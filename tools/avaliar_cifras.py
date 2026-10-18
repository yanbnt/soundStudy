"""Prova das cifras: compara os acordes que o soundStudy ouviu com o gabarito de cada música.

Gabaritos em data/gabarito/<id da música>.json, só com os nomes dos acordes, na ordem (sem letra):
    {"titulo": "...", "acordes": ["Eb", "B", "Fm/Eb", "Ab7M", ...], "trecho": true}
`trecho` (opcional): o gabarito cobre só o começo da música. A comparação não depende de compasso
nem de tempo, então erro de pulso não confunde a nota dos acordes (o pulso tem a prova dele).

Uso:  .venv\\Scripts\\python.exe tools\\avaliar_cifras.py [-v]
      -v  mostra o alinhamento acorde a acorde (gabarito→app) nos dois níveis

A prova mede o que o app OUVIU: quando a pessoa colou a cifra ou gravou a referência ("cifra" ou
"referencia" em chords_source), os acordes da tela são os dela; os ouvidos estão em chords_auto e
chords_detalhado_auto, e são esses que contam. Os dois níveis são medidos: Simples (chords) e
Detalhado (chords_detalhado).

Níveis de acerto (0 a 100%), do mais fácil ao mais exigente:
    raiz       a nota principal do acorde (Mi♭, Fá...)
    maior/menor  raiz + se é maior, menor, diminuto, aumentado ou suspenso
    com baixo  + a nota do baixo (inversões e baixo pedal: B♭/D, Fm/E♭)
    sétimas    + a sétima (7, 7M) — extensões como 9 e 11 não contam
    completo   o acorde nota por nota, como na cifra: 6, 9, 11, 13, 5- e o baixo (a quinta justa
               não conta, porque muita gente a omite). G7M(5-) e G7M(♯11) são o mesmo acorde.
A sequência do app é alinhada com a do gabarito (como um "diff"), nível por nível: antes, os acordes
seguidos iguais naquele nível viram um só, no gabarito e no app (um acorde partido em dois pedaços
iguais não conta duas vezes; na raiz, G7M → Gm6 é um acorde só). Três notas por nível:
    recall     acertos ÷ acordes do gabarito (a nota de antes: acorde que falta custa ponto)
    precisão   acertos ÷ acordes que o app pôs no mesmo trecho (acorde a mais custa ponto)
    F1         média harmônica das duas: pôr acorde demais não sobe mais a nota
Com `trecho`, o fim do trecho no app é onde o alinhamento termina; numa música que repete a mesma
sequência ele cai uma volta antes ou depois, e a precisão desse gabarito oscila muito (0,42 a 0,60 na
Um vencedor). Por isso precisão e F1 de gabarito com `trecho` saem marcados com * e ficam fora da
média (`precision_ok` falso em score_lists); o recall continua valendo.

Gravação de referência (work/referencia.json: a pessoa tocando a música; ver app/referencia.py):
quando existe, a prova também compara tempo a tempo, pelo relógio, os acordes ouvidos com os da
gravação, só nos tempos que ela cobre: concordância por tempo (raiz, maior/menor, sétimas) e as
trocas de raiz (recall e precisão, com folga de ±1 tempo).

Para testar uma mudança sem gravar nada na música:
    from avaliar_cifras import score_lists
    nota = score_lists(sid, simples, detalhado)   # listas de acordes no formato do analysis.json
"""
import json
import sys
from pathlib import Path

import numpy as np

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
# na comparação tempo a tempo com a gravação de referência
REF_LEVELS = ("raiz", "maior/menor", "sétimas")
NIVEIS = (("simples", "Simples"), ("detalhado", "Detalhado"))


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


def _align(ref, hyp, trecho=False):
    """Alinhamento por programação dinâmica: igual na raiz vale mais, mais igual ainda vale mais.
    `trecho`: o gabarito cobre só o começo da música; o que sobra da sequência do app no fim não conta.
    Devolve (pares, fim): `fim` = quantos acordes do app entram no trecho alinhado (sem `trecho`, todos)."""
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
    end = j
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
    return pairs[::-1], end


