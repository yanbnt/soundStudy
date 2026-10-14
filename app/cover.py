"""Capa da música e as cores que saem dela (a tela pinta botões, barra e fundo com essas cores).

De onde vem a capa, nesta ordem:
1. a imagem que vem dentro do próprio arquivo (MP3, M4A e FLAC de loja costumam trazer);
2. a capa da loja do iTunes, pela busca pública (sem cadastro), com o artista e a música do nome do arquivo;
3. nenhuma: a tela usa a cor do tom da música (cada tom tem a sua, pelo círculo das quintas).

Atenção: capa de disco é da gravadora. Mostrar a capa do próprio arquivo é o que qualquer player faz; a
busca na internet serve para uso pessoal. Para vender o app, precisa de licença ou desligar a busca
(BUSCAR_NA_INTERNET = False).
"""
import colorsys
import io
import json
import os
import subprocess
import urllib.parse
import urllib.request

from . import lyrics_api as LA

BUSCAR_NA_INTERNET = True
USER_AGENT = "PautaViva/0.2 (app local de estudo de musica)"
NAME = "cover.jpg"


def _ffmpeg():
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()


def embedded(src, out):
    """Tira a imagem que vem dentro do arquivo de áudio. Devolve True se havia uma."""
    flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
    r = subprocess.run([_ffmpeg(), "-hide_banner", "-loglevel", "error", "-y", "-i", str(src), "-an",
                        "-map", "0:v:0", "-frames:v", "1", "-q:v", "2", str(out)],
                       capture_output=True, creationflags=flags)
    ok = r.returncode == 0 and out.exists() and out.stat().st_size > 1000
    if not ok and out.exists():
        out.unlink()
    return ok


def _get(url, timeout=10):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def lookup(title, duration=None):
    """Capa na loja do iTunes: (bytes da imagem 1200x1200, crédito) ou (None, None) se não achar com
    segurança (nome da música e do artista batendo, duração parecida quando a loja informa)."""
    artist, track = LA.guess(title)
    if not track:
        return None, None
    query = urllib.parse.urlencode({"term": f"{artist} {track}".strip(), "media": "music", "entity": "song",
                                    "limit": 15, "country": "BR"})
    items = json.loads(_get(f"https://itunes.apple.com/search?{query}").decode("utf-8")).get("results", [])

    def score(it):
        s = 2.0 * LA._sim(it.get("trackName"), track)
        if artist:
            s += 1.5 * LA._sim(it.get("artistName"), artist)
        if duration and it.get("trackTimeMillis"):
            s -= min(2.0, abs(it["trackTimeMillis"] / 1000 - duration) / 20)
        # coletânea de vários artistas: a capa não é do artista; fica para o fim da fila
        album_artist = it.get("collectionArtistName")
        if album_artist and artist and LA._sim(album_artist, artist) < 0.6:
            s -= 1.0
        return s

    for it in sorted(items, key=score, reverse=True):
        name_ok = LA._sim(it.get("trackName"), track) >= 0.75
        artist_ok = not artist or LA._sim(it.get("artistName"), artist) >= 0.6
        art = it.get("artworkUrl100")
        if name_ok and artist_ok and art:
            big = art.replace("100x100bb", "1200x1200bb")  # grande: também vira o fundo do Modo Show
            credit = {"fonte": "iTunes", "artista": it.get("artistName"), "album": it.get("collectionName"),
                      "musica": it.get("trackName")}
            return _get(big), credit
        break  # a melhor não bateu: melhor ficar sem capa do que pôr a capa errada
    return None, None


def _hex(rgb):
    return "#%02x%02x%02x" % tuple(max(0, min(255, round(c * 255))) for c in rgb)


def colors(path):
    """Cores da capa para a tela: o destaque (a cor mais viva que aparece bem), o fundo (a mesma cor,
    bem escura, para o degradê do topo) e a tinta (preto ou branco, o que se lê melhor em cima do
    destaque). None quando a capa é quase sem cor (preto e branco)."""
    import math

    from PIL import Image

    im = Image.open(path).convert("RGB")
    im.thumbnail((120, 120))
    pixels = list(im.getdata())
    # Roda de cores em 36 fatias de 10°: cada pixel colorido vota na sua fatia, com mais peso quanto mais
    # viva e mais "meio-termo" (nem escura nem clara) a cor. Fundo branco, preto e cinza não votam.
    # Assim ganha a cor que salta aos olhos (o título, uma roupa), mesmo ocupando pouco da capa.
    weights = [0.0] * 36
    members = [[] for _ in range(36)]
    for r, g, b in pixels:
        h, l, s = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
        if s < 0.3 or l < 0.18 or l > 0.85:
            continue
        k = int(h * 36) % 36
        weights[k] += s * s * (1 - abs(l - 0.5))
        members[k].append((h, l, s))
    k = max(range(36), key=lambda i: weights[i - 1] + weights[i] + weights[(i + 1) % 36])
    group = members[k - 1] + members[k] + members[(k + 1) % 36]
    if len(group) < 0.006 * len(pixels):  # capa quase sem cor (preto e branco)
        return None
    # dentro da cor vencedora, a parte mais viva (o laranja do título, não a parede bege em volta)
    group.sort(key=lambda p: p[2], reverse=True)
    top = group[:max(20, len(group) * 3 // 10)]
    h = (math.atan2(sum(math.sin(2 * math.pi * p[0]) for p in top),
                    sum(math.cos(2 * math.pi * p[0]) for p in top)) / (2 * math.pi)) % 1
    l = sum(p[1] for p in top) / len(top)
    s = sum(p[2] for p in top) / len(top)
    s = min(max(s, 0.62), 0.9)  # cor de destaque é cor de verdade: nada desbotado
    accent = colorsys.hls_to_rgb(h, min(max(l, 0.48), 0.6), s)
    deep = colorsys.hls_to_rgb(h, 0.17, min(s, 0.55))
    # tinta: preto ou branco, o que tiver mais contraste com o destaque (conta da WCAG)
    lin = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in accent]
    lum = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]
    ink = "#000000" if (lum + 0.05) / 0.05 >= 1.05 / (lum + 0.05) else "#ffffff"
    return {"destaque": _hex(accent), "fundo": _hex(deep), "tinta": ink}


def find(song_dir, source, title, duration=None):
    """Acha a capa da música e grava em song_dir/cover.jpg. Devolve o que vai para o meta.json."""
    out = song_dir / NAME
    info = {"capa_ok": True, "capa": None, "capa_fonte": None, "capa_credito": None, "cores": None}
    try:
        if embedded(source, out):
            info.update(capa=NAME, capa_fonte="arquivo")
        elif BUSCAR_NA_INTERNET:
            data, credit = lookup(title, duration)
            if data:
                from PIL import Image
                Image.open(io.BytesIO(data)).convert("RGB").save(out, quality=90)
                info.update(capa=NAME, capa_fonte="itunes", capa_credito=credit)
    except Exception:  # noqa: BLE001 - sem internet ou imagem estranha: fica sem capa, sem travar nada
        info["capa_ok"] = False  # tenta de novo na próxima vez
    if info["capa"]:
        try:
            info["cores"] = colors(out)
        except Exception:  # noqa: BLE001
            info["cores"] = None
    return info
