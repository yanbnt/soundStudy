"""Análise musical: pulso, tom, acordes e melodia a partir dos stems separados."""
import numpy as np
import librosa

SR = 22050
HOP = 512

PC_SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
PC_FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"]
PT_LETTER = {"C": "Dó", "D": "Ré", "E": "Mi", "F": "Fá", "G": "Sol", "A": "Lá", "B": "Si"}
FLAT_MAJOR = {5, 10, 3, 8, 1, 6}  # Fá, Si♭, Mi♭, Lá♭, Ré♭, Sol♭
FLAT_MINOR = {2, 7, 0, 5, 10, 3}  # ré, sol, dó, fá, si♭, mi♭

# tipo: (intervalos, viés, kind do MusicXML, sufixo da cifra, nome falado)
CHORD_TYPES = {
    "maj": ((0, 4, 7), 0.000, "major", "", "maior"),
    "min": ((0, 3, 7), 0.000, "minor", "m", "menor"),
    "7": ((0, 4, 7, 10), -0.030, "dominant-seventh", "7", "com sétima"),
    "m7": ((0, 3, 7, 10), -0.025, "minor-seventh", "m7", "menor com sétima"),
    "maj7": ((0, 4, 7, 11), -0.030, "major-seventh", "7M", "com sétima maior"),
    "m7b5": ((0, 3, 6, 10), -0.050, "half-diminished-seventh", "m7(b5)", "meio-diminuto"),
    "dim7": ((0, 3, 6, 9), -0.070, "diminished-seventh", "°", "diminuto"),
    # os tipos abaixo só vêm do modelo treinado (BTC): por modelo de notas eles se confundem
    "m6": ((0, 3, 7, 9), -0.04, "minor-sixth", "m6", "menor com sexta"),
    "mmaj7": ((0, 3, 7, 11), -0.05, "minor-major-seventh", "m(7M)", "menor com sétima maior"),
    "6": ((0, 4, 7, 9), -0.04, "major-sixth", "6", "com sexta"),
    "aug": ((0, 4, 8), -0.07, "augmented", "(#5)", "aumentado"),
    "dim": ((0, 3, 6), -0.07, "diminished", "dim", "diminuto, sem sétima"),
    "sus2": ((0, 2, 7), -0.06, "suspended-second", "sus2", "com segunda no lugar da terça"),
    "sus4": ((0, 5, 7), -0.05, "suspended-fourth", "4", "com quarta no lugar da terça"),
    # extensões: só vêm do modelo de vocabulário grande (app/lvcr)
    "7sus4": ((0, 5, 7, 10), -0.05, "suspended-fourth", "7(4)", "com sétima e quarta no lugar da terça"),
    "9": ((0, 4, 7, 10, 14), -0.05, "dominant-ninth", "7(9)", "com sétima e nona"),
    "maj9": ((0, 4, 7, 11, 14), -0.05, "major-ninth", "7M(9)", "com sétima maior e nona"),
    "m9": ((0, 3, 7, 10, 14), -0.05, "minor-ninth", "m7(9)", "menor com sétima e nona"),
    "11": ((0, 7, 10, 14, 17), -0.06, "dominant-11th", "7(11)", "com sétima, nona e décima primeira"),
    "13": ((0, 4, 7, 10, 14, 21), -0.06, "dominant-13th", "7(13)", "com sétima e décima terceira"),
    # os tipos abaixo só vêm de cifra colada (o reconhecimento não os escolhe)
    "7sus2": ((0, 2, 7, 10), -0.06, "suspended-second", "7(2)", "com sétima e segunda no lugar da terça"),
    "maj7sus4": ((0, 5, 7, 11), -0.06, "suspended-fourth", "7M(4)", "com sétima maior e quarta no lugar da terça"),
    "aug7": ((0, 4, 8, 10), -0.07, "augmented-seventh", "7(#5)", "aumentado com sétima"),
    "power": ((0, 7), -0.07, "power", "5", "só com a quinta, sem terça"),
}
# Como cada tipo vai para a partitura (MusicXML): tipo + graus fixos (valor, alteração, add/alter/subtract).
# 7(4) = dominante sem a terça e com a quarta (o mesmo jeito do leitor de partitura da tela).
XML_FORM = {
    "maj": ("major", ()), "min": ("minor", ()), "7": ("dominant", ()), "m7": ("minor-seventh", ()),
    "maj7": ("major-seventh", ()), "m7b5": ("half-diminished", ()), "dim7": ("diminished-seventh", ()),
    "m6": ("minor-sixth", ()), "mmaj7": ("major-minor", ()), "6": ("major-sixth", ()), "aug": ("augmented", ()),
    "dim": ("diminished", ()), "sus2": ("suspended-second", ()), "sus4": ("suspended-fourth", ()),
    "7sus4": ("dominant", ((4, 0, "add"), (3, 0, "subtract"))),
    "7sus2": ("dominant", ((2, 0, "add"), (3, 0, "subtract"))),
    "maj7sus4": ("major-seventh", ((4, 0, "add"), (3, 0, "subtract"))),
    "aug7": ("augmented-seventh", ()), "power": ("power", ()),
    "9": ("dominant-ninth", ()), "maj9": ("major-ninth", ()), "m9": ("minor-ninth", ()),
    "11": ("dominant-11th", ()), "13": ("dominant-13th", ()),
}
# no nível "simples", as extensões viram o acorde de sétima por baixo delas
SIMPLE_KIND = {"9": "7", "maj9": "maj7", "m9": "m7", "11": "7sus4", "13": "7"}
TEMPLATE_KINDS = ("maj", "min", "7", "m7", "maj7", "m7b5", "dim7")
TEMPLATE_WEIGHTS = (1.0, 0.85, 0.7, 0.75)

KK_MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
KK_MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])


# ---------------------------------------------------------------- nomes

def uses_flats(tonic, mode):
    return tonic in (FLAT_MAJOR if mode == "major" else FLAT_MINOR)


def pc_name(pc, flats):
    return (PC_FLAT if flats else PC_SHARP)[pc % 12]


def pretty(name):
    """'Bb7M' -> 'B♭7M' (só troca acidentes logo depois da letra)."""
    if len(name) > 1 and name[1] in "b#":
        return name[0] + ("♭" if name[1] == "b" else "♯") + name[2:]
    return name


def pt_name(pc, flats):
    n = pc_name(pc, flats)
    return PT_LETTER[n[0]] + {"b": "♭", "#": "♯"}.get(n[1:], "")


LETTERS = "CDEFGAB"
NATURAL = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
_DEG_STEP = (0, 1, 1, 2, 2, 3, 3, 4, 5, 5, 6, 6)  # semitons acima da tônica -> graus (letras) acima


def spell(pc, key):
    """Nome da nota pela função dela no tom, como o músico escreve: em Ré maior o VI grau abaixado
    é B♭ (não A♯) e o IV aumentado é G♯. Nomes raros (C♭, F♭, E♯, B♯) voltam ao nome comum."""
    if key is None:
        return pc_name(pc, False)
    iv = (pc - key["tonic"]) % 12
    letter = LETTERS[(LETTERS.index(key["name"][0]) + _DEG_STEP[iv]) % 7]
    diff = (pc - NATURAL[letter]) % 12
    diff = diff - 12 if diff > 6 else diff
    if diff not in (-1, 0, 1):
        return pc_name(pc, key["flats"])
    name = letter + {0: "", 1: "#", -1: "b"}[diff]
    return pc_name(pc, key["flats"]) if name in ("Cb", "Fb", "E#", "B#") else name


def pt_spelled(name):
    """'Bb' -> 'Si♭'."""
    return PT_LETTER[name[0]] + {"b": "♭", "#": "♯"}.get(name[1:], "")


# ---------------------------------------------------------------- extensões e nome do acorde

# extensão (semitons acima da raiz, mod 12) -> como se escreve e como se fala
EXT_NAME = {1: "b9", 2: "9", 3: "#9", 5: "11", 6: "#11", 8: "b13", 9: "13"}
EXT_ORDER = (1, 2, 3, 5, 6, 8, 9)
EXT_SPOKEN = {1: "nona menor", 2: "nona", 3: "nona aumentada", 5: "décima primeira",
              6: "décima primeira aumentada", 8: "décima terceira menor", 9: "décima terceira"}
