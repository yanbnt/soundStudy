"""Violão nota por nota: notas do instrumento -> ataques (acordes ou notas soltas) -> posição no
braço (corda e casa) -> partitura com tablatura (MusicXML).

As notas vêm do Basic Pitch rodando na parte de violão/cavaco da separação (ou na "harmonia", quando
a música foi separada em 4 partes). A posição no braço é escolhida para a mão andar o mínimo possível.
"""
from xml.sax.saxutils import escape

import numpy as np

from . import basicpitch as BP
from .analysis import PC_FLAT, PC_SHARP

OPEN = [64, 59, 55, 50, 45, 40]  # cordas 1 a 6 (1 = Mi agudo), afinação padrão
LOW, HIGH = OPEN[-1], OPEN[0] + 19
MAX_FRET = 15
STRUM_S = 0.045                  # notas que começam juntas (uma batida no violão) viram um acorde

KIND_XML = {
    "maj": "major", "min": "minor", "7": "dominant", "m7": "minor-seventh", "maj7": "major-seventh",
    "m7b5": "half-diminished", "dim7": "diminished-seventh", "m6": "minor-sixth", "mmaj7": "major-minor",
    "6": "major-sixth", "aug": "augmented", "dim": "diminished", "sus2": "suspended-second",
    "sus4": "suspended-fourth", "7sus4": "suspended-fourth", "9": "dominant-ninth", "maj9": "major-ninth",
    "m9": "minor-ninth", "11": "dominant-11th", "13": "dominant-13th",
}
NOTE_TYPES = {1: ("16th", 0), 2: ("eighth", 0), 3: ("eighth", 1), 4: ("quarter", 0), 6: ("quarter", 1),
              8: ("half", 0), 12: ("half", 1), 16: ("whole", 0), 24: ("whole", 1)}


# ---------------------------------------------------------------- notas

def transcribe(y, progress=None):
    """Notas do instrumento: (início s, fim s, nota MIDI, intensidade)."""
    out = BP.run(y, progress=progress)
    return BP.notes(out, onset_thresh=0.5, frame_thresh=0.3, min_note_ms=80, min_hz=75, max_hz=1400)


def attacks(events, grid, spb, min_amp=0.25):
    """Junta as notas em ataques encaixados na grade (spb = casas por tempo).

    Devolve [{"slot", "len", "notes": [(midi, intensidade)]}] em ordem; cada ataque dura até o próximo.
    """
    g = np.asarray(grid)
    beats = np.arange(len(g))
    ev = sorted((a, b, m, amp) for a, b, m, amp in events if amp >= min_amp and LOW <= m <= HIGH)
    groups = []
    for a, b, m, amp in ev:
        if groups and a - groups[-1]["t"] <= STRUM_S:
            grp = groups[-1]
        else:
            grp = {"t": a, "end": b, "notes": {}}
            groups.append(grp)
        grp["end"] = max(grp["end"], b)
        grp["notes"][m] = max(amp, grp["notes"].get(m, 0.0))

    def slot(t):
        return int(round(float(np.interp(t, g, beats)) * spb))

    out = []
    for grp in groups:
        s = slot(grp["t"])
        notes = sorted(grp["notes"].items(), key=lambda kv: -kv[1])[:6]
        if out and out[-1]["slot"] == s:  # dois grupos na mesma casa da grade: junta
            merged = dict(out[-1]["notes"])
            for m, amp in notes:
                merged[m] = max(amp, merged.get(m, 0.0))
            out[-1]["notes"] = sorted(merged.items(), key=lambda kv: -kv[1])[:6]
            out[-1]["end"] = max(out[-1]["end"], slot(grp["end"]))
            continue
        # "t": quando a batida soa na gravação (a grade arredonda; o cursor segue o som)
        out.append({"slot": s, "end": max(s + 1, slot(grp["end"])), "notes": notes, "t": grp["t"]})
    for i, at in enumerate(out):
        nxt = out[i + 1]["slot"] if i + 1 < len(out) else at["end"]
        at["len"] = max(1, min(at["end"], nxt) - at["slot"])
    return out


# ---------------------------------------------------------------- posição no braço

def _shapes(pitches):
    """Jeitos de tocar as notas (da mais aguda para a mais grave) em cordas diferentes."""
    pitches = sorted(pitches, reverse=True)
    res = []

    def rec(i, first, acc):
        if i == len(pitches):
            res.append(tuple(acc))
            return
        for s in range(first, 7):
            f = pitches[i] - OPEN[s - 1]
            if 0 <= f <= MAX_FRET:
                rec(i + 1, s + 1, acc + [(s, f)])
    rec(0, 1, [])
    return res


def _shape_cost(shape):
    fretted = [f for _, f in shape if f > 0]
    if not fretted:
        return 0.0, None
    lo, hi = min(fretted), max(fretted)
    if hi - lo > 4:
        return None, None
    cost = max(0, hi - lo - 2) * 1.5 + 0.12 * (lo + hi) / 2
    if len(set(fretted)) > 4:  # mais de quatro casas diferentes não cabe nos dedos
        cost += 6
    return cost, (lo + hi) / 2


