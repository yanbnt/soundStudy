// Modo Show valendo pontos: o microfone escuta quem toca e confere com a música.
//  - modo "acordes" (violão, cavaco, teclado): a cada tempo compara as notas ouvidas com o acorde;
//  - modo "melodia" (voz, sopro, teclado de uma nota): identifica cada nota tocada e confere com a partitura.
// Acertos dão pontos e combo; erros esfriam a plateia.
(function () {
  'use strict';

  const INTERVALS = {
    maj: [0, 4, 7], min: [0, 3, 7], '7': [0, 4, 7, 10], m7: [0, 3, 7, 10], maj7: [0, 4, 7, 11],
    m7b5: [0, 3, 6, 10], dim7: [0, 3, 6, 9], dim: [0, 3, 6], m6: [0, 3, 7, 9], mmaj7: [0, 3, 7, 11],
    '6': [0, 4, 7, 9], aug: [0, 4, 8], sus2: [0, 2, 7], sus4: [0, 5, 7],
    '7sus4': [0, 5, 7, 10], '9': [0, 4, 7, 10, 2], maj9: [0, 4, 7, 11, 2], m9: [0, 3, 7, 10, 2],
    '11': [0, 7, 10, 2, 5], '13': [0, 4, 7, 10, 9],
  };
  // a "base" de cada acorde: quem toca A♭ no lugar de A♭7M simplificou, mas não errou
  const TRIAD = {
    maj: 'maj', '7': 'maj', maj7: 'maj', '6': 'maj', min: 'min', m7: 'min', m6: 'min', mmaj7: 'min',
    m7b5: 'dim', dim: 'dim', dim7: 'dim', aug: 'aug', sus2: 'sus2', sus4: 'sus4',
    '7sus4': 'sus4', '9': 'maj', maj9: 'maj', m9: 'min', '11': 'sus4', '13': 'maj',
  };

  function normalize(v) {
    let n = 0;
    for (let i = 0; i < 12; i++) n += v[i] * v[i];
    n = Math.sqrt(n) || 1;
    const out = new Float32Array(12);
    for (let i = 0; i < 12; i++) out[i] = v[i] / n;
    return out;
  }

  function template(root, kind) {
    const v = new Float32Array(12);
    (INTERVALS[kind] || INTERVALS.maj).forEach((iv, i) => { v[(root + iv) % 12] = i === 0 ? 1 : 0.8; });
    return normalize(v);
  }

  const dot = (a, b) => { let s = 0; for (let i = 0; i < 12; i++) s += a[i] * b[i]; return s; };

  const RIVALS = [];
  for (let r = 0; r < 12; r++) RIVALS.push(template(r, 'maj'), template(r, 'min'));

  // Altura de uma nota só (YIN), com o sinal reduzido pela metade para caber no tempo de um quadro.
  function detectPitch(buf, sampleRate) {
    const n = buf.length >> 1;
    const x = new Float32Array(n);
    for (let i = 0; i < n; i++) x[i] = (buf[2 * i] + buf[2 * i + 1]) * 0.5;
    const fs = sampleRate / 2;
    const minLag = Math.max(2, Math.floor(fs / 1000));
    const maxLag = Math.min(Math.floor(fs / 75), n >> 1);
    const W = n - maxLag;
    const d = new Float32Array(maxLag + 2);
    for (let tau = 1; tau <= maxLag; tau++) {
      let s = 0;
      for (let i = 0; i < W; i++) { const v = x[i] - x[i + tau]; s += v * v; }
      d[tau] = s;
    }
    let run = 0;
    for (let tau = 1; tau <= maxLag; tau++) {
      run += d[tau];
      d[tau] = run > 0 ? (d[tau] * tau) / run : 1;
    }
    let best = -1;
    for (let tau = minLag; tau < maxLag; tau++) {
      if (d[tau] < 0.15) {
        while (tau + 1 < maxLag && d[tau + 1] < d[tau]) tau++;
        best = tau;
        break;
      }
    }
    if (best < 1) return 0;
    const a = d[best - 1], b = d[best], c = d[best + 1];
    const den = a - 2 * b + c;
    return fs / (best + (den ? (a - c) / (2 * den) : 0));
  }

  class ChordGame {
    constructor() {
      this.active = false;
      this.mode = 'chords';
      this.reset();
    }

    reset() {
      this.score = 0;
      this.combo = 0;
      this.maxCombo = 0;
      this.judged = 0;
      this.hits = 0;
      this.perfects = 0;
      this.energy = 0.5;
      this.bucket = new Float32Array(12);
      this.frames = 0;
      this.loudFrames = 0;
      this.noteFrames = 0;
      this.noteVoiced = 0;
      this.noteMatch = 0;
      this.expectedPc = null;
      this.lastMidi = null;
      this.level = 0;
    }

    async start(actx, mode) {
      if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) {
        throw new Error('este navegador não libera o microfone');
      }
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      this.src = actx.createMediaStreamSource(this.stream);
      this.an = actx.createAnalyser();
      this.an.fftSize = 8192;
      this.an.smoothingTimeConstant = 0;
      this.src.connect(this.an); // só analisa: não vai para a caixa de som (sem microfonia)
      this.sampleRate = actx.sampleRate;
      this.freq = new Float32Array(this.an.frequencyBinCount);
      this.time = new Float32Array(2048);
      const binHz = actx.sampleRate / this.an.fftSize;
      this.kmin = Math.ceil(70 / binHz);
      this.kmax = Math.min(this.freq.length - 1, Math.floor(1700 / binHz));
      this.pc = new Int8Array(this.freq.length).fill(-1);
      for (let k = this.kmin; k <= this.kmax; k++) {
        this.pc[k] = (((Math.round(12 * Math.log2((k * binHz) / 440)) + 69) % 12) + 12) % 12;
      }
      this.mode = mode === 'melody' ? 'melody' : 'chords';
      this.reset();
      this.active = true;
    }

    stop() {
      this.active = false;
      if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
      try { if (this.src) this.src.disconnect(); } catch (_) { /* já solto */ }
      this.stream = null;
    }

    // a cada quadro: escuta o microfone
    sample() {
      if (!this.active) return;
      this.an.getFloatTimeDomainData(this.time);
      let rms = 0;
      for (let i = 0; i < this.time.length; i++) rms += this.time[i] * this.time[i];
      rms = Math.sqrt(rms / this.time.length);
      this.level = rms;
      if (this.mode === 'melody') {
        const f = rms >= 0.008 ? detectPitch(this.time, this.sampleRate) : 0;
        this.lastMidi = f > 0 ? 69 + 12 * Math.log2(f / 440) : null;
        if (this.expectedPc !== null) {
          this.noteFrames++;
          if (this.lastMidi !== null) {
            this.noteVoiced++;
            if (((Math.round(this.lastMidi) % 12) + 12) % 12 === this.expectedPc) this.noteMatch++;
          }
        }
        return;
      }
      this.frames++;
      if (rms < 0.01) return;
      this.loudFrames++;
      this.an.getFloatFrequencyData(this.freq);
      for (let k = this.kmin; k <= this.kmax; k++) {
        const pc = this.pc[k];
        if (pc >= 0) this.bucket[pc] += Math.pow(10, this.freq[k] / 20);
      }
    }

    // modo melodia: a nota que deveria estar soando agora (null = pausa)
    expect(midi) {
      this.expectedPc = midi == null ? null : ((midi % 12) + 12) % 12;
      this.noteFrames = 0;
      this.noteVoiced = 0;
      this.noteMatch = 0;
    }

    // modo melodia: fim de uma nota da partitura
    judgeNote() {
      const frames = this.noteFrames, voiced = this.noteVoiced, match = this.noteMatch;
      this.noteFrames = 0;
      this.noteVoiced = 0;
      this.noteMatch = 0;
      if (!this.active || frames < 3) return null;
      let result;
      if (voiced < frames * 0.15) result = 'silence';
      else if (match >= frames * 0.55) result = 'perfect';
      else if (match >= frames * 0.25) result = 'good';
      else result = 'miss';
      return this.apply(result);
    }

    // modo acordes: fim de um tempo, comparando o que foi ouvido com o acorde esperado
    judge(chord) {
      const frames = this.frames, loud = this.loudFrames;
      const heard = normalize(this.bucket);
      this.bucket = new Float32Array(12);
      this.frames = 0;
      this.loudFrames = 0;
      if (!this.active || !chord || chord.kind === 'N' || chord.root == null) return null;
      if (loud < Math.max(2, frames * 0.25)) return this.apply('silence');
      const full = dot(heard, template(chord.root, chord.kind));
      const base = dot(heard, template(chord.root, TRIAD[chord.kind] || 'maj'));
      const sim = Math.max(full, base);
      let best = sim;
      for (const r of RIVALS) best = Math.max(best, dot(heard, r));
      const gap = best - sim;
      let result = 'miss';
      if (gap <= 0.02 && sim >= 0.6) result = full >= base - 0.02 ? 'perfect' : 'good';
      else if (gap <= 0.07 && sim >= 0.5) result = 'good';
      return this.apply(result);
    }

    apply(result) {
      this.judged++;
      if (result === 'miss' || result === 'silence') {
        this.combo = 0;
        this.energy = Math.max(0, this.energy - (result === 'miss' ? 0.07 : 0.04));
      } else {
        this.combo++;
        this.hits++;
        if (result === 'perfect') this.perfects++;
        this.maxCombo = Math.max(this.maxCombo, this.combo);
        this.score += (result === 'perfect' ? 100 : 50) * this.multiplier;
        this.energy = Math.min(1, this.energy + (result === 'perfect' ? 0.05 : 0.03));
      }
      return { result, combo: this.combo };
    }

    get accuracy() { return this.judged ? this.hits / this.judged : 0; }

    // multiplicador dos pontos, como no Guitar Hero: sobe a cada 8 acertos seguidos, até x4
    get multiplier() { return Math.min(4, 1 + Math.floor(this.combo / 8)); }
  }

  window.ChordGame = ChordGame;
  window.detectPitch = detectPitch;
})();
