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
                _, _, _, suffix, spoken = CHORD_TYPES[kind]
                label = pc_name(root, flats) + suffix
                display = pretty(pc_name(root, flats)) + suffix.replace("b5", "♭5").replace("#5", "♯5")
                text = pt_name(root, flats) + " " + spoken
                if bass is not None:
                    label += "/" + pc_name(bass, flats)
                    display += "/" + pretty(pc_name(bass, flats))
                    text += ", baixo em " + pt_name(bass, flats)
                seg.update(kind=kind, root=root, bass=bass, label=label, display=display,
                           spoken=text)
            segs.append(seg)
            start = i
    return segs


# ---------------------------------------------------------------- melodia

def pitch_track(voc, progress=None, chunk_s=20.0):
    """f0 da voz (pYIN), em notas MIDI fracionárias + máscara de voz ativa."""
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
    loud = rms > 0.1 * np.percentile(rms, 95)
    voiced = vflag & (vprob > 0.25) & loud & np.isfinite(f0)

    midi = np.full(len(f0), np.nan)
    midi[voiced] = librosa.hz_to_midi(f0[voiced])
    if voiced.sum() > 50:
        frac = midi[voiced] - np.round(midi[voiced])
        offset = np.angle(np.mean(np.exp(2j * np.pi * frac))) / (2 * np.pi)
        midi -= offset
    times = np.arange(len(f0)) * hop / sr
    return times, midi, voiced


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
            if s <= prev[0]:  # duas notas no mesmo slot: fica a mais longa
                if (b - a) > prev[3]:
                    notes[-1] = [s, e - s, p, b - a, a]
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
