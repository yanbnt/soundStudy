"""O que esta máquina aguenta, e o que usar em cada etapa (modo automático de qualidade).

Com placa de vídeo NVIDIA (CUDA) tudo roda nela e dá para usar os modelos mais pesados:
separação "máxima" (BS-RoFormer, 6 partes) e reconhecimento de letra maior. Sem placa, o padrão é
o modo rápido; a pessoa pode forçar o máximo mesmo assim (fica bem mais lento).
"""
import json
import os
import sys
from functools import lru_cache
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / "data" / "config.json"
DEFAULTS = {"qualidade": "auto"}  # auto | rapida | maxima
CHOICES = ("auto", "rapida", "maxima")


def load():
    try:
        data = json.loads(CONFIG.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        data = {}
    out = dict(DEFAULTS)
    out.update({k: v for k, v in data.items() if k in DEFAULTS})
    if out["qualidade"] not in CHOICES:
        out["qualidade"] = "auto"
    return out


def save(**changes):
    data = load()
    data.update({k: v for k, v in changes.items() if k in DEFAULTS})
    CONFIG.parent.mkdir(parents=True, exist_ok=True)
    CONFIG.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    return data


@lru_cache(maxsize=1)
def info():
    """Placa de vídeo (se houver), memória dela e núcleos do processador."""
    out = {"gpu": False, "gpu_name": None, "vram_gb": 0.0, "cpus": os.cpu_count() or 1}
    try:
        import torch
        out["torch"] = torch.__version__
        if torch.cuda.is_available():
            props = torch.cuda.get_device_properties(0)
            out.update(gpu=True, gpu_name=props.name, vram_gb=round(props.total_memory / 2 ** 30, 1))
    except Exception:  # noqa: BLE001 - sem torch funcional: segue como máquina sem placa
        pass
    return out


def device():
    return "cuda" if info()["gpu"] else "cpu"


def plan():
    """O que usar em cada etapa, conforme a preferência e a máquina."""
    pref = load()["qualidade"]
    hw = info()
    strong = hw["gpu"] and hw["vram_gb"] >= 4
    maxima = pref == "maxima" or (pref == "auto" and strong)
    return {
        "qualidade": pref,
        "separacao": "maxima" if maxima else "rapida",
        "letra": "large-v3" if (hw["gpu"] and maxima) else "small",
        "device": device(),
        "visual": "alta" if strong else "leve",
    }


def add_cuda_dlls():
    """No Windows, as bibliotecas da NVIDIA instaladas pelo pip (cuBLAS, cuDNN) ficam em
    site-packages/nvidia/*/bin; o reconhecimento de letra na placa precisa achá-las."""
    if os.name != "nt":
        return
    for base in sys.path:
        nv = Path(base) / "nvidia"
        if not nv.is_dir():
            continue
        for sub in nv.iterdir():
            b = sub / "bin"
            if b.is_dir():
                try:
                    os.add_dll_directory(str(b))
                except OSError:
                    pass
                os.environ["PATH"] = str(b) + os.pathsep + os.environ.get("PATH", "")
