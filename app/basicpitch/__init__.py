"""Transcrição de notas com o Basic Pitch (Spotify, licença Apache 2.0; veja LICENSE e NOTICE).

Adaptado de basic_pitch 0.4.0 (`inference.py` e `note_creation.py`): mesmas janelas de 2 s, mesma
costura entre janelas e mesma decodificação das notas. Mudanças: só o modelo ONNX (sem TensorFlow),
áudio em memória, janelas em lote e sem pretty_midi / curvas de pitch bend.
"""
from pathlib import Path

import numpy as np
import scipy.signal

SR = 22050
FFT_HOP = 256
FPS = SR // FFT_HOP                     # 86 quadros por segundo
ANNOT_N_FRAMES = FPS * 2                # quadros por janela de 2 s
AUDIO_N_SAMPLES = SR * 2 - FFT_HOP      # amostras por janela
N_OVERLAP = 30                          # quadros de sobreposição entre janelas
MIDI_OFFSET = 21                        # o modelo vai do Lá0 (MIDI 21) ao Dó8 (88 notas)
MAX_FREQ_IDX = 87
_MODEL = Path(__file__).with_name("nmp.onnx")
_session = None


def _get_session():
    global _session
    if _session is None:
        import onnxruntime as ort
        opts = ort.SessionOptions()
        opts.log_severity_level = 3
        _session = ort.InferenceSession(str(_MODEL), sess_options=opts, providers=["CPUExecutionProvider"])
    return _session


def run(y, progress=None, batch=16):
    """Ativações do modelo para áudio mono em 22050 Hz.

    Devolve {'note': (quadros, 88), 'onset': (quadros, 88), 'contour': (quadros, 264)}.
    """
    sess = _get_session()
    overlap_len = N_OVERLAP * FFT_HOP
    hop = AUDIO_N_SAMPLES - overlap_len
    original_length = len(y)
    audio = np.concatenate([np.zeros(overlap_len // 2, dtype=np.float32), np.asarray(y, dtype=np.float32)])
    starts = list(range(0, len(audio), hop))
    outs = {"note": [], "onset": [], "contour": []}
    for b in range(0, len(starts), batch):
        wins = []
        for i in starts[b:b + batch]:
            w = audio[i:i + AUDIO_N_SAMPLES]
            if len(w) < AUDIO_N_SAMPLES:
                w = np.pad(w, (0, AUDIO_N_SAMPLES - len(w)))
            wins.append(w)
        x = np.stack(wins)[:, :, None]
        note, onset, contour = sess.run(
            ["StatefulPartitionedCall:1", "StatefulPartitionedCall:2", "StatefulPartitionedCall:0"],
            {"serving_default_input_2:0": x})
        outs["note"].append(note)
        outs["onset"].append(onset)
        outs["contour"].append(contour)
        if progress:
            progress(min(1.0, (b + batch) / len(starts)))
    n_olap = N_OVERLAP // 2
    n_frames = int(np.floor(original_length * (FPS / SR)))
    result = {}
    for k, v in outs.items():
        v = np.concatenate(v)[:, n_olap:-n_olap, :]
        result[k] = v.reshape(v.shape[0] * v.shape[1], v.shape[2])[:n_frames]
    return result


def frame_times(n_frames):
    """Tempo (s) de cada quadro, com a mesma correção por janela do original."""
    original = np.arange(n_frames) * FFT_HOP / SR
    window_numbers = np.floor(np.arange(n_frames) / ANNOT_N_FRAMES)
    window_offset = (FFT_HOP / SR) * (ANNOT_N_FRAMES - (AUDIO_N_SAMPLES / FFT_HOP)) + 0.0018
    return original - window_offset * window_numbers


def _hz_to_idx(hz):
    return int(np.round(12 * np.log2(hz / 440.0) + 69 - MIDI_OFFSET))


def _inferred_onsets(onsets, frames, n_diff=2):
    diffs = []
    for n in range(1, n_diff + 1):
        appended = np.concatenate([np.zeros((n, frames.shape[1])), frames])
        diffs.append(appended[n:, :] - appended[:-n, :])
    frame_diff = np.min(diffs, axis=0)
    frame_diff[frame_diff < 0] = 0
    frame_diff[:n_diff, :] = 0
    if np.max(frame_diff) > 0:
        frame_diff = np.max(onsets) * frame_diff / np.max(frame_diff)
    return np.max([onsets, frame_diff], axis=0)


def notes(out, onset_thresh=0.5, frame_thresh=0.3, min_note_ms=127.7, min_hz=None, max_hz=None,
          infer_onsets=True, melodia_trick=True, energy_tol=11):
    """Notas (início s, fim s, nota MIDI, intensidade 0..1) a partir das ativações do modelo."""
    frames = out["note"].copy()
    onsets = out["onset"].copy()
    n_frames = frames.shape[0]
    min_note_len = int(np.round(min_note_ms / 1000 * FPS))
    if max_hz is not None:
        onsets[:, _hz_to_idx(max_hz):] = 0
        frames[:, _hz_to_idx(max_hz):] = 0
    if min_hz is not None:
        onsets[:, :_hz_to_idx(min_hz)] = 0
        frames[:, :_hz_to_idx(min_hz)] = 0
    if infer_onsets:
        onsets = _inferred_onsets(onsets, frames)

    peak = np.zeros(onsets.shape)
    peaks = scipy.signal.argrelmax(onsets, axis=0)
    peak[peaks] = onsets[peaks]
    idx = np.where(peak >= onset_thresh)
    remaining = frames.copy()
    events = []
    for start, f in zip(idx[0][::-1], idx[1][::-1]):  # de trás para a frente no tempo
        if start >= n_frames - 1:
            continue
        i, k = start + 1, 0
        while i < n_frames - 1 and k < energy_tol:
            k = k + 1 if remaining[i, f] < frame_thresh else 0
            i += 1
        i -= k
        if i - start <= min_note_len:
            continue
        remaining[start:i, max(0, f - 1):min(MAX_FREQ_IDX, f + 1) + 1] = 0
        events.append((start, i, f + MIDI_OFFSET, float(np.mean(frames[start:i, f]))))

    if melodia_trick:
        while True:
            flat = int(np.argmax(remaining))
            mid, f = divmod(flat, remaining.shape[1])
            if remaining[mid, f] <= frame_thresh:
                break
            remaining[mid, f] = 0
            lo, hi = max(0, f - 1), min(MAX_FREQ_IDX, f + 1) + 1
            i, k = mid + 1, 0
            while i < n_frames - 1 and k < energy_tol:
                k = k + 1 if remaining[i, f] < frame_thresh else 0
                remaining[i, lo:hi] = 0
                i += 1
            end = i - 1 - k
            i, k = mid - 1, 0
            while i > 0 and k < energy_tol:
                k = k + 1 if remaining[i, f] < frame_thresh else 0
                remaining[i, lo:hi] = 0
                i -= 1
            begin = i + 1 + k
            if end - begin <= min_note_len:
                continue
            events.append((begin, end, f + MIDI_OFFSET, float(np.mean(frames[begin:end, f]))))

    t = frame_times(n_frames + 1)
    return sorted((float(t[a]), float(t[b]), int(p), amp) for a, b, p, amp in events)