def assign_tab(atks):
    """Escolhe corda e casa de cada nota (Viterbi: forma confortável e mão andando pouco)."""
    options = []
    for at in atks:
        notes = list(at["notes"])
        while True:
            cand = []
            for sh in _shapes([m for m, _ in notes]):
                c, center = _shape_cost(sh)
                if c is not None:
                    cand.append((c, center, sh))
            if cand or len(notes) <= 1:
                break
            notes = sorted(notes, key=lambda kv: -kv[1])[:-1]  # tira a nota mais fraca e tenta de novo
        at["notes"] = notes
        cand.sort(key=lambda x: x[0])
        options.append(cand[:24])

    keep = [i for i, c in enumerate(options) if c]
    best_prev = None
    back = []
    for n, i in enumerate(keep):
        cand = options[i]
        if best_prev is None:
            cur = [(c, None) for c, _, _ in cand]
        else:
            cur = []
            for c, center, _ in cand:
                best, arg = None, None
                for j, (pc, (_, pcenter, _)) in enumerate(zip(best_prev, options[keep[n - 1]])):
                    move = abs(center - pcenter) * 0.8 if center is not None and pcenter is not None else 0.0
                    total = pc[0] + c + move
                    if best is None or total < best:
                        best, arg = total, j
                cur.append((best, arg))
        back.append(cur)
        best_prev = cur
    if not keep:
        return []
    j = int(np.argmin([c for c, _ in back[-1]]))
    chosen = [None] * len(keep)
    for n in range(len(keep) - 1, -1, -1):
        chosen[n] = options[keep[n]][j][2]
        j = back[n][j][1] if back[n][j][1] is not None else 0
    out = []
    for n, i in enumerate(keep):
        at = atks[i]
        pitches = sorted((m for m, _ in at["notes"]), reverse=True)
        out.append({"slot": at["slot"], "len": at["len"], "t": at.get("t"),
                    "notes": [(m, s, f) for m, (s, f) in zip(pitches, chosen[n])]})
    for a, b in zip(out, out[1:]):  # depois de tirar ataques impossíveis, o anterior dura até o próximo
        a["len"] = max(1, min(a["len"], b["slot"] - a["slot"]))
    return out


# ---------------------------------------------------------------- partitura com tablatura

def _step(midi, flats):
    name = (PC_FLAT if flats else PC_SHARP)[midi % 12]
    alter = -1 if "b" in name else (1 if "#" in name else 0)
    return name[0], alter, midi // 12 - 1


def _split(s, e, bar_start, beat_div, cuts):
    """Divide [s, e) em pedaços que viram figuras: corta nas trocas de acorde e nos tempos
    (a não ser que comece no tempo e dure tempos inteiros), e quebra o que não tiver figura."""
    bounds = {s, e} | {k for k in cuts if s < k < e}
    on_beat = (s - bar_start) % beat_div == 0
    whole_beats = (e - s) % beat_div == 0
    if not (on_beat and whole_beats and (e - s) in NOTE_TYPES):
        bounds |= {k for k in range(s + 1, e) if (k - bar_start) % beat_div == 0}
    out = []
    pts = sorted(bounds)
    for a, b in zip(pts, pts[1:]):
        while b - a > 0:
            n = max(d for d in NOTE_TYPES if d <= b - a)
            out.append((a, a + n))
            a += n
    return out