# MusicXML: extensão -> (grau, alteração)
EXT_DEGREE = {1: (9, -1), 2: (9, 0), 3: (9, 1), 5: (11, 0), 6: (11, 1), 8: (13, -1), 9: (13, 0)}
# tipos do modelo que já trazem extensão: tipo de base + extensões
SPLIT_KIND = {"9": ("7", (2,)), "maj9": ("maj7", (2,)), "m9": ("m7", (2,)), "13": ("7", (2, 9)),
              "11": ("7sus4", (2,))}


def normalize_chord(kind, ext):
    """(tipo, extensões) no jeito das cifras: tríade com 13 vira acorde de sexta (D6, Gm6)."""
    if kind in SPLIT_KIND:
        base, more = SPLIT_KIND[kind]
        kind, ext = base, set(ext) | set(more)
    ext = set(ext)
    if kind in ("maj", "min") and 9 in ext:
        kind = "6" if kind == "maj" else "m6"
    if kind in ("6", "m6", "dim7"):
        ext.discard(9)  # a sexta já está no tipo
    if kind in ("sus4", "7sus4"):
        ext.discard(5)
    return kind, sorted(ext, key=EXT_ORDER.index)


def chord_suffix(kind, ext):
    """Sufixo da cifra: ('6', [2]) -> '6(9)'; ('maj7', [6]) -> '7M(#11)'; ('maj', [2]) -> '9' (D9 =
    ré com nona e sem sétima, como nas cifras brasileiras)."""
    base = CHORD_TYPES[kind][3]
    names = [EXT_NAME[i] for i in ext if i in EXT_NAME]
    if not names:
        return base
    if kind == "maj" and names == ["9"]:
        return "9"
    if base.endswith(")"):
        return base[:-1] + "/" + "/".join(names) + ")"
    return base + "(" + "/".join(names) + ")"


def pretty_suffix(s):
    for a, b in (("b5", "♭5"), ("#5", "♯5"), ("b9", "♭9"), ("#9", "♯9"), ("#11", "♯11"), ("b13", "♭13")):
        s = s.replace(a, b)
    return s


def chord_intervals(seg):
    """Notas do trecho (semitons sobre a raiz): tipo, quinta alterada (5- / 5+) e extensões."""
    ints = list(CHORD_TYPES[seg["kind"]][0])
    alt5 = seg.get("alt5")
    if alt5:
        ints = [iv + alt5 if iv == 7 else iv for iv in ints]
    return ints + [12 + iv for iv in seg.get("ext") or ()]


def xml_harmony(seg):
    """(tipo MusicXML, [(grau, alteração, add/alter/subtract), ...]) do trecho: forma fixa do tipo,
    quinta alterada e extensões. É o mesmo para a partitura de leitura e a dos instrumentos, e a tela
    usa estes graus para dar a cada acorde o nome escrito na análise."""
    kind, fixed = XML_FORM.get(seg["kind"], ("major", ()))
    degrees = [list(d) for d in fixed]
    if seg.get("alt5"):
        degrees.append([5, seg["alt5"], "alter"])
    for iv in seg.get("ext") or ():
        value, alter = EXT_DEGREE[iv]
        degrees.append([value, alter, "add"])
    return kind, degrees


def name_chord(seg, root, kind, bass, ext, key, alt5=None):
    """Preenche raiz, tipo, baixo, extensões e os nomes (cifra, tela, falado) de um trecho de acorde.
    `alt5`: quinta diminuta (-1) ou aumentada (+1) escrita na cifra (G7M(5-))."""
    kind, ext = normalize_chord(kind, ext)
    rname = spell(root, key)
    suffix = chord_suffix(kind, ext)
    label = rname + suffix
    display = pretty(rname) + pretty_suffix(suffix)
    spoken = pt_spelled(rname) + " " + CHORD_TYPES[kind][4]
    if alt5:
        spoken += ", com quinta " + ("diminuta" if alt5 < 0 else "aumentada")
    if ext:
        spoken += ", com " + " e ".join(EXT_SPOKEN[i] for i in ext)
    bname = None
    if bass is not None:
        bname = spell(bass, key)
        label += "/" + bname
        display += "/" + pretty(bname)
        spoken += ", baixo em " + pt_spelled(bname)
    seg.update(kind=kind, root=root, bass=bass, ext=list(ext), alt5=alt5 or None, root_name=rname, bass_name=bname,
               suffix=pretty_suffix(suffix), label=label, display=display, spoken=spoken)
    xkind, degrees = xml_harmony(seg)
    seg["xml"] = {"kind": xkind, "degrees": degrees}
    return seg


# ---------------------------------------------------------------- utilidades

def _frames(t):
    return librosa.time_to_frames(np.maximum(t, 0), sr=SR, hop_length=HOP)


def beat_sync(feat, times, trim=0.0):
    """Média de cada coluna de `feat` (d x T) em cada intervalo entre tempos consecutivos.

    `trim` descarta essa fração em cada ponta do intervalo (o croma "vaza" para o tempo vizinho).
    """
    T = feat.shape[1]
    times = np.asarray(times)
    span = np.diff(times)
    a_t = times[:-1] + trim * span
    b_t = times[1:] - trim * span
    fa, fb = np.clip(_frames(a_t), 0, T), np.clip(_frames(b_t), 0, T)
    out = np.zeros((len(times) - 1, feat.shape[0]))
    for i in range(len(times) - 1):
        a, b = fa[i], max(fb[i], fa[i] + 1)
        if a < T:
            out[i] = feat[:, a:min(b, T)].mean(axis=1)
    return out


# ---------------------------------------------------------------- pulso

def chord_change_times(probs, penalty=None):
    """Instantes em que o acorde muda, direto das probabilidades do modelo (sem depender do pulso)."""
    if probs is None:
        return np.array([])
    kind, p = probs
    if kind == "lv":
        from . import lvcr
        S, frame_sec, penalty = lvcr.chord_log_probs(p), lvcr.FRAME_SEC, penalty or 30.0
    else:
        from . import chord_model as CM
        S, frame_sec, penalty = np.log(p + 1e-4), CM.FRAME_SEC, penalty or 4.0
    if len(S) < 4:
        return np.array([])
    path = _viterbi(S, np.full(len(S), penalty))
    idx = np.flatnonzero(path[1:] != path[:-1]) + 1
    return idx * frame_sec


def estimate_meter(y, changes=None):
    """Compasso e andamento como um músico contaria.

    Acha a menor divisão que se repete (a "subdivisão": colcheia ou semicolcheia) e testa os
    agrupamentos: tempo de 2 ou de 4 subdivisões (4/4) ou de 3 (12/8). Cada hipótese ganha pontos
    pela força da repetição no tempo e no compasso, por os acordes trocarem em cima do tempo
    (em 12/8 a troca no meio do tempo é rara) e por um andamento confortável de contar.
    Devolve (duração do tempo em s, subdivisão do nível simples: 2 = binário, 3 = ternário).
    """
    hop = 256
    fps = SR / hop
    env = librosa.onset.onset_strength(y=y, sr=SR, hop_length=hop, aggregate=np.median)
    e = env - env.mean()
    ac = librosa.autocorrelate(e, max_size=int(9 * fps))
    ac = ac / (ac[0] + 1e-9)

    def at(sec):
        lag = int(round(sec * fps))
        if lag + 3 >= len(ac):
            return 0.0
        return float(ac[max(1, lag - 2):lag + 3].max())

    # subdivisão: o período curto cujos múltiplos se repetem com mais força
    cands = np.arange(0.10, 0.34, 1 / fps)
    comb = np.array([np.mean([at(k * c) for k in range(1, 9)]) for c in cands])
    best = float(comb.max())
    tatum = float(cands[int(np.argmax(comb))])
    for c, v in zip(cands, comb):  # entre dois quase empatados, fica o mais curto (o outro é múltiplo dele)
        if v >= 0.92 * best:
            tatum = float(c)
            break

    changes = np.asarray(changes if changes is not None else [])

    def on_grid(period):
        """0..1: quanto as trocas de acorde se concentram numa mesma fase desse período."""
        if len(changes) < 8:
            return 0.0
        ph = np.exp(2j * np.pi * (changes / period))
        return float(np.abs(ph.mean()))

    options = []
    for g, sub in ((2, 2), (4, 2), (3, 3)):
        beat = g * tatum
        bpm = 60.0 / beat
        if not 45 <= bpm <= 170:
            continue
        pulse = (at(beat) + at(2 * beat) + at(4 * beat)) / 3
        harmony = on_grid(beat) + 0.5 * on_grid(2 * beat)
        comfort = float(np.exp(-0.5 * (np.log2(bpm / 85.0) / 0.55) ** 2))
        options.append((pulse + 0.6 * harmony + 0.25 * comfort, beat, sub))
    if not options:
        return 4 * tatum, 2
    _, beat, sub = max(options)
    return beat, sub


