"""Servidor local do soundStudy: API + interface web."""
import json
import os
import re
import shutil
import threading
import time
import uuid
import webbrowser
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import hardware as H
from . import lyrics_api as LA
from . import pipeline as P

WEB = P.ROOT / "web"
AUDIO_EXT = {".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".opus", ".wma", ".webm", ".mp4"}


@asynccontextmanager
async def lifespan(_app):
    P.start_worker()
    # a checagem da placa de vídeo carrega o PyTorch (alguns segundos): já começa agora
    threading.Thread(target=H.info, daemon=True, name="checa-maquina").start()
    if os.environ.get("PAUTA_ABRIR_NAVEGADOR") == "1":
        threading.Timer(1.0, webbrowser.open, args=("http://127.0.0.1:8765",)).start()
    yield


app = FastAPI(title="soundStudy", lifespan=lifespan)


@app.middleware("http")
async def always_fresh(request, call_next):
    """Partituras mudam quando a letra é corrigida, as partes de áudio quando a música é separada de
    novo e a interface quando o programa é atualizado: o navegador tem que conferir sempre (com o
    ETag, se nada mudou, a resposta é rápida e o arquivo vem do cache)."""
    response = await call_next(request)
    response.headers.setdefault("Cache-Control", "no-cache")
    return response


def _song(sid, full=False):
    if not re.fullmatch(r"[a-z0-9-]+", sid) or not P.meta_path(sid).exists():
        raise HTTPException(404, "Música não encontrada")
    meta = P.read_meta(sid)
    meta["queue_position"] = P.queue_position(sid)
    if full and meta.get("status") == "ready":
        meta["analysis"] = json.loads((P.SONGS / sid / "analysis.json").read_text(encoding="utf-8"))
    return meta


@app.get("/api/stages")
def stages():
    return [{"key": k, "label": label} for k, label, _ in P.STAGES]


@app.get("/api/songs")
def list_songs():
    out = []
    for d in P.SONGS.iterdir():
        if (d / "meta.json").exists():
            out.append(_song(d.name))
    return sorted(out, key=lambda m: m.get("created_at", 0), reverse=True)


@app.get("/api/songs/{sid}")
def get_song(sid: str):
    return _song(sid, full=True)


@app.post("/api/songs")
async def upload(file: UploadFile = File(...)):
    ext = Path(file.filename or "").suffix.lower()
    if ext not in AUDIO_EXT:
        raise HTTPException(400, "Formato não suportado. Use MP3, WAV, M4A, FLAC ou OGG.")
    sid = time.strftime("%Y%m%d-%H%M%S-") + uuid.uuid4().hex[:6]
    d = P.SONGS / sid
    d.mkdir(parents=True)
    with open(d / f"source{ext}", "wb") as fh:
        shutil.copyfileobj(file.file, fh)
    title = re.sub(r"[_]+", " ", Path(file.filename).stem).strip() or "Sem título"
    P.write_meta(sid, id=sid, title=title, source=f"source{ext}", created_at=time.time(),
                 status="queued", stage=None, progress=0.0, error=None)
    P.enqueue(sid)
    # a capa (e a cor da tela) já aparece enquanto a música é processada
    threading.Thread(target=P.add_cover, args=(sid,), daemon=True, name="capa").start()
    return _song(sid)


@app.post("/api/songs/{sid}/reprocess")
def reprocess(sid: str, separacao: str = ""):
    """`separacao=maxima` (ou `rapida`) separa de novo com esse motor, só para esta música."""
    meta = _song(sid)
    if meta["status"] in ("queued", "processing"):
        raise HTTPException(409, "Essa música já está na fila.")
    if separacao in ("maxima", "rapida"):
        P.write_meta(sid, pedido_separacao=separacao)
    P.enqueue(sid)
    return _song(sid)


@app.get("/api/config")
def get_config():
    """Modo de qualidade, o que foi detectado na máquina e o que vai ser usado."""
    return {**H.load(), "hardware": H.info(), "plano": H.plan()}


@app.put("/api/config")
def put_config(body: dict):
    q = str(body.get("qualidade", "")).strip()
    if q not in H.CHOICES:
        raise HTTPException(400, "Qualidade inválida")
    H.save(qualidade=q)
    return get_config()


@app.get("/api/songs/{sid}/lyrics")
def get_lyrics(sid: str):
    meta = _song(sid, full=True)
    an = meta.get("analysis") or {}
    return {"text": "\n".join(l["text"] for l in an.get("lyrics", [])),
            "source": an.get("lyrics_source", "auto")}


@app.put("/api/songs/{sid}/lyrics")
def put_lyrics(sid: str, body: dict):
    """Texto vazio volta para a letra da base ou para a reconhecida automaticamente."""
    meta = _song(sid)
    if meta["status"] != "ready":
        raise HTTPException(409, "A música ainda está sendo processada.")
    P.save_lyrics(sid, str(body.get("text", ""))[:20000])
    return _song(sid, full=True)


@app.post("/api/songs/{sid}/lyrics/recognize")
def recognize_lyrics(sid: str):
    """Ouve a voz de novo com o modelo grande de reconhecimento (refaz a análise; a separação fica)."""
    meta = _song(sid)
    if meta["status"] in ("queued", "processing"):
        raise HTTPException(409, "Essa música já está na fila.")
    P.write_meta(sid, pedido_letra="large-v3")
    P.enqueue(sid)
    return _song(sid)


_found = {}  # últimas versões achadas na base de letras, por música (para não buscar duas vezes)


@app.get("/api/songs/{sid}/lyrics/search")
def search_lyrics(sid: str, q: str = ""):
    meta = _song(sid)
    try:
        items = LA.search(meta["title"], meta.get("duration"), query=q.strip()[:120] or None)
    except Exception:  # noqa: BLE001
        raise HTTPException(502, "A base de letras não respondeu agora. Tente de novo daqui a pouco ou cole a letra.")
    _found[sid] = {it["id"]: it for it in items}
    artist, track = LA.guess(meta["title"])
    return {"query": f"{artist} {track}".strip(), "results": [LA.summary(it) for it in items]}


@app.post("/api/songs/{sid}/lyrics/use")
def use_lyrics(sid: str, body: dict):
    meta = _song(sid)
    if meta["status"] != "ready":
        raise HTTPException(409, "A música ainda está sendo processada.")
    try:
        lid = int(body.get("id"))
    except (TypeError, ValueError):
        raise HTTPException(400, "Versão inválida")
    item = _found.get(sid, {}).get(lid)
    if item is None:
        try:
            item = LA.get(lid)
        except Exception:  # noqa: BLE001
            raise HTTPException(502, "A base de letras não respondeu agora. Tente de novo daqui a pouco.")
    P.use_api_lyrics(sid, item)
    return _song(sid, full=True)


@app.patch("/api/songs/{sid}")
def rename(sid: str, body: dict):
    _song(sid)
    title = str(body.get("title", "")).strip()[:120]
    if not title:
        raise HTTPException(400, "Título vazio")
    meta = P.write_meta(sid, title=title)
    if meta.get("capa_fonte") != "arquivo":  # nome novo pode achar a capa certa na loja
        threading.Thread(target=P.add_cover, args=(sid,), daemon=True, name="capa").start()
    return _song(sid)


@app.delete("/api/songs/{sid}")
def delete(sid: str):
    meta = _song(sid)
    if meta["status"] == "processing":
        raise HTTPException(409, "Espere terminar o processamento para excluir.")
    shutil.rmtree(P.SONGS / sid)
    return {"ok": True}


app.mount("/files", StaticFiles(directory=P.SONGS), name="files")
app.mount("/static", StaticFiles(directory=WEB), name="static")


@app.get("/")
def index():
    return FileResponse(WEB / "index.html")
