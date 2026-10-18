"""Acordes de uma gravação de referência: a pessoa grava (ou manda) ela mesma tocando a música, e o app usa
os acordes dela no trecho que ela tocou.

Por quê: na gravação da banda o reconhecimento às vezes erra feio num trecho inteiro (na Um vencedor ouviu
F#m7(11) por cinco compassos onde o violão passa por A7M, D7M, F7M, E7, Dm7 — as notas são quase as mesmas).
Tocado sozinho, sem bateria nem voz, o mesmo reconhecimento acerta.

Como:
1. alinha a gravação da pessoa com a parte de harmonia da música (croma + DTW com a inclinação presa entre
   1/2 e 2: andamentos parecidos, a pessoa pode começar e parar em qualquer ponto);
2. reconhece os acordes da gravação dela (o mesmo modelo de vocabulário grande, quadro a quadro, com custo
   para trocar) e as notas (Basic Pitch), que decidem 7ª e extensões como na análise normal;
3. leva cada acorde para os tempos da música e, no trecho coberto, troca os acordes da análise por eles.
Guarda em work/referencia.json; a próxima análise da música aplica de novo."""
import json
import os
import subprocess
import tempfile
from pathlib import Path

import numpy as np

SR = 22050
HOP = 2048          # ~93 ms por quadro no alinhamento
MAX_COST = 0.25     # custo médio do alinhamento acima disso: não parece a mesma música (ou outro tom)
SWITCH = 4.0        # custo de trocar de acorde a cada 0,25 s na gravação da pessoa


def _load(path):
    """Qualquer áudio (m4a do celular, mp3, wav) em mono 22050 Hz."""
    import imageio_ffmpeg
    import soundfile as sf
    tmp = Path(tempfile.gettempdir()) / f"ss_ref_{os.getpid()}.wav"
    flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
    subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), "-hide_banner", "-loglevel", "error", "-y", "-i", str(path),
                    "-vn", "-ac", "1", "-ar", str(SR), str(tmp)], check=True, capture_output=True, creationflags=flags)
    try:
        return sf.read(str(tmp), dtype="float32")[0]
    finally:
        tmp.unlink(missing_ok=True)


def _song_harmony(work):
    """A harmonia da música (violão, teclado, outros e um pouco do baixo), das partes separadas."""
    import soundfile as sf
    harm = None
    for n, k in (("guitar", 1.0), ("piano", 1.0), ("other", 1.0), ("bass", 0.6)):
        f = work / f"{n}.wav"
        if f.exists():
            x = sf.read(str(f), dtype="float32")[0] * k
            harm = x if harm is None else harm[:len(x)] + x[:len(harm)]
    if harm is None:
        raise RuntimeError("Esta música não tem as partes separadas para comparar.")
    return harm


def _chroma(y):
    import librosa
    C = librosa.feature.chroma_cqt(y=y, sr=SR, hop_length=HOP)
    C = librosa.decompose.nn_filter(C, aggregate=np.median, metric="cosine")
    return C / (np.linalg.norm(C, axis=0, keepdims=True) + 1e-9)


def align(ref, harm):
    """Instante da música para cada instante da gravação: (tempos da gravação, tempos da música, custo)."""
    import librosa
    Cr, Cs = _chroma(ref), _chroma(harm)
    steps = np.array([[1, 1], [1, 2], [2, 1]])  # inclinação entre 1/2 e 2
    D, wp = librosa.sequence.dtw(X=Cr, Y=Cs, metric="cosine", subseq=True, step_sizes_sigma=steps,
                                 weights_add=np.array([0, 0.02, 0.02]))
    wp = wp[::-1]
    cost = float(D[-1].min() / max(1, len(wp)))
    by_ref = {}
    for i, j in wp:
        by_ref.setdefault(int(i), []).append(int(j))
    keys = sorted(by_ref)
    fs = HOP / SR
    return np.array(keys) * fs, np.array([np.median(by_ref[i]) for i in keys]) * fs, cost


