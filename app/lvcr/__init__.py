"""Acordes com vocabulário grande: Jiang, Chen, Li & Xia, "Large-Vocabulary Chord Transcription via
Chord Structure Decomposition" (ISMIR 2019). Código e pesos sob licença MIT (ver LICENSE).

A rede não escolhe "um acorde" de uma lista: ela decompõe o acorde em partes — tríade (com a raiz),
baixo, sétima, nona, décima primeira e décima terceira — e a probabilidade de cada acorde do
vocabulário é a combinação dessas partes. Por isso ela escreve Fm/E♭, A♭/B♭, B♭/D e D♭7M(9).
São 5 redes treinadas (validação cruzada); a média delas vota.

Adaptado do repositório oficial: só a inferência, em PyTorch atual, sem a biblioteca `mir` deles.
"""
from pathlib import Path

import numpy as np

SR = 22050
HOP = 512
FRAME_SEC = HOP / SR
MODELS = [Path(__file__).with_name("models") / f"chordnet_s{i}.sdict" for i in range(5)]
SPEC_DIM = 252
BIN_OFFSET = 18  # a rede usa 252 dos 288 bins, a partir do Dó1

# partes do acorde (como no artigo)
TRIADS = ["maj", "min", "sus4", "sus2", "dim", "aug"]           # índice da tríade = tipo * 12 + raiz + 1
SEVENTH = {"none": 0, "7": 1, "b7": 2, "bb7": 3}
NINTH = {"none": 0, "9": 1, "#9": 2, "b9": 3}
ELEVENTH = {"none": 0, "11": 1, "#11": 2}
THIRTEENTH = {"none": 0, "13": 1, "b13": 2}

# vocabulário "submission" do artigo: (nome, tríade, intervalo do baixo, 7ª, 9ª, 11ª, 13ª, tipo do Pauta Viva)
VOCAB = [
    ("maj", "maj", 0, 0, 0, 0, 0, "maj"),
    ("min", "min", 0, 0, 0, 0, 0, "min"),
    ("maj/3", "maj", 4, 0, 0, 0, 0, "maj"),
    ("maj/5", "maj", 7, 0, 0, 0, 0, "maj"),
    ("maj/2", "maj", 2, 0, 0, 0, 0, "maj"),
    ("maj/b7", "maj", 10, 0, 0, 0, 0, "maj"),
    ("min/b3", "min", 3, 0, 0, 0, 0, "min"),
    ("min/5", "min", 7, 0, 0, 0, 0, "min"),
    ("min/2", "min", 2, 0, 0, 0, 0, "min"),
    ("min/b7", "min", 10, 0, 0, 0, 0, "min"),
    ("7", "maj", 0, 2, 0, 0, 0, "7"),
    ("maj7", "maj", 0, 1, 0, 0, 0, "maj7"),
    ("min7", "min", 0, 2, 0, 0, 0, "m7"),
    ("hdim7", "dim", 0, 2, 0, 0, 0, "m7b5"),
    ("dim7", "dim", 0, 3, 0, 0, 0, "dim7"),
    ("9", "maj", 0, 2, 1, 0, 0, "9"),
    ("maj9", "maj", 0, 1, 1, 0, 0, "maj9"),
    ("min9", "min", 0, 2, 1, 0, 0, "m9"),
    ("11", "maj", 0, 2, 1, 1, 0, "11"),
    ("13", "maj", 0, 2, 1, 1, 1, "13"),
    ("sus4", "sus4", 0, 0, 0, 0, 0, "sus4"),
    ("sus2", "sus2", 0, 0, 0, 0, 0, "sus2"),
    ("sus4(b7)", "sus4", 0, 2, 0, 0, 0, "7sus4"),
    ("dim", "dim", 0, 0, 0, 0, 0, "dim"),
    ("aug", "aug", 0, 0, 0, 0, 0, "aug"),
]

_nets = None


def available():
    return all(p.exists() for p in MODELS)


