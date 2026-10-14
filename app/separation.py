"""Separação da gravação em 6 partes: voz, violão (guitar), teclado (piano), outros, baixo e percussão.

Dois motores, os dois com as mesmas 6 partes:
- "rapida": Demucs htdemucs_6s (Meta, licença MIT). Roda bem até em computador sem placa de vídeo,
  mas às vezes confunde violão de nylon com piano (introduções dedilhadas, finais).
- "maxima": BS-RoFormer SW (6 partes; código MIT, pacote bs-roformer-infer). Bem melhor em violão e
  piano. Pesado: com placa de vídeo leva poucos minutos; sem placa, pode levar mais de meia hora.
  Atenção: a licença dos pesos é desconhecida. Serve para teste e uso pessoal; para vender o app,
  precisa resolver a licença ou treinar um modelo próprio.

Cada motor devolve {parte: áudio estéreo (2 x amostras) em 44,1 kHz}.
"""
import os
from pathlib import Path

import numpy as np
import soundfile as sf

ROOT = Path(__file__).resolve().parent.parent
MODELS = ROOT / "data" / "models"
PARTS = ["vocals", "guitar", "piano", "other", "bass", "drums"]


def run(engine, wav, device, progress=None):
    if engine == "maxima":
        return _roformer(wav, device, progress)
    return _demucs(wav, device, progress)


def _demucs(wav, device, progress):
    import torch
    import demucs.apply as dap
    from demucs.pretrained import get_model

    torch.set_num_threads(os.cpu_count() or 4)
    model = get_model("htdemucs_6s")
    model.eval()
    audio, sr = sf.read(str(wav), dtype="float32", always_2d=True)
    mix = torch.from_numpy(audio.T.copy())
    ref = mix.mean(0)
    mean, std = ref.mean(), ref.std() + 1e-8

    class _Progress:  # o demucs usa tqdm.tqdm(...) para mostrar o andamento
        @staticmethod
        def tqdm(iterable, **_):
            items = list(iterable)
            for i, item in enumerate(items):
                yield item
                if progress:
                    progress((i + 1) / max(1, len(items)))

    original = dap.tqdm
    dap.tqdm = _Progress
    try:
        with torch.no_grad():
            out = dap.apply_model(model, ((mix - mean) / std)[None], shifts=1, split=True,
                                  overlap=0.25, progress=True, device=device)[0]
    finally:
        dap.tqdm = original
    out = (out * std + mean).cpu().numpy()
    return {name: src for name, src in zip(model.sources, out)}, sr


def _roformer(wav, device, progress):
    import torch
    import torch.nn as nn
    import yaml
    from ml_collections import ConfigDict
    from bs_roformer.download import ensure_model_assets
    from bs_roformer.inference import SafeLoaderWithTuple
    from bs_roformer.model_registry import DEFAULT_MODEL
    from bs_roformer.utils import get_model_from_config, get_windowing_array

    torch.set_num_threads(os.cpu_count() or 4)
    model_path, config_path = ensure_model_assets(DEFAULT_MODEL, models_dir=MODELS)
    with open(config_path, encoding="utf-8") as fh:
        config = ConfigDict(yaml.load(fh, Loader=SafeLoaderWithTuple))
    model = get_model_from_config("bs_roformer", config)
    try:
        state = torch.load(model_path, map_location="cpu", weights_only=True)
    except Exception:  # noqa: BLE001 - arquivo antigo que só abre do jeito completo
        state = torch.load(model_path, map_location="cpu", weights_only=False)
    model.load_state_dict(state)
    model.to(device).eval()

    audio, sr = sf.read(str(wav), dtype="float32", always_2d=True)
    mix = torch.tensor(audio.T.copy())
    if mix.shape[0] == 1:
        mix = mix.repeat(2, 1)

    # sobreposição de janelas como no pacote original, com o andamento informado
    C = int(config.inference.chunk_size)
    N = int(config.inference.num_overlap)
    step = C // N
    fade = C // 10
    border = C - step
    padded = mix.shape[1] > 2 * border
    if padded:
        mix = nn.functional.pad(mix, (border, border), mode="reflect")
    window = get_windowing_array(C, fade, device)
    names = list(config.training.instruments)
    total = mix.shape[1]
    result = torch.zeros((len(names), 2, total), dtype=torch.float32, device=device)
    counter = torch.zeros_like(result)
    use_amp = device == "cuda"
    with torch.no_grad(), torch.autocast(device_type="cuda", enabled=use_amp):
        mix = mix.to(device)
        i = 0
        n_chunks = (total + step - 1) // step
        k = 0
        while i < total:
            part = mix[:, i:i + C]
            length = part.shape[-1]
            if length < C:
                mode = "reflect" if length > C // 2 + 1 else "constant"
                part = nn.functional.pad(part, (0, C - length), mode=mode)
            x = model(part.unsqueeze(0))[0].float()
            w = window.clone()
            if i == 0:
                w[:fade] = 1
            elif i + C >= total:
                w[-fade:] = 1
            result[..., i:i + length] += x[..., :length] * w[..., :length]
            counter[..., i:i + length] += w[..., :length]
            i += step
            k += 1
            if progress:
                progress(min(1.0, k / n_chunks))
    out = (result / counter).cpu().numpy()
    np.nan_to_num(out, copy=False, nan=0.0)
    if padded:
        out = out[..., border:-border]
    return {name: src for name, src in zip(names, out)}, sr
