"""Fila de processamento: áudio -> stems -> pulso -> tom/acordes -> melodia -> partitura."""
import json
import os
import queue
import subprocess
import threading
import time
import traceback
from pathlib import Path

import numpy as np
import soundfile as sf

ROOT = Path(__file__).resolve().parent.parent
SONGS = ROOT / "data" / "songs"
# separação em 6 partes: o violão sai sozinho (o cavaco e os agudos ficam em "other"); ver separation.py
STEMS = ["vocals", "guitar", "piano", "other", "bass", "drums"]

STAGES = [
    ("convert", "Preparando o áudio", 0.03),
    ("separate", "Separando voz, violão, teclado, baixo e percussão", 0.50),
    ("rhythm", "Ouvindo os acordes e achando o compasso", 0.06),
    ("harmony", "Reconhecendo o tom e os acordes", 0.03),
    ("melody", "Transcrevendo a melodia da voz", 0.12),
    ("violao", "Transcrevendo violão, baixo, cavaco e teclado nota por nota", 0.05),
    ("lyrics", "Buscando e encaixando a letra", 0.16),
    ("score", "Escrevendo a partitura", 0.05),
]
WEIGHT = {k: w for k, _, w in STAGES}
BEFORE = {k: sum(w for _, _, w in STAGES[:i]) for i, (k, _, _) in enumerate(STAGES)}

_lock = threading.Lock()
_queue: "queue.Queue[str]" = queue.Queue()


# ---------------------------------------------------------------- metadados

def meta_path(sid):
    return SONGS / sid / "meta.json"


def read_meta(sid):
    return json.loads(meta_path(sid).read_text(encoding="utf-8"))


def write_meta(sid, **changes):
    with _lock:
        path = meta_path(sid)
        meta = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
        meta.update(changes)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
        _replace(tmp, path)
        return meta


def _replace(src, dst, tries=40):
    """No Windows, trocar um arquivo que outro está lendo dá "Acesso negado" (a tela de progresso
    lê o meta.json a toda hora; o antivírus também abre arquivos novos). A leitura é rápida:
    tenta de novo por até ~2 s."""
    for i in range(tries):
        try:
            os.replace(src, dst)
            return
        except PermissionError:
            if i == tries - 1:
                raise
            time.sleep(0.05)


class Reporter:
    def __init__(self, sid):
        self.sid = sid
        self.key = None
        self.last = 0.0

    def stage(self, key):
        self.key = key
        write_meta(self.sid, status="processing", stage=key, progress=round(BEFORE[key], 4))

    def __call__(self, frac):
        now = time.time()
        if now - self.last < 0.7 and frac < 1:
            return
        self.last = now
        p = BEFORE[self.key] + WEIGHT[self.key] * min(max(frac, 0.0), 1.0)
        write_meta(self.sid, progress=round(p, 4))


# ---------------------------------------------------------------- ffmpeg

def _ffmpeg(*args):
    import imageio_ffmpeg
    flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
    subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), "-hide_banner", "-loglevel", "error", "-y",
                    *map(str, args)], check=True, capture_output=True, creationflags=flags)


# ---------------------------------------------------------------- etapas

def separate(wav, stems_dir, work, rep, engine):
    """Separa nas 6 partes (motor "rapida" ou "maxima", ver separation.py) e grava cada uma:
    AAC estéreo para ouvir e WAV mono 22 kHz para a análise. Devolve o motor que de fato separou: se a
    máxima falhar (memória da placa de vídeo, modelo que não baixou...), a música não dá erro, cai na rápida."""
    import librosa

    from . import hardware as H
    from . import separation as SEP
    from .analysis import SR

    try:
        parts, sr = SEP.run(engine, wav, H.device(), progress=rep)
    except Exception:  # noqa: BLE001
        if engine != "maxima":
            raise
        traceback.print_exc()
        try:
            import torch
            if torch.cuda.is_available():
                torch.cuda.empty_cache()  # libera a placa antes de tentar de novo
        except Exception:  # noqa: BLE001
            pass
        engine = "rapida"
        parts, sr = SEP.run(engine, wav, H.device(), progress=rep)
    for name, src in parts.items():
        tmp = work / f"{name}_44k.wav"
        sf.write(str(tmp), src.T, sr, subtype="PCM_16")
        _ffmpeg("-i", tmp, "-c:a", "aac", "-b:a", "160k", stems_dir / f"{name}.m4a")
        tmp.unlink()
        mono = librosa.resample(src.mean(axis=0), orig_sr=sr, target_sr=SR)
        sf.write(str(work / f"{name}.wav"), mono, SR, subtype="PCM_16")
    return engine


