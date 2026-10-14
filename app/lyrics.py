"""Letra cantada: reconhecimento de fala na voz separada (Whisper, roda no computador).

A letra fica só nos arquivos da música no computador de quem usa o app.
"""
import difflib
import os
import re
import unicodedata

import librosa
import numpy as np

_models = {}


def _get_model(name=None):
    """Whisper no tamanho que a máquina aguenta: com placa de vídeo, o "large-v3" na placa
    (erra bem menos palavra); sem placa, o "small" no processador. `name` (pedido da pessoa) ou
    PAUTA_WHISPER_MODEL forçam um tamanho."""
    from faster_whisper import WhisperModel
    from . import hardware
    plan = hardware.plan()
    name = name or os.environ.get("PAUTA_WHISPER_MODEL") or plan["letra"]
    if name in _models:
        return _models[name]
    model = None
    if plan["device"] == "cuda":
        try:
            hardware.add_cuda_dlls()
            model = WhisperModel(name, device="cuda", compute_type="float16")
        except Exception:  # noqa: BLE001 - faltam as bibliotecas da NVIDIA: usa o processador
            import traceback
            traceback.print_exc()
    if model is None:
        model = WhisperModel(name, device="cpu", compute_type="int8", cpu_threads=os.cpu_count() or 4)
    _models[name] = model
    return model


def transcribe(voc, sr, progress=None, model=None):
    """Frases cantadas com o tempo de cada palavra.

    Devolve [{start, end, text, words: [{start, end, text}]}], em segundos.
    """
    y = librosa.resample(voc, orig_sr=sr, target_sr=16000).astype(np.float32)
    total = max(1.0, len(y) / 16000)
    segments, _ = _get_model(model).transcribe(
        y, language="pt", word_timestamps=True, vad_filter=True,
        condition_on_previous_text=False, beam_size=5,
        initial_prompt="Letra de música brasileira, cantada em português do Brasil.")
    lines = []
    for seg in segments:
        if progress:
            progress(min(1.0, seg.end / total))
        # trechos sem canto em que o modelo "inventa" frase: pouca fala e pouca confiança
        if seg.no_speech_prob > 0.6 and seg.avg_logprob < -1.0:
            continue
        words = [{"start": round(w.start, 3), "end": round(w.end, 3), "text": w.word.strip()}
                 for w in (seg.words or []) if w.word.strip()]
        if words:
            lines.append({"start": words[0]["start"], "end": words[-1]["end"],
                          "text": " ".join(w["text"] for w in words), "words": words})
    return lines


def _norm(word):
    w = unicodedata.normalize("NFD", word.lower())
    w = "".join(ch for ch in w if unicodedata.category(ch) != "Mn")
    return re.sub(r"[^a-z0-9]", "", w)


def _syllables(word):
    """Sílabas aproximadas (grupos de vogais) de uma palavra em português."""
    return max(1, len(re.findall(r"[aeiouy]+", _norm(word))))


def _match(a_words, rec):
    """Pares (palavra escrita i, palavra reconhecida j) que batem, pela melhor sequência (DP)."""
    a = [_norm(w) for w in a_words]
    b = [_norm(w["text"]) for w in rec]
    n, m = len(a), len(b)
    if not n or not m:
        return []
    sim = np.full((n, m), -1.0)
    for i in range(n):
        for j in range(m):
            if not a[i] or not b[j]:
                sim[i, j] = -0.5
            elif a[i] == b[j]:
                sim[i, j] = 2.0
            else:
                r = difflib.SequenceMatcher(None, a[i], b[j]).ratio()
                sim[i, j] = 1.0 if r >= 0.6 else (0.0 if r >= 0.4 else -1.0)
    gap = -0.6
    score = np.zeros((n + 1, m + 1))
    back = np.zeros((n + 1, m + 1), dtype=np.int8)
    score[1:, 0] = gap * np.arange(1, n + 1)
    score[0, 1:] = gap * np.arange(1, m + 1)
    back[1:, 0], back[0, 1:] = 1, 2
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            d = score[i - 1, j - 1] + sim[i - 1, j - 1]
            u = score[i - 1, j] + gap
            lft = score[i, j - 1] + gap
            score[i, j] = max(d, u, lft)
            back[i, j] = 0 if score[i, j] == d else (1 if score[i, j] == u else 2)
    pairs = []
    i, j = n, m
    while i > 0 or j > 0:
        if i > 0 and j > 0 and back[i, j] == 0:
            if sim[i - 1, j - 1] > 0:
                pairs.append((i - 1, j - 1))
            i, j = i - 1, j - 1
        elif i > 0 and (j == 0 or back[i, j] == 1):
            i -= 1
        else:
            j -= 1
    return pairs[::-1]