def align(ref, hyp, trecho=False):
    """Pares (índice no gabarito, índice no app ou None); ver _align."""
    return _align(ref, hyp, trecho)[0]


def _f1(p, r):
    return 2 * p * r / (p + r) if p + r > 0 else 0.0


def _gab_chords(gab):
    ref = [parse(s) for s in gab["acordes"]]
    if None in ref:
        bad = [s for s, r in zip(gab["acordes"], ref) if r is None]
        raise ValueError(f"cifra que não entendi no gabarito: {bad}")
    return ref


def _merge(seq, level):
    """Índices que ficam depois de juntar os acordes seguidos iguais no nível `level` (fica o primeiro de cada
    grupo). Um acorde que o app partiu em dois pedaços iguais (numa grade dobrada, por exemplo) conta uma vez
    só; no gabarito também (na raiz, G7M → Gm6 é um acorde só: a raiz não trocou)."""
    keep = []
    for k, c in enumerate(seq):
        if not keep or not same(seq[keep[-1]], c, level):
            keep.append(k)
    return keep


def _seq_score(gab, ref, chords):
    """Nota de uma lista de acordes do app contra o gabarito (sequência, sem tempo). Cada nível de acerto
    junta antes os acordes seguidos iguais naquele nível (no gabarito e no app) e alinha de novo.
    `n_ref`/`n_app` e os pares do -v são os do nível "completo" (acorde igual nota por nota); por nível
    ficam em `n_ref_lv`/`n_app_lv`. `precision_ok` é falso com `trecho`: aí a precisão (e o F1) depende de
    onde o alinhamento termina e não é confiável."""
    segs = [c for c in chords if c["kind"] != "N"]
    hyp = [ours(c) for c in segs]
    trecho = bool(gab.get("trecho"))
    hits, rec, prec, n_ref, n_app, pares = {}, {}, {}, {}, {}, []
    for lv in LEVELS:
        ri, hi = _merge(ref, lv), _merge(hyp, lv)
        r, h = [ref[k] for k in ri], [hyp[k] for k in hi]
        pairs, used = _align(r, h, trecho=trecho)
        hits[lv] = sum(1 for i, j in pairs if j is not None and same(r[i], h[j], lv))
        n_ref[lv], n_app[lv] = len(r), used
        rec[lv] = hits[lv] / len(r) if r else 0.0
        prec[lv] = hits[lv] / used if used else 0.0
        if lv == "completo":
            # (acorde do gabarito, acorde do app ou None, igual nota por nota), para o -v
            pares = [(gab["acordes"][ri[i]], segs[hi[j]]["display"] if j is not None else None,
                      j is not None and same(r[i], h[j], lv)) for i, j in pairs]
    return {
        "n_ref": n_ref["completo"], "n_app": n_app["completo"], "n_ref_lv": n_ref, "n_app_lv": n_app,
        "hits": hits, "recall": rec, "precision": prec, "f1": {lv: _f1(prec[lv], rec[lv]) for lv in LEVELS},
        "precision_ok": not trecho, "pairs": pares,
    }


# ---------------------------------------------------------------- gravação de referência, tempo a tempo

def _ref_beats(segs, grid, same_grid):
    """(início, fim, acorde) de cada tempo coberto pelos trechos da referência. Com a mesma grade da análise
    os tempos vêm dela; se a grade mudou, cada trecho é dividido por igual entre os tempos dele."""
    out = []
    for s in sorted(segs, key=lambda c: c["start"]):
        lab = None if s["kind"] == "N" else ours(s)
        bs, be = int(s["start_beat"]), int(s["end_beat"])
        for b in range(bs, be):
            if same_grid and be < len(grid):
                t0, t1 = grid[b], grid[b + 1]
            else:
                k = (s["end"] - s["start"]) / max(1, be - bs)
                t0, t1 = s["start"] + (b - bs) * k, s["start"] + (b - bs + 1) * k
            out.append((float(t0), float(t1), lab))
    return out


EPS = 0.02  # folga de arredondamento (em tempos): a grade do analysis.json é gravada com 4 casas


