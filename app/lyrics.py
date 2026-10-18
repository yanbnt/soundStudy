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


def as_events(voice):
    """Trechos cantados [(início, fim, nota)] a partir dos trechos da análise ou, em análises antigas,
    só dos inícios das notas (cada um vira um trecho curto)."""
    out = []
    for v in voice or []:
        if isinstance(v, (int, float)):
            out.append((float(v), float(v) + 0.2, 0))
        else:
            out.append((float(v[0]), float(v[1]), int(v[2]) if len(v) > 2 else 0))
    return sorted(out)


def phrase_starts(events, quiet=0.3):
    """Respirações: início de nota depois de pelo menos `quiet` s sem voz (a 1ª nota também conta)."""
    out, prev_end = [], -1e9
    for a, b, _ in events:
        if a - prev_end >= quiet:
            out.append(a)
        prev_end = max(prev_end, b)
    return np.asarray(out, dtype=float)


def lrc_offset(starts, events, limit=12.0, lrc_duration=None, audio_duration=None):
    """Atraso (s) entre a letra sincronizada (LRC) e esta gravação.

    Cada linha da letra começa numa respiração do cantor: o atraso é o que põe o maior número de
    carimbos perto de uma respiração (e não perto de qualquer nota: no meio da frase as notas são
    densas e o máximo caía lá, deslocando a letra inteira em uma frase, ~3 s). Quando a letra da base
    tem a mesma duração do áudio, é a mesma gravação: a busca fica em ±(diferença + 1,5 s)."""
    ev = as_events(events)
    st = np.asarray(starts, dtype=float)
    ph = phrase_starts(ev)
    if len(ph) < 3 or not len(st):
        return 0.0
    if lrc_duration and audio_duration:
        limit = min(limit, abs(float(lrc_duration) - float(audio_duration)) + 1.5)
    best, best_off = -np.inf, 0.0
    for off in np.arange(-limit, limit + 1e-9, 0.02):
        d = np.abs(ph[None, :] - (st[:, None] + off)).min(axis=1)
        sc = np.exp(-0.5 * (d / 0.15) ** 2).sum() - 0.02 * abs(off)
        if sc > best:
            best, best_off = sc, float(off)
    # refina pela mediana das linhas que caíram perto de uma respiração
    d = ph[None, :] - (st[:, None] + best_off)
    near = d[np.arange(len(st)), np.abs(d).argmin(axis=1)]
    near = near[np.abs(near) <= 0.4]
    if len(near) >= 3:
        best_off += float(np.median(near))
    return best_off


def snap_words(auto_lines, events):
    """O reconhecimento (Whisper) às vezes marca o início da palavra no silêncio antes da frase: puxa
    cada início para o primeiro início de nota cantada dentro da palavra [início-0,05; fim-0,03]."""
    on = np.asarray([a for a, _, _ in as_events(events)], dtype=float)
    if not len(on):
        return auto_lines
    out, last = [], -1.0
    for ln in auto_lines or []:
        words = []
        for w in ln.get("words") or []:
            w = dict(w)
            # a nota tem que vir depois do início já usado pela palavra anterior: duas palavras coladas
            # (fim de uma = início da outra) não podem cair no mesmo ataque
            cand = on[(on >= w["start"] - 0.05) & (on <= w["end"] - 0.03) & (on > last + 0.02)]
            if len(cand):
                w["start"] = round(float(cand[0]), 3)
            last = max(last, w["start"])
            words.append(w)
        out.append({**ln, "words": words, "start": words[0]["start"] if words else ln.get("start")})
    return out