def track_beats(y, duration, low=None, period=None):
    """Tempos (em segundos) regularizados, cobrindo a música inteira, e o BPM.

    `low` (bateria + baixo) serve para conferir se o pulso não ficou no contratempo.
    `period` (s): duração do tempo já decidida por `estimate_meter`; o rastreador só acha onde caem.
    """
    env = librosa.onset.onset_strength(y=y, sr=SR, hop_length=HOP, aggregate=np.median)
    if period:
        tempo, frames = librosa.beat.beat_track(onset_envelope=env, sr=SR, hop_length=HOP,
                                                bpm=60.0 / period, tightness=400)
    else:
        tempo, frames = librosa.beat.beat_track(onset_envelope=env, sr=SR, hop_length=HOP,
                                                start_bpm=100, tightness=100)
    times = librosa.frames_to_time(frames, sr=SR, hop_length=HOP)
    if len(times) < 8:
        bpm = float(np.atleast_1d(tempo)[0]) or 100.0
        times = np.arange(0, duration, 60.0 / bpm)
    found = float(np.median(np.diff(times)))
    if period:
        # o rastreador pode ter escapado para outro nível: volta para o tempo decidido
        while found < period * 0.75 and len(times) > 16:
            times, found = times[::2], found * 2
        while found > period * 1.5:
            mids = (times[:-1] + times[1:]) / 2
            times, found = np.sort(np.r_[times, mids]), found / 2
        period = found
    else:
        # sem compasso decidido antes, mantém o pulso entre ~65 e ~150 BPM
        period = found
        while 60 / period > 150 and len(times) > 16:
            times, period = times[::2], period * 2
        while 60 / period < 65:
            mids = (times[:-1] + times[1:]) / 2
            times, period = np.sort(np.r_[times, mids]), period / 2

    filled = [float(times[0])]
    for t in times[1:]:
        gap = t - filled[-1]
        n = int(round(gap / period))
        prev = filled[-1]
        for k in range(1, n):
            filled.append(prev + gap * k / n)
        filled.append(float(t))
    filled = np.array(filled)
    if low is not None and _offbeat(filled, low):
        filled = filled + period / 2
    filled = list(filled)
    while filled[0] > 0.05:
        filled.insert(0, filled[0] - period)
    while filled[-1] < duration:
        filled.append(filled[-1] + period)
    return np.array(filled), 60.0 / period


def _offbeat(times, low):
    """True se os graves (bumbo, surdo, baixo) caem entre os tempos: o rastreador pegou o contratempo."""
    S = librosa.feature.melspectrogram(y=low, sr=SR, hop_length=HOP, n_mels=32, fmax=250)
    env = librosa.onset.onset_strength(S=librosa.power_to_db(S), sr=SR, hop_length=HOP)
    def at(t):
        f = np.clip(librosa.time_to_frames(t, sr=SR, hop_length=HOP), 0, len(env) - 1)
        win = np.stack([env[np.clip(f + k, 0, len(env) - 1)] for k in (-1, 0, 1)])
        return float(win.max(axis=0).mean())
    on = at(times[times > 0])
    mids = (times[:-1] + times[1:]) / 2
    off = at(mids[mids > 0])
    return off > on * 1.2


# ---------------------------------------------------------------- tom

def make_key(tonic, mode):
    flats = uses_flats(tonic, mode)
    return {
        "tonic": tonic,
        "mode": mode,
        "flats": flats,
        "name": pc_name(tonic, flats),
        "display": pt_name(tonic, flats) + (" maior" if mode == "major" else " menor"),
    }


def detect_key(y):
    """Primeiro palpite do tom, pelo perfil das notas (Krumhansl). Depois os acordes confirmam."""
    chroma = librosa.feature.chroma_cqt(y=y, sr=SR, hop_length=HOP)
    prof = chroma.mean(axis=1)
    best = (-2.0, 0, "major")
    for tonic in range(12):
        for mode, kk in (("major", KK_MAJOR), ("minor", KK_MINOR)):
            r = np.corrcoef(prof, np.roll(kk, tonic))[0, 1]
            if r > best[0]:
                best = (r, tonic, mode)
    _, tonic, mode = best
    return make_key(tonic, mode)


TONIC_KINDS = {"major": ("maj", "maj7", "6", "sus2", "sus4"), "minor": ("min", "m7", "m6", "mmaj7")}
SCALE = {"major": (0, 2, 4, 5, 7, 9, 11), "minor": (0, 2, 3, 5, 7, 8, 10)}


def key_from_chords(per_beat, prior):
    """Tom pelo que os acordes fazem: os do tom contam, o da tônica conta mais, e começar ou
    terminar nele também. Resolve a confusão comum do perfil de notas entre tons vizinhos
    (ex.: Mi♭ maior lido como Fá menor)."""
    seq = [(lab[0], SIMPLE_KIND.get(lab[1], lab[1])) for lab in per_beat if lab is not None]
    if len(seq) < 16:
        return prior
    beats = {}
    for lab in seq:
        beats[lab] = beats.get(lab, 0) + 1
    ends = (seq[0], seq[-1])
    best, best_key = -1e9, (prior["tonic"], prior["mode"])
    for tonic in range(12):
        for mode in ("major", "minor"):
            diat = _diatonic(tonic, mode)
            degrees = {(tonic + d) % 12 for d in SCALE[mode]}
            sc = 0.0
            for (root, kind), n in beats.items():
                if (root, kind) in diat:
                    sc += n
                elif root in degrees:
                    sc += 0.3 * n
                if root == tonic and kind in TONIC_KINDS[mode]:
                    sc += n
            sc += sum(0.08 * len(seq) for r, k in ends if r == tonic and k in TONIC_KINDS[mode])
            if (tonic, mode) == (prior["tonic"], prior["mode"]):
                sc += 0.02 * len(seq)
            if sc > best:
                best, best_key = sc, (tonic, mode)
    return make_key(*best_key)


def _diatonic(tonic, mode):
    if mode == "major":
        degs = [(0, "maj"), (0, "maj7"), (2, "min"), (2, "m7"), (4, "min"), (4, "m7"), (5, "maj"),
                (5, "maj7"), (7, "maj"), (7, "7"), (9, "min"), (9, "m7"), (11, "m7b5")]
    else:
        degs = [(0, "min"), (0, "m7"), (2, "m7b5"), (3, "maj"), (3, "maj7"), (5, "min"), (5, "m7"),
                (7, "7"), (7, "maj"), (8, "maj"), (8, "maj7"), (10, "maj"), (10, "7")]
    return {((tonic + d) % 12, k) for d, k in degs}


def _home_roots(tonic, mode):
    """Raízes "de casa" no tom: escala maior relativa + a sensível da menor relativa."""
    major = tonic if mode == "major" else (tonic + 3) % 12
    return {(major + d) % 12 for d in (0, 2, 4, 5, 7, 9, 11)} | {(major + 8) % 12}


# ---------------------------------------------------------------- levada

def _env_at(env, times, frac, hop):
    """Força média do ataque numa fração de cada tempo (0 = no tempo, 0.5 = no meio)."""
    t = np.asarray(times)
    at = t[:-1] + frac * np.diff(t)
    f = np.clip(librosa.time_to_frames(np.maximum(at, 0), sr=SR, hop_length=hop), 1, len(env) - 2)
    return np.maximum(np.maximum(env[f - 1], env[f]), env[f + 1])