def _match(ref_c, app_c, tol=1.0):
    """Quantas trocas da referência têm uma troca do app a até `tol` tempos (cada troca conta uma vez)."""
    app_c = sorted(app_c)
    hits, j = 0, 0
    for r in sorted(ref_c):
        while j < len(app_c) and app_c[j] < r - tol - EPS:
            j += 1
        if j < len(app_c) and app_c[j] <= r + tol + EPS:
            hits += 1
            j += 1
    return hits


def _ref_score(beats, chords):
    """Acordes do app contra os tempos da referência, pelo relógio (vale para qualquer grade do app)."""
    if not beats:
        return {"beats": 0, "agree": {lv: 0.0 for lv in REF_LEVELS},
                "changes": {"ref": 0, "app": 0, "hits": 0, "recall": 0.0, "precision": 0.0, "f1": 0.0}}
    segs = sorted(chords, key=lambda c: c["start"])
    st = np.array([c["start"] for c in segs], dtype=float)
    en = np.array([c["end"] for c in segs], dtype=float)
    labs = [None if c["kind"] == "N" else ours(c) for c in segs]
    # acorde do app em cada tempo: o que mais ocupa o tempo
    got = []
    for t0, t1, _ in beats:
        ov = np.minimum(en, t1) - np.maximum(st, t0)
        k = int(ov.argmax()) if len(ov) else -1
        got.append(labs[k] if k >= 0 and ov[k] > 0 else None)
    covered = [(r, g) for (_, _, r), g in zip(beats, got) if r is not None]
    agree = {lv: (sum(1 for r, g in covered if g is not None and same(r, g, lv)) / len(covered) if covered else 0.0)
             for lv in REF_LEVELS}
    # trocas de raiz: na referência, entre tempos seguidos; no app, o início de cada acorde de raiz nova,
    # em tempos da referência (fracionário: o app pode trocar no meio do tempo)
    root = lambda lab: None if lab is None else lab[0]  # noqa: E731
    ref_c = [i for i in range(1, len(beats)) if root(beats[i][2]) != root(beats[i - 1][2])]
    knots = np.array([b[0] for b in beats] + [beats[-1][1]])
    app_c = []
    for k in range(1, len(segs)):
        if root(labs[k]) != root(labs[k - 1]):
            p = float(np.interp(st[k], knots, np.arange(len(knots))))
            if EPS < p < len(beats) - EPS:
                app_c.append(p)
    hits = _match(ref_c, app_c)
    rec = hits / len(ref_c) if ref_c else 0.0
    prec = hits / len(app_c) if app_c else 0.0
    return {"beats": len(covered), "agree": agree,
            "changes": {"ref": len(ref_c), "app": len(app_c), "hits": hits, "recall": rec, "precision": prec,
                        "f1": _f1(prec, rec)}}


def _grid_id(grid):
    return [len(grid), round(float(grid[0]), 2), round(float(grid[-1]), 2)]  # o mesmo de app/referencia.py


def _load_ref(sid):
    f = SONGS / sid / "work" / "referencia.json"
    return json.loads(f.read_text(encoding="utf-8")) if f.exists() else None


# ---------------------------------------------------------------- notas de uma música

def load_analysis(sid):
    return json.loads((SONGS / sid / "analysis.json").read_text(encoding="utf-8"))


def load_gabarito(sid):
    f = GABARITO / f"{sid}.json"
    return json.loads(f.read_text(encoding="utf-8")) if f.exists() else None


def auto_lists(an):
    """(Simples, Detalhado) que o app ouviu. Com cifra colada ou gravação de referência, os da tela são os
    da pessoa; os ouvidos ficam em chords_auto / chords_detalhado_auto."""
    simples, det = an["chords"], an.get("chords_detalhado") or an["chords"]
    if an.get("chords_source") in ("cifra", "referencia"):
        simples = an.get("chords_auto") or simples
        det = an.get("chords_detalhado_auto") or an.get("chords_auto") or det
    return simples, det