def analyze(sid, d, work, rep, title, duration, lyrics_model=None):
    from . import analysis as A
    from . import lyrics as L
    from . import lyrics_api as LA
    from . import notation as N
    from . import violao as V

    stems = [n for n in STEMS if (work / f"{n}.wav").exists()]
    y = {n: sf.read(str(work / f"{n}.wav"), dtype="float32")[0] for n in stems}
    harm = sum(y[n] for n in ("guitar", "piano", "other") if n in y)  # tudo o que faz harmonia

    rep.stage("rhythm")
    mix = sum(y.values())  # o modelo de acordes ouve a mistura
    probs = A.chord_probs(mix, progress=lambda f: rep(0.8 * f))
    # compasso como um músico contaria: pulsação, onde os acordes trocam e andamento confortável
    period, sub = A.estimate_meter(y["drums"] + 0.5 * y["bass"] + 0.3 * harm, A.chord_change_times(probs))
    times, bpm = A.track_beats(y["drums"] + 0.5 * y["bass"], duration,
                               low=y["drums"] + y["bass"], period=period)
    beat_ql = 1.5 if sub == 3 else 1.0  # sub: 2 = 4/4, 3 = 12/8
    rep(1)

    rep.stage("harmony")
    key = A.detect_key(harm + y["bass"] + 0.5 * y["vocals"])
    rep(0.2)
    tracks, bass_chroma, phase = A.detect_chords(harm + 0.6 * y["bass"], y["bass"],
                                                 times, key, mix=mix, probs=probs)
    # o tom de verdade é o que os acordes confirmam (o perfil de notas confunde tons vizinhos)
    by_chords = A.key_from_chords(tracks["detalhado"], key)
    if (by_chords["tonic"], by_chords["mode"]) != (key["tonic"], key["mode"]):
        key = by_chords
        tracks, bass_chroma, phase = A.detect_chords(harm + 0.6 * y["bass"], y["bass"],
                                                     times, key, mix=mix, probs=probs)
    write_meta(sid, key=key["display"],
               key_short=A.pretty(key["name"]) + ("m" if key["mode"] == "minor" else ""),
               bpm=round(bpm))
    grid, offset = A.build_grid(times, phase)
    chords = {lv: A.chord_segments(t, bass_chroma, grid, offset, key) for lv, t in tracks.items()}
    rep(0.4)
    # notas que cada instrumento de harmonia toca (Basic Pitch): decidem 6, 9, 11, 13 e a sétima
    # no nível detalhado, e servem depois à tablatura do violão
    # Cada parte é transcrita uma vez, com a faixa (Hz) mais larga que algum instrumento dela precisa
    # (teclado vai de Lá1 a Dó7); para decidir as extensões vale só a região do meio (Ré2 a Mi6).
    played_by = {}
    for i, n in enumerate(("guitar", "piano", "other")):
        if n in y:
            ranges = [inst["hz"] for inst in V.INSTRUMENTS.values() if inst["stem"] == n] + [(75, 1400)]
            played_by[n] = V.transcribe(y[n], hz=(min(r[0] for r in ranges), max(r[1] for r in ranges)))
        rep(0.4 + 0.2 * (i + 1))
    mid = lambda evs, k=1.0: [(s, e, m, k * a) for s, e, m, a in evs if 38 <= m <= 88]  # noqa: E731
    played = mid(played_by.get("guitar", [])) + mid(played_by.get("piano", [])) + \
        mid(played_by.get("other", []), 0.5)  # "outros": cavaco e vazamentos, com peso menor
    A.refine_with_notes(chords["detalhado"], played, key)
    # guardados para encaixar uma cifra colada depois, sem refazer a análise
    _save_played(work, played)
    if probs is not None and probs[0] == "lv":
        _save_probs(work, probs[1])
    chords_auto = None
    cifra_file = work / "cifra_user.json"
    if cifra_file.exists():  # a pessoa colou a cifra: os acordes são os dela, no tempo da gravação
        chords_auto = chords
        symbols = json.loads(cifra_file.read_text(encoding="utf-8"))["acordes"]
        simples, det = cifra_chords(work, y, grid, key, chords["detalhado"], symbols)
        chords = {"simples": simples, "detalhado": det}
    from . import referencia as R
    ref_an = {"grid": grid, "chords": chords["simples"], "chords_detalhado": chords["detalhado"]}
    ref_used = R.apply_saved(ref_an, work)  # gravação da pessoa tocando: vale por cima, no trecho dela
    if ref_used:
        chords_auto = chords_auto or chords
        chords = {"simples": ref_an["chords"], "detalhado": ref_an["chords_detalhado"]}
    rep(1)

    rep.stage("melody")
    rms = {n: float(np.sqrt(np.mean(y[n] ** 2))) for n in stems}
    has_vocals = rms["vocals"] > 0.08 * max(rms.values())
    if has_vocals:
        ptimes, midi, voiced, midi_all, weak = A.pitch_track(y["vocals"], progress=rep, extra=True)
        events = A.extend_phrase_starts(A.note_events(ptimes, midi, voiced), ptimes, midi_all, weak)
    else:
        events = []
    levels = {"simples": sub, "detalhado": 2 * sub}
    notes, note_t = {}, {}  # notas na grade e o instante real em que cada uma começa no canto
    for lv, s in levels.items():
        notes[lv], note_t[lv] = A.quantize_melody(events, grid, s, with_times=True)

    rep.stage("violao")  # cada instrumento nota por nota (violão, cavaco e baixo com corda e casa)
    tabs = {}
    insts = list(V.INSTRUMENTS.items())
    for i, (name, inst) in enumerate(insts):
        stem = inst["stem"]
        if stem not in y:
            continue
        if stem == "bass":  # o baixo precisa da faixa grave (até ~35 Hz) que as outras partes não usam
            inst_notes = V.transcribe(y["bass"], hz=inst["hz"])
        else:
            inst_notes = played_by.get(stem) or V.transcribe(y[stem], hz=inst["hz"])
        t = V.assign_tab(V.attacks(inst_notes, grid, 2 * sub, inst=inst), inst)
        if len(t) >= 8:  # quase nada tocado: o instrumento não está na música (ou a separação não o achou)
            tabs[name] = t
        rep((i + 1) / len(insts))
    tab = tabs.get("violao", [])

    rep.stage("lyrics")
    # ordem: letra colada pela pessoa > letra da base (LRCLIB) > reconhecimento da voz no computador
    lines, source, credit = [], "auto", None
    cache = work / "lyrics.json"           # reconhecimento automático (só depende da voz: fica guardado)
    user = work / "lyrics_user.json"
    api_file = work / "lyrics_api.json"
    onsets = [a for a, _, _ in events]     # início das notas cantadas, em segundos
    if user.exists():
        lines, source = json.loads(user.read_text(encoding="utf-8")), "user"
    elif has_vocals:
        found = json.loads(api_file.read_text(encoding="utf-8")) if api_file.exists() else None
        if found is None:
            try:
                found = LA.best(title, duration)
            except Exception:  # noqa: BLE001 - sem internet: segue com o reconhecimento
                found = None
            if found:
                api_file.write_text(json.dumps(found, ensure_ascii=False), encoding="utf-8")
        auto = []
        fresh = cache.exists() and cache.stat().st_mtime >= (work / "vocals.wav").stat().st_mtime
        if fresh and not lyrics_model:
            auto = json.loads(cache.read_text(encoding="utf-8"))
        else:
            # ouve a voz sempre, também com a letra da base: o tempo de cada palavra dentro da linha vem
            # daqui (sem isso, só 5-17% das palavras caíam na nota certa nas músicas com LRC)
            try:
                auto = L.transcribe(y["vocals"], A.SR, progress=rep, model=lyrics_model)
                cache.write_text(json.dumps(auto, ensure_ascii=False), encoding="utf-8")
            except Exception:  # noqa: BLE001 - sem letra a partitura continua útil
                traceback.print_exc()
        auto = L.snap_words(auto, events)  # início da palavra na nota, não no silêncio antes dela
        if found:
            lines, source, credit = api_lines(found, auto, events, duration), "lrclib", LA.summary(found)
        else:
            lines = auto
    rep(1)

    rep.stage("score")
    n_beats = len(grid) - 1
    shift = N.display_shift(notes["detalhado"])
    for i, (lv, s) in enumerate(levels.items()):
        slot_time = _slot_time(grid, s, notes[lv], note_t[lv])
        words = L.syllables_on_notes(lines, notes[lv], slot_time)
        N.write_score(d / f"score_{lv}.musicxml", title, key, bpm, n_beats, chords[lv],
                      notes[lv], s, shift, beat_ql, words)
        rep((i + 1) / 3)
    N.write_midi(d / "transcricao.mid", key, bpm, n_beats, chords["detalhado"],
                 notes["detalhado"], levels["detalhado"], beat_ql)
    for name, t in tabs.items():
        V.write_musicxml(d / f"score_{name}.musicxml", title, key, bpm, n_beats, chords["detalhado"],
                         t, 2 * sub, beat_ql, inst=V.INSTRUMENTS[name])

    result = {
        "title": title,
        "duration": duration,
        "bpm": round(bpm, 1),
        "key": key,
        "time_signature": [4, 4] if sub == 2 else [12, 8],
        "beat_ql": beat_ql,
        "subdivision": sub,
        "grid": [round(float(t), 4) for t in grid],
        "measures": n_beats // 4,
        "chords": chords["simples"],
        "chords_detalhado": chords["detalhado"],
        # de onde vêm os acordes: "auto" (ouvidos pelo app) ou "cifra" (colada pela pessoa)
        "chords_source": "referencia" if ref_used else "cifra" if chords_auto else "auto",
        "octave_shift": shift,
        "has_vocals": has_vocals,
        "lyrics": lines,
        "lyrics_source": source,
        "lyrics_credit": credit,
        "melody_notes": {lv: len(v) for lv, v in notes.items()},
        # notas da melodia em tempos (início, duração, nota MIDI do som real), para o jogo
        "melody": {lv: [[round(s / levels[lv], 4), round(n / levels[lv], 4), int(p)]
                        for s, n, p in v] for lv, v in notes.items()},
        # instante (s) em que cada nota da melodia começa na gravação: o cursor pula no canto de verdade
        "melody_times": note_t,
        # trechos cantados como saíram da voz [início, fim, nota]: a letra usa estes mesmos trechos
        # na análise e quando é refeita pela tela (antes eram referências diferentes)
        "voice_events": [[round(a, 3), round(b, 3), int(p)] for a, b, p in events],
        # violão: [início em tempos, duração em tempos, [[nota MIDI, corda, casa], ...]]
        "violao": V.to_json(tab, 2 * sub) if tab else None,
        # os outros instrumentos no mesmo formato (baixo, cavaco, teclado); ver violao.INSTRUMENTS
        "instrumentos": {n: V.to_json(t, 2 * sub) for n, t in tabs.items() if n != "violao"},
        "stems": stems,
    }
    if chords_auto:
        result["chords_auto"] = chords_auto["simples"]
        result["chords_detalhado_auto"] = chords_auto["detalhado"]
    (d / "analysis.json").write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
    rep(1)


