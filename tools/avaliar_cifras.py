"""Prova das cifras: compara os acordes que o Pauta Viva achou com o gabarito de cada música.

Gabaritos em data/gabarito/<id da música>.json, só com os nomes dos acordes, na ordem (sem letra):
    {"titulo": "...", "acordes": ["Eb", "B", "Fm/Eb", "Ab7M", ...], "trecho": true}
`trecho` (opcional): o gabarito cobre só o começo da música. A comparação não depende de compasso
nem de tempo, então erro de pulso não confunde a nota dos acordes (o pulso tem a prova dele).

Uso:  .venv\\Scripts\\python.exe tools\\avaliar_cifras.py

Notas (0 a 100%), do mais fácil ao mais exigente:
    raiz       a nota principal do acorde (Mi♭, Fá...)
    maior/menor  raiz + se é maior, menor, diminuto, aumentado ou suspenso
    com baixo  + a nota do baixo (inversões e baixo pedal: B♭/D, Fm/E♭)
    sétimas    + a sétima (7, 7M) — extensões como 9 e 11 não contam
A sequência do app é alinhada com a do gabarito (como um "diff"), então acorde a mais ou a menos
custa ponto, mas não bagunça o resto da comparação.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SONGS = ROOT / "data" / "songs"
GABARITO = ROOT / "data" / "gabarito"
PC = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
# tipo do Pauta Viva -> (família, sétima)
KIND = {"maj": ("maj", None), "min": ("min", None), "7": ("maj", "7"), "m7": ("min", "7"),
        "maj7": ("maj", "7M"), "m7b5": ("dim", "7"), "dim7": ("dim", "°7"), "m6": ("min", None),
        "mmaj7": ("min", "7M"), "6": ("maj", None), "aug": ("aug", None), "dim": ("dim", None),
        "sus2": ("sus", None), "sus4": ("sus", None)}


def _pc(name):
    pc = PC[name[0].upper()]
    for ch in name[1:]:
        pc += 1 if ch in "#♯" else -1 if ch in "b♭" else 0
    return pc % 12


def parse(symbol):
    """Cifra no jeito brasileiro -> (raiz, família, sétima, baixo). Ex.: 'Db7M(9)' -> (1, maj, 7M, None)."""
    s = symbol.strip().replace("♭", "b").replace("♯", "#")
    m = re.match(r"^([A-G][#b]?)(.*?)(?:/([A-G][#b]?))?$", s)
    if not m:
        return None
    root, q, bass = m.group(1), m.group(2), m.group(3)
    core = re.sub(r"\(.*?\)", "", q)  # tira (9), (11), (b5)...
    if "°" in core or "dim" in core:
        fam, sev = "dim", ("°7" if "7" in core else None)
    elif "(b5)" in q and core.startswith("m"):
        fam, sev = "dim", "7"  # m7(b5) = meio diminuto
    elif re.match(r"^m(?!aj)", core):
        fam = "min"
        sev = "7M" if "7M" in core or "maj7" in core else ("7" if "7" in core else None)
    elif "aug" in core or "+" in core or "(#5)" in q:
        fam, sev = "aug", ("7" if "7" in core else None)
    elif "sus" in core or core.startswith("4") or core == "2":
        fam, sev = "sus", ("7" if "7" in core else None)
    else:
        fam = "maj"
        sev = "7M" if "7M" in core or "maj7" in core else ("7" if re.search(r"7(?!M)", core) else None)
    return _pc(root), fam, sev, (_pc(bass) if bass else None)


def ours(c):
    fam, sev = KIND.get(c["kind"], ("maj", None))
    return c["root"], fam, sev, c.get("bass")


LEVELS = ("raiz", "maior/menor", "com baixo", "sétimas")


def same(a, b, level):
    if a[0] != b[0]:
        return False
    if level == "raiz":
        return True
    if a[1] != b[1]:
        return False
    if level == "maior/menor":
        return True
    if level == "com baixo":
        return a[3] == b[3]
    return a[2] == b[2]


def align(ref, hyp, trecho=False):
    """Alinhamento por programação dinâmica: igual na raiz vale mais, mais igual ainda vale mais.
    `trecho`: o gabarito cobre só o começo da música; o que sobra da sequência do app no fim não conta."""
    def sim(a, b):
        if a[0] != b[0]:
            return -0.6
        return 1.0 + 0.3 * (a[1] == b[1]) + 0.2 * (a[3] == b[3]) + 0.1 * (a[2] == b[2])
    gap = -0.5
    n, m = len(ref), len(hyp)
    D = [[0.0] * (m + 1) for _ in range(n + 1)]
    for i in range(1, n + 1):
        D[i][0] = gap * i
    for j in range(1, m + 1):
        D[0][j] = gap * j
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            D[i][j] = max(D[i - 1][j - 1] + sim(ref[i - 1], hyp[j - 1]), D[i - 1][j] + gap, D[i][j - 1] + gap)
    pairs, i, j = [], n, m
    if trecho:  # termina onde o gabarito acaba
        j = max(range(m + 1), key=lambda k: D[n][k])
    while i > 0 and j > 0:
        if abs(D[i][j] - (D[i - 1][j - 1] + sim(ref[i - 1], hyp[j - 1]))) < 1e-9:
            pairs.append((i - 1, j - 1))
            i, j = i - 1, j - 1
        elif abs(D[i][j] - (D[i - 1][j] + gap)) < 1e-9:
            pairs.append((i - 1, None))
            i -= 1
        else:
            j -= 1
    pairs += [(k, None) for k in range(i - 1, -1, -1)]
    return pairs[::-1]


def evaluate(song_id, gab, level_key="chords_detalhado", show=False):
    an = json.loads((SONGS / song_id / "analysis.json").read_text(encoding="utf-8"))
    ref_sym = gab["acordes"]
    ref = [parse(s) for s in ref_sym]
    if None in ref:
        bad = [s for s, r in zip(ref_sym, ref) if r is None]
        raise ValueError(f"cifra que não entendi no gabarito: {bad}")
    segs = [c for c in an.get(level_key) or an["chords"] if c["kind"] != "N"]
    hyp = [ours(c) for c in segs]
    pairs = align(ref, hyp, trecho=bool(gab.get("trecho")))
    score = {lv: sum(1 for i, j in pairs if j is not None and same(ref[i], hyp[j], lv)) / len(ref)
             for lv in LEVELS}
    if show:
        line = []
        for i, j in pairs:
            got = segs[j]["display"] if j is not None else "—"
            mark = "" if j is not None and same(ref[i], hyp[j], "com baixo") else " ✗"
            line.append(f"{ref_sym[i]}→{got}{mark}")
        print("   " + "  ".join(line))
    return score, an["key"]["display"]


def main():
    files = sorted(GABARITO.glob("*.json"))
    if not files:
        print(f"Nenhum gabarito em {GABARITO}")
        return
    show = "-v" in sys.argv
    totals = {lv: [] for lv in LEVELS}
    print(f"{'música':38s} {'tom achado':14s} " + " ".join(f"{lv:>12s}" for lv in LEVELS))
    for f in files:
        gab = json.loads(f.read_text(encoding="utf-8"))
        sid = f.stem
        if not (SONGS / sid / "analysis.json").exists():
            print(f"{gab.get('titulo', sid)[:38]:38s} (música não processada)")
            continue
        score, key = evaluate(sid, gab, show=show)
        tom_ok = "" if not gab.get("tom") else (" ✓" if gab["tom"] == key else f" ✗ ({gab['tom']})")
        print(f"{gab.get('titulo', sid)[:38]:38s} {(key + tom_ok)[:14]:14s} " +
              " ".join(f"{100 * score[lv]:11.0f}%" for lv in LEVELS))
        for lv in LEVELS:
            totals[lv].append(score[lv])
    n = len(totals["raiz"])
    if n > 1:
        print(f"{'MÉDIA (' + str(n) + ' músicas)':38s} {'':14s} " +
              " ".join(f"{100 * sum(v) / n:11.0f}%" for v in totals.values()))


if __name__ == "__main__":
    main()