def align_synced(lrc, events, auto_lines=None, total=None, lrc_duration=None):
    """Encaixa a letra sincronizada (LRC) no canto desta gravação.

    `lrc` = [(segundos, texto)] (texto vazio marca o fim da frase anterior); `events` = trechos
    cantados [(início, fim, nota)] (ou só os inícios, em análises antigas).
    1. acha o atraso entre a letra e a gravação (pelas respirações, `lrc_offset`);
    2. cada linha começa na respiração mais próxima do carimbo (±0,8 s) e vai até o começo real da
       linha seguinte (antes a janela ia até o carimbo seguinte e pegava as 1ªs notas da outra linha);
    3. dentro da linha, onde o reconhecimento ouviu a mesma palavra, vale o tempo dele (já puxado para
       a nota); as outras vão sílaba por sílaba sobre as notas da linha; duas palavras na mesma nota:
       a segunda vai para a nota seguinte.
    """
    stamps = sorted(lrc)
    lines = [(t, txt) for t, txt in stamps if txt.strip()]
    if not lines:
        return []
    ev = as_events(events)
    on = np.asarray([a for a, _, _ in ev], dtype=float)
    ph = phrase_starts(ev)
    off = lrc_offset([t for t, _ in lines], ev, lrc_duration=lrc_duration, audio_duration=total)
    rec = [w for ln in (auto_lines or []) for w in ln["words"]]

    # começo real de cada linha
    line_start = []
    for t, _ in lines:
        target = t + off
        cand = ph[np.abs(ph - target) <= 0.8] if len(ph) else ph
        if len(cand):
            s = float(cand[np.abs(cand - target).argmin()])
        else:
            after = on[on >= target - 0.15]
            s = float(after[0]) if len(after) and after[0] - target < 2.0 else target
        if line_start and s <= line_start[-1] + 0.1:  # sempre para a frente
            s = max(target, line_start[-1] + 0.1)
        line_start.append(s)

    out, last = [], -1.0
    for k, (t, text) in enumerate(lines):
        ws = line_start[k]
        nxt_any = [(s, txt) for s, txt in stamps if s > t]
        if k + 1 < len(lines):
            we = line_start[k + 1]
        else:
            we = (nxt_any[0][0] + off) if nxt_any else min(ws + 8.0, total or ws + 8.0)
        # carimbo vazio logo depois da linha = fim da frase na letra da base: as palavras não passam dele
        # (senão iam para dentro do trecho instrumental, nos vazamentos da voz)
        if nxt_any and not nxt_any[0][1].strip():
            we = min(we, nxt_any[0][0] + off + 0.3)
        we = max(ws + 0.3, min(we, ws + 12.0))
        words = text.split()
        syl = [_syllables(w) for w in words]
        inside = np.round(on[(on >= ws - 0.02) & (on < we - 0.02)], 3)
        # 1º as palavras que o reconhecimento ouviu (tempo confiável, já puxado para a nota), inclusive as
        # que cruzam a linha; depois as outras, sílaba por sílaba, só entre as confiáveis vizinhas (antes
        # o chute podia passar da palavra confiável seguinte e empurrá-la para depois, até 1,3 s)
        near = [w for w in rec if w["start"] < we and w.get("end", w["start"]) > ws - 0.1]
        anchor = {}
        for i, j in _match(words, near):
            anchor[i] = round(float(min(max(near[j]["start"], ws), we - 0.05)), 3)
        keys = sorted(anchor)
        for i in range(len(keys) - 1, 0, -1):  # âncoras fora de ordem (par errado): fica a mais segura
            if anchor[keys[i]] <= anchor[keys[i - 1]]:
                del anchor[keys[i]]
        starts = [None] * len(words)
        for i, v in anchor.items():
            starts[i] = v
        i = 0
        while i < len(words):
            if starts[i] is not None:
                i += 1
                continue
            j = i
            while j < len(words) and starts[j] is None:
                j += 1
            lo = starts[i - 1] if i > 0 else ws - 0.02
            hi = starts[j] if j < len(words) else we
            pool = inside[(inside > lo + 0.005) & (inside < hi - 0.005)] if i > 0 else inside[inside < hi - 0.005]
            gsyl = syl[i:j]
            tot, acc = sum(gsyl), 0
            for q, s in zip(range(i, j), gsyl):
                frac = acc / tot
                if len(pool):
                    starts[q] = float(pool[min(len(pool) - 1, int(frac * len(pool)))])
                else:
                    a = max(lo + 0.02, ws) if i > 0 else ws
                    starts[q] = a + frac * max(0.05, hi - a - 0.05)
                acc += s
            i = j
        for i in range(len(starts)):  # sempre andando para a frente (com folga para o arredondamento)
            prev = starts[i - 1] if i else last
            if starts[i] <= prev + 0.005:
                later = inside[inside > prev + 0.01]
                starts[i] = float(later[0]) if len(later) else prev + 0.05
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
    # sempre para a frente: um par errado do reconhecimento podia pôr uma palavra antes da anterior
    for i in range(1, n):
        if starts[i] <= starts[i - 1] + 0.005:
            starts[i] = starts[i - 1] + 0.05
            ends[i] = max(ends[i], starts[i] + 0.05)
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