def detect_subdivision(y, times):
    """2 = levada binária (colcheias); 3 = ternária, como 12/8 (os ataques caem em terços do tempo)."""
    env = librosa.onset.onset_strength(y=y, sr=SR, hop_length=256)
    v = {fr: float(_env_at(env, times, fr, 256).mean()) for fr in (0.25, 1 / 3, 0.5, 2 / 3, 0.75)}
    ternary = (v[1 / 3] + v[2 / 3]) / 2
    binary = max(v[0.5], (v[0.25] + v[0.75]) / 2)
    return 3 if ternary > 1.5 * binary else 2


# ---------------------------------------------------------------- acordes

def _viterbi(S, penalty):
    """Melhor sequência de rótulos; trocar de rótulo no tempo b custa penalty[b]."""
    n, C = S.shape
    back = np.zeros((n, C), dtype=np.int32)
    dp = S[0].copy()
    for b in range(1, n):
        best = int(dp.argmax())
        switch = dp[best] - penalty[b]
        keep = dp >= switch
        back[b] = np.where(keep, np.arange(C), best)
        dp = np.where(keep, dp, switch) + S[b]
    path = np.zeros(n, dtype=int)
    path[-1] = int(dp.argmax())
    for b in range(n - 1, 0, -1):
        path[b - 1] = back[b, path[b]]
    return path


def detect_chords(harm, bass, times, key, mix=None, probs=None):
    """Acorde de cada tempo e qual tempo é o "1" do compasso.

    O croma da harmonia (sem os ataques percussivos) é comparado com modelos de acorde; o baixo
    reforça a raiz e acordes fora do tom precisam de mais evidência. Depois um Viterbi escolhe a
    sequência: trocar de acorde custa caro nos tempos 2 e 4 e barato no 1 e no 3.

    Devolve ({nível: lista de (raiz, tipo) ou None por tempo}, croma do baixo por tempo,
    fase do compasso).
    """
    times = np.asarray(times)
    h = librosa.effects.harmonic(harm, margin=2.0)
    fmin = librosa.note_to_hz("C2")
    tuning = librosa.estimate_tuning(y=h, sr=SR, bins_per_octave=36)
    C = np.abs(librosa.cqt(h, sr=SR, hop_length=HOP, fmin=fmin, n_bins=36 * 5,
                           bins_per_octave=36, tuning=tuning))
    # tira parte dos harmônicos naturais de cada nota (o 3º soa como quinta e o 5º como terça
    # maior), que fazem acorde menor parecer maior
    clean = C.copy()
    for shift, amount in ((57, 0.35), (84, 0.25)):  # +19 e +28 semitons, 3 bins por semitom
        clean[shift:] -= amount * C[:-shift]
    C = np.log1p(100 * np.maximum(clean, 0) / (C.max() + 1e-9))
    chroma = beat_sync(librosa.feature.chroma_cqt(C=C, sr=SR, hop_length=HOP, fmin=fmin,
                                                  bins_per_octave=36), times, trim=0.15)
    energy = beat_sync(librosa.feature.rms(y=harm, hop_length=HOP), times, trim=0.15)[:, 0]
    bass_chroma = beat_sync(
        librosa.feature.chroma_cqt(y=bass, sr=SR, hop_length=HOP, fmin=librosa.note_to_hz("E1"),
                                   n_octaves=3, bins_per_octave=36), times, trim=0.1)
    bass_energy = beat_sync(librosa.feature.rms(y=bass, hop_length=HOP), times, trim=0.1)[:, 0]
    bass_p = bass_chroma / (bass_chroma.sum(axis=1, keepdims=True) + 1e-9)
    playing = bass_energy > 0.25 * (np.median(bass_energy[bass_energy > 0]) if np.any(bass_energy > 0) else 1)

    diat = _diatonic(key["tonic"], key["mode"])
    home = _home_roots(key["tonic"], key["mode"])
    norm = chroma / (np.linalg.norm(chroma, axis=1, keepdims=True) + 1e-9)

    S = None
    if probs is not None and probs[0] == "lv":
        # modelo de vocabulário grande: já traz baixo, sétimas e extensões
        S, labels = _lv_scores(probs[1], times, diat, home)
        pass1 = 1.5
        levels = (("simples", (0.6, 2.4, 1.0, 1.8), None),
                  ("detalhado", (0.3, 0.9, 0.5, 0.7), 0.7))
    elif mix is not None:
        try:
            S, labels = _btc_scores(mix, times, diat, home, bass_p, playing,
                                    probs[1] if probs is not None else None)
            pass1 = 1.5
            levels = (("simples", (0.6, 2.4, 1.0, 1.8), None),
                      ("detalhado", (0.3, 0.9, 0.5, 0.7), 0.7))
        except Exception:  # noqa: BLE001 - sem o modelo, segue com a comparação por notas
            import traceback
            traceback.print_exc()
            S = None
    if S is None:
        S, labels = _template_scores(norm, energy, bass_p, playing, diat, home)
        pass1 = 0.3
        levels = (("simples", (0.12, 0.5, 0.22, 0.4), None),
                  ("detalhado", (0.05, 0.14, 0.08, 0.12), 0.05))
    n = len(S)

    # 1ª passada (troca com custo igual) só para achar o 1 do compasso
    path = _viterbi(S, np.full(n, pass1))
    change = np.r_[0.0, (path[1:] != path[:-1]).astype(float)]
    novelty = np.r_[0.0, 1 - np.sum(norm[1:] * norm[:-1], axis=1)]
    env = librosa.onset.onset_strength(y=bass, sr=SR, hop_length=256)
    attack = _env_at(env, times, 0.0, 256)
    attack = attack / (attack.max() + 1e-9)
    score = [change[p::4].sum() + 0.5 * novelty[p::4].sum() + 0.5 * attack[p::4].sum() for p in range(4)]
    phase = int(np.argmax(score))

    # 2ª passada, uma por nível: trocar no tempo 1 ou 3 é barato, no 2 ou 4 é caro.
    # "simples" junta as trocas rápidas; "detalhado" mantém as que o áudio sustenta com folga.
    pos = (np.arange(n) - phase) % 4
    tracks = {}
    for level, pen, keep in levels:
        path = _viterbi(S, np.array(pen)[pos])
        tracks[level] = [labels[p] for p in _drop_blips(path, S, keep)]
    # no simples, extensões (9, 11, 13) viram o acorde de sétima por baixo delas
    tracks["simples"] = [None if lab is None else (lab[0], SIMPLE_KIND.get(lab[1], lab[1])) + tuple(lab[2:])
                         for lab in tracks["simples"]]
    return tracks, bass_chroma, phase


def chord_probs(mix, progress=None):
    """Probabilidades do modelo de acordes por quadro (calculadas uma vez e reaproveitadas).
    Usa o de vocabulário grande (app/lvcr) quando está instalado; senão o BTC.
    Devolve ("lv" ou "btc", probabilidades) ou None."""
    from . import lvcr
    if lvcr.available():
        return "lv", lvcr.frame_probs(mix, progress=progress)
    from . import chord_model as CM
    return ("btc", CM.frame_probs(mix)) if CM.available() else None


def _lv_scores(probs, times, diat, home):
    """Pontuação por tempo do modelo de vocabulário grande, com leve preferência pelo tom."""
    from . import lvcr
    S = lvcr.beat_scores(probs, times)
    labels = lvcr.vocabulary()
    prior = np.zeros(len(labels))
    for i, lab in enumerate(labels):
        if lab is None:
            continue
        root, kind, _ = lab
        outside = sum(1 for iv in CHORD_TYPES[kind][0] if (root + iv) % 12 not in home)
        prior[i] = (0.25 if (root, SIMPLE_KIND.get(kind, kind)) in diat else 0.0) - 0.2 * outside
    return S + prior, labels


def _btc_scores(mix, times, diat, home, bass_p, playing, probs=None):
    """Pontuação por tempo vinda do modelo treinado (log da probabilidade), com leve preferência
    pelos acordes do tom e reforço do baixo na raiz."""
    from . import chord_model as CM
    if not CM.available():
        raise FileNotFoundError("pesos do modelo de acordes não encontrados")
    S = CM.beat_log_probs(probs if probs is not None else CM.frame_probs(mix), times)
    labels = CM.labels()
    prior = np.zeros(len(labels))
    roots = np.full(len(labels), -1)
    for i, lab in enumerate(labels):
        if lab is None:
            continue
        root, kind = lab
        outside = sum(1 for iv in CHORD_TYPES[kind][0] if (root + iv) % 12 not in home)
        prior[i] = (0.25 if lab in diat else 0.0) - 0.2 * outside
        roots[i] = root
    S = S + prior
    has_root = roots >= 0
    S[:, has_root] += playing[:, None] * 0.6 * bass_p[:, roots[has_root]]
    return S, labels


