"""Servidor local do soundStudy: API + interface web."""
import json
import os
import re
import secrets
import shutil
import sys
import threading
import time
import uuid
import webbrowser

# Bibliotecas imprimem emoji (o download da separação máxima, por exemplo). Fora do console, o Windows
# usa cp1252 na saída e o print dá UnicodeEncodeError, derrubando a etapa: a saída passa a ser UTF-8.
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # noqa: BLE001 - saída sem reconfigure (já trocada por outro programa)
        pass
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles

from . import celular as C
from . import hardware as H
from . import lyrics_api as LA
from . import pipeline as P
from . import tunel as T

WEB = P.ROOT / "web"
AUDIO_EXT = {".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".opus", ".wma", ".webm", ".mp4"}


@asynccontextmanager
async def lifespan(_app):
    P.start_worker()
    # a checagem da placa de vídeo carrega o PyTorch (alguns segundos): já começa agora
    threading.Thread(target=H.info, daemon=True, name="checa-maquina").start()
    if os.environ.get("PAUTA_ABRIR_NAVEGADOR") == "1":
        threading.Timer(1.0, webbrowser.open, args=("http://127.0.0.1:8765",)).start()
    # o túnel de fora de casa roda à parte: se estava ligado, continua com o mesmo endereço
    T.resume(C.PORTA)
    yield


app = FastAPI(title="soundStudy", lifespan=lifespan)

COOKIE_CHAVE = "ss_k"
_LOOPBACK = {"127.0.0.1", "::1", "::ffff:127.0.0.1"}

SEM_CHAVE = """<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>soundStudy</title>
<style>
html, body { margin: 0; background: #000; color: #fff; }
body { font: 17px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; padding: 40px 22px; }
main { max-width: 420px; margin: 0 auto; }
h1 { font-size: 24px; margin: 0 0 18px; }
ol { padding-left: 22px; margin: 0 0 22px; }
li { margin-bottom: 10px; }
p { margin: 0 0 14px; }
.nota { opacity: .6; font-size: 15px; }
</style></head>
<body><main>
<h1>soundStudy</h1>
<p>Para abrir no celular, use o link do seu computador:</p>
<ol>
<li>Abra o soundStudy no computador.</li>
<li>Toque na engrenagem e escolha <b>Abrir no celular</b>.</li>
<li>Leia o QR code com a câmera do celular ou digite o link que aparece.</li>
</ol>
<p class="nota">O celular e o computador precisam estar na mesma rede Wi-Fi.</p>
</main></body></html>"""


_LOCAL_HOSTS = {"127.0.0.1", "localhost", "[::1]", "::1"}
# cabeçalhos que túneis e proxies acrescentam (Cloudflare, ngrok, localhost.run, nginx...)
_PROXY_HEADERS = ("x-forwarded-for", "x-forwarded-host", "forwarded", "x-real-ip", "cf-connecting-ip",
                  "cf-ray", "true-client-ip", "x-original-host")


def _local(request):
    """É o próprio computador, abrindo pelo endereço local? Um túnel para a internet também chega
    pelo 127.0.0.1, mas com o endereço público no Host (e cabeçalhos de repasse): esse precisa da chave.
    Um site malicioso que aponte o próprio nome para 127.0.0.1 também cai fora (Host diferente)."""
    if not request.client or request.client.host not in _LOOPBACK:
        return False
    host = (request.headers.get("host") or "").strip().lower()
    host = host.rsplit(":", 1)[0] if not host.endswith("]") else host  # tira a porta
    if host not in _LOCAL_HOSTS:
        return False
    return not any(h in request.headers for h in _PROXY_HEADERS)


def _chave_certa(valor):
    return bool(valor) and secrets.compare_digest(valor.encode("utf-8"), C.chave().encode("utf-8"))


_SAFE = {"GET", "HEAD", "OPTIONS"}
# o que o navegador busca sem cookie e não tem nada de particular: ícone e manifesto da tela inicial
_PUBLIC = {"/static/manifest.webmanifest", "/static/icon-192.png", "/static/icon-512.png",
           "/static/icon-maskable-512.png"}


def _cross_site(request):
    """Pedido mandado por outro site aberto no navegador do PC (um formulário ou fetch escondido)."""
    if request.headers.get("sec-fetch-site") == "cross-site":
        return True
    origin = (request.headers.get("origin") or "").lower()
    if not origin or origin == "null":
        return origin == "null"
    host = origin.split("://", 1)[-1].split("/", 1)[0]
    host = host.rsplit(":", 1)[0] if not host.endswith("]") else host
    return host not in _LOCAL_HOSTS


@app.middleware("http")
async def so_com_chave(request, call_next):
    """O próprio computador entra direto. Outro aparelho (o celular, pela rede de casa) só com a chave:
    no link do QR code (`?k=`) ou no cookie que esse link grava, para o celular não precisar dela de novo.
    Mesmo no PC, pedido que muda alguma coisa (POST, PUT, DELETE) mandado por outro site é recusado: uma
    página maliciosa aberta no navegador poderia desligar o túnel, apagar músicas etc."""
    if request.url.path in _PUBLIC and request.method in _SAFE:
        return await call_next(request)
    if _local(request):
        if request.method not in _SAFE and _cross_site(request):
            return HTMLResponse("Pedido de outro site recusado.", status_code=403)
        return await call_next(request)
    k = request.query_params.get("k")
    if _chave_certa(k):
        response = await call_next(request)
        response.set_cookie(COOKIE_CHAVE, k, max_age=400 * 24 * 3600, httponly=True, samesite="lax")
        return response
    if _chave_certa(request.cookies.get(COOKIE_CHAVE)):
        return await call_next(request)
    return HTMLResponse(SEM_CHAVE, status_code=403)


# Declarado depois: fica por fora e também marca a página de "falta a chave".
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


@app.get("/api/celular")
def celular(request: Request):
    """Link (com a chave) e QR code para abrir no celular. Só o próprio computador vê."""
    if not _local(request):
        raise HTTPException(403, "Só no computador.")
    server = request.scope.get("server") or ()
    porta = server[1] if len(server) > 1 and server[1] else C.PORTA
    ip = C.lan_ip()
    url = C.phone_url(porta, ip)
    return {"url": url, "ip": ip, "porta": porta, "qr_svg": C.qr_svg(url),
            "ouvindo_rede": C.listening_on_lan(porta, ip)}


def _tunel_info(st):
    """Estado do túnel com o link já com a chave e o QR code."""
    url = f"{st['url']}/?k={C.chave()}" if st.get("url") else None
    return {"ligado": st["on"], "url": url, "via": st.get("via"), "erro": st.get("erro"), "qr_svg": C.qr_svg(url)}


@app.get("/api/tunel")
def tunel_status(request: Request):
    """Acesso de fora de casa (túnel pela internet). Só o próprio computador vê o link."""
    if not _local(request):
        raise HTTPException(403, "Só no computador.")
    return _tunel_info(T.status())


@app.post("/api/tunel/ligar")
def tunel_ligar(request: Request):
    if not _local(request):
        raise HTTPException(403, "Só no computador.")
    server = request.scope.get("server") or ()
    T.start(server[1] if len(server) > 1 and server[1] else C.PORTA)
    return _tunel_info(T.wait_url())


@app.post("/api/tunel/desligar")
def tunel_desligar(request: Request):
    if not _local(request):
        raise HTTPException(403, "Só no computador.")
    return _tunel_info(T.stop())


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


@app.get("/api/songs/{sid}/cifra")
def get_cifra(sid: str):
    meta = _song(sid, full=True)
    an = meta.get("analysis") or {}
    return {"text": P.cifra_text(sid), "source": an.get("chords_source", "auto")}


@app.put("/api/songs/{sid}/cifra")
def put_cifra(sid: str, body: dict):
    """Usa os acordes da cifra colada (encaixados no tempo da gravação). Texto vazio volta para os
    acordes que o app ouviu."""
    meta = _song(sid)
    if meta["status"] != "ready":
        raise HTTPException(409, "A música ainda está sendo processada.")
    try:
        P.save_cifra(sid, str(body.get("text", ""))[:40000])
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
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


# A pasta das músicas fica fora do Git: num computador novo ela ainda não existe.
P.SONGS.mkdir(parents=True, exist_ok=True)
app.mount("/files", StaticFiles(directory=P.SONGS), name="files")
app.mount("/static", StaticFiles(directory=WEB), name="static")


@app.get("/")
def index():
    return FileResponse(WEB / "index.html")