def ref_chords(ref):
    """Acorde em cada 0,25 s da gravação: (raiz, tipo, baixo) ou None, com custo para trocar."""
    from . import lvcr
    L = lvcr.chord_log_probs(lvcr.frame_probs(ref))
    labels = lvcr.vocabulary()
    win = max(1, int(round(0.25 / lvcr.FRAME_SEC)))
    nw = len(L) // win
    if nw < 2:
        raise ValueError("A gravação é curta demais.")
    W = np.stack([L[i * win:(i + 1) * win].mean(axis=0) for i in range(nw)])
    K = W.shape[1]
    dp = W[0].copy()
    back = np.zeros((nw, K), dtype=np.int32)
    for t in range(1, nw):
        best = int(dp.argmax())
        move = dp[best] - SWITCH
        take = move > dp
        back[t] = np.where(take, best, np.arange(K))
        dp = np.where(take, move, dp) + W[t]
    path = np.zeros(nw, dtype=int)
    path[-1] = int(dp.argmax())
    for t in range(nw - 1, 0, -1):
        path[t - 1] = back[t, path[t]]
    return [labels[p] for p in path], 0.25


def song_chords(sid, path):
    """Acordes da gravação da pessoa nos tempos da música: (trechos, 1º tempo coberto, tempo depois do último)."""
    from . import analysis as A
    from . import pipeline as P
    from . import violao as V
    d = P.SONGS / sid
    work = d / "work"
    an = json.loads((d / "analysis.json").read_text(encoding="utf-8"))
    ref = _load(path)
    if len(ref) < SR * 5:
        raise ValueError("A gravação é curta demais (mande pelo menos uns 10 segundos tocando).")
    ref_t, song_t, cost = align(ref, _song_harmony(work))
    if cost > MAX_COST:
        raise ValueError("Não reconheci essa gravação como esta música (o tom é o mesmo?).")
    labels, step = ref_chords(ref)
    grid = np.asarray(an["grid"])
    key = an["key"]
    # cada tempo da música coberto pela gravação: o acorde que mais soa nele (5 pontos dentro do tempo)
    per_beat = {}
    for b in range(len(grid) - 1):
        t0, t1 = grid[b], grid[b + 1]
        if t1 <= song_t[0] or t0 >= song_t[-1]:
            continue
        votes = {}
        for f in (0.1, 0.3, 0.5, 0.7, 0.9):
            rt = float(np.interp(t0 + f * (t1 - t0), song_t, ref_t))
            lab = labels[min(len(labels) - 1, int(rt / step))]
            votes[lab] = votes.get(lab, 0) + (1.5 if f >= 0.5 else 1.0)  # o fim do tempo pesa mais
        per_beat[b] = max(votes, key=votes.get)
    if not per_beat:
        raise ValueError("A gravação não cobre nenhum trecho da música.")
    b0, b1 = min(per_beat), max(per_beat) + 1
    segs, s = [], b0
    for b in range(b0 + 1, b1 + 1):
        if b == b1 or per_beat.get(b) != per_beat.get(s):
            lab = per_beat.get(s)
            seg = {"start_beat": s, "end_beat": b, "start": float(grid[s]), "end": float(grid[min(b, len(grid) - 1)])}
            if lab is None:
                seg.update(kind="N", root=None, bass=None, ext=[], label="N.C.", display="—", spoken="sem acorde")
            else:
                A.name_chord(seg, lab[0], lab[1], lab[2], [], key)
            segs.append(seg)
            s = b
    # 7ª e extensões pelas notas que a pessoa tocou (como na análise), já nos tempos da música
    played = []
    for st, en, m, amp in V.transcribe(ref):
        if 38 <= m <= 88:
            played.append((float(np.interp(st, ref_t, song_t)), float(np.interp(en, ref_t, song_t)), m, amp))
    A.refine_with_notes(segs, played, key)
    return segs, b0, b1