def _template_scores(norm, energy, bass_p, playing, diat, home):
    """Pontuação por tempo comparando o croma com modelos de acorde (reserva sem o modelo)."""
    labels, templates, bias, tones = [], [], [], []
    for kind in TEMPLATE_KINDS:
        ints, b = CHORD_TYPES[kind][:2]
        for root in range(12):
            v = np.zeros(12)
            for i, iv in enumerate(ints):
                v[(root + iv) % 12] = TEMPLATE_WEIGHTS[i]
            templates.append(v / np.linalg.norm(v))
            tone = np.zeros(12)
            tone[[(root + iv) % 12 for iv in ints[1:]]] = 1
            tones.append(tone)
            labels.append((root, kind))
            outside = sum(1 for iv in ints if (root + iv) % 12 not in home)  # notas fora do tom
            bias.append(b + (0.05 if (root, kind) in diat else 0.0) - 0.035 * outside)
    M, bias, T = np.array(templates), np.array(bias), np.array(tones)
    roots = np.array([r for r, _ in labels])
    S = norm @ M.T + bias
    S += playing[:, None] * (0.2 * bass_p[:, roots] + 0.05 * (bass_p @ T.T))
    # coluna extra: "sem acorde"
    med = np.median(energy[energy > 0]) if np.any(energy > 0) else 1
    S = np.c_[S, np.where(energy < 0.08 * med, 2.0, 0.4)]
    labels.append(None)
    return S, labels


def _drop_blips(path, S, keep_margin):
    """Acorde de um tempo só, diferente dos vizinhos: vira o vizinho que soa mais parecido,
    a não ser que ganhe dos dois por pelo menos `keep_margin` (None = sempre junta)."""
    path = path.copy()
    n = len(path)

    def blip(b, neighbors):
        if keep_margin is None:
            return True
        return S[b, path[b]] - max(S[b, k] for k in neighbors) < keep_margin

    if n > 1 and path[0] != path[1] and blip(0, [path[1]]):
        path[0] = path[1]
    for b in range(1, n - 1):
        if path[b] != path[b - 1] and path[b] != path[b + 1] and blip(b, [path[b - 1], path[b + 1]]):
            path[b] = path[b - 1] if S[b, path[b - 1]] >= S[b, path[b + 1]] else path[b + 1]
    if n > 1 and path[-1] != path[-2] and blip(n - 1, [path[-2]]):
        path[-1] = path[-2]
    return path


def build_grid(times, phase):
    """Grade a partir do 1º tempo do compasso 1, completada até fechar o último compasso."""
    period = float(np.median(np.diff(times)))
    pre = (4 - phase) % 4
    grid = list(times)
    for _ in range(pre):
        grid.insert(0, grid[0] - period)
    while (len(grid) - 1) % 4:
        grid.append(grid[-1] + period)
    return np.array(grid), pre


def segment_bass(bass_notes, t0, t1, beat):
    """Nota do baixo no começo do acorde: a que mais soa (tempo x força) no primeiro meio tempo.
    Só vale se cobrir boa parte dessa janela; senão None."""
    if not bass_notes:
        return None
    w0, w1 = t0 - 0.06, min(t1, t0 + 0.6 * beat)
    weight = {}
    for a, b, m, amp in bass_notes:  # em ordem de início
        if a >= w1:
            break
        if b <= w0:
            continue
        cover = min(b, w1) - max(a, w0)
        weight[m % 12] = weight.get(m % 12, 0.0) + cover * amp
    if not weight:
        return None
    pc, w = max(weight.items(), key=lambda kv: kv[1])
    if w < 0.25 * (w1 - w0) * 0.5:  # pouca nota de baixo ali (pausa ou passagem)
        return None
    return pc


def spell_with_bass(root, kind, bpc):
    """Acerta o acorde com a nota do baixo. Devolve (raiz, tipo, baixo ou None):
    - baixo na raiz: posição fundamental;
    - baixo em nota do acorde: inversão (B♭/D);
    - tríade em cima de um baixo que completa um acorde de sétima: o acorde é o do baixo
      (B♭ com baixo em Sol = Gm7; Cm com baixo em Lá♭ = A♭7M);
    - fora disso: baixo pedal (Fm/E♭, A♭/B♭)."""
    if bpc is None or bpc == root:
        return root, kind, None
    tones = {(root + iv) % 12 for iv in CHORD_TYPES[kind][0]}
    if bpc in tones:
        return root, kind, bpc
    below = (root - bpc) % 12
    if kind == "maj" and below == 3:
        return bpc, "m7", None
    if kind == "min" and below == 4:
        return bpc, "maj7", None
    if kind == "min" and below == 3:
        return bpc, "m7b5", None
    if kind == "dim" and below == 4:
        return bpc, "7", None
    return root, kind, bpc


def chord_segments(per_beat, bass_chroma, grid, offset, key, bass_notes=None):
    flats = key["flats"]
    beat = float(np.median(np.diff(grid))) if len(grid) > 1 else 0.6
    bass_notes = sorted(bass_notes or [])
    segs, start = [], 0
    for i in range(1, len(per_beat) + 1):
        if i == len(per_beat) or per_beat[i] != per_beat[start]:
            lab = per_beat[start]
            seg = {"start_beat": start + offset, "end_beat": i + offset}
            seg["start"] = float(grid[seg["start_beat"]])
            seg["end"] = float(grid[min(seg["end_beat"], len(grid) - 1)])
            if lab is None:
                seg.update(kind="N", root=None, bass=None, label="N.C.", display="—",
                           spoken="sem acorde")
            else:
                root, kind = lab[0], lab[1]
                if len(lab) == 3:  # o modelo de vocabulário grande já diz o baixo
                    bass = lab[2] if lab[2] != root else None
                elif bass_notes:  # baixo transcrito nota por nota: decide inversão, pedal e acorde sem fundamental
                    root, kind, bass = spell_with_bass(root, kind, segment_bass(bass_notes, seg["start"], seg["end"], beat))
                else:
                    ints = CHORD_TYPES[kind][0]
                    bc = bass_chroma[start:i].mean(axis=0)
                    bpc = int(bc.argmax())
                    conf = bc.max() / (bc.sum() + 1e-9)
                    bass = None
                    if bpc != root and (bpc - root) % 12 in ints[1:] and conf > 0.28:
                        bass = bpc
                name_chord(seg, root, kind, bass, (), key)
            segs.append(seg)
            start = i
    return segs


# ---------------------------------------------------------------- acordes da cifra colada

def kind_from_cifra(ch):
    """Acorde lido da cifra (app/cifra.py) -> (tipo do soundStudy, extensões, quinta alterada).
    Nada que a cifra escreve se perde: 7(♯5), 7M(♯5), 7(2), 7M(4), E5 e o 5- têm forma própria."""
    t, f, s = ch["third"], ch["fifth"], ch["seventh"]
    ext = set(ch["ext"])
    alt5 = None
    if t == 3 and f == 6:
        kind = {10: "m7b5", 9: "dim7"}.get(s, "dim")
    elif t == 4 and f == 8:
        if s == 10:
            kind = "aug7"
        elif s == 11:
            kind, alt5 = "maj7", 1
        else:
            kind = "aug"
    elif t == 3:
        kind = {10: "m7", 11: "mmaj7"}.get(s, "min")
        if f != 7:
            alt5 = f - 7
    elif t == 5:
        kind = {10: "7sus4", 11: "maj7sus4"}.get(s, "sus4")
    elif t == 2:
        kind = "7sus2" if s == 10 else "sus2"
    elif t is None:
        kind = "power"
    else:
        kind = {10: "7", 11: "maj7"}.get(s, "maj")
        if f != 7:
            alt5 = f - 7  # G7M(5-): quinta diminuta no lugar da justa
    return kind, ext, alt5