def lrc_offset(starts, onsets, limit=12.0):
    """Atraso (s) entre a letra sincronizada e esta gravação: o que faz as linhas começarem junto
    com notas cantadas (com uma leve preferência por atraso pequeno)."""
    on = np.asarray(onsets, dtype=float)
    st = np.asarray(starts, dtype=float)
    if len(on) < 5 or not len(st):
        return 0.0
    fps = 50
    size = int((max(on.max(), st.max()) + limit + 5) * fps)
    dens = np.zeros(size)
    np.add.at(dens, np.clip((on * fps).astype(int), 0, size - 1), 1.0)
    k = np.exp(-0.5 * (np.arange(-18, 19) / 6.0) ** 2)  # desvio de 0,12 s
    dens = np.convolve(dens, k, mode="same")
    best, best_off = -np.inf, 0.0
    for off in np.arange(-limit, limit + 1e-9, 0.02):
        pos = np.round((st + off) * fps).astype(int)
        ok = (pos >= 0) & (pos < size)
        sc = dens[pos[ok]].sum() - 0.01 * abs(off) * len(st)
        if sc > best:
            best, best_off = sc, float(off)
    return best_off


def align_synced(lrc, onsets, auto_lines=None, total=None):
    """Encaixa a letra sincronizada (LRC) no canto desta gravação.

    `lrc` = [(segundos, texto)] (texto vazio marca o fim da frase anterior); `onsets` = início das
    notas cantadas (s). Acha o atraso entre a letra e a gravação e espalha as palavras de cada linha
    pelas notas cantadas da janela dela, sílaba por sílaba; onde o reconhecimento automático ouviu a
    mesma palavra, usa o tempo dele.
    """
    stamps = sorted(lrc)
    lines = [(t, txt) for t, txt in stamps if txt.strip()]
    if not lines:
        return []
    on = np.sort(np.asarray(onsets, dtype=float))
    off = lrc_offset([t for t, _ in lines], on)
    rec = [w for ln in (auto_lines or []) for w in ln["words"]]
    out, last = [], -1.0
    for k, (t, text) in enumerate(lines):
        ws = t + off
        nxt = [s for s, _ in stamps if s > t]
        we = (nxt[0] + off) if nxt else min(ws + 8.0, total or ws + 8.0)
        we = min(we, ws + 12.0)
        words = text.split()
        syl = [_syllables(w) for w in words]
        total_syl = sum(syl)
        inside = on[(on >= ws - 0.15) & (on < we - 0.05)]
        # sílaba por sílaba sobre as notas da janela (ou espalhadas por igual, sem notas)
        starts = []
        acc = 0
        for s in syl:
            frac = acc / total_syl
            if len(inside):
                starts.append(float(inside[min(len(inside) - 1, int(frac * len(inside)))]))
            else:
                starts.append(ws + frac * max(0.5, we - ws - 0.3))
            acc += s
        # palavras que o reconhecimento automático ouviu igual, dentro da janela, ficam no tempo dele
        near = [w for w in rec if ws - 0.3 <= w["start"] < we]
        for i, j in _match(words, near):
            starts[i] = float(near[j]["start"])
        for i in range(len(starts)):  # sempre andando para a frente
            starts[i] = max(starts[i], (starts[i - 1] if i else last) + 0.05)
        ends = starts[1:] + [min(we, starts[-1] + 0.6)]
        ws_out = [{"start": round(a, 3), "end": round(max(b, a + 0.05), 3), "text": w}
                  for w, a, b in zip(words, starts, ends)]
        out.append({"start": ws_out[0]["start"], "end": ws_out[-1]["end"], "text": text, "words": ws_out})
        last = starts[-1]
    return out


CHORD_TOKEN = re.compile(r"^[A-G][#b♯♭]?(?:m|maj|min|dim|aug|sus|add|°|º|\+|M|[0-9]|\(|\)|/|[#b♯♭]|-)*(?:/[A-G][#b♯♭]?)?$")
SKIP_LINE = re.compile(r"^\s*(\[.*\]|tom\s*:|capotraste|afina[cç][aã]o|composi[cç][aã]o|intro\b|refr[aã]o\s*$|"
                       r"solo\b|ponte\b|final\b|parte\s*\d|primeira parte|segunda parte|[eEBGDA]\s*\|)", re.I)


