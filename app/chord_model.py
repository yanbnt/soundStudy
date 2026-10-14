"""Acordes com o BTC (Park et al., "A Bi-directional Transformer for Musical Chord Recognition",
ISMIR 2019; código e pesos sob licença MIT, ver app/btc/LICENSE).

É uma rede treinada com gravações reais: a cada quadro (~0,09 s) ela dá a probabilidade de 170
acordes (12 raízes x 14 tipos, mais "sem acorde" e "desconhecido").
"""
import sys
from pathlib import Path

import librosa
import numpy as np

BTC_DIR = Path(__file__).resolve().parent / "btc"
SR = 22050
HOP = 2048
TIMESTEP = 108          # quadros por janela de 10 s
FRAME_SEC = 10.0 / TIMESTEP
N_CLASSES = 170
QUALITIES = ["min", "maj", "dim", "aug", "min6", "maj6", "min7", "minmaj7", "maj7", "7", "dim7",
             "hdim7", "sus2", "sus4"]
# tipo do BTC -> tipo do soundStudy (analysis.CHORD_TYPES)
KIND = {"min": "min", "maj": "maj", "dim": "dim", "aug": "aug", "min6": "m6", "maj6": "6",
        "min7": "m7", "minmaj7": "mmaj7", "maj7": "maj7", "7": "7", "dim7": "dim7",
        "hdim7": "m7b5", "sus2": "sus2", "sus4": "sus4"}

_model = None


def labels():
    """Rótulo de cada classe: (raiz 0-11, tipo) ou None para "sem acorde"/"desconhecido"."""
    out = [(i // 14, KIND[QUALITIES[i % 14]]) for i in range(168)]
    return out + [None, None]


def available():
    return (BTC_DIR / "btc_model_large_voca.pt").exists()


def _load():
    global _model
    if _model is None:
        import torch
        import yaml
        if str(BTC_DIR) not in sys.path:
            sys.path.insert(0, str(BTC_DIR))
        from btc_model import BTC_model
        from utils.hparams import HParams

        with open(BTC_DIR / "run_config.yaml", encoding="utf-8") as fh:
            config = HParams(**yaml.safe_load(fh))  # o HParams.load original usa uma API antiga do yaml
        config.feature["large_voca"] = True
        config.model["num_chords"] = N_CLASSES
        model = BTC_model(config=config.model)
        ckpt = torch.load(BTC_DIR / "btc_model_large_voca.pt", map_location="cpu",
                          weights_only=False)
        model.load_state_dict(ckpt["model"])
        model.eval()
        _model = (model, ckpt["mean"], ckpt["std"])
    return _model


def frame_probs(y):
    """Probabilidade de cada acorde em cada quadro: matriz (quadros x 170). `y` mono em 22050 Hz."""
    import torch
    model, mean, std = _load()
    step = int(SR * 10.0)
    parts = [librosa.cqt(y[a:a + step], sr=SR, n_bins=144, bins_per_octave=24, hop_length=HOP)
             for a in range(0, len(y), step) if len(y[a:a + step]) >= HOP]
    feat = np.log(np.abs(np.concatenate(parts, axis=1)) + 1e-6).T
    feat = (feat - mean) / std
    n = len(feat)
    feat = np.pad(feat, ((0, (-n) % TIMESTEP), (0, 0)))
    x = torch.tensor(feat, dtype=torch.float32).unsqueeze(0)
    out = []
    with torch.no_grad():
        for t in range(len(feat) // TIMESTEP):
            hidden, _ = model.self_attn_layers(x[:, t * TIMESTEP:(t + 1) * TIMESTEP, :])
            logits = model.output_layer.output_projection(hidden)
            out.append(torch.softmax(logits, -1)[0].numpy())
    return np.concatenate(out)[:n]


def beat_log_probs(probs, times, trim=0.1):
    """Log da probabilidade média de cada acorde dentro de cada tempo (tempos x 170)."""
    t = np.asarray(times)
    out = np.zeros((len(t) - 1, probs.shape[1]))
    for i in range(len(t) - 1):
        span = t[i + 1] - t[i]
        fa = int(max(0, np.floor((t[i] + trim * span) / FRAME_SEC)))
        fb = int(max(fa + 1, np.ceil((t[i + 1] - trim * span) / FRAME_SEC)))
        if fa < len(probs):
            out[i] = probs[fa:min(fb, len(probs))].mean(axis=0)
        else:
            out[i, -1] = 1.0
    return np.log(out + 1e-4)