def name_from_cifra(seg, symbol, key):
    """Trecho com o acorde escrito na cifra: tipo e extensões para diagrama e partitura, e o nome
    exatamente como a cifra escreve (G7M(5-) continua G7M(5-))."""
    from . import cifra
    ch = cifra.parse_symbol(symbol)
    kind, ext, alt5 = kind_from_cifra(ch)
    name_chord(seg, ch["root"], kind, ch["bass"], ext, key, alt5=alt5)
    s = cifra._norm(symbol)
    head = s[:s.rfind("/")] if ch["bass"] is not None else s
    rname = head[:2] if len(head) > 1 and head[1] in "#b" else head[:1]
    suffix = head[len(rname):]
    bname = s[s.rfind("/") + 1:] if ch["bass"] is not None else None
    seg.update(root_name=rname, bass_name=bname, suffix=pretty_suffix(suffix),
               label=s, display=pretty(rname) + pretty_suffix(suffix) + ("/" + pretty(bname) if bname else ""))
    return seg


def beat_profiles(played, grid):
    """Força de cada nota (classe de altura) tocada em cada tempo: (tempos x 12), soma 1 por tempo."""
    g = np.asarray(grid)
    n = len(g) - 1
    P = np.zeros((n, 12))
    for s, e, m, amp in played:
        i = max(0, int(np.searchsorted(g, s, side="right")) - 1)
        while i < n and g[i] < e:
            ov = min(e, g[i + 1]) - max(s, g[i])
            if ov > 0:
                P[i, int(m) % 12] += ov * amp
            i += 1
    return P / (P.sum(axis=1, keepdims=True) + 1e-9)


def _note_match(P, pcs):
    """Correlação entre as notas tocadas em cada tempo e as notas do acorde (-1 a 1): nota do acorde
    que não soa e nota que soa fora do acorde contam contra. Tempo sem nota: 0."""
    t = np.zeros(12)
    t[list(pcs)] = 1.0
    t = t - t.mean()
    Pc = P - P.mean(axis=1, keepdims=True)
    num = Pc @ t
    den = np.linalg.norm(Pc, axis=1) * np.linalg.norm(t) + 1e-9
    return np.where(P.sum(axis=1) > 0, num / den, 0.0)


OFF_CIFRA = -2  # no caminho do encaixe: trecho que não está na cifra (fica o acorde ouvido)


def align_cifra(probs, grid, symbols, played=None, changes=None, change_cost=(0.3, 0.9, 0.5, 0.7),
                skip=6.0, jump=25.0, off_change=2.0, ext_weight=0.3, note_weight=3.0,
                auto=None, off_margin=2.5, off_enter=12.0):
    """Encaixa os acordes da cifra no tempo da gravação.

    Cada acorde da cifra (qualquer um: D6(9), G7M(5-), A7(4/9)...) é pontuado em cada tempo pelas
    partes que o modelo ouve (tríade e baixo com peso cheio; 7ª, 9ª, 11ª e 13ª com peso menor, porque
    o modelo quase não as ouve) e pelas notas que violão, teclado e cavaco tocam naquele tempo
    (separa D6(9) de D7(13): o Mi soa, o Dó não). Um Viterbi escolhe a sequência: só os acordes da
    cifra entram, na ordem dela; trocar custa menos no 1 e no 3 do compasso.
    `changes`: tempos em que o reconhecimento ouviu troca de acorde. Trocar fora deles custa
    `off_change` a mais: quando a gravação toca outro acorde no lugar do da cifra, o acorde da cifra
    ocupa o tempo que aquele acorde ocupa no áudio (e não um tempo só, espremido).
    `auto`: os acordes que o reconhecimento ouviu (trechos com start_beat/end_beat/label). Com eles, o
    encaixe pode dizer "este trecho não está na cifra" (OFF_CIFRA): a introdução antes da cifra colada, uma
    parte que a cifra não traz, o fim depois dela. Ali vale o acorde ouvido, com uma desvantagem por tempo
    (`off_margin`, para a cifra simplificada — D no lugar de D7M(9) — continuar valendo) e um custo para
    sair da cifra no meio (`off_enter`). Sem isso, a cifra era esticada à força: na Um vencedor a cifra
    começa no verso e o F#m dela cobria os 8 compassos da introdução.
    Devolve o índice (em `distinct`) de cada tempo, -1 para "sem acorde" ou OFF_CIFRA, e a lista `distinct`."""
    from . import cifra
    from . import lvcr
    distinct, seen = [], {}
    for s in symbols:
        k = cifra._norm(s)
        if k not in seen:
            seen[k] = len(distinct)
            distinct.append(s)
    nd = len(distinct)
    # os acordes ouvidos entram como colunas a mais, só para pontuar o "fora da cifra"
    auto_syms, auto_idx = [], {}
    for a in auto or []:
        if a.get("kind") != "N" and a.get("label"):
            k = cifra._norm(a["label"])
            if k not in auto_idx:
                try:
                    cifra.parse_symbol(a["label"])
                except Exception:  # noqa: BLE001 — nome que a cifra não lê: o trecho fica sem nota
                    continue
                auto_idx[k] = nd + len(auto_syms)
                auto_syms.append(a["label"])
    tri, bass, p7, p9, p11, p13 = [np.log(np.maximum(p, 1e-6)) for p in probs]
    cols, parsed = [], []
    for s in distinct + auto_syms:
        ch = cifra.parse_symbol(s)
        parsed.append(ch)
        t, b, s7, s9, s11, s13 = cifra.lvcr_parts(ch)
        cols.append(tri[:, t] + bass[:, b] + ext_weight * (p7[:, s7] + p9[:, s9] + p11[:, s11] + p13[:, s13]))
    cols.append(tri[:, 0] + bass[:, 0])  # sem acorde
    L = np.stack(cols, axis=1)
    g = np.asarray(grid)
    n, K = len(g) - 1, L.shape[1]
    S = np.full((n, K), -20.0)
    S[:, -1] = 0.0
    for i in range(n):
        span = g[i + 1] - g[i]
        fa = int(max(0, np.floor((g[i] + 0.1 * span) / lvcr.FRAME_SEC)))
        fb = int(max(fa + 1, np.ceil((g[i + 1] - 0.1 * span) / lvcr.FRAME_SEC)))
        if g[i + 1] > 0 and fa < len(L):
            S[i] = L[fa:min(fb, len(L))].mean(axis=0)
    if played:
        P = beat_profiles(played, g)
        for k, ch in enumerate(parsed):
            S[:, k] += note_weight * _note_match(P, cifra.pitch_classes(ch))
    # Anda pela cifra posição por posição (a cifra escrita do começo ao fim, com as repetições
    # abertas): ficar no acorde é de graça; ir para o próximo custa só a troca; pular um acorde da
    # cifra custa `skip`; voltar ou saltar para outra parte (a gravação repete o refrão mais vezes,
    # ou corta uma parte) custa `jump`. Assim o A7(4/9) da cifra fica no lugar dele mesmo quando o
    # áudio puxa para outro acorde.
    seq = [seen[cifra._norm(s)] for s in cifra.compact(symbols)]
    M = len(seq)
    # "sem acorde" antes da música começar e depois que ela acaba; e o trecho fora da cifra
    START, END, OFF = M, M + 1, M + 2
    SP = S[:, seq]
    SN = S[:, -1]
    NEG = -1e9
    SO = np.full(n, NEG)  # fora da cifra: o acorde ouvido naquele tempo, com a desvantagem
    for a in auto or []:
        if a.get("kind") == "N" or not a.get("label"):
            col = K - 1
        else:
            col = auto_idx.get(cifra._norm(a["label"]))
            if col is None:
                continue
        lo, hi = max(0, int(a["start_beat"])), min(n, int(a["end_beat"]))
        if hi > lo:
            SO[lo:hi] = S[lo:hi, col] - off_margin
    use_off = auto is not None
    dp = np.full(M + 3, NEG)
    dp[:M] = SP[0] - jump
    dp[0] = SP[0, 0]
    dp[START] = SN[0]
    if use_off:
        dp[OFF] = SO[0]
    back = np.zeros((n, M + 3), dtype=np.int32)
    ar = np.arange(M)
    changes = set(changes) if changes is not None else None
    for b in range(1, n):
        pen = change_cost[b % 4] + (0.0 if changes is None or b in changes else off_change)
        pos = dp[:M]
        best_any = int(pos.argmax())
        from_start = np.full(M, dp[START] - pen - jump)
        from_start[0] = dp[START] - pen
        # depois de um trecho fora da cifra, ela recomeça do começo (a introdução acabou) ou de onde for
        from_off = np.full(M, dp[OFF] - pen - off_enter)
        from_off[0] = dp[OFF] - pen
        cands = [
            (pos, ar),                                                        # fica no acorde
            (np.r_[NEG, pos[:-1] - pen], ar - 1),                             # próximo da cifra
            (np.r_[NEG, NEG, pos[:-2] - pen - skip][:M], ar - 2),             # pula um acorde
            (np.full(M, pos[best_any] - pen - jump), np.full(M, best_any)),   # salta de parte
            (from_start, np.full(M, START)),                                  # a música começa
            (from_off, np.full(M, OFF)),                                      # volta para a cifra
        ]
        vals = np.stack([c[0] for c in cands])
        choice = vals.argmax(axis=0)
        new = np.full(M + 3, NEG)
        new[:M] = vals.max(axis=0) + SP[b]
        back[b, :M] = np.choose(choice, [c[1] for c in cands])
        new[START] = dp[START] + SN[b]
        back[b, START] = START
        end_opts = [(dp[END], END), (dp[M - 1] - pen, M - 1), (pos[best_any] - pen - jump, best_any),
                    (dp[OFF] - pen, OFF)]
        v, src = max(end_opts)
        new[END] = v + SN[b]
        back[b, END] = src
        if use_off:
            off_opts = [(dp[OFF], OFF), (dp[START] - pen, START), (pos[best_any] - pen - off_enter, best_any)]
            v, src = max(off_opts)
            new[OFF] = v + SO[b]
            back[b, OFF] = src
        dp = new
    path = np.zeros(n, dtype=int)
    path[-1] = int(dp.argmax())
    for b in range(n - 1, 0, -1):
        path[b - 1] = back[b, path[b]]
    return [seq[p] if p < M else OFF_CIFRA if p == OFF else -1 for p in path], distinct