def write_musicxml(path, title, key, bpm, n_beats, chords, tab, spb, beat_ql):
    """Escreve a parte de violão: pauta (clave de sol com 8 embaixo) e tablatura de 6 cordas."""
    from music21 import key as m21key

    flats = key["flats"]
    fifths = m21key.Key(key["name"].replace("b", "-") if len(key["name"]) > 1 else key["name"], key["mode"]).sharps
    beat_div = int(round(beat_ql * 4))  # 4 divisões por semínima: uma casa da grade = semicolcheia
    assert spb * 1 == beat_div, "a grade do violão precisa ser de semicolcheias"
    bar = 4 * beat_div
    n_bars = n_beats // 4
    cuts = {}
    for c in chords:
        if c["kind"] != "N":
            cuts[int(c["start_beat"]) * spb] = c

    by_bar = [[] for _ in range(n_bars)]
    for at in tab:
        s, e = at["slot"], at["slot"] + at["len"]
        for m in range(s // bar, min(n_bars, (e - 1) // bar + 1)):
            a, b = max(s, m * bar), min(e, (m + 1) * bar)
            by_bar[m].append((a, b, at["notes"], a > s, b < e))

    x = ['<?xml version="1.0" encoding="UTF-8"?>',
         '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" '
         '"http://www.musicxml.org/dtds/partwise.dtd">',
         '<score-partwise version="4.0">',
         f'<work><work-title>{escape(title)}</work-title></work>',
         '<identification><creator type="composer">Transcrição automática — Pauta Viva</creator></identification>',
         '<part-list><score-part id="P1"><part-name>Violão</part-name></score-part></part-list>',
         '<part id="P1">']

    def harmony(c):
        r = _step(c["root"] + 60, flats)
        h = f'<harmony><root><root-step>{r[0]}</root-step>' + (f'<root-alter>{r[1]}</root-alter>' if r[1] else '') + '</root>'
        h += f'<kind>{KIND_XML.get(c["kind"], "major")}</kind>'
        if c.get("bass") is not None:
            bs = _step(c["bass"] + 60, flats)
            h += f'<bass><bass-step>{bs[0]}</bass-step>' + (f'<bass-alter>{bs[1]}</bass-alter>' if bs[1] else '') + '</bass>'
        return h + '<staff>1</staff></harmony>'

    def note_xml(dur, staff, pitch=None, chord=False, tie_in=False, tie_out=False, tech=None):
        t, dot = NOTE_TYPES[dur]
        n = '<note>' + ('<chord/>' if chord else '')
        if pitch is None:
            n += '<rest/>'
        else:
            st, al, octv = pitch
            n += f'<pitch><step>{st}</step>' + (f'<alter>{al}</alter>' if al else '') + f'<octave>{octv}</octave></pitch>'
        n += f'<duration>{dur}</duration>'
        if pitch is not None:
            if tie_in:
                n += '<tie type="stop"/>'
            if tie_out:
                n += '<tie type="start"/>'
        n += f'<voice>{1 if staff == 1 else 5}</voice><type>{t}</type>' + ('<dot/>' if dot else '') + f'<staff>{staff}</staff>'
        nots = ''
        if pitch is not None and (tie_in or tie_out):
            nots += ('<tied type="stop"/>' if tie_in else '') + ('<tied type="start"/>' if tie_out else '')
        if tech:
            nots += f'<technical><string>{tech[0]}</string><fret>{tech[1]}</fret></technical>'
        if nots:
            n += f'<notations>{nots}</notations>'
        return n + '</note>'

    for m in range(n_bars):
        a0, b0 = m * bar, (m + 1) * bar
        x.append(f'<measure number="{m + 1}">')
        if m == 0:
            tuning = ''.join(f'<staff-tuning line="{i + 1}"><tuning-step>{_step(p, False)[0]}</tuning-step>'
                             f'<tuning-octave>{_step(p, False)[2]}</tuning-octave></staff-tuning>'
                             for i, p in enumerate(reversed(OPEN)))
            beats, btype = ("4", "4") if beat_div == 4 else ("12", "8")
            x.append('<attributes><divisions>4</divisions>'
                     f'<key><fifths>{fifths}</fifths><mode>{key["mode"]}</mode></key>'
                     f'<time><beats>{beats}</beats><beat-type>{btype}</beat-type></time><staves>2</staves>'
                     '<clef number="1"><sign>G</sign><line>2</line><clef-octave-change>-1</clef-octave-change></clef>'
                     '<clef number="2"><sign>TAB</sign><line>5</line></clef>'
                     f'<staff-details number="2"><staff-lines>6</staff-lines>{tuning}</staff-details></attributes>')
            unit = '<beat-unit>quarter</beat-unit>' + ('<beat-unit-dot/>' if beat_div == 6 else '')
            x.append(f'<direction placement="above"><direction-type><metronome>{unit}<per-minute>{round(bpm)}</per-minute>'
                     f'</metronome></direction-type><staff>1</staff><sound tempo="{round(bpm * beat_ql, 2)}"/></direction>')
        items = sorted(by_bar[m])
        events = []  # (início, fim, notas ou None, liga com o anterior, liga com o próximo)
        pos = a0
        for a, b, notes, tie_in, tie_out in items:
            if a > pos:
                events.append((pos, a, None, False, False))
            events.append((a, b, notes, tie_in, tie_out))
            pos = b
        if pos < b0:
            events.append((pos, b0, None, False, False))
        for staff in (1, 2):
            if staff == 2:
                x.append(f'<backup><duration>{bar}</duration></backup>')
            for a, b, notes, tie_in, tie_out in events:
                parts = _split(a, b, a0, beat_div, cuts)
                for k, (pa, pb) in enumerate(parts):
                    if staff == 1 and pa in cuts:
                        x.append(harmony(cuts[pa]))
                    if notes is None:
                        x.append(note_xml(pb - pa, staff))
                        continue
                    t_in = tie_in or k > 0
                    t_out = tie_out or k < len(parts) - 1
                    for i, (midi, string, fret) in enumerate(notes):
                        x.append(note_xml(pb - pa, staff, _step(midi, flats), chord=i > 0, tie_in=t_in, tie_out=t_out,
                                          tech=(string, fret) if staff == 2 else None))
        x.append('</measure>')
    x.append('</part></score-partwise>')
    path.write_text('\n'.join(x), encoding="utf-8")


def to_json(tab, spb):
    """Para a tela: [início em tempos, duração em tempos, [[nota MIDI, corda, casa], ...], instante (s)]."""
    return [[round(at["slot"] / spb, 4), round(at["len"] / spb, 4),
             [[int(m), int(s), int(f)] for m, s, f in at["notes"]], round(float(at.get("t") or 0.0), 4)]
            for at in tab]