def score_lists(sid, simples, detalhado, an=None, gab=None, ref=None):
    """Nota de listas de acordes em memória (Simples e Detalhado, no formato do analysis.json) para a música
    `sid`, sem gravar nada. `an`, `gab`, `ref`: análise, gabarito e referência já carregados (senão, lê do disco).
    Devolve {"titulo", "tom", "tom_ok", "gabarito": {nível: notas} ou None, "referencia": {...} ou None};
    nível = "simples" / "detalhado"; notas = {"recall", "precision", "f1": {nível de acerto: 0..1}, "n_ref", "n_app",
    "precision_ok" (falso com `trecho`: precisão e F1 não confiáveis), ...}; ver _seq_score."""
    if an is None and (SONGS / sid / "analysis.json").exists():
        an = load_analysis(sid)
    gab = gab if gab is not None else load_gabarito(sid)
    ref = ref if ref is not None else _load_ref(sid)
    levels = {"simples": simples, "detalhado": detalhado}
    key = an["key"]["display"] if an else None
    out = {"sid": sid, "titulo": (gab or {}).get("titulo") or (an or {}).get("title") or sid, "tom": key,
           "tom_ok": None if not (gab and gab.get("tom") and key) else gab["tom"] == key,
           "gabarito": None, "referencia": None}
    if gab:
        g = _gab_chords(gab)
        out["gabarito"] = {lv: _seq_score(gab, g, chords) for lv, chords in levels.items()}
    if ref:
        t = ref["trechos"]
        rsegs = {"simples": t["simples"], "detalhado": t["detalhado"]} if isinstance(t, dict) else {"simples": t, "detalhado": t}
        grid = an["grid"] if an else []
        same_grid = bool(an) and (not ref.get("grade") or ref["grade"] == _grid_id(grid))
        r = {"de": ref["de"], "ate": ref["ate"], "same_grid": same_grid}
        for lv, chords in levels.items():
            r[lv] = _ref_score(_ref_beats(rsegs[lv], grid, same_grid), chords)
        out["referencia"] = r
    return out


def score_song(sid, an=None):
    """Nota do que está gravado na música (os acordes ouvidos, ver auto_lists)."""
    an = an or load_analysis(sid)
    simples, det = auto_lists(an)
    return score_lists(sid, simples, det, an=an)


def evaluate(song_id, gab, level_key="chords_detalhado", show=False, an=None):
    """Jeito antigo (só recall de um nível): devolve ({nível de acerto: recall}, tom achado).
    `an`: análise já carregada (para testar uma mudança sem gravar na música)."""
    if an is None:
        an = load_analysis(song_id)
    simples, det = auto_lists(an)  # a prova mede o que o app ouviu, não a cifra/referência da pessoa
    chords = {"chords": simples, "chords_detalhado": det}.get(level_key) or an.get(level_key) or an["chords"]
    r = _seq_score(gab, _gab_chords(gab), chords)
    if show:
        _print_pairs(r["pairs"])
    return r["recall"], an["key"]["display"]


# ---------------------------------------------------------------- tela

def _print_pairs(pairs):
    print("   " + "  ".join(f"{a}→{b or '—'}{'' if ok else ' ✗'}" for a, b, ok in pairs))


def _pct(x):
    return f"{100 * x:11.0f}%"