def cifra_segments(path, distinct, grid, key, auto=None):
    """Trechos de acorde (como chord_segments) a partir do encaixe da cifra. Trecho fora da cifra
    (OFF_CIFRA): os acordes ouvidos (`auto`) recortados nele."""
    segs, start = [], 0
    for i in range(1, len(path) + 1):
        if i == len(path) or path[i] != path[start]:
            if path[start] == OFF_CIFRA:
                for a in auto or []:
                    lo, hi = max(start, a["start_beat"]), min(i, a["end_beat"])
                    if hi > lo:
                        seg = dict(a, start_beat=lo, end_beat=hi, start=float(grid[lo]),
                                   end=float(grid[min(hi, len(grid) - 1)]))
                        segs.append(seg)
                start = i
                continue
            seg = {"start_beat": start, "end_beat": i, "start": float(grid[start]),
                   "end": float(grid[min(i, len(grid) - 1)])}
            if path[start] < 0:
                seg.update(kind="N", root=None, bass=None, ext=[], label="N.C.", display="—", spoken="sem acorde")
            else:
                name_from_cifra(seg, distinct[path[start]], key)
            segs.append(seg)
            start = i
    return segs


# ---------------------------------------------------------------- extensões pelas notas tocadas

# Quanto uma extensão precisa soar, em relação à média das notas da tríade, para entrar no nome.
# Depende do tipo: 6 e 9 num acorde maior são comuns (D6(9)); 13 num 7M é raro e pede muita evidência.
EXT_MIN = {
    "maj": {2: 0.40, 9: 0.40, 6: 0.50},
    "6": {2: 0.40, 6: 0.50},
    "maj7": {2: 0.50, 6: 0.40, 9: 0.80},
    "7": {2: 0.40, 9: 0.40, 1: 0.50, 3: 0.60, 8: 0.50, 6: 0.60},
    "min": {2: 0.50, 5: 0.40, 9: 0.40},
    "m6": {2: 0.50},
    "m7": {2: 0.50, 5: 0.40},
    "sus4": {2: 0.40},
    "7sus4": {2: 0.40, 9: 0.50},
}


def played_profile(played, a, b, root):
    """Força de cada nota (intervalo sobre a raiz) tocada entre a e b segundos."""
    w = np.zeros(12)
    for s, e, m, amp in played:
        ov = min(e, b) - max(s, a)
        if ov > 0:
            w[(int(m) - root) % 12] += ov * amp
    return w


EXT_FAMILIES = ((1, 2, 3), (8, 9))  # uma nona só (♭9, 9 ou ♯9) e uma décima terceira só (♭13 ou 13)


def refine_with_notes(segs, played, key, scale=1.0, add_seventh=True, reroot=True):
    """Sétima e extensões (6, 9, 11, 13) pelo que violão, teclado e cavaco tocam de fato.

    O modelo de acordes acerta raiz, tríade e baixo, mas quase nunca ouve as extensões. As notas
    transcritas (Basic Pitch) mostram, por exemplo, a 9ª e a 6ª soando em cima do Ré (D6(9)).
    A evidência é somada em todos os trechos do mesmo acorde na música (como numa cifra, o mesmo
    acorde tem o mesmo nome do começo ao fim), o que tira o ruído de um trecho só."""
    if not played:
        return segs
    groups = {}
    for seg in segs:
        if seg["kind"] == "N":
            continue
        groups.setdefault((seg["root"], seg["kind"], seg["bass"], tuple(seg.get("ext") or ())), []).append(seg)
    for (root, kind, bass, ext0), group in groups.items():
        w = sum(played_profile(played, s["start"], s["end"], root) for s in group)
        tri = [iv % 12 for iv in CHORD_TYPES[kind][0][:3]]
        ref = w[tri].mean()
        if ref <= 0:
            continue
        r = w / ref
        ext = set(ext0)
        # Baixo fora do acorde (A/G) e as notas de cima formam um acorde em cima do baixo: o acorde é
        # o do baixo, e o resto vira extensão (A/G com Si e Ré soando = Sol com 9ª e 11ª aumentada).
        if reroot and bass is not None and (bass - root) % 12 not in [iv % 12 for iv in CHORD_TYPES[kind][0]]:
            rb = np.roll(r, -((bass - root) % 12))  # mesmo perfil, agora sobre o baixo
            third = 4 if rb[4] >= rb[3] else 3
            if rb[third] >= 0.5 and rb[7] >= 0.5:
                root, kind, bass, ext = bass, ("maj" if third == 4 else "min"), None, set()
                w = np.roll(w, -((root - group[0]["root"]) % 12))
                ref = w[[0, third, 7]].mean()
                r = w / ref
        # sétima que a tríade não tinha (ou diminuto em vez de meio diminuto)
        if not add_seventh:
            pass
        elif kind == "maj" and r[11] >= 0.45 * scale and r[11] > r[10]:
            kind = "maj7"
        elif kind == "maj" and r[10] >= 0.60 * scale and r[10] > r[11]:
            kind = "7"
        elif kind == "min" and r[10] >= 0.50 * scale and r[10] > r[11] and r[10] > r[9]:
            kind = "m7"
        elif kind == "m7b5" and r[9] >= 0.80 * scale and r[9] > 1.5 * r[10]:
            kind = "dim7"
        for iv, need in EXT_MIN.get(kind, {}).items():
            if r[iv] >= need * scale:
                ext.add(iv)
        for fam in EXT_FAMILIES:  # ♭13 e 13 juntos não existem: fica a que mais soa
            mine = [iv for iv in fam if iv in ext]
            if len(mine) > 1:
                keep = max(mine, key=lambda iv: r[iv])
                ext -= set(mine) - {keep}
        for seg in group:
            name_chord(seg, root, kind, bass, ext, key)
    return segs


# ---------------------------------------------------------------- melodia