def _build():
    import torch
    import torch.nn as nn
    import torch.nn.functional as F

    class CNN(nn.Module):
        def __init__(self):
            super().__init__()
            c1, c2, c3, c4 = 16, 32, 64, 80
            conv = lambda a, b, pad=(1, 1): nn.Conv2d(a, b, (3, 3), padding=pad)  # noqa: E731
            self.conv1a, self.conv1b, self.conv1c = conv(1, c1), conv(c1, c1), conv(c1, c1)
            self.conv2a, self.conv2b, self.conv2c = conv(c1, c2), conv(c2, c2), conv(c2, c2)
            self.conv3a, self.conv3b = conv(c2, c3), conv(c3, c3)
            self.conv4a, self.conv4b = conv(c3, c4, (1, 0)), conv(c4, c4, (1, 0))
            self.output_size = 3 * c4

        def forward(self, x):
            b, t = x.shape[0], x.shape[1]
            x = x.view((b, 1, t, SPEC_DIM))
            n = F.instance_norm
            for c in (self.conv1a, self.conv1b, self.conv1c):
                x = F.selu(n(c(x)))
            x = F.max_pool2d(x, (1, 3))
            for c in (self.conv2a, self.conv2b, self.conv2c):
                x = F.selu(n(c(x)))
            x = F.max_pool2d(x, (1, 3))
            for c in (self.conv3a, self.conv3b):
                x = F.selu(n(c(x)))
            x = F.max_pool2d(x, (1, 4))
            for c in (self.conv4a, self.conv4b):
                x = F.selu(n(c(x)))
            return x.transpose(1, 2).contiguous().view((b, t, self.output_size))

    class ChordNet(nn.Module):
        def __init__(self):
            super().__init__()
            self.audio_feature_block = CNN()
            self.condition_linear = nn.Linear(self.audio_feature_block.output_size + 12 + 6 + 12, 128)  # não usado
            self.lstm1 = nn.LSTM(input_size=self.audio_feature_block.output_size, hidden_size=96, num_layers=1,
                                 bidirectional=True, batch_first=True)
            self.final_fc1 = nn.Linear(192, 100)

        def forward(self, x):
            x = self.audio_feature_block(x)
            x = self.lstm1(x)[0]
            out = self.final_fc1(x)[0]
            # tríade (73) | baixo (13) | 7ª (4) | 9ª (4) | 11ª (3) | 13ª (3)
            cuts = [0, 73, 86, 90, 94, 97, 100]
            return [F.softmax(out[:, a:b], dim=1).cpu().numpy() for a, b in zip(cuts, cuts[1:])]

    nets = []
    for p in MODELS:
        net = ChordNet()
        state = torch.load(p, map_location="cpu", weights_only=True)["net"]
        net.load_state_dict(state)
        net.eval()
        nets.append(net)
    return nets


def features(y):
    """CQT híbrida como no artigo: 288 bins (36 por oitava) desde o Fá#0, magnitude."""
    import librosa
    C = librosa.hybrid_cqt(np.asarray(y, dtype=np.float32), sr=SR, hop_length=HOP, fmin=librosa.note_to_hz("F#0"),
                           n_bins=288, bins_per_octave=36, tuning=None)
    return np.abs(C).T.astype(np.float32)


def frame_probs(y, progress=None):
    """Probabilidades das 6 partes do acorde em cada quadro (~23 ms), média das 5 redes.
    Roda na placa de vídeo quando houver."""
    import torch
    from .. import hardware
    global _nets
    if _nets is None:
        _nets = _build()
    dev = hardware.device()
    feat = features(y)
    x = torch.tensor(feat[:, BIN_OFFSET:BIN_OFFSET + SPEC_DIM]).unsqueeze(0).to(dev)
    acc = None
    with torch.no_grad():
        for k, net in enumerate(_nets):
            out = net.to(dev)(x)
            acc = out if acc is None else [a + b for a, b in zip(acc, out)]
            if progress:
                progress((k + 1) / len(_nets))
    return [a / len(_nets) for a in acc]


def vocabulary():
    """Rótulos do vocabulário: (raiz, tipo do Pauta Viva, baixo ou None); o último é "sem acorde"."""
    labels = []
    for root in range(12):
        for name, triad, bass_iv, *_rest, kind in VOCAB:
            labels.append((root, kind, (root + bass_iv) % 12 if bass_iv else None))
    labels.append(None)
    return labels


def chord_log_probs(probs):
    """Log da probabilidade de cada acorde do vocabulário em cada quadro (quadros x rótulos)."""
    tri, bass, p7, p9, p11, p13 = [np.log(np.maximum(p, 1e-6)) for p in probs]
    cols = []
    for root in range(12):
        for name, triad, bass_iv, s7, s9, s11, s13, kind in VOCAB:
            t = TRIADS.index(triad) * 12 + root + 1
            b = (root + bass_iv) % 12 + 1
            cols.append(tri[:, t] + bass[:, b] + p7[:, s7] + p9[:, s9] + p11[:, s11] + p13[:, s13])
    cols.append(tri[:, 0] + bass[:, 0])  # sem acorde
    return np.stack(cols, axis=1)


def beat_scores(probs, times, trim=0.1):
    """Média por tempo do log da probabilidade de cada acorde (tempos x rótulos)."""
    L = chord_log_probs(probs)
    t = np.asarray(times)
    out = np.zeros((len(t) - 1, L.shape[1]))
    for i in range(len(t) - 1):
        span = t[i + 1] - t[i]
        fa = int(max(0, np.floor((t[i] + trim * span) / FRAME_SEC)))
        fb = int(max(fa + 1, np.ceil((t[i + 1] - trim * span) / FRAME_SEC)))
        if fa < len(L):
            out[i] = L[fa:min(fb, len(L))].mean(axis=0)
        else:
            out[i, -1] = 0.0
            out[i, :-1] = -20.0
    return out
