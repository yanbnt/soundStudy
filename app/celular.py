"""Abrir o soundStudy no celular pela rede de casa (Wi-Fi): o PC processa tudo, o celular só mostra.

Quem não é o próprio computador precisa da chave (`chave_celular` em data/config.json). Ela vai no
link do QR code (`?k=`); na primeira visita o servidor grava um cookie e o celular não precisa mais dela.
O servidor tem que escutar na rede (`--host 0.0.0.0`, como no iniciar.bat).
"""
import io
import secrets
import socket
import threading

from . import hardware as H

PORTA = 8765
CAMPO = "chave_celular"

_lock = threading.Lock()
_chave = None


def _valido(ip):
    return bool(ip) and not ip.startswith(("127.", "0.", "169.254."))


def lan_ip():
    """IPv4 do PC na rede de casa, ou None se ele só tiver o 127.0.0.1."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))  # UDP: o "connect" só escolhe a placa de rede, nada é enviado
            ip = s.getsockname()[0]
        if _valido(ip):
            return ip
    except OSError:  # sem rota para a internet: tenta pelo nome do computador
        pass
    try:
        ips = [ip for ip in socket.gethostbyname_ex(socket.gethostname())[2] if _valido(ip)]
    except OSError:
        return None
    # rede de casa costuma ser 192.168.x.x; placas virtuais (VirtualBox, Hyper-V) ficam por último
    ips.sort(key=lambda ip: not ip.startswith("192.168."))
    return ips[0] if ips else None


def chave():
    """Chave de acesso do celular; criada na primeira vez e guardada no config.json."""
    global _chave
    with _lock:
        if _chave:
            return _chave
        k = H.read_raw().get(CAMPO)
        if not isinstance(k, str) or len(k) < 8:
            k = secrets.token_urlsafe(9)
            H.write_raw(**{CAMPO: k})
        _chave = k
        return k


def phone_url(port=PORTA, ip=None):
    """Link que o celular abre (já com a chave), ou None sem rede."""
    ip = ip or lan_ip()
    return f"http://{ip}:{port}/?k={chave()}" if ip else None


def qr_svg(text):
    """QR code em SVG (módulos pretos em fundo branco, com margem: lê bem na página preta).
    None sem o pacote segno."""
    if not text:
        return None
    try:
        import segno
    except ImportError:
        return None
    buf = io.BytesIO()
    segno.make_qr(text, error="m").save(buf, kind="svg", scale=8, border=4, dark="#000", light="#fff",
                                        xmldecl=False, omitsize=True, nl=False)
    return buf.getvalue().decode("utf-8")


def listening_on_lan(port=PORTA, ip=None):
    """True se o servidor atende pelo IP da rede (foi aberto com --host 0.0.0.0)."""
    ip = ip or lan_ip()
    if not ip:
        return False
    try:
        with socket.create_connection((ip, port), timeout=0.3):
            return True
    except OSError:
        return False