# ---------------------------------------------------------------- cifra colada

def _save_played(work, played):
    (work / "notas_harmonia.json").write_text(
        json.dumps([[round(float(s), 4), round(float(e), 4), int(m), round(float(a), 4)] for s, e, m, a in played]),
        encoding="utf-8")


def _save_probs(work, probs):
    np.savez_compressed(work / "acordes_lvcr.npz", *[p.astype(np.float16) for p in probs])


def _load_harmony_inputs(work, y=None):
    """Probabilidades do modelo de acordes e notas tocadas, guardadas na análise. Músicas analisadas
    antes desta versão não têm: calcula agora (uma vez) e guarda."""
    from . import analysis as A
    from . import lvcr
    from . import violao as V
    if y is None:
        y = {n: sf.read(str(work / f"{n}.wav"), dtype="float32")[0] for n in STEMS if (work / f"{n}.wav").exists()}
    pf = work / "acordes_lvcr.npz"
    if pf.exists():
        z = np.load(pf)
        probs = [z[f"arr_{i}"].astype(np.float32) for i in range(len(z.files))]
    else:
        if not lvcr.available():
            raise RuntimeError("O modelo de acordes (app/lvcr/models) não está instalado.")
        probs = A.chord_probs(sum(y.values()))[1]
        _save_probs(work, probs)
    nf = work / "notas_harmonia.json"
    if nf.exists():
        played = [tuple(x) for x in json.loads(nf.read_text(encoding="utf-8"))]
    else:
        played = []
        for n, k in (("guitar", 1.0), ("piano", 1.0), ("other", 0.5)):
            if n in y:
                played += [(s, e, m, k * a) for s, e, m, a in V.transcribe(y[n]) if 38 <= m <= 88]
        _save_played(work, played)
    return probs, played