def main():
    show = "-v" in sys.argv
    files = sorted(GABARITO.glob("*.json"))
    sids = [f.stem for f in files]
    # músicas com gravação de referência e sem gabarito também entram (só na comparação tempo a tempo)
    sids += [d.name for d in sorted(SONGS.iterdir()) if (d / "work" / "referencia.json").exists() and d.name not in sids]
    if not sids:
        print(f"Nenhum gabarito em {GABARITO}")
        return
    results, missing = [], []
    for sid in sids:
        if not (SONGS / sid / "analysis.json").exists():
            gab = load_gabarito(sid) or {}
            missing.append(gab.get("titulo", sid))
            continue
        results.append(score_song(sid))
    W = 30
    print("PROVA DAS CIFRAS — acordes que o app ouviu (com cifra colada ou referência: chords_auto)\n")
    print(f"{'música':{W}s} {'tom achado':16s} {'gabarito':>13s} {'app Simples':>12s} {'app Detalhado':>14s}")
    for r in results:
        if not r["gabarito"]:
            continue
        g = r["gabarito"]
        tom = r["tom"] + ("" if r["tom_ok"] is None else " ✓" if r["tom_ok"] else " ✗")
        trecho = " (trecho)" if load_gabarito(r["sid"]).get("trecho") else ""
        print(f"{r['titulo'][:W]:{W}s} {tom[:16]:16s} {str(g['simples']['n_ref']) + trecho:>13s} "
              f"{g['simples']['n_app']:12d} {g['detalhado']['n_app']:14d}")
    for t in missing:
        print(f"{t[:W]:{W}s} (música não processada)")
    scored = [r for r in results if r["gabarito"]]
    blocks = (("recall", "RECALL — acertos ÷ acordes do gabarito (a nota de antes)"),
              ("precision", "PRECISÃO — acertos ÷ acordes que o app pôs no mesmo trecho (acorde a mais custa)"),
              ("f1", "F1 — média harmônica de recall e precisão"))
    for metric, title in blocks:
        if not scored:
            break
        print(f"\n{title}")
        print(f"{'música':{W}s} {'nível':10s}" + "".join(f"{lv:>12s}" for lv in LEVELS))
        # precisão e F1 de gabarito com `trecho` não são confiáveis: saem com * e ficam fora da média
        ok = lambda r: metric == "recall" or r["gabarito"]["detalhado"]["precision_ok"]  # noqa: E731
        for r in scored:
            for i, (lv, name) in enumerate(NIVEIS):
                s = r["gabarito"][lv][metric]
                cells = "".join(_pct(s[x]) if ok(r) else f"{100 * s[x]:10.0f}%*" for x in LEVELS)
                print(f"{(r['titulo'][:W] if i == 0 else ''):{W}s} {name:10s}" + cells)
        media = [r for r in scored if ok(r)]
        if len(scored) > 1 and media:
            for i, (lv, name) in enumerate(NIVEIS):
                avg = {x: sum(r["gabarito"][lv][metric][x] for r in media) / len(media) for x in LEVELS}
                n = len(media)
                head = (f"MÉDIA ({n} música{'s' if n > 1 else ''}" + (", sem *)" if n < len(scored) else ")")) if i == 0 else ""
                print(f"{head:{W}s} {name:10s}" + "".join(_pct(avg[x]) for x in LEVELS))
        if len(media) < len(scored):
            print("* gabarito só de um trecho: a precisão depende de onde o alinhamento termina (não é confiável)")
    refs = [r for r in results if r["referencia"]]
    if refs:
        print("\nREFERÊNCIA — contra a gravação da pessoa tocando, tempo a tempo, só nos tempos que ela cobre")
        print(f"{'':{W}s} {'':10s} {'':6s}{'concordância por tempo':^36s} | {'trocas de raiz (±1 tempo)':^37s}")
        print(f"{'música':{W}s} {'nível':10s} {'tempos':>6s}" + "".join(f"{lv:>12s}" for lv in REF_LEVELS) +
              f" | {'gravação':>8s} {'app':>5s} {'recall':>7s} {'precisão':>8s} {'F1':>5s}")
        for r in refs:
            ref = r["referencia"]
            for i, (lv, name) in enumerate(NIVEIS):
                s = ref[lv]
                c = s["changes"]
                head = r["titulo"][:W] if i == 0 else (f"  tempos {ref['de']}–{ref['ate']}" +
                                                       ("" if ref["same_grid"] else ", grade mudou"))[:W]
                print(f"{head:{W}s} {name:10s} {s['beats']:6d}" + "".join(_pct(s["agree"][x]) for x in REF_LEVELS) +
                      f" | {c['ref']:8d} {c['app']:5d} {100 * c['recall']:6.0f}% {100 * c['precision']:7.0f}% "
                      f"{100 * c['f1']:4.0f}%")
    if show:
        for r in scored:
            for lv, name in NIVEIS:
                print(f"\n{r['titulo']} — {name}")
                _print_pairs(r["gabarito"][lv]["pairs"])


if __name__ == "__main__":
    main()
