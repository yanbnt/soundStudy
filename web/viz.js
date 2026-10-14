// Fundo animado que reage à música, em preto e branco: névoas de luz que respiram no tempo,
// clareiam na troca de acorde, e uma faixa de barras que acompanha o som.
(function () {
  'use strict';

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  class Visualizer {
    // source() devolve { chordPc, playing, sinceBeat, downbeat, analyser }
    constructor(canvas, source, opts = {}) {
      this.c = canvas;
      this.ctx = canvas.getContext('2d');
      this.source = source;
      this.scale = opts.scale || 0.6;
      this.bars = opts.bars === undefined ? 64 : opts.bars;
      this.fadeTo = opts.fadeTo || null; // função () => cor do rodapé
      this.spec = new Float32Array(this.bars);
      this.level = 0;
      this.flash = 0;
      this.chordPc = null;
      this.t0 = performance.now();
      this.running = false;
      this.loop = this.loop.bind(this);
      new ResizeObserver(() => this.resize()).observe(canvas);
      this.resize();
    }

    resize() {
      const r = this.c.getBoundingClientRect();
      const k = Math.min(window.devicePixelRatio || 1, 1.5) * this.scale;
      this.c.width = Math.max(1, Math.round(r.width * k));
      this.c.height = Math.max(1, Math.round(r.height * k));
    }

    start() {
      if (this.running) return;
      this.running = true;
      requestAnimationFrame(this.loop);
    }

    stop() { this.running = false; }

    loop(now) {
      if (!this.running) return;
      if (!this.paused && this.c.offsetParent !== null && !document.hidden) {
        const st = this.source() || {};
        // parado, a animação roda a 1/3 dos quadros para poupar o computador
        this.frame = (this.frame || 0) + 1;
        if (st.playing || this.frame % 3 === 0) this.draw(now, st);
      }
      requestAnimationFrame(this.loop);
    }

    readAudio(st) {
      const n = this.bars;
      if (st.analyser && st.playing) {
        const a = st.analyser;
        if (!this.freq || this.freq.length !== a.frequencyBinCount) this.freq = new Uint8Array(a.frequencyBinCount);
        a.getByteFrequencyData(this.freq);
        const binHz = a.context.sampleRate / a.fftSize;
        const lo = Math.max(1, Math.round(40 / binHz));
        const hi = Math.min(this.freq.length - 1, Math.round(11000 / binHz));
        let sum = 0;
        for (let i = 0; i < n; i++) {
          const a0 = Math.round(lo * Math.pow(hi / lo, i / n));
          const a1 = Math.max(a0 + 1, Math.round(lo * Math.pow(hi / lo, (i + 1) / n)));
          let s = 0;
          for (let j = a0; j < a1; j++) s += this.freq[j];
          const v = Math.pow(s / (a1 - a0) / 255, 1.5);
          this.spec[i] = Math.max(v, this.spec[i] * 0.86);
          if (i < n / 3) sum += v;
        }
        return sum / (n / 3);
      }
      for (let i = 0; i < n; i++) this.spec[i] *= 0.9;
      return 0;
    }

    draw(now, st) {
      const ctx = this.ctx;
      const w = this.c.width, h = this.c.height;
      const t = (now - this.t0) / 1000;
      const still = reduceMotion.matches;
      if (st.playing && st.chordPc != null && st.chordPc !== this.chordPc) this.flash = 1;
      this.chordPc = st.chordPc;
      this.flash *= 0.94;

      const lvl = this.readAudio(st);
      this.level += (lvl - this.level) * 0.2;
      const pulse = !still && st.playing && st.sinceBeat != null
        ? Math.exp(-st.sinceBeat * 5) * (st.downbeat ? 1 : 0.55)
        : 0;
      const motion = still ? 0 : 1;
      const energy = st.playing ? 1 : 0.6;

      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = st.bg || '#050505'; // a cor do topo (a da capa, meio escura) ou quase preto
      ctx.fillRect(0, 0, w, h);

      // névoas de luz que flutuam e "respiram" no tempo, na cor da música (a da capa); sem cor, brancas
      ctx.globalCompositeOperation = 'lighter';
      const R = Math.max(w, h);
      const tint = st.color ? st.color.join(',') : '255,255,255';
      const boost = st.color ? 1.25 : 1; // cor pura soma menos luz que o branco: compensa um pouco
      const blobs = [0.0, 1.7, 3.1, 4.4];
      blobs.forEach((ph, i) => {
        const sp = 0.07 + i * 0.025;
        const x = w * (0.5 + 0.42 * Math.sin(t * sp * motion + ph));
        const y = h * (0.5 + 0.38 * Math.cos(t * sp * 1.3 * motion + ph * 1.7));
        const r = R * (0.3 + 0.06 * i) * (1 + 0.16 * pulse + 0.3 * this.level);
        const a = Math.min(1, (0.1 + 0.07 * pulse + 0.09 * this.level + 0.07 * this.flash) * energy * boost);
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, `rgba(${tint},${a.toFixed(3)})`);
        g.addColorStop(1, `rgba(${tint},0)`);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      });

      // barras do som passando no rodapé
      ctx.globalCompositeOperation = 'source-over';
      const n = this.bars;
      if (n) {
        const bw = w / n;
        for (let i = 0; i < n; i++) {
          const v = this.spec[i];
          if (v < 0.01) continue;
          const bh = v * h * 0.42;
          ctx.fillStyle = `rgba(255,255,255,${(0.05 + 0.26 * v).toFixed(3)})`;
          ctx.fillRect(i * bw + bw * 0.22, h - bh, bw * 0.56, bh);
        }
      }

      if (pulse > 0.02) {
        ctx.fillStyle = `rgba(255,255,255,${(0.035 * pulse).toFixed(3)})`;
        ctx.fillRect(0, 0, w, h);
      }

      if (this.fadeTo) {
        const g = ctx.createLinearGradient(0, h * 0.35, 0, h);
        g.addColorStop(0, 'rgba(0,0,0,0)');
        g.addColorStop(1, this.fadeTo());
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      }
    }
  }

  window.Visualizer = Visualizer;
})();