def cifra_chords(work, y, grid, key, auto_detalhado, symbols):
    """Acordes da cifra encaixados no tempo da gravação, nos dois níveis (ver analysis.align_cifra).
    No simples as trocas rápidas custam mais (o mesmo jeito do reconhecimento)."""
    from . import analysis as A
    probs, played = _load_harmony_inputs(work, y)
    changes = {s["start_beat"] for s in auto_detalhado if s["kind"] != "N"}
    out = []
    for cost in ((0.6, 2.4, 1.0, 1.8), (0.3, 0.9, 0.5, 0.7)):
        # trecho que não está na cifra (introdução antes dela, parte que ela não traz) fica com o ouvido
        path, distinct = A.align_cifra(probs, grid, symbols, played=played, changes=changes, change_cost=cost,
                                       auto=auto_detalhado)
        out.append(A.cifra_segments(path, distinct, grid, key, auto=auto_detalhado))
    return out[0], out[1]


def cifra_text(sid):
    """A cifra guardada (só os acordes, em linhas de 8), para mostrar na janela."""
    f = SONGS / sid / "work" / "cifra_user.json"
    if not f.exists():
        return ""
    acordes = json.loads(f.read_text(encoding="utf-8"))["acordes"]
    return "\n".join("  ".join(acordes[i:i + 8]) for i in range(0, len(acordes), 8))


