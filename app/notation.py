"""Escreve a partitura (MusicXML) e o MIDI a partir da análise.

Um "tempo" da análise vira uma semínima em 4/4 ou uma semínima pontuada em 12/8 (beat_ql = 1.5).
"""
from music21 import (chord as m21chord, clef, duration, harmony, key as m21key, metadata, meter,
                     note, pitch, stream, tempo, tie)

from .analysis import CHORD_TYPES, pc_name


def _m21_name(name):
    """'Ab' -> 'A-' (music21 usa '-' para bemol)."""
    return name.replace("b", "-") if len(name) > 1 else name


def _pitch(midi, flats):
    p = pitch.Pitch()
    p.midi = int(midi)
    if p.accidental is not None:
        if flats and p.accidental.name == "sharp":
            p = p.getEnharmonic()
        elif not flats and p.accidental.name == "flat":
            p = p.getEnharmonic()
    return p


def display_shift(notes):
    """Voz grave é escrita uma oitava acima na clave de sol (prática comum)."""
    if not notes:
        return 0
    pitches = sorted(n[2] for n in notes)
    return 12 if pitches[len(pitches) // 2] < 62 else 0


def _melody_part(notes, subdiv, total_slots, flats, shift, beat_ql, words=None):
    """`words`: {slot inicial da nota: texto} para escrever a letra embaixo das notas."""
    part = stream.Part()
    q = beat_ql / subdiv
    pos = 0
    for start, length, midi in notes:
        if start > pos:
            part.insert(pos * q, note.Rest(quarterLength=(start - pos) * q))
        n = note.Note(_pitch(midi + shift, flats))
        n.quarterLength = length * q
        if words and start in words:
            n.lyric = words[start]
        part.insert(start * q, n)
        pos = start + length
    if pos < total_slots:
        part.insert(pos * q, note.Rest(quarterLength=(total_slots - pos) * q))
    return part


def _header(part, key, bpm, beat_ql):
    part.insert(0, clef.TrebleClef())
    part.insert(0, m21key.Key(_m21_name(key["name"]), key["mode"]))
    part.insert(0, meter.TimeSignature("4/4" if beat_ql == 1 else "12/8"))
    part.insert(0, tempo.MetronomeMark(number=round(bpm), referent=duration.Duration(beat_ql)))


def _chord_symbol(c, flats):
    return harmony.ChordSymbol(
        root=_m21_name(pc_name(c["root"], flats)),
        kind=CHORD_TYPES[c["kind"]][2],
        bass=_m21_name(pc_name(c["bass"], flats)) if c["bass"] is not None else None,
    )


def write_score(path, title, key, bpm, n_beats, chords, notes, subdiv, shift, beat_ql=1.0,
                words=None):
    """Partitura de leitura, compasso a compasso e com uma voz só.

    - compasso sem melodia vira barras de ritmo (uma por tempo), como num lead sheet;
    - notas e pausas são divididas nas trocas de acorde, para cada cifra ter o seu lugar;
    - pausas são agrupadas por tempo (e em meio compasso quando não há troca de acorde).
    """
    flats = key["flats"]
    words = words or {}
    spb = subdiv                 # slots por tempo
    spm = 4 * spb                # slots por compasso
    q = beat_ql / subdiv         # semínimas por slot
    alter = m21key.Key(_m21_name(key["name"]), key["mode"]).accidentalByStep("B")
    slash_pitch = "B" + (alter.modifier if alter is not None else "") + "4"  # Si como a armadura manda
    cuts = {}                    # slot onde a cifra muda -> acorde
    for c in chords:
        if c["kind"] != "N":
            cuts[int(c["start_beat"]) * spb] = c

    part = stream.Part()
    part.partName = "Melodia"
    for m in range(n_beats // 4):
        a, b = m * spm, (m + 1) * spm
        meas = stream.Measure(number=m + 1)
        if m == 0:
            meas.insert(0, clef.TrebleClef())
            meas.insert(0, m21key.Key(_m21_name(key["name"]), key["mode"]))
            meas.insert(0, meter.TimeSignature("4/4" if beat_ql == 1 else "12/8"))
            meas.insert(0, tempo.MetronomeMark(number=round(bpm), referent=duration.Duration(beat_ql)))

        pieces = []  # (início, fim, midi, slot da nota original, liga com a anterior, liga com a próxima)
        for start, length, midi in notes:
            end = start + length
            if end <= a or start >= b:
                continue
            ps, pe = max(start, a), min(end, b)
            bounds = [ps] + sorted(k for k in cuts if ps < k < pe) + [pe]
            for i in range(len(bounds) - 1):
                pieces.append((bounds[i], bounds[i + 1], midi, start, bounds[i] > start, bounds[i + 1] < end))

        if not pieces:
            for beat in range(4):  # barras de ritmo, na linha do meio e sem acidente
                n = note.Note(slash_pitch)
                n.notehead = "slash"
                n.stemDirection = "noStem"
                n.quarterLength = beat_ql
                meas.insert(beat * beat_ql, n)
        else:
            pos = a
            for ps, pe, midi, origin, tie_in, tie_out in sorted(pieces):
                if ps > pos:
                    _rests(meas, pos, ps, a, spb, cuts, q)
                n = note.Note(_pitch(midi + shift, flats))
                n.quarterLength = (pe - ps) * q
                if tie_in or tie_out:
                    n.tie = tie.Tie("continue" if tie_in and tie_out else "stop" if tie_in else "start")
                if not tie_in and origin in words:
                    w = words[origin]
                    if isinstance(w, tuple):  # sílaba com a posição na palavra (o hífen sai na partitura)
                        n.lyrics = [note.Lyric(text=w[0], syllabic=w[1])]
                    else:
                        n.lyric = w
                meas.insert((ps - a) * q, n)
                pos = pe
            if pos < b:
                _rests(meas, pos, b, a, spb, cuts, q)

        for slot, c in cuts.items():
            if a <= slot < b:
                meas.insert((slot - a) * q, _chord_symbol(c, flats))
        part.append(meas)

    score = stream.Score()
    score.metadata = metadata.Metadata()
    score.metadata.title = title
    score.metadata.composer = "Transcrição automática — soundStudy"
    score.insert(0, part)
    for meas in part.getElementsByClass(stream.Measure):
        meas.makeBeams(inPlace=True)
    part.makeAccidentals(inPlace=True)
    score.write("musicxml", fp=str(path))


def _rests(meas, x, y, measure_start, spb, cuts, q):
    """Pausas de x a y (slots), cortadas nos tempos e nas trocas de acorde; dois tempos inteiros
    seguidos no mesmo meio compasso, sem troca de acorde no meio, viram uma pausa só."""
    bounds = sorted({x, y} | {k for k in range(x + 1, y) if (k - measure_start) % spb == 0 or k in cuts})
    segs = list(zip(bounds[:-1], bounds[1:]))
    merged = []
    for s, e in segs:
        if merged:
            ps, pe = merged[-1]
            full_prev = (ps - measure_start) % spb == 0 and pe - ps == spb
            full_this = (s - measure_start) % spb == 0 and e - s == spb
            first_half_beat = ((ps - measure_start) // spb) % 2 == 0
            if full_prev and full_this and first_half_beat and s not in cuts:
                merged[-1] = (ps, e)
                continue
        merged.append((s, e))
    for s, e in merged:
        meas.insert((s - measure_start) * q, note.Rest(quarterLength=(e - s) * q))


def write_midi(path, key, bpm, n_beats, chords, notes, subdiv, beat_ql=1.0):
    flats = key["flats"]
    melody = _melody_part(notes, subdiv, n_beats * subdiv, flats, 0, beat_ql)
    melody.partName = "Melodia"
    _header(melody, key, bpm, beat_ql)

    harm = stream.Part()
    harm.partName = "Acordes"
    for c in chords:
        dur = float(c["end_beat"] - c["start_beat"]) * beat_ql
        at = float(c["start_beat"]) * beat_ql
        if c["kind"] == "N":
            harm.insert(at, note.Rest(quarterLength=dur))
            continue
        ints = CHORD_TYPES[c["kind"]][0]
        root = 48 + c["root"]
        notes_ = [root + i for i in ints]
        if c["bass"] is not None:
            notes_.insert(0, 36 + c["bass"])
        ch = m21chord.Chord([_pitch(m, flats) for m in notes_])
        ch.quarterLength = dur
        harm.insert(at, ch)

    score = stream.Score([melody, harm])
    score.makeNotation(inPlace=True)
    score.write("midi", fp=str(path))