def clean_pasted(text):
    """Aceita a letra colada de qualquer site, inclusive uma cifra (com os acordes em cima):
    tira as linhas que só têm acordes, os títulos de parte ([Intro], [Refrão]), "Tom:", tablaturas
    e marcações; junta o resto em frases."""
    out = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        tokens = line.replace("|", " ").split()
        if tokens and all(CHORD_TOKEN.match(t.strip("*.,")) or set(t) <= set("-–—|*.,x") for t in tokens):
            continue  # linha de acordes (ou de marcação)
        if SKIP_LINE.match(line):
            continue
        line = re.sub(r"\s{2,}", " ", line.replace("*", "")).strip(" .")
        if line:
            out.append(line)
    return "\n".join(out)


def align_text(text, auto_lines, anchors=None):
    """Encaixa a letra certa (colada pela pessoa) no tempo do canto.

    As palavras escritas são alinhadas com as reconhecidas automaticamente (que podem estar
    erradas, mas estão no tempo certo); palavras sem par recebem tempo interpolado entre as
    vizinhas. Sem reconhecimento, usa `anchors` (início das notas cantadas, em segundos).
    """
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    words = [(li, w) for li, ln in enumerate(lines) for w in ln.split()]
    n = len(words)
    if not n:
        return []
    rec = [w for ln in auto_lines for w in ln["words"]]
    starts, ends = [None] * n, [None] * n
    if rec:
        for i, j in _match([w for _, w in words], rec):
            starts[i], ends[i] = rec[j]["start"], rec[j]["end"]
    elif anchors is not None and len(anchors):
        for i in range(min(n, len(anchors))):
            starts[i] = float(anchors[i])
            ends[i] = float(anchors[i + 1]) if i + 1 < len(anchors) else starts[i] + 0.4

    known = [i for i in range(n) if starts[i] is not None]
    if not known:
        return [{"start": 0.0, "end": 0.0, "text": ln, "words": []} for ln in lines]
    # antes da primeira e depois da última palavra encaixada: 0,3 s por palavra
    for i in range(known[0] - 1, -1, -1):
        ends[i] = starts[i + 1] - 0.02
        starts[i] = ends[i] - 0.3
    for i in range(known[-1] + 1, n):
        starts[i] = ends[i - 1] + 0.02
        ends[i] = starts[i] + 0.3
    # entre duas palavras encaixadas: divide o tempo pelo tamanho de cada palavra
    for k0, k1 in zip(known, known[1:]):
        if k1 - k0 < 2:
            continue
        gap_words = range(k0 + 1, k1)
        t0, t1 = ends[k0], starts[k1]
        weights = [len(words[i][1]) + 1 for i in gap_words]
        total, acc = sum(weights), 0
        for i, wgt in zip(gap_words, weights):
            starts[i] = t0 + (t1 - t0) * acc / total
            acc += wgt
            ends[i] = t0 + (t1 - t0) * acc / total
    out = []
    for li, ln in enumerate(lines):
        idx = [i for i in range(n) if words[i][0] == li]
        ws = [{"start": round(starts[i], 3), "end": round(max(ends[i], starts[i] + 0.05), 3),
               "text": words[i][1]} for i in idx]
        out.append({"start": ws[0]["start"], "end": ws[-1]["end"], "text": ln, "words": ws})
    return out


VOWELS = set("aeiouáéíóúâêôãõàüy")
INSEPARABLE = {"bl", "br", "cl", "cr", "dr", "fl", "fr", "gl", "gr", "pl", "pr", "tl", "tr", "vr",
               "ch", "lh", "nh", "gu", "qu"}


def syllabify(word):
    """Divide uma palavra em sílabas (regras do português, simplificadas para o canto):
    consoante entre vogais vai para a sílaba seguinte; encontros como "br", "tr", "ch", "lh", "nh"
    ficam juntos; "rr", "ss", "sc" se separam; ditongos com i/u ficam juntos, hiatos se separam."""
    low = word.lower()
    n = len(low)
    is_v = [c in VOWELS for c in low]
    for i in range(1, n):  # "qu"/"gu" + vogal: o u é semivogal da consoante
        if low[i] == "u" and low[i - 1] in "qg" and i + 1 < n and low[i + 1] in "eiéêíao":
            is_v[i] = False
    nuclei = []  # (início, fim) de cada grupo de vogais que forma uma sílaba
    i = 0
    while i < n:
        if not is_v[i]:
            i += 1
            continue
        j = i + 1
        while j < n and is_v[j]:
            prev, cur = low[j - 1], low[j]
            ditongo = (cur in "iu" and prev not in "iu") or (prev in "ãõ" and cur in "oe") or (prev + cur in ("ão", "õe", "ãe"))
            if not ditongo:
                break
            j += 1
        nuclei.append((i, j))
        i = j
    if len(nuclei) <= 1:
        return [word]
    cuts = []
    for (a1, b1), (a2, b2) in zip(nuclei, nuclei[1:]):
        cons = low[b1:a2]
        if len(cons) == 0:
            cuts.append(b1)
        elif len(cons) == 1:
            cuts.append(b1)
        elif len(cons) == 2:
            cuts.append(b1 if cons in INSEPARABLE else b1 + 1)
        else:
            cuts.append(a2 - 2 if cons[-2:] in INSEPARABLE else a2 - 1)
    out, last = [], 0
    for c in cuts:
        out.append(word[last:c])
        last = c
    out.append(word[last:])
    return [s for s in out if s]