def save_cifra(sid, text):
    """Usa os acordes da cifra colada (a letra que vier junto é ignorada e não é guardada).
    Texto vazio volta para os acordes que o app ouviu. Refaz as partituras em segundos."""
    from . import cifra as CF
    d = SONGS / sid
    work = d / "work"
    an = json.loads((d / "analysis.json").read_text(encoding="utf-8"))
    f = work / "cifra_user.json"
    symbols = CF.parse_text(text or "")
    if (text or "").strip() and not symbols:
        raise ValueError("Não achei acordes nesse texto. Cole a cifra com as linhas de acordes (ex.: D6(9)  G7M).")
    if "chords_auto" not in an:
        an["chords_auto"], an["chords_detalhado_auto"] = an["chords"], an["chords_detalhado"]
    if symbols:
        f.write_text(json.dumps({"acordes": symbols}, ensure_ascii=False), encoding="utf-8")
        simples, det = cifra_chords(work, None, an["grid"], an["key"], an["chords_detalhado_auto"], symbols)
        an["chords"], an["chords_detalhado"], an["chords_source"] = simples, det, "cifra"
    else:
        if f.exists():
            f.unlink()
        an["chords"], an["chords_detalhado"] = an.pop("chords_auto"), an.pop("chords_detalhado_auto")
        an["chords_source"] = "auto"
        if (work / "referencia.json").exists():  # a gravação de referência continua valendo
            an["chords_auto"], an["chords_detalhado_auto"] = an["chords"], an["chords_detalhado"]
    from . import referencia as R
    if R.apply_saved(an, work):  # a gravação da pessoa tocando vale por cima, no trecho dela
        an["chords_source"] = "referencia"
    rebuild_scores(sid, an, an.get("lyrics") or [])
    return an


def _slot_time(grid, subdiv, notes=None, times=None):
    """Segundos de uma casa da grade; para o início de uma nota, o instante real em que ela é cantada."""
    beat_axis = np.arange(len(grid))
    real = dict(zip((n[0] for n in notes), times)) if notes and times and len(times) == len(notes) else {}

    def slot_time(k):
        t = real.get(k)
        return float(t) if t is not None else float(np.interp(k / subdiv, beat_axis, grid))
    return slot_time


