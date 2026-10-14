"""Letra pela internet: LRCLIB (lrclib.net), base aberta e gratuita, sem chave.

Muitas letras vêm sincronizadas (formato LRC: o tempo em que cada linha começa). A letra fica só nos
arquivos da música no computador de quem usa o app. Para vender o app, exibir letra exige licença
(ex.: Musixmatch ou LyricFind); o LRCLIB serve para o estudo pessoal e para o protótipo.
"""
import difflib
import json
import re
import unicodedata
import urllib.parse
import urllib.request

API = "https://lrclib.net/api"
USER_AGENT = "soundStudy/0.2 (app local de estudo de musica)"
JUNK = (r"\b(lan[cç]amento|clipe|oficial|official|video|v[ií]deo|lyrics?|letra|audio|[aá]udio|hd|hq|4k|"
        r"ao vivo|live|ac[uú]stico|remix|cover|karaok[eê]|dvd|cd|feat\.?|part\.?|ft\.?)\b")


def _norm(s):
    s = unicodedata.normalize("NFD", (s or "").lower())
    s = "".join(ch for ch in s if unicodedata.category(ch) != "Mn")
    return re.sub(r"[^a-z0-9 ]", " ", s).split()


def _sim(a, b):
    a, b = " ".join(_norm(a)), " ".join(_norm(b))
    if not a or not b:
        return 0.0
    if a in b or b in a:
        return 1.0
    return difflib.SequenceMatcher(None, a, b).ratio()


def guess(title):
    """'Artista - Música (Ao Vivo) Lançamento 2015 - Canal' -> ('Artista', 'Música')."""
    t = re.sub(r"[\(\[\{].*?[\)\]\}]", " ", title or "")
    t = re.sub(r"\b(19|20)\d{2}\b", " ", t)
    parts = []
    for p in re.split(r"\s+[-–—|]\s+|\s*[|]\s*", t):
        p = re.sub(r"\s+", " ", re.sub(JUNK, " ", p, flags=re.I)).strip(" -–—|.,")
        if p:
            parts.append(p)
    if len(parts) >= 2:
        return parts[0], parts[1]
    return "", parts[0] if parts else (title or "")


def _get(path, **params):
    query = urllib.parse.urlencode({k: v for k, v in params.items() if v})
    req = urllib.request.Request(f"{API}/{path}" + (f"?{query}" if query else ""),
                                 headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=12) as r:
        return json.loads(r.read().decode("utf-8"))


def _score(item, artist, track, duration):
    s = 2.0 * _sim(item.get("trackName"), track)
    if artist:
        s += 1.0 * _sim(item.get("artistName"), artist)
    if duration and item.get("duration"):
        s -= min(3.0, abs(float(item["duration"]) - duration) / 4.0)
    if item.get("syncedLyrics"):
        s += 0.5
    if item.get("instrumental") or not (item.get("plainLyrics") or item.get("syncedLyrics")):
        s -= 10
    return s


def search(title, duration=None, query=None):
    """Versões candidatas, da mais provável para a menos. Cada uma traz a letra (texto e LRC)."""
    artist, track = guess(title)
    tries = []
    if query:
        tries.append({"q": query})
    if track:
        tries.append({"track_name": track, "artist_name": artist})
        tries.append({"q": f"{artist} {track}".strip()})
    seen, found, answered = set(), [], False
    for params in tries:
        try:
            items = _get("search", **params)
        except Exception:  # noqa: BLE001 - sem internet ou serviço fora do ar: tenta a próxima busca
            continue
        answered = True
        for it in items:
            if it.get("id") not in seen:
                seen.add(it.get("id"))
                found.append(it)
        if query and found:
            break
    if tries and not answered:
        raise ConnectionError("A base de letras não respondeu agora.")
    if query and not track:
        artist, track = "", query
    found.sort(key=lambda it: _score(it, artist, track, duration), reverse=True)
    return found[:10]


def best(title, duration=None):
    """A versão mais provável, só se o nome bater e a duração for parecida; senão None."""
    artist, track = guess(title)
    if not track:
        return None
    for it in search(title, duration):
        ok_name = _sim(it.get("trackName"), track) >= 0.75 and (not artist or _sim(it.get("artistName"), artist) >= 0.6)
        ok_dur = not (duration and it.get("duration")) or abs(float(it["duration"]) - duration) <= 12
        if ok_name and ok_dur and (it.get("syncedLyrics") or it.get("plainLyrics")) and not it.get("instrumental"):
            return it
    return None


def get(lyrics_id):
    return _get(f"get/{int(lyrics_id)}")


def summary(item):
    """O que a tela mostra na lista de versões (sem a letra)."""
    return {"id": item.get("id"), "track": item.get("trackName"), "artist": item.get("artistName"),
            "album": item.get("albumName"), "duration": item.get("duration"),
            "synced": bool(item.get("syncedLyrics")), "plain": bool(item.get("plainLyrics"))}


def parse_lrc(text):
    """'[01:02.34] linha' -> [(62.34, 'linha')]; linhas vazias marcam o fim da frase anterior."""
    out = []
    for raw in (text or "").splitlines():
        stamps = re.findall(r"\[(\d+):(\d+(?:\.\d+)?)\]", raw)
        if not stamps:
            continue
        words = re.sub(r"\[[^\]]*\]", "", raw).strip()
        for mm, ss in stamps:
            out.append((int(mm) * 60 + float(ss), words))
    return sorted(out)
