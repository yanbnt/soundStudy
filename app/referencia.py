"""Acordes de uma gravação de referência: a pessoa grava (ou manda) ela mesma tocando a música, e o app usa
os acordes dela no trecho que ela tocou.

Por quê: na gravação da banda o reconhecimento às vezes erra feio num trecho inteiro (na Um vencedor ouviu
F#m7(11) por cinco compassos onde o violão passa por A7M, D7M, F7M, E7, Dm7 — as notas são quase as mesmas).
Tocado sozinho, sem bateria nem voz, o mesmo reconhecimento acerta.

Como:
1. alinha a gravação da pessoa com a parte de harmonia da música (croma + DTW com a inclinação presa entre
   1/2 e 2: andamentos parecidos, a pessoa pode começar e parar em qualquer ponto);
2. pontua os acordes da gravação dela em cada tempo da música (o mesmo modelo de vocabulário grande) e
   escolhe um acorde por tempo com os mesmos custos de troca da análise normal (menores no 1 e no 3 do
   compasso; antes eram 7 a 9 vezes maiores e apagavam as passagens que ela toca, como o II-V de um tempo
   cada); no Simples o acorde de um tempo só junta com o vizinho e os nomes ficam como na cifra (sem 9ª,
   11ª, 13ª); no Detalhado as notas que ela tocou (Basic Pitch) decidem 7ª e extensões, como na análise;
3. no trecho coberto, troca os acordes da análise por esses.
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


#  Por nível: custo de trocar de acorde por tempo do compasso (1º, 2º, 3º, 4º) e quanto um acorde de um tempo
#  só precisa ganhar dos dois vizinhos para ficar (None = sempre junta). Os mesmos da análise
#  (analysis.detect_chords, modelo de vocabulário grande): a gravação da pessoa é limpa, não precisa de mais.
CHANGE = {"simples": ((0.6, 2.4, 1.0, 1.8), None), "detalhado": ((0.3, 0.9, 0.5, 0.7), 0.7)}


def _beat_scores(L, song_t, ref_t, grid):
    """Pontuação de cada acorde em cada tempo da música coberto pela gravação (média dos quadros dela que
    caem naquele tempo). Devolve (1º tempo, matriz tempos x acordes)."""
    from . import lvcr
    cover = [b for b in range(len(grid) - 1) if grid[b + 1] > song_t[0] and grid[b] < song_t[-1]]
    if not cover:
        raise ValueError("A gravação não cobre nenhum trecho da música.")
    rows = []
    for b in range(cover[0], cover[-1] + 1):
        t0, t1 = grid[b], grid[b + 1]
        r0 = float(np.interp(t0 + 0.1 * (t1 - t0), song_t, ref_t))
        r1 = float(np.interp(t1 - 0.1 * (t1 - t0), song_t, ref_t))
        fa = int(max(0, r0 / lvcr.FRAME_SEC))
        fb = int(max(fa + 1, r1 / lvcr.FRAME_SEC))
        rows.append(L[min(fa, len(L) - 1):min(max(fb, fa + 1), len(L))].mean(axis=0))
    return cover[0], np.stack(rows)


def _levels(S, b0, grid, key, played):
    """Um acorde por tempo em cada nível, do jeito da análise (mesmo Viterbi, mesma limpeza dos acordes de um
    tempo só, mesmos trechos). Devolve {"simples": trechos, "detalhado": trechos}."""
    from . import analysis as A
    from . import lvcr
    labels = lvcr.vocabulary()
    pos = (b0 + np.arange(len(S))) % 4  # tempo do compasso (a grade começa no 1)
    out = {}
    for level, (pen, keep) in CHANGE.items():
        path = A._drop_blips(A._viterbi(S, np.array(pen)[pos]), S, keep)
        per_beat = [labels[p] for p in path]
        if level == "simples":  # o nome fica como na cifra: sem 9ª, 11ª e 13ª
            per_beat = [None if lab is None else (lab[0], A.SIMPLE_KIND.get(lab[1], lab[1])) + tuple(lab[2:])
                        for lab in per_beat]
        segs = A.chord_segments(per_beat, None, grid, b0, key)
        if level == "detalhado":
            A.refine_with_notes(segs, played, key)
        out[level] = segs
    return out


def song_chords(sid, path):
    """Acordes da gravação da pessoa nos tempos da música, nos dois níveis:
    ({"simples": trechos, "detalhado": trechos}, 1º tempo coberto, tempo depois do último)."""
    from . import lvcr
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
    L = lvcr.chord_log_probs(lvcr.frame_probs(ref))
    grid = np.asarray(an["grid"])
    b0, S = _beat_scores(L, song_t, ref_t, grid)
    # Tempos das pontas em que ela ainda não tocava (ou já tinha parado) ficam com os acordes da análise, em vez
    # de "sem acorde" por cima deles: o 1º tempo coberto costuma pegar só o comecinho da gravação, em silêncio
    tocou = np.flatnonzero(S.argmax(axis=1) != S.shape[1] - 1)  # a última coluna é "sem acorde"
    if not len(tocou):
        raise ValueError("Não ouvi acordes nessa gravação.")
    S, b0 = S[tocou[0]:tocou[-1] + 1], b0 + int(tocou[0])
    # notas que a pessoa tocou, já nos tempos da música: decidem 7ª e extensões no Detalhado
    played = []
    for st, en, m, amp in V.transcribe(ref):
        if 38 <= m <= 88:
            played.append((float(np.interp(st, ref_t, song_t)), float(np.interp(en, ref_t, song_t)), m, amp))
    return _levels(S, b0, grid, an["key"], played), b0, b0 + len(S)


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
    t, b0, b1 = ref["trechos"], ref["de"], ref["ate"]
    simples, det = (t["simples"], t["detalhado"]) if isinstance(t, dict) else (t, t)
    an["chords"] = overlay(an["chords"], simples, b0, b1)
    an["chords_detalhado"] = overlay(an.get("chords_detalhado") or an["chords"], det, b0, b1)
    return True


def use_reference(sid, path):
    """Usa os acordes da gravação da pessoa no trecho que ela tocou e refaz as partituras."""
    from . import pipeline as P
    d = P.SONGS / sid
    work = d / "work"
    levels, b0, b1 = song_chords(sid, path)
    segs = levels["simples"]
    an = json.loads((d / "analysis.json").read_text(encoding="utf-8"))
    (work / "referencia.json").write_text(json.dumps({"trechos": levels, "de": b0, "ate": b1, "grade": _grid_id(an["grid"])},
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
