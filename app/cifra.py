"""Cifra no jeito brasileiro: entende o nome de cada acorde (com 6, 9, 11, 13, 7M, 5-, 4...) e acha os
acordes de um texto de cifra colado (as linhas de acordes; a letra é ignorada).

Cada acorde vira as notas dele (intervalos sobre a raiz) e as partes que o modelo de acordes de
vocabulário grande (app/lvcr) ouve: tríade, baixo, 7ª, 9ª, 11ª e 13ª. Assim dá para pontuar
QUALQUER acorde escrito na cifra contra o áudio, não só os da lista do modelo.
"""
import re

NOTE = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
_SYMBOL = re.compile(r"^([A-G])([#b]?)(.*?)(?:/([A-G])([#b]?))?$")
# extensões escritas entre parênteses (ou depois do tipo): nome -> intervalo em semitons
_EXT = {"9": 2, "b9": 1, "9-": 1, "-9": 1, "#9": 3, "9+": 3, "+9": 3, "11": 5, "#11": 6, "11+": 6, "+11": 6,
        "13": 9, "b13": 8, "13-": 8, "-13": 8, "6": 9, "2": 2, "add9": 2, "add2": 2, "add11": 5, "add4": 5}


def _norm(s):
    return (s.strip().replace("♭", "b").replace("♯", "#").replace("º", "°").replace("₀", "°")
            .replace("Maj", "maj").replace("M7", "7M").replace("maj7", "7M").replace("Δ", "7M"))


def _acc(a):
    return 1 if a == "#" else -1 if a == "b" else 0


def parse_symbol(symbol):
    """'D6(9)' -> {root, bass, third, fifth, seventh, ext}; None se não for acorde.
    third: 4 maior, 3 menor, 5 (sus4), 2 (sus2) ou None (D5); fifth: 7, 6 (5-) ou 8 (5+);
    seventh: 11 (7M), 10 (7), 9 (° com sétima) ou None; ext: intervalos das extensões."""
    s = _norm(symbol)
    m = _SYMBOL.match(s)
    if not m:
        return None
    root = (NOTE[m.group(1)] + _acc(m.group(2))) % 12
    bass = (NOTE[m.group(4)] + _acc(m.group(5))) % 12 if m.group(4) else None
    q = m.group(3)
    if not re.fullmatch(r"[0-9mMajdiusg°ø+()#b/,\-]*", q.replace("add", "").replace("sus", "")):
        return None
    inner = []
    for grp in re.findall(r"\(([^)]*)\)", q):
        inner += [t for t in re.split(r"[/,]", grp) if t]
    core = re.sub(r"\(.*?\)", "", q)
    third, fifth, seventh, ext = 4, 7, None, set()
    explicit_minor = False

    if core.startswith("m") and not core.startswith("maj"):
        third, explicit_minor, core = 3, True, core[1:]
    elif core.startswith("°") or core.startswith("dim"):
        third, fifth = 3, 6
        core = core[1:] if core.startswith("°") else core[3:]
        if core.startswith("7") or not core:  # "°" sozinho é o diminuto com sétima (C° = C°7)
            seventh = 9
            core = core[1:] if core.startswith("7") else core
    elif core.startswith("ø"):
        third, fifth, seventh, core = 3, 6, 10, core[1:].lstrip("7")
    elif core.startswith("+") or core.startswith("aug"):
        fifth, core = 8, core[1:] if core.startswith("+") else core[3:]

    core = core.replace("/", "").replace(",", "").replace("69", "6 9")
    tokens = re.findall(r"7M|sus4|sus2|sus|add\d+|1[13][+\-]?|[2-9][+\-]?|[#b]1[13]|[#b][2-9]", core)
    if "".join(tokens) != core.replace(" ", ""):
        return None  # sobrou texto que não é de acorde
    for t in tokens:
        if t in ("7M", "7+"):  # A7+ = A7M no jeito brasileiro
            seventh = 11
        elif t == "7":
            seventh = 9 if (third, fifth) == (3, 6) and seventh == 9 else 10
        elif t in ("sus4", "sus", "4"):
            if explicit_minor:
                ext.add(5)
            else:
                third = 5
        elif t in ("sus2", "2"):
            third = 2 if not explicit_minor else third
            if explicit_minor:
                ext.add(2)
        elif t == "5":
            third = None  # D5: só raiz e quinta
        elif t in ("5-", "b5"):
            fifth = 6
        elif t in ("5+", "#5"):
            fifth = 8
        elif t == "13":
            ext.add(9)
            seventh = seventh or 10  # D13 = D7(13)
        elif t == "11":
            ext.add(5)
            seventh = seventh or 10
        elif t in _EXT:
            ext.add(_EXT[t])  # 9 = add9 no jeito brasileiro (D9 não tem sétima)
        else:
            return None
    for t in inner:
        t = t.strip()
        if t in ("5-", "b5", "-5"):
            fifth = 6
        elif t in ("5+", "#5", "+5"):
            fifth = 8
        elif t in ("4", "sus4"):
            if explicit_minor or third == 3:
                ext.add(5)
            else:
                third = 5
        elif t == "7":
            seventh = seventh or 10
        elif t in ("7M", "7+"):  # Am(7+) = Am(7M)
            seventh = 11
        elif t in _EXT:
            ext.add(_EXT[t])
        else:
            return None
    return {"root": root, "bass": bass, "third": third, "fifth": fifth, "seventh": seventh,
            "ext": sorted(ext)}


