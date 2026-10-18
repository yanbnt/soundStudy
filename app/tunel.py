"""Acesso de fora de casa: um túnel da internet até o soundStudy deste computador.

Sem conta e sem configurar roteador. Usa o cloudflared (Cloudflare, "quick tunnel") se ele estiver
instalado (data/bin/cloudflared.exe ou no PATH); senão, o SSH que já vem no Windows com o serviço
localhost.run (bem mais lento). Os dois dão um endereço https aleatório.

O túnel roda num processo à parte e **sobrevive a reinícios do servidor**: o endereço fica em
data/bin/tunel.json e o servidor, ao voltar, reaproveita o túnel aberto (o link de quem está fora de
casa continua valendo). Ele só desliga pelo botão "Desligar acesso pela internet" (ou se o
computador desligar). Se o processo do túnel cair, ele é aberto de novo (o endereço muda).

Segurança: pelo túnel ninguém entra sem a chave de acesso (ver server._local e celular.chave). Com o
servidor parado o túnel não expõe nada (a Cloudflare só responde erro).
"""
import ctypes
import json
import re
import shutil
import subprocess
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BIN = ROOT / "data" / "bin"
STATE = BIN / "tunel.json"
LOG = BIN / "tunel.log"
PORTA = 8765
_URL_RE = {
    "cloudflared": re.compile(r"https://[a-z0-9-]+\.trycloudflare\.com"),
    # só a linha "... tunneled with tls termination, https://xxxx.lhr.life" (o texto de boas-vindas
    # também traz links do próprio serviço, como https://admin.localhost.run)
    "ssh": re.compile(r"tunneled with tls termination, (https://[a-z0-9-]+\.lhr\.life)"),
}

_lock = threading.Lock()
_watch = None
_stop = threading.Event()


# ---------------------------------------------------------------- processo (Windows)

def _alive(pid, names=("cloudflared.exe", "cloudflared", "ssh.exe", "ssh")):
    """O processo ainda existe e é o do túnel? (no Windows, os.kill(pid, 0) MATARIA o processo)"""
    if not pid:
        return False
    try:
        k32 = ctypes.windll.kernel32
    except AttributeError:  # fora do Windows
        try:
            import os
            os.kill(pid, 0)
            return True
        except OSError:
            return False
    h = k32.OpenProcess(0x1000, False, int(pid))  # PROCESS_QUERY_LIMITED_INFORMATION
    if not h:
        return False
    try:
        code = ctypes.c_ulong()
        if not k32.GetExitCodeProcess(h, ctypes.byref(code)) or code.value != 259:  # STILL_ACTIVE
            return False
        buf = ctypes.create_unicode_buffer(1024)
        size = ctypes.c_ulong(1024)
        if k32.QueryFullProcessImageNameW(h, 0, buf, ctypes.byref(size)):
            return Path(buf.value).name.lower() in names  # nome exato (ssh-agent/sshd não contam)
        return False
    finally:
        k32.CloseHandle(h)


def _kill(pid):
    """Encerra o túnel, mas só se o processo ainda for o túnel (o Windows reaproveita números de
    processo: sem a checagem, um programa qualquer que ganhasse o mesmo número seria encerrado)."""
    if pid and _alive(pid):
        subprocess.run(["taskkill", "/PID", str(int(pid)), "/T", "/F"], capture_output=True)


def _read():
    for _ in range(10):
        try:
            return json.loads(STATE.read_text(encoding="utf-8"))
        except PermissionError:  # outro está trocando o arquivo neste instante
            time.sleep(0.03)
        except (OSError, ValueError):
            return {}
    return {}


def _write(st):
    """Grava o estado. No Windows trocar um arquivo que outro está lendo dá "Acesso negado": tenta de novo."""
    BIN.mkdir(parents=True, exist_ok=True)
    tmp = STATE.with_suffix(".tmp")
    tmp.write_text(json.dumps(st), encoding="utf-8")
    for i in range(40):
        try:
            tmp.replace(STATE)
            return
        except PermissionError:
            if i == 39:
                raise
            time.sleep(0.05)


def _cloudflared():
    for p in (BIN / "cloudflared.exe", BIN / "cloudflared"):
        if p.exists():
            return str(p)
    return shutil.which("cloudflared")


def _command(port):
    exe = _cloudflared()
    if exe:
        return "cloudflared", [exe, "tunnel", "--no-autoupdate", "--url", f"http://127.0.0.1:{port}"]
    ssh = shutil.which("ssh")
    if ssh:
        return "ssh", [ssh, "-T", "-o", "StrictHostKeyChecking=accept-new", "-o", "ServerAliveInterval=30",
                       "-o", "ServerAliveCountMax=3", "-o", "ExitOnForwardFailure=yes", "-o", "BatchMode=yes",
                       "-R", f"80:127.0.0.1:{port}", "nokey@localhost.run"]
    return None, None