def overlay(chords, segs, b0, b1):
    """Os acordes da referência no lugar dos da análise, só no trecho [b0, b1)."""
    out = []
    for c in chords:
        if c["end_beat"] <= b0 or c["start_beat"] >= b1:
            out.append(c)
            continue
        if c["start_beat"] < b0:  # pedaço antes do trecho
            out.append(dict(c, end_beat=b0, end=segs[0]["start"]))
        if c["end_beat"] > b1:  # pedaço depois
            out.append(dict(c, start_beat=b1, start=segs[-1]["end"]))
    out += segs
    return sorted(out, key=lambda c: c["start_beat"])


def _grid_id(grid):
    """Marca da grade de tempos: a referência guardada só vale para a mesma grade (refazer a análise pode
    mudar os tempos; aí a pessoa manda a gravação de novo)."""
    return [len(grid), round(float(grid[0]), 2), round(float(grid[-1]), 2)]


def apply_saved(an, work):
    """Na análise (ou ao trocar a cifra): aplica a referência guardada por cima dos acordes. Devolve se aplicou."""
    f = work / "referencia.json"
    if not f.exists():
        return False
    ref = json.loads(f.read_text(encoding="utf-8"))
    if ref.get("grade") and ref["grade"] != _grid_id(an["grid"]):
        return False
    segs, b0, b1 = ref["trechos"], ref["de"], ref["ate"]
    an["chords"] = overlay(an["chords"], segs, b0, b1)
    an["chords_detalhado"] = overlay(an.get("chords_detalhado") or an["chords"], segs, b0, b1)
    return True


def use_reference(sid, path):
    """Usa os acordes da gravação da pessoa no trecho que ela tocou e refaz as partituras."""
    from . import pipeline as P
    d = P.SONGS / sid
    work = d / "work"
    segs, b0, b1 = song_chords(sid, path)
    an = json.loads((d / "analysis.json").read_text(encoding="utf-8"))
    (work / "referencia.json").write_text(json.dumps({"trechos": segs, "de": b0, "ate": b1, "grade": _grid_id(an["grid"])},
                                                     ensure_ascii=False), encoding="utf-8")
    if "chords_auto" not in an:
        an["chords_auto"], an["chords_detalhado_auto"] = an["chords"], an["chords_detalhado"]
    # parte dos acordes "de baixo" (cifra encaixada ou o que o app ouviu) e põe a referência por cima
    base = None
    cf = work / "cifra_user.json"
    if cf.exists():
        symbols = json.loads(cf.read_text(encoding="utf-8"))["acordes"]
        base = P.cifra_chords(work, None, an["grid"], an["key"], an["chords_detalhado_auto"], symbols)
    simples, det = base if base else (an["chords_auto"], an["chords_detalhado_auto"])
    an["chords"], an["chords_detalhado"] = simples, det
    apply_saved(an, work)
    an["chords_source"] = "referencia"
    P.rebuild_scores(sid, an, an.get("lyrics") or [])
    return {"de": b0, "ate": b1, "acordes": [c["display"] for c in segs if c.get("kind") != "N"]}


def forget_reference(sid):
    """Volta aos acordes sem a gravação de referência."""
    from . import pipeline as P
    d = P.SONGS / sid
    f = d / "work" / "referencia.json"
    if f.exists():
        f.unlink()
    an = json.loads((d / "analysis.json").read_text(encoding="utf-8"))
    cf = d / "work" / "cifra_user.json"
    if cf.exists():
        return P.save_cifra(sid, P.cifra_text(sid).replace("\n", "  "))
    if "chords_auto" in an:
        an["chords"], an["chords_detalhado"] = an.pop("chords_auto"), an.pop("chords_detalhado_auto")
    an["chords_source"] = "auto"
    P.rebuild_scores(sid, an, an.get("lyrics") or [])
    return an