def api_lines(found, auto, events, total):
    """Letra da base encaixada no canto: pelo tempo das linhas (LRC) ou, sem ele, pelo reconhecimento.
    `events`: trechos cantados [início, fim, nota] (ou só inícios, em análises antigas)."""
    from . import lyrics as L
    from . import lyrics_api as LA
    if found.get("syncedLyrics"):
        return L.align_synced(LA.parse_lrc(found["syncedLyrics"]), events, auto, total,
                              lrc_duration=found.get("duration"))
    return L.align_text(found.get("plainLyrics") or "", auto, [a for a, _, _ in L.as_events(events)])


def _lyrics_context(sid):
    """Os mesmos trechos de voz da análise (`voice_events`) e o reconhecimento puxado para as notas."""
    from . import lyrics as L
    d = SONGS / sid
    work = d / "work"
    an = json.loads((d / "analysis.json").read_text(encoding="utf-8"))
    auto = json.loads((work / "lyrics.json").read_text(encoding="utf-8")) if (work / "lyrics.json").exists() else []
    grid = np.array(an["grid"])
    events = an.get("voice_events") or (an.get("melody_times") or {}).get("detalhado") or [
        float(np.interp(b0, np.arange(len(grid)), grid)) for b0, _, _ in an.get("melody", {}).get("detalhado", [])]
    return work, an, L.snap_words(auto, events), events


def save_lyrics(sid, text):
    """Encaixa a letra colada pela pessoa no tempo do canto e refaz as partituras (segundos).
    Texto vazio volta para a letra da base (se houver) ou para a reconhecida automaticamente."""
    from . import lyrics as L
    work, an, auto, onsets = _lyrics_context(sid)
    user, api_file = work / "lyrics_user.json", work / "lyrics_api.json"
    text = L.clean_pasted(text)  # aceita cifra colada: tira as linhas de acordes e as marcações
    if text.strip():
        lines = L.align_text(text, auto, [a for a, _, _ in L.as_events(onsets)])
        user.write_text(json.dumps(lines, ensure_ascii=False), encoding="utf-8")
    else:
        if user.exists():
            user.unlink()
        lines = auto
        if api_file.exists():
            lines = api_lines(json.loads(api_file.read_text(encoding="utf-8")), auto, onsets, an.get("duration"))
    rebuild_scores(sid, an, lines)
    return lines


def use_api_lyrics(sid, found):
    """Usa a versão escolhida na base de letras (no lugar da colada ou da reconhecida)."""
    work, an, auto, onsets = _lyrics_context(sid)
    (work / "lyrics_api.json").write_text(json.dumps(found, ensure_ascii=False), encoding="utf-8")
    if (work / "lyrics_user.json").exists():
        (work / "lyrics_user.json").unlink()
    lines = api_lines(found, auto, onsets, an.get("duration"))
    rebuild_scores(sid, an, lines)
    return lines


def rebuild_scores(sid, an, lines):
    """Refaz as duas partituras a partir da análise salva, com a letra informada."""
    from . import lyrics as L
    from . import notation as N
    d = SONGS / sid
    grid = np.array(an["grid"])
    sub = an.get("subdivision", 2)
    beat_ql = an.get("beat_ql", 1.0)
    levels = {"simples": sub, "detalhado": 2 * sub}
    chords = {"simples": an["chords"], "detalhado": an.get("chords_detalhado", an["chords"])}
    title = read_meta(sid)["title"]
    for lv, s in levels.items():
        notes = [(int(round(b0 * s)), max(1, int(round(ln * s))), int(m)) for b0, ln, m in an["melody"][lv]]
        slot_time = _slot_time(grid, s, notes, (an.get("melody_times") or {}).get(lv))
        words = L.syllables_on_notes(lines, notes, slot_time)
        N.write_score(d / f"score_{lv}.musicxml", title, an["key"], an["bpm"], len(grid) - 1, chords[lv],
                      notes, s, an.get("octave_shift", 0), beat_ql, words)
        if lv == "detalhado":
            N.write_midi(d / "transcricao.mid", an["key"], an["bpm"], len(grid) - 1, chords[lv], notes, s, beat_ql)
    # as partes dos instrumentos trazem as cifras em cima: refaz com os acordes de agora
    from . import violao as V
    spb = 2 * sub
    parts = dict(an.get("instrumentos") or {})
    if an.get("violao"):
        parts["violao"] = an["violao"]
    for name, data in parts.items():
        tab = [{"slot": int(round(b0 * spb)), "len": max(1, int(round(ln * spb))),
                "notes": [tuple(x) for x in ns], "t": t} for b0, ln, ns, t in data]
        V.write_musicxml(d / f"score_{name}.musicxml", title, an["key"], an["bpm"], len(grid) - 1,
                         chords["detalhado"], tab, spb, beat_ql, inst=V.INSTRUMENTS[name])
    an["lyrics"] = lines
    work = d / "work"
    if (work / "lyrics_user.json").exists():
        an["lyrics_source"], an["lyrics_credit"] = "user", None
    elif (work / "lyrics_api.json").exists():
        from . import lyrics_api as LA
        an["lyrics_source"] = "lrclib"
        an["lyrics_credit"] = LA.summary(json.loads((work / "lyrics_api.json").read_text(encoding="utf-8")))
    else:
        an["lyrics_source"], an["lyrics_credit"] = "auto", None
    (d / "analysis.json").write_text(json.dumps(an, ensure_ascii=False), encoding="utf-8")