def _spawn(port):
    """Abre o túnel num processo à parte (sem janela, fora do grupo do servidor) e devolve o estado."""
    via, cmd = _command(port)
    if not cmd:
        return {"erro": "Este computador não tem SSH nem cloudflared para abrir o túnel.", "desde": time.time()}
    BIN.mkdir(parents=True, exist_ok=True)
    for f in (LOG, LOG.with_suffix(".out")):
        try:
            f.unlink()
        except OSError:
            pass
    pid = None
    if hasattr(ctypes, "windll"):
        # Pelo Start-Process do PowerShell, que sai logo: o túnel não fica "filho" do servidor e não cai
        # quando o servidor é parado ou reiniciado (parar o servidor mata a árvore de processos dele).
        # O número do processo vai para um arquivo: com a saída do PowerShell num "pipe", o túnel herdava
        # o pipe e o servidor ficava esperando ele fechar.
        q = lambda s: "'" + str(s).replace("'", "''") + "'"  # noqa: E731
        pid_file = BIN / "tunel.pid"
        try:
            pid_file.unlink()
        except OSError:
            pass
        ps = (f"$p = Start-Process -FilePath {q(cmd[0])} -ArgumentList {','.join(q(a) for a in cmd[1:])} "
              f"-WindowStyle Hidden -RedirectStandardError {q(LOG)} -RedirectStandardOutput {q(LOG.with_suffix('.out'))} "
              f"-PassThru; Set-Content -Path {q(pid_file)} -Value $p.Id")
        try:
            subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", ps], stdin=subprocess.DEVNULL,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=30, creationflags=0x08000000)
            pid = int(pid_file.read_text(encoding="utf-8", errors="ignore").strip().lstrip("﻿"))
        except (OSError, ValueError, subprocess.TimeoutExpired):
            pid = None
    if pid is None:  # fora do Windows (ou sem PowerShell): processo à parte comum
        with open(LOG, "w", encoding="utf-8") as log:
            try:
                pid = subprocess.Popen(cmd, stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT,
                                       start_new_session=True).pid
            except OSError:
                return {"erro": "Não consegui abrir o túnel.", "desde": time.time()}
    st = {"pid": pid, "via": via, "port": port, "url": None, "desde": time.time()}
    _write(st)
    return st


def _find_url(st):
    text = ""
    for f in (LOG, LOG.with_suffix(".out")):  # o cloudflared escreve no erro; o ssh, na saída
        try:
            text += f.read_text(encoding="utf-8", errors="replace")
        except OSError:
            pass
    if not text:
        return None
    m = _URL_RE.get(st.get("via"), _URL_RE["cloudflared"]).search(text)
    return m.group(m.lastindex or 0) if m else None


# ---------------------------------------------------------------- vigia

def _watchdog(port):
    """Enquanto o túnel estiver ligado: anota o endereço quando ele aparece e reabre se o processo cair.
    Se ele cai logo depois de abrir (sem internet, Cloudflare fora), espera cada vez mais entre as
    tentativas (5 s, 10 s, 20 s... até 2 min) e avisa na tela; nunca morre por um erro."""
    wait = 2.0
    while not _stop.wait(wait):
        wait = 2.0
        try:
            with _lock:
                st = _read()
                if not st.get("ligado"):
                    return
                if not _alive(st.get("pid")):
                    if time.time() < st.get("proxima", 0):
                        wait = max(1.0, st["proxima"] - time.time())
                        continue
                    quick = time.time() - st.get("desde", 0) < 60 and not st.get("url")
                    fails = (st.get("falhas", 0) + 1) if quick else 0
                    new = _spawn(st.get("port") or port)
                    new.update(ligado=True, falhas=fails)
                    if fails:
                        new["proxima"] = time.time() + min(120, 5 * 2 ** (fails - 1))
                    if fails >= 3:
                        new["erro"] = "O túnel não está conseguindo abrir (sem internet?). Tentando de novo…"
                    _write(new)
                    continue
                if not st.get("url"):
                    url = _find_url(st)
                    if url:
                        st.update(url=url, falhas=0, erro=None)
                        st.pop("proxima", None)
                        _write(st)
        except Exception:  # noqa: BLE001 - o vigia não pode morrer: tenta de novo na próxima volta
            import traceback
            traceback.print_exc()
            wait = 5.0


def _ensure_watch(port):
    global _watch
    if _watch is None or not _watch.is_alive():
        _stop.clear()
        _watch = threading.Thread(target=_watchdog, args=(port,), daemon=True, name="tunel")
        _watch.start()


# ---------------------------------------------------------------- API

def status():
    st = _read()
    on = bool(st.get("ligado")) and _alive(st.get("pid"))
    return {"on": bool(st.get("ligado")), "url": st.get("url") if on else None, "via": st.get("via"),
            "erro": st.get("erro"), "desde": st.get("desde")}


def resume(port=PORTA):
    """Na volta do servidor: se o túnel estava ligado, reaproveita (ou reabre) e volta a vigiar."""
    if _read().get("ligado"):
        _ensure_watch(port)


def start(port=PORTA):
    """Liga o túnel (se já estiver ligado e vivo, reaproveita o mesmo endereço)."""
    with _lock:
        st = _read()
        if not (st.get("ligado") and _alive(st.get("pid"))):
            _kill(st.get("pid"))  # só se ainda for um túnel nosso
            st = _spawn(port)
            st["ligado"] = "erro" not in st
            _write(st)
    _ensure_watch(port)
    return status()


def stop():
    _stop.set()
    with _lock:
        st = _read()
        _kill(st.get("pid"))  # só se ainda for o túnel
        _write({"ligado": False})
    return status()


def wait_url(timeout=30.0):
    """Espera o endereço aparecer (o túnel leva alguns segundos para abrir)."""
    end = time.time() + timeout
    while time.time() < end:
        st = _read()
        if not st.get("url") and st.get("ligado"):
            url = _find_url(st)
            if url:
                with _lock:
                    cur = _read()
                    if cur.get("pid") == st.get("pid") and cur.get("ligado"):  # ainda é o mesmo túnel
                        cur["url"] = url
                        _write(cur)
        s = status()
        if s["url"] or s["erro"] or not s["on"]:
            return s
        time.sleep(0.4)
    return status()