def pitch_track(voc, progress=None, chunk_s=20.0, extra=False):
    """f0 da voz (pYIN), em notas MIDI fracionárias + máscara de voz ativa.

    Confiança mínima do pYIN de 0,10 (era 0,25): com 0,25 um terço dos ataques da voz ficava sem nota
    e as frases entravam atrasadas, em quadros que o pYIN já marcava como voz, com altura e volume.
    Sem o corte (só "tem voz"), 12-26% das notas novas saíam um semitom erradas (escorregadas).
    `extra`: devolve também a altura de todos os quadros (mesma correção de afinação) e a máscara
    "fraca" (voz, altura e volume baixo), usadas para recuar o começo das frases."""
    sr = 16000
    hop = 160
    y = librosa.resample(voc, orig_sr=SR, target_sr=sr)
    step = int(chunk_s * sr) // hop * hop
    f0s, flags, probs = [], [], []
    starts = list(range(0, len(y), step))
    for k, a in enumerate(starts):
        seg = y[a:a + step]
        if len(seg) < 2048:
            seg = np.pad(seg, (0, 2048 - len(seg)))
        f0, vf, vp = librosa.pyin(seg, fmin=70, fmax=1000, sr=sr, frame_length=1024,
                                  hop_length=hop, center=True)
        keep = min(len(f0), step // hop)
        f0s.append(f0[:keep]); flags.append(vf[:keep]); probs.append(vp[:keep])
        if progress:
            progress((k + 1) / len(starts))
    f0 = np.concatenate(f0s)
    vflag = np.concatenate(flags)
    vprob = np.concatenate(probs)
    rms = librosa.feature.rms(y=y, frame_length=1024, hop_length=hop, center=True)[0][:len(f0)]
    rms = np.pad(rms, (0, len(f0) - len(rms)))
    p95 = np.percentile(rms, 95)
    loud = rms > 0.1 * p95
    voiced = vflag & (vprob > 0.10) & loud & np.isfinite(f0)

    midi = np.full(len(f0), np.nan)
    midi[voiced] = librosa.hz_to_midi(f0[voiced])
    offset = 0.0
    if voiced.sum() > 50:
        frac = midi[voiced] - np.round(midi[voiced])
        offset = np.angle(np.mean(np.exp(2j * np.pi * frac))) / (2 * np.pi)
        midi -= offset
    times = np.arange(len(f0)) * hop / sr
    if not extra:
        return times, midi, voiced
    fin = np.isfinite(f0)
    midi_all = np.full(len(f0), np.nan)
    midi_all[fin] = librosa.hz_to_midi(f0[fin]) - offset
    weak = vflag & fin & (rms > 0.05 * p95)
    return times, midi, voiced, midi_all, weak


def extend_phrase_starts(events, times, midi_all, weak, quiet=0.25, back=0.15, tol=1.0):
    """Começo de frase: a primeira nota (sem outra nos `quiet` s antes) recua até `back` s enquanto o
    quadro já tem voz fraca na mesma altura (até `tol` semitom). O pYIN fica inseguro nos primeiros
    quadros de uma frase, e a nota entrava depois da voz. Só no começo de frase: em todas as notas
    isso dobrava as notas adiantadas."""
    if not events or len(times) < 2:
        return events
    dt = times[1] - times[0]
    out, prev_end = [], -1e9
    for a, b, p in events:
        if a - prev_end >= quiet:
            k = int(round(a / dt))
            lim = max(prev_end + quiet / 2, a - back)
            while k - 1 >= 0 and times[k - 1] >= lim and weak[k - 1] and abs(midi_all[k - 1] - p) <= tol:
                k -= 1
            a = min(a, float(times[k]))
        out.append((a, b, p))
        prev_end = b
    return out


def note_events(times, midi, voiced, max_gap=0.03, min_hold=0.05, min_len=0.06):
    """Notas contínuas da voz: (início s, fim s, nota MIDI).

    Um trecho vozeado vira uma nota; ele só é dividido quando a altura muda e se mantém
    por pelo menos `min_hold` segundos (evita picotar vibrato e escorregadas).
    """
    if len(times) < 2:
        return []
    dt = times[1] - times[0]
    v = voiced.copy()
    gap = max(1, int(round(max_gap / dt)))
    i = 0
    while i < len(v):  # fecha buraquinhos de poucos quadros dentro da mesma nota
        if not v[i]:
            j = i
            while j < len(v) and not v[j]:
                j += 1
            if 0 < i and j < len(v) and j - i <= gap:
                v[i:j] = True
            i = j
        else:
            i += 1
    filled = midi.copy()
    nan = ~np.isfinite(filled)
    if (v & ~nan).any():
        filled[nan] = np.interp(np.flatnonzero(nan), np.flatnonzero(~nan), filled[~nan])
    hold = max(1, int(round(min_hold / dt)))

    events = []
    i = 0
    while i < len(v):
        if not v[i]:
            i += 1
            continue
        j = i
        while j < len(v) and v[j]:
            j += 1
        r = np.round(filled[i:j]).astype(int)
        start, cur = 0, int(np.median(r[:hold]))
        k = 0
        while k < len(r):
            if abs(r[k] - cur) >= 1 and np.all(r[k:k + hold] == r[k]) and k + hold <= len(r):
                events.append((times[i + start], times[i + k], cur))
                start, cur = k, int(r[k])
            k += 1
        events.append((times[i + start], times[min(j, len(times) - 1)], cur))
        i = j
    out = []
    for a, b, p in events:
        if b - a < min_len:
            continue
        seg = (times >= a) & (times < b) & voiced & np.isfinite(midi)
        pitch = int(round(float(np.median(midi[seg])))) if seg.any() else p
        out.append((float(a), float(b), pitch))
    return out


def quantize_melody(events, grid, subdiv, with_times=False):
    """Encaixa as notas na grade (subdiv = 2 colcheias, 4 semicolcheias por tempo).

    Devolve lista de notas (slot inicial, duração em slots, nota MIDI). Com `with_times`, devolve
    também o instante real (s) em que cada nota começa na gravação: a partitura arredonda para a
    grade, mas o cursor e a letra seguem o canto de verdade.
    """
    g = np.asarray(grid)
    beats = np.arange(len(g))

    def slot(t):
        return int(round(float(np.interp(t, g, beats)) * subdiv))

    notes = []
    for a, b, p in events:
        s, e = slot(a), slot(b)
        if e <= s:
            e = s + 1
        if notes and s < notes[-1][0] + notes[-1][1]:
            prev = notes[-1]
            if s <= prev[0]:
                # duas notas no mesmo slot: a altura é a da mais longa, mas o instante continua o do
                # PRIMEIRO ataque (o cursor e a sílaba disparam quando a voz entra na casa; antes
                # ficava o da segunda e o cursor pulava até 0,3 s atrasado no nível simples)
                if (b - a) > prev[3]:
                    prev[2] = p
                prev[3] = max(prev[3], b - a)
                prev[1] = max(prev[1], e - prev[0])
                continue
            prev[1] = s - prev[0]
        if notes:  # o fim da nota some um pouco antes da próxima: liga se o buraco for de 1 slot
            prev = notes[-1]
            if 0 < s - (prev[0] + prev[1]) <= 1:
                prev[1] = s - prev[0]
        notes.append([s, e - s, p, b - a, a])
    starts = {n[0]: n[4] for n in notes}
    notes = [n[:3] for n in notes]

    # corrige saltos de oitava isolados
    for i in range(1, len(notes) - 1):
        a, n, b = notes[i - 1], notes[i], notes[i + 1]
        if abs(a[2] - b[2]) <= 2:
            for shift in (12, -12):
                if abs(n[2] + shift - a[2]) <= 3 and abs(n[2] - a[2]) >= 9:
                    n[2] += shift
                    break

    # remove notas de 1 slot que saltam muito em relação às vizinhas grudadas
    clean = []
    for i, n in enumerate(notes):
        prev = clean[-1] if clean else None
        nxt = notes[i + 1] if i + 1 < len(notes) else None
        glued_prev = prev is not None and prev[0] + prev[1] == n[0]
        glued_next = nxt is not None and n[0] + n[1] == nxt[0]
        if (n[1] == 1 and glued_prev and glued_next and abs(n[2] - prev[2]) >= 3
                and abs(n[2] - nxt[2]) >= 3):
            prev[1] += 1
            continue
        clean.append(n)
    out = [tuple(n) for n in clean]
    if with_times:
        return out, [round(float(starts[n[0]]), 4) for n in out]
    return out