def intervals(ch):
    """Notas do acorde como intervalos (mod 12) sobre a raiz."""
    out = {0, ch["fifth"]} | set(ch["ext"])
    if ch["third"] is not None:
        out.add(ch["third"])
    if ch["seventh"] is not None:
        out.add(ch["seventh"])
    return out


def pitch_classes(ch):
    return {(ch["root"] + iv) % 12 for iv in intervals(ch)}


def same_notes(a, b):
    """Mesmo acorde nota por nota (a quinta justa não conta: muita gente omite); o baixo conta."""
    if a["root"] != b["root"] or (a["bass"] or a["root"]) != (b["bass"] or b["root"]):
        return False
    return intervals(a) - {7} == intervals(b) - {7}


# ---------------------------------------------------------------- partes do modelo (app/lvcr)

def lvcr_parts(ch):
    """(índice da tríade, índice do baixo, 7ª, 9ª, 11ª, 13ª) nas saídas do modelo de vocabulário grande.
    O modelo não tem tríade com 5-: maior com 5- é ouvido como maior com 11ª aumentada (mesma nota)."""
    third, fifth, ext = ch["third"], ch["fifth"], set(ch["ext"])
    eleventh = 2 if 6 in ext else 1 if 5 in ext else 0
    if third == 3 and fifth == 6:
        triad = "dim"
    elif third == 4 and fifth == 8:
        triad = "aug"
    elif third == 3:
        triad = "min"
    elif third == 5:
        triad = "sus4"
    elif third == 2:
        triad = "sus2"
    else:
        triad = "maj"
        if fifth == 6:
            eleventh = 2
    seventh = {11: 1, 10: 2, 9: 3}.get(ch["seventh"], 0)
    if seventh == 3 and triad != "dim":
        seventh = 0
    ninth = 1 if 2 in ext and triad != "sus2" else 2 if 3 in ext and triad != "min" else 3 if 1 in ext else 0
    thirteenth = 1 if (9 in ext and seventh != 3) else 2 if (8 in ext and triad != "aug") else 0
    if triad == "sus4" and eleventh == 1:
        eleventh = 0
    triads = ["maj", "min", "sus4", "sus2", "dim", "aug"]
    t_index = triads.index(triad) * 12 + ch["root"] + 1
    b_index = (ch["bass"] if ch["bass"] is not None else ch["root"]) + 1
    return t_index, b_index, seventh, ninth, eleventh, thirteenth


# ---------------------------------------------------------------- texto da cifra

_REPEAT = re.compile(r"\((\d+)\s*[xX]\)|\b(\d+)\s*[xX]\b")
# rótulo de parte no começo da linha: "[Intro]", "[Solo]", "Intro:", "Refrão:", "Primeira parte:"
_LABEL = re.compile(r"^\s*(?:\[[^\]]*\]|[A-Za-zÀ-ÿ][\wÀ-ÿ\- ]{0,24}:)\s*")
_NO_CHORD = {"N.C.", "N.C", "NC", "n.c.", "N/C"}


def _is_chord_token(tok):
    return parse_symbol(tok) is not None


def chord_line(line):
    """Os acordes da linha, se ela for uma linha de acordes (só acordes e marcações); senão None.
    Um rótulo de parte antes dos acordes ("[Intro] D6(9)  G7M(5-)", "Solo: Bm  G") não atrapalha."""
    line = _LABEL.sub("", line, count=1)
    line = re.sub(r"\[[^\]]*\]", " ", line)  # outros rótulos entre colchetes no meio da linha
    tokens = [t for t in re.split(r"\s+", line.strip()) if t]
    if not tokens:
        return None
    chords, other = [], 0
    for t in tokens:
        t2 = t.strip("|")
        if not t2 or _REPEAT.fullmatch(t2) or t2 in ("-", "–", "%", "...", "|") or t2 in _NO_CHORD:
            continue
        if _is_chord_token(t2):
            chords.append(t2)
        else:
            other += 1
    if chords and other == 0:
        return chords
    return None


def parse_text(text):
    """Acordes do texto da cifra, em ordem, com as repetições "(2x)" abertas.
    Uma marcação de repetição numa linha de letra repete a linha de acordes logo acima.
    Devolve a lista de acordes (texto como escrito na cifra)."""
    out, last_line = [], None
    for raw in text.splitlines():
        line = raw.replace("\t", " ")
        if not line.strip():
            continue
        found = chord_line(line)
        rep = _REPEAT.search(line)
        times = int(rep.group(1) or rep.group(2)) if rep else 1
        if found is not None:
            out += found * times
            last_line = found
        elif rep and last_line:
            out += last_line * (times - 1)
            last_line = None
        else:
            last_line = None
    return out


def compact(seq):
    """Junta acordes iguais seguidos (como o app mostra)."""
    out = []
    for s in seq:
        if not out or _norm(out[-1]) != _norm(s):
            out.append(s)
    return out
