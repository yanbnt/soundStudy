// Roda de samba à noite, em clima de cinema: músicos e povo em silhueta contra a luz quente do
// boteco, lâmpadas desfocadas (bokeh), uma lâmpada pendurada sobre a mesa, poeira na luz e
// granulado de filme. Tudo desenhado aqui, no tempo da música e na cor do acorde.
// Para ficar leve: o fixo é pintado uma vez; o povo do fundo é desenhado em baixa resolução
// (o que já dá o desfoque); a cena roda a até 30 quadros por segundo.
(function () {
  'use strict';

  const W = 1600, H = 900, TAU = Math.PI * 2;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const fifthsHue = (pc) => ((pc * 7) % 12) * 30;
  const seeded = (seed) => {
    let s = seed >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  };
  const DARK = '#0c0706';
  const RIM = 'rgba(255,170,90,0.95)';

  function line(ctx, pts, width) {
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
    ctx.stroke();
  }

  // silhueta de busto: tronco com ombros arredondados, pescoço e cabeça (com chapéu ou cabelo)
  function bust(ctx, x, waist, s, look, nod = 0) {
    const sh = waist - 118 * s, hy = waist - 168 * s + nod;
    ctx.beginPath();
    ctx.moveTo(x - 40 * s, waist + 60 * s);
    ctx.bezierCurveTo(x - 44 * s, waist - 30 * s, x - 58 * s, sh + 18 * s, x - 50 * s, sh + 2 * s);
    ctx.quadraticCurveTo(x - 36 * s, sh - 14 * s, x - 12 * s, sh - 16 * s);
    ctx.lineTo(x + 12 * s, sh - 16 * s);
    ctx.quadraticCurveTo(x + 36 * s, sh - 14 * s, x + 50 * s, sh + 2 * s);
    ctx.bezierCurveTo(x + 58 * s, sh + 18 * s, x + 44 * s, waist - 30 * s, x + 40 * s, waist + 60 * s);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(x - 9 * s + look, sh - 34 * s, 18 * s, 26 * s);
    ctx.beginPath();
    ctx.ellipse(x + look, hy, 23 * s, 27 * s, 0, 0, TAU);
    ctx.fill();
    return { sh, hy };
  }

  function hat(ctx, x, hy, s) {
    ctx.beginPath();
    ctx.ellipse(x, hy - 16 * s, 44 * s, 9 * s, 0, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x - 24 * s, hy - 16 * s);
    ctx.quadraticCurveTo(x - 24 * s, hy - 44 * s, x, hy - 44 * s);
    ctx.quadraticCurveTo(x + 24 * s, hy - 44 * s, x + 24 * s, hy - 16 * s);
    ctx.fill();
  }

  class StageScene {
    // source() devolve { hue, chordPc, playing, sinceBeat, downbeat, beatPos, beatPeriod, subdivision,
    //                    analyser, energy, mood, moodAt }
    constructor(canvas, source, opts = {}) {
      this.c = canvas;
      this.ctx = canvas.getContext('2d');
      this.source = source;
      this.mono = opts.mono !== false; // identidade preto e branco: tira a cor no fim de cada quadro
      this.scale = opts.scale || 0.6;
      this.minFrame = 1000 / (opts.fps || 30);
      this.focus = 1;
      this.t0 = performance.now();
      this.last = this.t0;
      this.lastFrame = 0;
      this.energy = 0.45;
      this.level = 0;
      this.sparks = [];
      this.hueSprites = {};
      this.running = false;
      this.paused = false;
      this.loop = this.loop.bind(this);
      this.build();
      this.ro = new ResizeObserver(() => this.resize());
      this.ro.observe(canvas);
      this.resize();
    }

    destroy() {
      this.running = false;
      this.ro.disconnect();
    }

    build() {
      const rand = seeded(1916); // ano do primeiro samba gravado
      this.bokeh = Array.from({ length: 36 }, () => ({
        x: rand() * (W + 300) - 150, y: 40 + rand() * 560, r: 16 + Math.pow(rand(), 2) * 78,
        tint: rand() < 0.25, ph: rand() * TAU, sp: 0.2 + rand() * 0.6, a: 0.28 + rand() * 0.5,
      }));
      this.crowd = [80, 215, 345, 485, 630, 770, 905, 1050, 1190, 1330, 1470, 1580]
        .map((x) => ({ x: x + (rand() - 0.5) * 50, y: 560 + rand() * 40, s: 0.95 + rand() * 0.4, ph: rand() * TAU, arms: rand(), hat: rand() < 0.22 }));
      this.players = [
        { x: 330, inst: 'surdo', hat: false }, { x: 575, inst: 'cavaco', hat: true },
        { x: 800, inst: 'pandeiro', hat: false }, { x: 1025, inst: 'violao', hat: true },
        { x: 1270, inst: 'tanta', hat: false },
      ].map((p) => ({ ...p, ph: rand() * TAU }));
      this.dust = Array.from({ length: 50 }, () => ({
        x: 520 + rand() * 560, y: 160 + rand() * 560, r: 0.8 + rand() * 2.2, sp: 4 + rand() * 12, ph: rand() * TAU,
      }));
    }

    setFocus(f) {
      const v = Math.max(0.3, Math.min(1, f || 1));
      if (Math.abs(v - this.focus) < 0.01) return;
      this.focus = v;
      this.resize();
    }

    resize() {
      const r = this.c.getBoundingClientRect();
      const k = Math.min(window.devicePixelRatio || 1, 1.25) * this.scale;
      this.c.width = Math.max(1, Math.round(r.width * k));
      this.c.height = Math.max(1, Math.round(r.height * k));
      // a faixa do desenho do topo (y 60) até a beira da mesa (y 905) ocupa a área acima da partitura
      const avail = this.c.height * this.focus;
      const kk = Math.max(avail / 845, this.c.width / (W + 600));
      this.tf = [kk, 0, 0, kk, (this.c.width - W * kk) / 2, avail - 905 * kk];
      this.k = kk;
      // povo do fundo em 1/4 da resolução: ao ampliar, fica desfocado como em foto
      this.crowdCv = document.createElement('canvas');
      this.crowdCv.width = Math.max(1, Math.round(this.c.width / 4));
      this.crowdCv.height = Math.max(1, Math.round(this.c.height / 4));
      this.bg = this.layer((ctx) => this.paintBackground(ctx));
      this.table = this.layer((ctx) => this.paintTable(ctx));
      this.vignette = this.layer((ctx) => {
        const g = ctx.createRadialGradient(W / 2, 520, 200, W / 2, 520, 1000);
        g.addColorStop(0, 'rgba(0,0,0,0)');
        g.addColorStop(1, 'rgba(0,0,0,0.7)');
        ctx.fillStyle = g;
        ctx.fillRect(-600, -1200, W + 1200, 3000);
      });
      this.warm = this.disc('255,196,120');
      this.glow = this.sprite(256, (ctx, s) => {
        const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
        g.addColorStop(0, 'rgba(255,236,190,1)');
        g.addColorStop(0.08, 'rgba(255,200,120,0.85)');
        g.addColorStop(0.35, 'rgba(255,150,60,0.25)');
        g.addColorStop(1, 'rgba(255,120,40,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, s, s);
      });
      this.cone = this.sprite(256, (ctx, s) => {
        const g = ctx.createLinearGradient(0, 0, 0, s);
        g.addColorStop(0, 'rgba(255,190,110,0.5)');
        g.addColorStop(1, 'rgba(255,150,70,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(s * 0.46, 0);
        ctx.lineTo(s * 0.54, 0);
        ctx.lineTo(s, s);
        ctx.lineTo(0, s);
        ctx.closePath();
        ctx.fill();
      });
      const grain = this.sprite(128, (ctx, s) => {
        const img = ctx.createImageData(s, s);
        const rand = seeded(42);
        for (let i = 0; i < img.data.length; i += 4) {
          const v = rand() * 255;
          img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
          img.data[i + 3] = 255;
        }
        ctx.putImageData(img, 0, 0);
      });
      this.grain = this.ctx.createPattern(grain, 'repeat');
    }

    layer(paint) {
      const cv = document.createElement('canvas');
      cv.width = this.c.width;
      cv.height = this.c.height;
      const ctx = cv.getContext('2d');
      ctx.setTransform(...this.tf);
      paint(ctx);
      return cv;
    }

    sprite(size, paint) {
      const cv = document.createElement('canvas');
      cv.width = cv.height = size;
      paint(cv.getContext('2d'), size);
      return cv;
    }

    // disco de bokeh: miolo suave e borda um pouco mais clara, como lente desfocada
    disc(rgb) {
      return this.sprite(128, (ctx, s) => {
        const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
        g.addColorStop(0, `rgba(${rgb},0.32)`);
        g.addColorStop(0.78, `rgba(${rgb},0.42)`);
        g.addColorStop(0.9, `rgba(${rgb},0.6)`);
        g.addColorStop(1, `rgba(${rgb},0)`);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, s, s);
      });
    }

    hueDisc(h) {
      const key = Math.round(h / 30) % 12;
      if (!this.hueSprites[key]) {
        const c = document.createElement('canvas').getContext('2d');
        c.fillStyle = `hsl(${key * 30}, 85%, 70%)`;
        c.fillRect(0, 0, 1, 1);
        const [r, g, b] = c.getImageData(0, 0, 1, 1).data;
        this.hueSprites[key] = this.disc(`${r},${g},${b}`);
      }
      return this.hueSprites[key];
    }

    paintBackground(ctx) {
      const g = ctx.createLinearGradient(0, -400, 0, 900);
      g.addColorStop(0, '#07060c');
      g.addColorStop(0.55, '#1a0f10');
      g.addColorStop(0.85, '#2b160d');
      g.addColorStop(1, '#120906');
      ctx.fillStyle = g;
      ctx.fillRect(-600, -1200, W + 1200, 3200);
      // brilho do salão atrás do povo
      const glow = ctx.createRadialGradient(W / 2, 520, 40, W / 2, 520, 820);
      glow.addColorStop(0, 'rgba(255,150,70,0.42)');
      glow.addColorStop(0.5, 'rgba(200,90,40,0.16)');
      glow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(-600, -400, W + 1200, 1600);
    }

    paintTable(ctx) {
      // tampo escuro com o brilho da lâmpada na borda de trás
      ctx.fillStyle = '#140b07';
      ctx.beginPath();
      ctx.ellipse(800, 915, 820, 210, 0, 0, TAU);
      ctx.fill();
      ctx.fillRect(-600, 915, W + 1200, 1600);
      const edge = ctx.createLinearGradient(0, 700, 0, 760);
      edge.addColorStop(0, 'rgba(255,170,90,0.55)');
      edge.addColorStop(1, 'rgba(255,170,90,0)');
      ctx.strokeStyle = edge;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.ellipse(800, 915, 818, 208, 0, Math.PI * 1.08, Math.PI * 1.92);
      ctx.stroke();
      // garrafas e copos contra a luz: vidro com reflexo, cerveja acesa
      const bottle = (x, y) => {
        ctx.fillStyle = '#0d0705';
        ctx.beginPath();
        ctx.moveTo(x - 16, y);
        ctx.lineTo(x - 16, y - 66);
        ctx.quadraticCurveTo(x - 15, y - 90, x - 6, y - 100);
        ctx.lineTo(x - 6, y - 124);
        ctx.lineTo(x + 6, y - 124);
        ctx.lineTo(x + 6, y - 100);
        ctx.quadraticCurveTo(x + 15, y - 90, x + 16, y - 66);
        ctx.lineTo(x + 16, y);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,205,150,0.75)';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(x - 9, y - 8);
        ctx.lineTo(x - 9, y - 64);
        ctx.quadraticCurveTo(x - 8, y - 84, x - 2, y - 94);
        ctx.stroke();
      };
      const glass = (x, y) => {
        const halo = ctx.createRadialGradient(x, y - 24, 0, x, y - 24, 60);
        halo.addColorStop(0, 'rgba(255,170,60,0.45)');
        halo.addColorStop(1, 'rgba(255,170,60,0)');
        ctx.fillStyle = halo;
        ctx.fillRect(x - 60, y - 84, 120, 120);
        const beer = ctx.createLinearGradient(0, y - 46, 0, y);
        beer.addColorStop(0, '#ffd27a');
        beer.addColorStop(1, '#c9701c');
        ctx.fillStyle = beer;
        ctx.beginPath();
        ctx.moveTo(x - 17, y - 46);
        ctx.lineTo(x + 17, y - 46);
        ctx.lineTo(x + 13, y);
        ctx.lineTo(x - 13, y);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#fff4dc';
        ctx.fillRect(x - 17, y - 54, 34, 9);
      };
      bottle(560, 800); bottle(880, 792); bottle(1135, 806);
      glass(660, 822); glass(995, 826); glass(1240, 818); glass(455, 830);
    }

    burst(n = 120) {
      for (let i = 0; i < n; i++) {
        this.sparks.push({
          x: 300 + Math.random() * 1000, y: 700 + Math.random() * 120,
          vx: (Math.random() - 0.5) * 60, vy: -(120 + Math.random() * 220), life: 1, r: 1.5 + Math.random() * 3,
        });
      }
    }

    start() {
      if (this.running) return;
      this.running = true;
      requestAnimationFrame(this.loop);
    }

    stop() { this.running = false; }

    loop(now) {
      if (!this.running) return;
      if (!this.paused && this.c.offsetParent !== null && !document.hidden && now - this.lastFrame >= this.minFrame - 1) {
        this.lastFrame = now;
        this.draw(now, this.source() || {});
      }
      requestAnimationFrame(this.loop);
    }

    audioLevel(st) {
      if (!(st.analyser && st.playing)) return 0;
      const a = st.analyser;
      if (!this.freq || this.freq.length !== a.frequencyBinCount) this.freq = new Uint8Array(a.frequencyBinCount);
      a.getByteFrequencyData(this.freq);
      let s = 0;
      for (let i = 2; i < 60; i++) s += this.freq[i];
      return Math.pow(s / 58 / 255, 1.3);
    }

    draw(now, st) {
      const ctx = this.ctx;
      const t = (now - this.t0) / 1000;
      const dt = Math.min(0.08, (now - this.last) / 1000);
      this.last = now;
      const playing = !!st.playing && !reduceMotion.matches;
      this.level += (this.audioLevel(st) - this.level) * 0.2;
      const wanted = st.energy != null ? st.energy : (st.playing ? 0.35 + 0.65 * Math.min(1, this.level * 1.7) : 0.3);
      this.energy += (wanted - this.energy) * 0.06;
      const e = this.energy;
      const since = st.sinceBeat == null ? 9 : st.sinceBeat;
      const hit = playing ? Math.exp(-since * 7) : 0;
      const period = st.beatPeriod || 0.6;
      const phase = playing ? Math.min(1, since / period) : 0;
      const beatPos = playing && st.beatPos != null ? st.beatPos : t * 0.6;
      const sub = st.subdivision || 2;
      const sadAge = st.mood === 'miss' && st.moodAt ? (now - st.moodAt) / 1000 : 9;
      const sad = sadAge < 1.0;
      const motion = reduceMotion.matches ? 0 : 1;

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(this.bg, 0, 0);
      ctx.setTransform(...this.tf);

      // lâmpadas desfocadas ao fundo, respirando no tempo; algumas na cor do acorde
      ctx.globalCompositeOperation = 'lighter';
      const tintDisc = this.hueDisc(st.chordPc == null ? 30 : fifthsHue(st.chordPc));
      for (const b of this.bokeh) {
        const x = b.x + Math.sin(t * b.sp * 0.25 + b.ph) * 14 * motion;
        const y = b.y + Math.cos(t * b.sp * 0.18 + b.ph) * 9 * motion;
        const r = b.r * (1 + 0.06 * hit * (b.tint ? 1 : 0.5));
        ctx.globalAlpha = Math.min(1, b.a * (0.5 + 0.35 * e + 0.3 * hit * (b.tint ? 1 : 0.4)) * (sad ? 0.6 : 1));
        ctx.drawImage(b.tint ? tintDisc : this.warm, x - r, y - r, r * 2, r * 2);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';

      // povo do fundo, desfocado
      this.drawCrowd(t, beatPos, hit, e, sad, playing);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.crowdCv, 0, 0, this.c.width, this.c.height);
      ctx.setTransform(...this.tf);

      // cone de luz da lâmpada sobre a mesa
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = (0.3 + 0.12 * hit) * (sad ? 0.6 : 1);
      ctx.drawImage(this.cone, 800 - 560, 150, 1120, 760);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';

      // músicos em volta da mesa: contorno de luz e silhueta
      for (const p of this.players) this.drawPlayer(ctx, p, t, beatPos, phase, hit, sub, playing, st.downbeat);

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(this.table, 0, 0);
      ctx.setTransform(...this.tf);

      // lâmpada pendurada, com reflexo de lente
      ctx.strokeStyle = 'rgba(20,12,8,0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(800, -300);
      ctx.lineTo(800, 160);
      ctx.stroke();
      ctx.globalCompositeOperation = 'lighter';
      const flick = 1 + 0.08 * hit + 0.02 * Math.sin(t * 13) * motion;
      ctx.globalAlpha = (sad ? 0.55 : 0.9) * Math.min(1, flick);
      const gr = 210 * flick;
      ctx.drawImage(this.glow, 800 - gr, 178 - gr, gr * 2, gr * 2);
      const flare = ctx.createLinearGradient(400, 0, 1200, 0);
      flare.addColorStop(0, 'rgba(255,200,140,0)');
      flare.addColorStop(0.5, 'rgba(255,220,170,0.35)');
      flare.addColorStop(1, 'rgba(255,200,140,0)');
      ctx.fillStyle = flare;
      ctx.fillRect(400, 176, 800, 4);
      // poeira dançando na luz
      ctx.fillStyle = 'rgba(255,220,170,0.5)';
      for (const d of this.dust) {
        const y = ((d.y - t * d.sp * motion) % 560 + 560) % 560 + 160;
        const x = d.x + Math.sin(t * 0.5 + d.ph) * 18 * motion;
        ctx.globalAlpha = 0.25 + 0.25 * Math.sin(t * 1.3 + d.ph);
        ctx.beginPath();
        ctx.arc(x, y, d.r, 0, TAU);
        ctx.fill();
      }
      // faíscas douradas nos combos
      if (this.sparks.length) {
        for (const s of this.sparks) {
          s.x += s.vx * dt; s.y += s.vy * dt; s.vy += 60 * dt; s.life -= dt * 0.55;
          ctx.globalAlpha = Math.max(0, s.life);
          ctx.fillStyle = '#ffd27a';
          ctx.beginPath();
          ctx.arc(s.x, s.y, s.r, 0, TAU);
          ctx.fill();
        }
        this.sparks = this.sparks.filter((s) => s.life > 0);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';

      // erro: a luz esfria por um instante
      if (sad) {
        ctx.fillStyle = `rgba(40,50,70,${0.35 * (1 - sadAge)})`;
        ctx.fillRect(-600, -1200, W + 1200, 3200);
      }
      // granulado de filme e vinheta
      ctx.setTransform(1, 0, 0, 1, Math.random() * 128, Math.random() * 128);
      ctx.globalAlpha = 0.06;
      ctx.fillStyle = this.grain;
      ctx.fillRect(-128, -128, this.c.width + 128, this.c.height + 128);
      ctx.globalAlpha = 1;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(this.vignette, 0, 0);
      if (this.mono) { // uma passada só, na placa de vídeo: guarda o brilho e zera a saturação
        ctx.globalCompositeOperation = 'saturation';
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, this.c.width, this.c.height);
        ctx.globalCompositeOperation = 'source-over';
      }
    }

    drawCrowd(t, beatPos, hit, e, sad, playing) {
      const c = this.crowdCv.getContext('2d');
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, this.crowdCv.width, this.crowdCv.height);
      const q = 0.25;
      c.setTransform(this.tf[0] * q, 0, 0, this.tf[3] * q, this.tf[4] * q, this.tf[5] * q);
      c.lineCap = 'round';
      for (const pass of [0, 1]) {
        c.fillStyle = pass ? '#120a08' : 'rgba(255,150,80,0.55)';
        c.strokeStyle = c.fillStyle;
        const off = pass ? 0 : -4;
        for (const p of this.crowd) {
          const dancing = playing && !sad;
          const sway = dancing ? Math.sin(Math.PI * beatPos + p.ph) * (8 + 14 * e) : Math.sin(t * 0.8 + p.ph) * 3;
          const bob = dancing ? Math.abs(Math.sin(Math.PI * beatPos)) * (5 + 9 * e) : 0;
          const x = p.x + sway + (pass ? 0 : (800 - p.x) * 0.004);
          const waist = p.y - bob + off;
          const s = p.s;
          const { sh, hy } = bust(c, x, waist, s, sway * 0.15);
          if (p.hat) hat(c, x + sway * 0.15, hy, s);
          const up = dancing && e > 0.72 && p.arms < (e - 0.55) * 2.2;
          if (up) {
            const w = Math.sin(t * 5 + p.ph) * 12;
            line(c, [x - 44 * s, sh + 10 * s, x - 62 * s, sh - 70 * s, x - 50 * s + w, sh - 150 * s], 17 * s);
            line(c, [x + 44 * s, sh + 10 * s, x + 62 * s, sh - 70 * s, x + 50 * s - w, sh - 150 * s], 17 * s);
          } else if (dancing) {
            const gap = 8 + 34 * (1 - hit); // palmas no tempo
            line(c, [x - 44 * s, sh + 10 * s, x - 40 * s, sh + 70 * s, x - gap * s * 0.5, sh + 58 * s], 17 * s);
            line(c, [x + 44 * s, sh + 10 * s, x + 40 * s, sh + 70 * s, x + gap * s * 0.5, sh + 58 * s], 17 * s);
          }
        }
      }
    }

    drawPlayer(ctx, p, t, beatPos, phase, hit, sub, playing, downbeat) {
      const strike = playing ? Math.abs(Math.sin(Math.PI * phase * sub)) : 0.3;
      const lean = playing ? Math.sin(Math.PI * beatPos + p.ph) * 4 : 0;
      const nod = playing ? 6 * hit : Math.sin(t * 1.2 + p.ph) * 1.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const pass of [0, 1]) {
        // 1ª passada: contorno de luz (um pouco acima, de onde vem a lâmpada); 2ª: silhueta
        ctx.save();
        if (!pass) ctx.translate((800 - p.x) * 0.006, -3.5);
        ctx.fillStyle = pass ? DARK : RIM;
        ctx.strokeStyle = ctx.fillStyle;
        const x = p.x + lean, waist = 760;
        const s = 1.12;
        const { sh, hy } = bust(ctx, x, waist, s, 0, nod);
        if (p.hat) hat(ctx, x, hy, s);
        const L = [x - 46 * s, sh + 12 * s], R = [x + 46 * s, sh + 12 * s];
        this.instrument(ctx, p, x, waist, sh, L, R, strike, phase, playing, downbeat, pass, beatPos, hit);
        ctx.restore();
      }
    }

    instrument(ctx, p, x, waist, sh, L, R, strike, phase, playing, downbeat, pass, beatPos, hit) {
      const armW = 19;
      if (p.inst === 'surdo') {
        const cx = x + 84, top = waist - 100;
        ctx.beginPath();
        ctx.ellipse(cx, top, 74, 20, 0, 0, TAU);
        ctx.fill();
        ctx.fillRect(cx - 74, top, 148, 160);
        const lift = playing ? 80 * (1 - Math.exp(-phase * 4)) * (downbeat ? 1 : 0.6) : 24;
        const hx = cx + 6, hy = top - 26 - lift;
        line(ctx, [...R, R[0] + 26, sh + 80, hx, hy], armW);
        line(ctx, [hx, hy, hx - 12, hy + 50], 8);
        line(ctx, [...L, L[0] + 10, sh + 92, cx - 46, top - 6], armW);
        if (pass) {
          ctx.strokeStyle = 'rgba(255,200,140,0.55)';
          ctx.lineWidth = 3;
          ctx.beginPath(); ctx.ellipse(cx, top, 74, 20, 0, Math.PI, TAU); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(cx - 74, top + 30); ctx.lineTo(cx + 74, top + 30); ctx.stroke();
        }
      } else if (p.inst === 'cavaco' || p.inst === 'violao') {
        const big = p.inst === 'violao';
        const bx = x + 16, by = waist - 78, ang = big ? -0.35 : -0.5;
        ctx.save();
        ctx.translate(bx, by);
        ctx.rotate(ang);
        const r1 = big ? 54 : 40, r2 = big ? 44 : 31;
        ctx.beginPath(); ctx.arc(18, 0, r1, 0, TAU); ctx.arc(-34, 0, r2, 0, TAU); ctx.fill();
        ctx.fillRect(-(big ? 205 : 155), -7, big ? 175 : 128, 14);
        ctx.fillRect(-(big ? 238 : 182), -11, 36, 22);
        if (pass) {
          ctx.strokeStyle = 'rgba(255,200,140,0.5)';
          ctx.lineWidth = 2.5;
          ctx.beginPath(); ctx.arc(18, 0, r1, Math.PI * 1.15, Math.PI * 1.75); ctx.stroke();
          ctx.beginPath(); ctx.arc(-34, 0, r2, Math.PI * 1.2, Math.PI * 1.7); ctx.stroke();
        }
        ctx.restore();
        ctx.strokeStyle = pass ? DARK : RIM;
        const nx = bx - Math.cos(ang) * (big ? 155 : 115), ny = by - Math.sin(ang) * (big ? 155 : 115);
        line(ctx, [...L, L[0] - 30, sh + 76, nx, ny], armW);
        const amp = big ? 10 : 24;
        line(ctx, [...R, R[0] + 30, sh + 66, bx + 12, by - 12 + (strike - 0.5) * 2 * amp], armW);
      } else if (p.inst === 'pandeiro') {
        const tilt = playing ? Math.sin(Math.PI * beatPos) * 0.14 : 0;
        const px = x - 50, py = sh + 26;
        line(ctx, [...L, L[0] - 30, sh + 52, px - 22, py + 30], armW);
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(tilt);
        ctx.beginPath(); ctx.ellipse(0, 0, 52, 48, 0, 0, TAU); ctx.fill();
        if (pass) {
          // platinelas pegando a luz, piscando no toque
          for (let i = 0; i < 6; i++) {
            const a = (i / 6) * TAU + 0.3;
            ctx.fillStyle = `rgba(255,225,170,${0.45 + 0.5 * hit * Math.abs(Math.sin(i * 1.7 + beatPos))})`;
            ctx.beginPath(); ctx.ellipse(Math.cos(a) * 48, Math.sin(a) * 44, 7, 3.5, a, 0, TAU); ctx.fill();
          }
          ctx.strokeStyle = 'rgba(255,200,140,0.5)';
          ctx.lineWidth = 2.5;
          ctx.beginPath(); ctx.ellipse(0, 0, 52, 48, 0, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
        }
        ctx.restore();
        ctx.strokeStyle = pass ? DARK : RIM;
        line(ctx, [...R, R[0] + 12, sh + 70, px + 28 + 30 * strike, py + 8 + 22 * strike], armW);
      } else if (p.inst === 'tanta') {
        const cx = x + 6, cy = waist - 70;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(-0.12);
        ctx.beginPath();
        ctx.ellipse(-10, 0, 108, 40, 0, 0, TAU);
        ctx.fill();
        if (pass) {
          ctx.strokeStyle = 'rgba(255,200,140,0.5)';
          ctx.lineWidth = 3;
          ctx.beginPath(); ctx.ellipse(-10, 0, 108, 40, 0, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
        }
        ctx.restore();
        ctx.strokeStyle = pass ? DARK : RIM;
        const l = playing ? Math.max(0, Math.sin(Math.PI * phase * 2)) : 0.3;
        const r = playing ? Math.max(0, Math.sin(Math.PI * phase * 2 + Math.PI)) : 0.3;
        line(ctx, [...L, L[0] + 30, sh + 70, cx + 60, cy - 44 - 34 * l], armW);
        line(ctx, [...R, R[0] + 30, sh + 50, cx + 92, cy - 34 - 34 * r], armW);
      }
    }
  }

  window.StageScene = StageScene;
})();