def process(sid):
    d = SONGS / sid
    meta = read_meta(sid)
    work, stems_dir = d / "work", d / "stems"
    work.mkdir(exist_ok=True)
    stems_dir.mkdir(exist_ok=True)
    rep = Reporter(sid)
    write_meta(sid, status="processing", started_at=time.time(), error=None)

    rep.stage("convert")
    wav = work / "mix44k.wav"
    if not wav.exists():
        _ffmpeg("-i", d / meta["source"], "-vn", "-ac", "2", "-ar", "44100", "-c:a", "pcm_s16le",
                wav)
    duration = sf.info(str(wav)).duration
    write_meta(sid, duration=duration)
    if not read_meta(sid).get("capa_ok"):  # a busca logo depois do envio não deu certo: tenta de novo
        add_cover(sid)
    rep(1)

    # motor da separação: o pedido para esta música ("Refazer com separação máxima") ou o do modo
    # de qualidade. Separa de novo se faltar parte (músicas antigas, de 4 partes) ou se o motor mudou.
    from . import hardware as H
    engine = meta.get("pedido_separacao") or H.plan()["separacao"]
    have_stems = all((stems_dir / f"{n}.m4a").exists() and (work / f"{n}.wav").exists()
                     for n in STEMS)
    if not have_stems or meta.get("separacao", "rapida") != engine:
        rep.stage("separate")
        engine = separate(wav, stems_dir, work, rep, engine)
        write_meta(sid, separacao=engine)
    write_meta(sid, pedido_separacao=None)

    analyze(sid, d, work, rep, meta["title"], duration, lyrics_model=meta.get("pedido_letra"))
    write_meta(sid, pedido_letra=None)
    write_meta(sid, status="ready", stage=None, progress=1.0, finished_at=time.time())


def add_cover(sid):
    """Capa da música e as cores dela (ver cover.py), guardadas no meta.json. Nunca derruba nada."""
    from . import cover as C
    try:
        meta = read_meta(sid)
        info = C.find(SONGS / sid, SONGS / sid / meta["source"], meta.get("title", ""), meta.get("duration"))
        write_meta(sid, **info, capa_v=int(time.time()))  # capa_v: a tela não usa a capa antiga do cache
    except Exception:  # noqa: BLE001
        traceback.print_exc()


# ---------------------------------------------------------------- fila

def enqueue(sid):
    write_meta(sid, status="queued", stage=None, progress=0.0, error=None)
    _queue.put(sid)


def _worker():
    while True:
        sid = _queue.get()
        try:
            if meta_path(sid).exists():
                process(sid)
        except Exception as exc:  # noqa: BLE001 - qualquer falha vira mensagem na tela
            traceback.print_exc()
            if meta_path(sid).exists():
                write_meta(sid, status="error", error=f"{type(exc).__name__}: {exc}")
        finally:
            _queue.task_done()


def start_worker():
    SONGS.mkdir(parents=True, exist_ok=True)
    for d in sorted(SONGS.iterdir()):
        mp = d / "meta.json"
        if mp.exists() and json.loads(mp.read_text(encoding="utf-8")).get("status") in (
                "queued", "processing"):
            enqueue(d.name)
    threading.Thread(target=_worker, daemon=True, name="soundstudy-worker").start()


def queue_position(sid):
    with _queue.mutex:
        items = list(_queue.queue)
    return items.index(sid) + 1 if sid in items else 0
