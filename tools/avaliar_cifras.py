"""Prova das cifras: compara os acordes que o soundStudy achou com o gabarito de cada música.

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
    completo   o acorde nota por nota, como na cifra: 6, 9, 11, 13, 5- e o baixo (a quinta justa
               não conta, porque muita gente a omite). G7M(5-) e G7M(♯11) são o mesmo acorde.
A sequência do app é alinhada com a do gabarito (como um "diff"), então acorde a mais ou a menos
custa ponto, mas não bagunça o resto da comparação.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from app import cifra  # noqa: E402
from app.analysis import chord_intervals  # noqa: E402

SONGS = ROOT / "data" / "songs"
GABARITO = ROOT / "data" / "gabarito"


def _fam_sev(third, fifth, seventh):
    if third == 3 and fifth == 6:
        fam = "dim"
    elif third == 4 and fifth == 8:
        fam = "aug"
    elif third == 3:
        fam = "min"
    elif third in (5, 2):
        fam = "sus"
    else:
        fam = "maj"
    sev = {11: "7M", 10: "7", 9: "°7" if fam == "dim" else None}.get(seventh)
    return fam, sev


def parse(symbol):
    """Cifra no jeito brasileiro -> (raiz, família, sétima, baixo, notas). Ex.: 'Db7M(9)'."""
    ch = cifra.parse_symbol(symbol)
    if ch is None:
        return None
    fam, sev = _fam_sev(ch["third"], ch["fifth"], ch["seventh"])
    return ch["root"], fam, sev, ch["bass"], frozenset(cifra.intervals(ch) - {7})


def ours(c):
    ints = {iv % 12 for iv in chord_intervals(c)}
    third = 4 if 4 in ints else 3 if 3 in ints else 5 if 5 in ints else 2 if 2 in ints else None
    fifth = 7 if 7 in ints else 6 if 6 in ints else 8 if 8 in ints else 7
    seventh = 11 if 11 in ints else 10 if 10 in ints else 9 if (third, fifth) == (3, 6) and 9 in ints else None
    fam, sev = _fam_sev(third, fifth, seventh)
    return c["root"], fam, sev, c.get("bass"), frozenset(ints - {7})


LEVELS = ("raiz", "maior/menor", "com baixo", "sétimas", "completo")


def same(a, b, level):
    if a[0] != b[0]:
        return False
    if level == "raiz":
        return True
    if level == "completo":
        return a[3] == b[3] and a[4] == b[4]
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


def evaluate(song_id, gab, level_key="chords_detalhado", show=False, an=None):
    """`an`: análise já carregada (para testar uma mudança sem gravar na música)."""
    if an is None:
        an = json.loads((SONGS / song_id / "analysis.json").read_text(encoding="utf-8"))
    if an.get("chords_source") == "cifra" and level_key in ("chords_detalhado", "chords"):
        level_key += "_auto"  # a prova mede o que o app ouviu, não a cifra colada pela pessoa
        if level_key == "chords_auto" and "chords_auto" not in an:
            level_key = "chords"
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
            mark = "" if j is not None and same(ref[i], hyp[j], "completo") else " ✗"
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
