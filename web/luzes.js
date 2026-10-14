// "Luzes de show": palco escuro com canhões de luz que varrem a fumaça, luzes desfocadas (bokeh) subindo
// devagar e o som virando luz na boca do palco. Tudo na cor da música (a da capa) e mais branco; sem cor,
// preto e branco. Reage à música: os canhões batem no tempo (mais forte no 1 do compasso), a luz clareia na
// troca de acorde e o brilho acompanha o volume; nos combos do jogo, chuva de faíscas.
(function () {
  'use strict';

  const TAU = Math.PI * 2;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const seeded = (seed) => {
    let s = seed >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  };
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
  const WHITE = [255, 255, 255];
  const BARS = 48;

  class LightsScene {
    // source() devolve { color, playing, analyser, chordPc, sinceBeat, downbeat, energy, mood, moodAt }
    constructor(canvas, source, opts = {}) {
      this.c = canvas;
      this.ctx = canvas.getContext('2d');
      this.source = source;
      this.scale = opts.scale || 0.6;
      this.minFrame = 1000 / (opts.fps || 30);
      this.focus = 1;
      this.inset = 0;
      this.t0 = performance.now();
      this.last = this.t0;
      this.lastFrame = 0;
      this.level = 0;
      this.flash = 0;
      this.chordPc = null;
      this.running = false;
      this.paused = false;
      this.sparks = [];
      this.spec = new Float32Array(BARS);
      this.loop = this.loop.bind(this);
      const rand = seeded(2026);
      // luzes desfocadas: posição (0 a 1), tamanho, profundidade (as de perto são maiores e mais fracas)
      this.bokeh = Array.from({ length: 24 }, () => ({
        x: rand(), y: rand(), r: 0.016 + rand() * 0.04, depth: rand(), ph: rand() * TAU,
        sp: 0.006 + rand() * 0.014, white: rand() < 0.38,
      }));
      // canhões: de onde saem (fração da largura), para onde apontam, velocidade e fase da varredura
      this.beams = [
        { x: 0.1, aim: 0.42, sp: 0.21, ph: 0.0, white: false },
        { x: 0.32, aim: 0.12, sp: 0.27, ph: 1.9, white: true },
        { x: 0.68, aim: -0.12, sp: 0.24, ph: 3.7, white: true },
        { x: 0.9, aim: -0.42, sp: 0.19, ph: 5.1, white: false },
      ];
      this.fog = Array.from({ length: 5 }, (_, i) => ({ x: rand(), y: 0.35 + rand() * 0.4, r: 0.35 + rand() * 0.3, sp: 0.01 + rand() * 0.02, ph: i * 1.3 }));
      this.ro = new ResizeObserver(() => this.resize());
      this.ro.observe(canvas);
      this.resize();
    }

    destroy() {
      this.running = false;
      this.ro.disconnect();
    }

    // f: até onde (fração da altura) vai o palco; inset: faixa de cima coberta por botões
    setFocus(f, inset = 0) {
      this.focus = Math.max(0.3, Math.min(1, f || 1));
      this.inset = Math.max(0, Math.min(0.3, inset || 0));
    }

    resize() {
      const r = this.c.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const k = Math.min(window.devicePixelRatio || 1, 1.25) * this.scale;
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
      if (!this.paused && this.c.offsetParent !== null && !document.hidden && now - this.lastFrame >= this.minFrame) {
        this.lastFrame = now;
        this.draw(now, this.source() || {});
      }
      requestAnimationFrame(this.loop);
    }

    // chuva de faíscas (combos do jogo)
    burst(n = 120) {
      const w = this.c.width, h = this.c.height * this.focus;
      for (let b = 0; b < Math.max(1, Math.round(n / 60)); b++) {
        const x = w * (0.2 + Math.random() * 0.6), y = h * (0.15 + Math.random() * 0.3);
        for (let i = 0; i < 60; i++) {
          const a = Math.random() * TAU, sp = (60 + Math.random() * 120) * (w / 900);
          this.sparks.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 30, life: 1, white: Math.random() < 0.5 });
        }
      }
    }

    readAudio(st) {
      if (!(st.analyser && st.playing)) {
        for (let i = 0; i < BARS; i++) this.spec[i] *= 0.9;
        return 0;
      }
      const a = st.analyser;
      if (!this.freq || this.freq.length !== a.frequencyBinCount) this.freq = new Uint8Array(a.frequencyBinCount);
      a.getByteFrequencyData(this.freq);
      const binHz = a.context.sampleRate / a.fftSize;
      const lo = Math.max(1, Math.round(50 / binHz)), hi = Math.min(this.freq.length - 1, Math.round(9000 / binHz));
      let low = 0;
      for (let i = 0; i < BARS; i++) {
        const a0 = Math.round(lo * Math.pow(hi / lo, i / BARS));
        const a1 = Math.max(a0 + 1, Math.round(lo * Math.pow(hi / lo, (i + 1) / BARS)));
        let s = 0;
        for (let j = a0; j < a1; j++) s += this.freq[j];
        const v = Math.pow(s / (a1 - a0) / 255, 1.6);
        this.spec[i] = Math.max(v, this.spec[i] * 0.84);
        if (i < BARS / 4) low += v;
      }
      return low / (BARS / 4);
    }

    draw(now, st) {
      const ctx = this.ctx, w = this.c.width, h = this.c.height;
      const t = (now - this.t0) / 1000;
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      const still = reduceMotion.matches;
      const motion = still ? 0 : 1;
      const col = st.color || [200, 200, 200];
      const tint = st.color ? col.map((v) => Math.round(v + (255 - v) * 0.55)) : WHITE; // a cor bem clarinha
      this.level += (this.readAudio(st) - this.level) * 0.2;
      if (st.playing && st.chordPc != null && st.chordPc !== this.chordPc) this.flash = 1;
      this.chordPc = st.chordPc;
      this.flash *= 0.92;
      const pulse = st.playing && !still && st.sinceBeat != null ? Math.exp(-st.sinceBeat * 6) * (st.downbeat ? 1 : 0.5) : 0;
      const energy = st.energy != null ? 0.6 + 0.6 * st.energy : (st.playing ? 1 : 0.7);
      const sad = st.mood === 'miss' && st.moodAt ? Math.max(0, 1 - (now - st.moodAt) / 1000) : 0;
      const floorY = h * this.focus, top = h * this.inset;

      // fundo: quase preto, com o ar do palco tomado pela cor
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#030303';
      ctx.fillRect(0, 0, w, h);
      const air = ctx.createRadialGradient(w * 0.5, floorY * 0.62, 0, w * 0.5, floorY * 0.62, Math.max(w, h) * 0.75);
      air.addColorStop(0, rgba(col, 0.2 + 0.12 * this.level));
      air.addColorStop(0.55, rgba(col, 0.06));
      air.addColorStop(1, rgba(col, 0));
      ctx.fillStyle = air;
      ctx.fillRect(0, 0, w, h);

      ctx.globalCompositeOperation = 'lighter';
      // fumaça: manchas enormes e lentas, que pegam a luz dos canhões
      for (const f of this.fog) {
        const x = w * (f.x + 0.08 * Math.sin(t * f.sp * TAU * motion + f.ph)), y = floorY * f.y;
        const g = ctx.createRadialGradient(x, y, 0, x, y, w * f.r);
        g.addColorStop(0, rgba(tint, 0.035 + 0.03 * this.level));
        g.addColorStop(1, rgba(tint, 0));
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      }

      // canhões de luz varrendo o palco
      for (const b of this.beams) {
        const sx = w * b.x, sy = top - h * 0.06;
        const ang = Math.PI / 2 + b.aim + 0.3 * Math.sin(t * b.sp * motion + b.ph); // a partir de "para baixo"
        const len = (floorY - sy) * 1.18, spread = 0.085 + 0.02 * this.level;
        const ex1 = sx + Math.cos(ang - spread) * len, ey1 = sy + Math.sin(ang - spread) * len;
        const ex2 = sx + Math.cos(ang + spread) * len, ey2 = sy + Math.sin(ang + spread) * len;
        const c = b.white ? tint : col;
        const a = (0.16 + 0.24 * pulse + 0.1 * this.level + 0.08 * this.flash) * energy * (1 - 0.6 * sad);
        const g = ctx.createLinearGradient(sx, sy, (ex1 + ex2) / 2, (ey1 + ey2) / 2);
        g.addColorStop(0, rgba(c, a * 1.6));
        g.addColorStop(0.35, rgba(c, a));
        g.addColorStop(1, rgba(c, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(ex1, ey1);
        ctx.lineTo(ex2, ey2);
        ctx.closePath();
        ctx.fill();
        // onde o feixe bate no chão do palco
        const fx = (ex1 + ex2) / 2;
        if (fx > -w * 0.2 && fx < w * 1.2) {
          const spot = ctx.createRadialGradient(fx, floorY, 0, fx, floorY, w * 0.12);
          spot.addColorStop(0, rgba(c, a * 0.9));
          spot.addColorStop(1, rgba(c, 0));
          ctx.fillStyle = spot;
          ctx.save();
          ctx.translate(fx, floorY);
          ctx.scale(1, 0.25);
          ctx.translate(-fx, -floorY);
          ctx.fillRect(fx - w * 0.13, floorY - w * 0.13, w * 0.26, w * 0.26);
          ctx.restore();
        }
      }

      // luzes desfocadas subindo devagar (as de perto, maiores e mais fracas)
      for (const p of this.bokeh) {
        p.y -= dt * p.sp * motion;
        if (p.y < -0.1) { p.y = 1.05; p.x = Math.random(); }
        const x = w * (p.x + 0.015 * Math.sin(t * 0.4 * motion + p.ph));
        const y = top + (floorY - top) * p.y;
        const r = h * p.r * (0.6 + 0.8 * p.depth);
        const tw = 0.6 + 0.4 * Math.sin(t * 0.9 * motion + p.ph);
        const a = (0.04 + 0.08 * (1 - p.depth)) * tw * (0.75 + 0.6 * this.level + 0.4 * pulse) * energy;
        const c = p.white ? tint : col;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, rgba(c, a * 0.55));
        g.addColorStop(0.82, rgba(c, a * 0.8));
        g.addColorStop(0.94, rgba(c, a));
        g.addColorStop(1, rgba(c, 0));
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
      }

      // o som virando luz na boca do palco: barras espelhadas a partir do meio
      const bw = w / (BARS * 2 + 6);
      for (let i = 0; i < BARS; i++) {
        const v = this.spec[i];
        if (v < 0.01) continue;
        const bh = v * floorY * 0.26;
        const g = ctx.createLinearGradient(0, floorY - bh, 0, floorY);
        g.addColorStop(0, rgba(tint, 0.55 * energy));
        g.addColorStop(1, rgba(col, 0.15));
        ctx.fillStyle = g;
        for (const s of [-1, 1]) {
          const x = w / 2 + s * (i + 0.5) * bw - bw * 0.32;
          ctx.fillRect(x, floorY - bh, bw * 0.64, bh);
        }
      }
      // a linha do palco
      const edge = ctx.createLinearGradient(0, 0, w, 0);
      edge.addColorStop(0, rgba(col, 0));
      edge.addColorStop(0.5, rgba(tint, 0.35 + 0.25 * pulse));
      edge.addColorStop(1, rgba(col, 0));
      ctx.fillStyle = edge;
      ctx.fillRect(0, floorY - Math.max(1, h * 0.002), w, Math.max(1, h * 0.003));

      // faíscas dos combos
      for (const s of this.sparks) {
        s.x += s.vx * dt; s.y += s.vy * dt; s.vy += 90 * dt * (w / 900); s.vx *= 0.985; s.life -= dt * 0.7;
        ctx.fillStyle = rgba(s.white ? WHITE : tint, s.life);
        ctx.beginPath(); ctx.arc(s.x, s.y, Math.max(1, w / 700), 0, TAU); ctx.fill();
      }
      this.sparks = this.sparks.filter((s) => s.life > 0);

      // clarão na troca de acorde
      if (this.flash > 0.02) {
        ctx.fillStyle = rgba(tint, 0.05 * this.flash);
        ctx.fillRect(0, 0, w, h);
      }

      ctx.globalCompositeOperation = 'source-over';
      // errou: o palco escurece por um instante
      if (sad > 0) {
        ctx.fillStyle = `rgba(0,0,0,${(0.4 * sad).toFixed(3)})`;
        ctx.fillRect(0, 0, w, h);
      }
      // vinheta
      const v = ctx.createRadialGradient(w / 2, h * 0.45, Math.min(w, h) * 0.3, w / 2, h * 0.45, Math.max(w, h) * 0.75);
      v.addColorStop(0, 'rgba(0,0,0,0)');
      v.addColorStop(1, 'rgba(0,0,0,0.7)');
      ctx.fillStyle = v;
      ctx.fillRect(0, 0, w, h);
    }
  }

  window.LightsScene = LightsScene;
})();