def syllables_on_notes(lines, notes, slot_time):
    """A letra embaixo das notas, como numa partitura de verdade: uma sílaba por nota.

    Para cada frase, pega as notas cantadas dentro do tempo dela e alinha (programação dinâmica)
    as sílabas com as notas pelo tempo estimado de cada sílaba. Nota sem sílaba nova é melisma
    (a sílaba anterior continua); se faltar nota, duas sílabas dividem a mesma nota.
    Devolve {slot da nota: (texto, "single" | "begin" | "middle" | "end")}.
    """
    if not lines or not notes:
        return {}
    starts = np.array([slot_time(nt[0]) for nt in notes])
    out = {}
    for li, line in enumerate(lines):
        words = line.get("words") or []
        if not words:
            continue
        t0 = words[0]["start"] - 0.2
        t1 = lines[li + 1]["start"] - 0.05 if li + 1 < len(lines) else words[-1]["end"] + 0.6
        idx = [k for k in range(len(notes)) if t0 <= starts[k] < max(t1, t0 + 0.3)]
        if not idx:
            continue
        syl = []  # (texto, posição na palavra, tempo estimado, índice da palavra)
        for wi, w in enumerate(words):
            parts = syllabify(w["text"])
            span = max(0.05, w["end"] - w["start"])
            for k, p in enumerate(parts):
                kind = "single" if len(parts) == 1 else ("begin" if k == 0 else ("end" if k == len(parts) - 1 else "middle"))
                syl.append((p, kind, w["start"] + span * k / len(parts), wi))
        S, N = len(syl), len(idx)
        melisma, merge = 0.25, 0.6
        INF = 1e9
        D = np.full((S + 1, N + 1), INF)
        D[0, :] = np.arange(N + 1) * melisma
        back = np.zeros((S + 1, N + 1), dtype=np.int8)
        for i in range(1, S + 1):
            for j in range(1, N + 1):
                take = D[i - 1, j - 1] + abs(syl[i - 1][2] - starts[idx[j - 1]])
                skip = D[i, j - 1] + melisma  # nota sem sílaba nova
                join = D[i - 1, j] + merge if j > 0 and i > 1 else INF  # sílaba dividindo a nota
                best = min(take, skip, join)
                D[i, j] = best
                back[i, j] = 0 if best == take else (1 if best == skip else 2)
        i, j = S, N
        placed = {}  # índice da nota -> lista de sílabas
        while i > 0 and j > 0:
            if back[i, j] == 0:
                placed.setdefault(j - 1, []).insert(0, syl[i - 1])
                i, j = i - 1, j - 1
            elif back[i, j] == 1:
                j -= 1
            else:
                placed.setdefault(j - 1, []).insert(0, syl[i - 1])
                i -= 1
        for j, group in placed.items():
            text = group[0][0]
            for (p, kind, _, wi), prev in zip(group[1:], group):
                text += ("" if wi == prev[3] else " ") + p  # mesma palavra junta, palavra nova com espaço
            first, last = group[0][1], group[-1][1]
            if first in ("single", "begin") and last in ("single", "end"):
                kind = "single"
            elif first in ("single", "begin"):
                kind = "begin"
            elif last in ("single", "end"):
                kind = "end"
            else:
                kind = "middle"
            out[notes[idx[j]][0]] = (text, kind)
    return out


def words_on_notes(lines, notes, slot_time, tolerance=0.35):
    """Liga cada palavra à nota da melodia que começa mais perto dela.

    `notes` = [(slot inicial, duração, midi)], `slot_time(slot)` = segundos. Devolve {slot: texto}.
    """
    if not lines or not notes:
        return {}
    starts = np.array([slot_time(n[0]) for n in notes])
    out = {}
    for line in lines:
        for w in line["words"]:
            i = int(np.argmin(np.abs(starts - w["start"])))
            if abs(starts[i] - w["start"]) > tolerance:
                continue
            slot = notes[i][0]
            out[slot] = f"{out[slot]} {w['text']}" if slot in out else w["text"]
    return out
