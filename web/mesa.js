// "Mesa de samba" sem pessoas, em preto e branco: noite de lua sobre a baía, morros com as luzes
// das casas, o bondinho, um varal de lâmpadas e, na mesa, chapéu, tamborim, pandeiro, cavaquinho,
// chopp e uma folha de partitura. Tudo desenhado aqui. Mexe com a música: as lâmpadas pulsam no
// tempo e acendem em onda na troca de acorde, as platinelas brilham, o chopp borbulha e o caminho
// da lua no mar cintila com o som; nos combos do jogo sobem fogos sobre a baía.
(function () {
  'use strict';

  // O desenho tem 1600 x 500 unidades; a beira da mesa fica sempre embaixo da área visível.
  // Em telas mais largas aparece mais dos lados; em telas mais altas, mais céu.
  const W = 1600, D = 500, TAU = Math.PI * 2;
  const HORIZON = 232, TABLE = 318;
  const MOON = { x: 960, y: 112, r: 24 };
  const PANDEIRO = { x: 590, y: 418, rx: 108, ry: 34 };
  const GLASS = { x: 1240, top: 352, bottom: 468, w0: 50, w1: 40 };
  const CABLE = { x0: 1046, y0: 152, x1: 1166, y1: 78 };
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const seeded = (seed) => {
    let s = seed >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  };
  // varal de lâmpadas: fios pendurados em vãos, como na varanda de um bar
  const WIRES = [
    { x0: -1040, span: 760, y0: 0, sag: 54 },
    { x0: -700, span: 900, y0: 20, sag: 40 },
  ];
  const wireY = (w, x) => {
    const u = ((((x - w.x0) / w.span) % 1) + 1) % 1;
    return w.y0 + w.sag * Math.sin(Math.PI * u);
  };
  // morros, do mais longe para o mais perto (x, y do contorno)
  const FAR = [
    [[-1500, 232], [-1150, 176], [-860, 150], [-560, 178], [-300, 232]],
    [[1650, 232], [1900, 182], [2250, 158], [2650, 190], [2950, 232]],
  ];
  const HILLS = [
    [[-420, 232], [-220, 176], [-40, 128], [90, 112], [220, 142], [340, 192], [480, 232]],
    [[350, 232], [470, 206], [600, 186], [720, 197], [850, 181], [960, 206], [1050, 232]],
    [[1230, 232], [1330, 198], [1450, 172], [1560, 162], [1690, 184], [1820, 232]],
    [[985, 232], [1006, 192], [1026, 162], [1052, 151], [1082, 162], [1106, 198], [1120, 232]],
    [[1098, 232], [1116, 186], [1132, 118], [1150, 86], [1170, 77], [1192, 84], [1212, 118], [1230, 186], [1252, 232]],
  ];
  const ridgeAt = (pts, x) => {
    for (let i = 1; i < pts.length; i++) {
      if (x <= pts[i][0]) {
        const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
        return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0 || 1);
      }
    }
    return HORIZON;
  };

  class MesaScene {
    // source() devolve { playing, analyser, chordPc, sinceBeat, beatPos, energy, mood, moodAt }
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
      this.energy = 0.4;
      this.level = 0;
      this.rockets = [];
      this.sparks = [];
      this.chordPc = null;
      this.waveAt = -1e9;
      this.running = false;
      this.paused = false;
      this.loop = this.loop.bind(this);
      const rand = seeded(1965);
      this.bulbs = [];
      WIRES.forEach((w, wi) => {
        for (let x = -1000 + wi * 27; x < 2600; x += 56) this.bulbs.push({ x, y: wireY(w, x) + 11, g: this.bulbs.length % 3 });
      });
      this.twinkle = Array.from({ length: 60 }, () => ({ x: rand() * 2600 - 500, y: rand(), ph: rand() * TAU, r: 0.6 + rand() * 1.2 }));
      this.glints = Array.from({ length: 50 }, () => ({
        x: rand() * 2600 - 500, y: HORIZON + 4 + rand() * (TABLE - HORIZON - 8), w: 6 + rand() * 22, ph: rand() * TAU, sp: 0.5 + rand() * 1.4,
      }));
      this.bubbles = Array.from({ length: 18 }, () => ({ x: rand(), y: rand(), r: 0.8 + rand() * 1.6, sp: 0.25 + rand() * 0.5 }));
      this.jingles = Array.from({ length: 7 }, (_, i) => {
        const a = Math.PI * (0.14 + (i * 0.72) / 6);
        return { x: PANDEIRO.x + Math.cos(a) * PANDEIRO.rx, y: PANDEIRO.y + 6 + Math.sin(a) * PANDEIRO.ry };
      });
      this.ro = new ResizeObserver(() => this.resize());
      this.ro.observe(canvas);
      this.resize();
    }

    destroy() {
      this.running = false;
      this.ro.disconnect();
    }

    // f: até onde (fração da altura) vai o desenho; inset: faixa de cima coberta por botões (fica só céu)
    setFocus(f, inset = 0) {
      const v = Math.max(0.3, Math.min(1, f || 1));
      const ins = Math.max(0, Math.min(0.3, inset || 0));
      if (Math.abs(v - this.focus) < 0.01 && Math.abs(ins - this.inset) < 0.01) return;
      this.focus = v;
      this.inset = ins;
      this.resize();
    }

    resize() {
      const r = this.c.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const k = Math.min(window.devicePixelRatio || 1, 1.25) * this.scale;
      this.c.width = Math.max(1, Math.round(r.width * k));
      this.c.height = Math.max(1, Math.round(r.height * k));
      const avail = this.c.height * this.focus;
      const kk = Math.min(Math.max(1, avail - this.c.height * this.inset) / D, this.c.width / W);
      this.k = kk;
      this.tf = [kk, 0, 0, kk, (this.c.width - W * kk) / 2, avail - D * kk];
      this.yTop = D - avail / kk;
      this.xL = -this.tf[4] / kk;
      this.xR = (this.c.width - this.tf[4]) / kk;
      this.bg = this.layer((ctx) => this.paintBackground(ctx));
      this.table = this.layer((ctx) => this.paintTable(ctx));
      this.vignette = this.layer((ctx) => {
        const g = ctx.createRadialGradient(W / 2, D * 0.55, 260, W / 2, D * 0.55, 1150);
        g.addColorStop(0, 'rgba(0,0,0,0)');
        g.addColorStop(1, 'rgba(0,0,0,0.72)');
        ctx.fillStyle = g;
        ctx.fillRect(-3000, -3000, 7600, 6000);
      });
      this.glow = this.sprite(128, (ctx, s) => {
        const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
        g.addColorStop(0, 'rgba(255,255,255,1)');
        g.addColorStop(0.16, 'rgba(255,255,255,0.55)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, s, s);
      });
      this.disc = this.sprite(128, (ctx, s) => {
        const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
        g.addColorStop(0, 'rgba(255,255,255,0.22)');
        g.addColorStop(0.82, 'rgba(255,255,255,0.3)');
        g.addColorStop(0.93, 'rgba(255,255,255,0.45)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, s, s);
      });
      const grain = this.sprite(128, (ctx, s) => {
        const img = ctx.createImageData(s, s);
        const rand = seeded(7);
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

    paintBackground(ctx) {
      const top = Math.min(this.yTop, -40);
      const sky = ctx.createLinearGradient(0, top, 0, HORIZON);
      sky.addColorStop(0, '#000');
      sky.addColorStop(0.6, '#070707');
      sky.addColorStop(1, '#2b2b2b');
      ctx.fillStyle = sky;
      ctx.fillRect(-3000, top - 20, 7600, HORIZON - top + 30);
      const rand = seeded(11);
      const stars = Math.round(110 + (HORIZON - top) * 0.3);
      for (let i = 0; i < stars; i++) {
        const x = this.xL + rand() * (this.xR - this.xL), y = top + rand() * (200 - top);
        ctx.fillStyle = `rgba(255,255,255,${(0.2 + rand() * 0.6).toFixed(2)})`;
        ctx.beginPath();
        ctx.arc(x, y, 0.4 + rand() * 1.0, 0, TAU);
        ctx.fill();
      }
      // lua cheia
      const halo = ctx.createRadialGradient(MOON.x, MOON.y, MOON.r * 0.8, MOON.x, MOON.y, MOON.r * 7.5);
      halo.addColorStop(0, 'rgba(255,255,255,0.2)');
      halo.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = halo;
      ctx.fillRect(MOON.x - MOON.r * 8, MOON.y - MOON.r * 8, MOON.r * 16, MOON.r * 16);
      const disc = ctx.createRadialGradient(MOON.x - 7, MOON.y - 7, 2, MOON.x, MOON.y, MOON.r);
      disc.addColorStop(0, '#fff');
      disc.addColorStop(1, '#cfcfcf');
      ctx.fillStyle = disc;
      ctx.beginPath(); ctx.arc(MOON.x, MOON.y, MOON.r, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.08)';
      for (const [dx, dy, rr] of [[-8, -6, 6], [7, 5, 4.5], [-2, 11, 3.5], [11, -9, 3], [-13, 6, 2.5]]) {
        ctx.beginPath(); ctx.arc(MOON.x + dx, MOON.y + dy, rr, 0, TAU); ctx.fill();
      }
      // morros: os de longe mais claros (névoa), os de perto quase pretos, com a borda batida de lua
      const ridge = (pts, fill, rim) => {
        ctx.beginPath();
        ctx.moveTo(pts[0][0], HORIZON + 2);
        ctx.lineTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length - 1; i++) {
          ctx.quadraticCurveTo(pts[i][0], pts[i][1], (pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2);
        }
        const last = pts[pts.length - 1];
        ctx.lineTo(last[0], last[1]);
        ctx.lineTo(last[0], HORIZON + 2);
        ctx.closePath();
        ctx.fillStyle = fill;
        ctx.fill();
        if (rim) { ctx.strokeStyle = rim; ctx.lineWidth = 1.2; ctx.stroke(); }
      };
      for (const p of FAR) ridge(p, '#151515');
      const near = ctx.createLinearGradient(0, 70, 0, HORIZON);
      near.addColorStop(0, '#121212');
      near.addColorStop(1, '#090909');
      for (const p of HILLS) ridge(p, near, 'rgba(255,255,255,0.15)');
      // luzes das casas nas encostas e da orla
      for (const p of [HILLS[0], HILLS[1], HILLS[2]]) {
        for (let i = 0; i < 150; i++) {
          const x = p[0][0] + rand() * (p[p.length - 1][0] - p[0][0]);
          const r0 = ridgeAt(p, x) + 7;
          if (r0 > HORIZON - 4) continue;
          const y = HORIZON - 3 - Math.pow(rand(), 1.8) * (HORIZON - 3 - r0);
          ctx.fillStyle = `rgba(255,255,255,${(0.25 + rand() * 0.55).toFixed(2)})`;
          ctx.fillRect(x, y, 1.2 + rand() * 0.8, 1.2);
        }
      }
      for (let i = 0; i < 420; i++) {
        const x = this.xL + rand() * (this.xR - this.xL);
        ctx.fillStyle = `rgba(255,255,255,${(0.45 + rand() * 0.5).toFixed(2)})`;
        ctx.fillRect(x, HORIZON - 1.5 - rand() * 6, 1.4 + rand() * 2.2, 1.3);
      }
      const haze = ctx.createLinearGradient(0, 150, 0, HORIZON);
      haze.addColorStop(0, 'rgba(255,255,255,0)');
      haze.addColorStop(1, 'rgba(255,255,255,0.06)');
      ctx.fillStyle = haze;
      ctx.fillRect(-3000, 150, 7600, HORIZON - 150);
      // cabo do bondinho
      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(938, 226); ctx.lineTo(CABLE.x0, CABLE.y0); ctx.lineTo(CABLE.x1, CABLE.y1);
      ctx.stroke();
      // mar
      const sea = ctx.createLinearGradient(0, HORIZON, 0, TABLE);
      sea.addColorStop(0, '#121212');
      sea.addColorStop(1, '#030303');
      ctx.fillStyle = sea;
      ctx.fillRect(-3000, HORIZON, 7600, TABLE - HORIZON + 6);
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      for (let i = 0; i < 160; i++) {
        ctx.fillRect(this.xL + rand() * (this.xR - this.xL), HORIZON + 1, 1.4, 8 + rand() * 30);
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.035)';
      ctx.lineWidth = 1;
      for (let y = HORIZON + 6; y < TABLE; y += 6 + (y - HORIZON) * 0.09) {
        ctx.beginPath(); ctx.moveTo(-3000, y); ctx.lineTo(4600, y); ctx.stroke();
      }
    }

    paintTable(ctx) {
      const k = this.k;
      const shade = (blur, dy) => { ctx.shadowColor = 'rgba(0,0,0,0.75)'; ctx.shadowBlur = blur * k; ctx.shadowOffsetY = dy * k; };
      const noShade = () => { ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0; };
      const ellipse = (x, y, rx, ry, fill) => { ctx.fillStyle = fill; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, TAU); ctx.fill(); };

      // tampo de madeira escura, com a luz do bar no meio e os veios em perspectiva
      ctx.fillStyle = '#121212';
      ctx.fillRect(-3000, TABLE, 7600, 1200);
      const light = ctx.createRadialGradient(800, 380, 20, 800, 380, 950);
      light.addColorStop(0, 'rgba(255,255,255,0.17)');
      light.addColorStop(0.45, 'rgba(255,255,255,0.05)');
      light.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = light;
      ctx.fillRect(-3000, TABLE, 7600, 1200);
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.lineWidth = 1.6;
      for (let i = -18; i <= 18; i++) {
        ctx.beginPath(); ctx.moveTo(800 + i * 110, TABLE); ctx.lineTo(800 + i * 260, D + 120); ctx.stroke();
      }
      ctx.fillStyle = 'rgba(255,255,255,0.14)';
      ctx.fillRect(-3000, TABLE - 1, 7600, 2);

      // folha de partitura
      ctx.save();
      ctx.translate(800, 454);
      ctx.rotate(-0.06);
      shade(22, 8);
      const paper = ctx.createLinearGradient(0, -46, 0, 46);
      paper.addColorStop(0, '#f2f2f2');
      paper.addColorStop(1, '#c9c9c9');
      ctx.fillStyle = paper;
      ctx.fillRect(-125, -45, 250, 90);
      noShade();
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.lineWidth = 0.9;
      for (const y0 of [-31, 7]) {
        for (let l = 0; l < 5; l++) { ctx.beginPath(); ctx.moveTo(-108, y0 + l * 5); ctx.lineTo(108, y0 + l * 5); ctx.stroke(); }
        ctx.beginPath(); ctx.moveTo(-108, y0); ctx.lineTo(-108, y0 + 20); ctx.moveTo(108, y0); ctx.lineTo(108, y0 + 20); ctx.stroke();
      }
      ctx.fillStyle = 'rgba(0,0,0,0.85)';
      [[-84, -21], [-62, -26], [-40, -18], [-18, -23], [8, -16], [30, -28], [52, -21], [78, -24],
        [-80, 15], [-54, 19], [-30, 12], [-4, 17], [24, 10], [50, 22], [76, 15]].forEach(([x, y]) => {
        ctx.beginPath(); ctx.ellipse(x, y, 3.3, 2.4, -0.4, 0, TAU); ctx.fill();
        ctx.fillRect(x + 2.4, y - 15, 1, 15);
      });
      ctx.restore();

      // tamborim com a baqueta
      shade(16, 6);
      ellipse(128, 457, 50, 16, '#262626');
      noShade();
      ctx.fillStyle = '#262626';
      ctx.fillRect(78, 449, 100, 8);
      ellipse(128, 449, 50, 16, '#1a1a1a');
      const tskin = ctx.createRadialGradient(118, 444, 2, 128, 449, 46);
      tskin.addColorStop(0, '#ececec');
      tskin.addColorStop(1, '#a9a9a9');
      ellipse(128, 449, 44, 13.5, tskin);
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#080808';
      ctx.lineWidth = 6;
      ctx.beginPath(); ctx.moveTo(62, 486); ctx.lineTo(214, 432); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(66, 483); ctx.lineTo(212, 430); ctx.stroke();

      // chapéu panamá
      const hx = 300, hy = 392;
      shade(24, 10);
      const brim = ctx.createLinearGradient(0, hy - 30, 0, hy + 30);
      brim.addColorStop(0, '#dcdcdc');
      brim.addColorStop(1, '#9a9a9a');
      ellipse(hx, hy, 128, 30, brim);
      noShade();
      ellipse(hx + 4, hy - 1, 76, 17, 'rgba(0,0,0,0.22)');
      const crown = ctx.createLinearGradient(hx - 70, 0, hx + 70, 0);
      crown.addColorStop(0, '#a9a9a9');
      crown.addColorStop(0.3, '#e4e4e4');
      crown.addColorStop(1, '#8c8c8c');
      ctx.fillStyle = crown;
      ctx.beginPath();
      ctx.moveTo(hx - 68, hy - 6);
      ctx.bezierCurveTo(hx - 71, hy - 40, hx - 58, hy - 62, hx - 20, hy - 64);
      ctx.quadraticCurveTo(hx, hy - 55, hx + 20, hy - 64);
      ctx.bezierCurveTo(hx + 58, hy - 62, hx + 71, hy - 40, hx + 68, hy - 6);
      ctx.ellipse(hx, hy - 6, 68, 15, 0, 0, Math.PI);
      ctx.closePath();
      ctx.fill();
      ctx.save();
      ctx.clip();
      ctx.strokeStyle = 'rgba(0,0,0,0.07)';
      ctx.lineWidth = 1;
      for (let i = -12; i < 12; i++) { ctx.beginPath(); ctx.moveTo(hx + i * 12, hy - 70); ctx.lineTo(hx + i * 12 + 40, hy + 10); ctx.stroke(); }
      ctx.strokeStyle = '#0c0c0c';
      ctx.lineWidth = 12;
      ctx.beginPath(); ctx.ellipse(hx, hy - 20, 70, 15, 0, 0, Math.PI); ctx.stroke();
      ctx.restore();

      // pandeiro deitado
      const P = PANDEIRO;
      shade(22, 10);
      ellipse(P.x, P.y + 12, P.rx, P.ry, '#1c1c1c');
      noShade();
      const side = ctx.createLinearGradient(P.x - P.rx, 0, P.x + P.rx, 0);
      side.addColorStop(0, '#161616');
      side.addColorStop(0.45, '#4a4a4a');
      side.addColorStop(1, '#161616');
      ctx.fillStyle = side;
      ctx.fillRect(P.x - P.rx, P.y, P.rx * 2, 12);
      ctx.beginPath(); ctx.ellipse(P.x, P.y + 12, P.rx, P.ry, 0, 0, Math.PI); ctx.fill();
      for (const j of this.jingles) {
        ctx.fillStyle = '#060606';
        ctx.fillRect(j.x - 8, j.y - 3, 16, 7);
        ctx.fillStyle = '#9a9a9a';
        ctx.beginPath(); ctx.ellipse(j.x - 3, j.y, 3.4, 2.4, 0, 0, TAU); ctx.ellipse(j.x + 3, j.y, 3.4, 2.4, 0, 0, TAU); ctx.fill();
      }
      ellipse(P.x, P.y, P.rx, P.ry, '#3c3c3c');
      const skin = ctx.createRadialGradient(P.x - 26, P.y - 10, 4, P.x, P.y, P.rx);
      skin.addColorStop(0, '#f4f4f4');
      skin.addColorStop(1, '#a6a6a6');
      ellipse(P.x, P.y, P.rx - 10, P.ry - 4, skin);

      // cavaquinho deitado na diagonal (o lado da caixa aparece embaixo)
      const body = (c) => {
        c.beginPath();
        c.arc(32, 0, 60, 0, TAU);
        c.moveTo(-1, 0);
        c.arc(-46, 0, 47, 0, TAU);
        c.fill();
        c.fillRect(-46, -36, 80, 72);
      };
      ctx.save();
      ctx.translate(1052, 420);
      ctx.rotate(-0.36);
      ctx.scale(1, 0.58);
      shade(24, 16);
      ctx.fillStyle = '#1e1e1e';
      body(ctx);
      ctx.restore();
      noShade();
      ctx.save();
      ctx.translate(1052, 410);
      ctx.rotate(-0.36);
      ctx.scale(1, 0.58);
      const top = ctx.createLinearGradient(-90, -60, 90, 60);
      top.addColorStop(0, '#b4b4b4');
      top.addColorStop(1, '#5e5e5e');
      ctx.fillStyle = top;
      body(ctx);
      ctx.fillStyle = '#050505';
      ctx.beginPath(); ctx.arc(-8, 0, 15, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(-8, 0, 20, 0, TAU); ctx.stroke();
      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(56, -17, 9, 34);
      ctx.fillStyle = '#1b1b1b';
      ctx.fillRect(-262, -10, 220, 20);
      ctx.fillStyle = '#151515';
      ctx.fillRect(-316, -15, 56, 30);
      ctx.strokeStyle = '#555';
      ctx.lineWidth = 1.4;
      for (let f = 0; f < 12; f++) { const x = -62 - f * 16.5; ctx.beginPath(); ctx.moveTo(x, -10); ctx.lineTo(x, 10); ctx.stroke(); }
      ctx.fillStyle = '#8f8f8f';
      for (const [x, y] of [[-302, -19], [-282, -19], [-302, 19], [-282, 19]]) { ctx.beginPath(); ctx.arc(x, y, 4, 0, TAU); ctx.fill(); }
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.lineWidth = 0.9;
      for (let s = -1.5; s <= 1.5; s += 1) { ctx.beginPath(); ctx.moveTo(-300, s * 5.5); ctx.lineTo(60, s * 5.5); ctx.stroke(); }
      ctx.restore();

      // copo de chopp
      const G = GLASS;
      ellipse(G.x + 8, G.bottom + 3, 34, 9, 'rgba(0,0,0,0.6)');
      const beer = ctx.createLinearGradient(0, G.top, 0, G.bottom);
      beer.addColorStop(0, '#d8d8d8');
      beer.addColorStop(1, '#5c5c5c');
      ctx.fillStyle = beer;
      ctx.beginPath();
      ctx.moveTo(G.x - G.w0 / 2, G.top + 16); ctx.lineTo(G.x + G.w0 / 2, G.top + 16);
      ctx.lineTo(G.x + G.w1 / 2, G.bottom); ctx.lineTo(G.x - G.w1 / 2, G.bottom);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#f7f7f7';
      ctx.fillRect(G.x - G.w0 / 2 - 1, G.top + 2, G.w0 + 2, 16);
      for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.arc(G.x - G.w0 / 2 + 5 + i * 8, G.top + 3, 5, 0, TAU); ctx.fill(); }
      ctx.fillStyle = 'rgba(255,255,255,0.32)';
      ctx.fillRect(G.x - G.w0 / 2 + 6, G.top + 22, 4, G.bottom - G.top - 30);
      ellipse(G.x, G.bottom - 3, G.w1 / 2, 4, 'rgba(255,255,255,0.22)');

      // garrafa
      ellipse(1352, 468, 30, 8, 'rgba(0,0,0,0.6)');
      ctx.fillStyle = '#0b0b0b';
      ctx.beginPath();
      ctx.moveTo(1326, 466); ctx.lineTo(1326, 354);
      ctx.quadraticCurveTo(1328, 330, 1339, 318); ctx.lineTo(1339, 292); ctx.lineTo(1353, 292); ctx.lineTo(1353, 318);
      ctx.quadraticCurveTo(1364, 330, 1366, 354); ctx.lineTo(1366, 466);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#b0b0b0';
      ctx.fillRect(1337, 284, 18, 9);
      ctx.fillStyle = '#e6e6e6';
      ctx.fillRect(1326, 392, 40, 38);
      ctx.fillStyle = '#111';
      ctx.fillRect(1332, 402, 28, 4);
      ctx.fillRect(1336, 412, 20, 2.5);
      ctx.fillRect(1336, 419, 20, 2.5);
      ctx.fillStyle = 'rgba(255,255,255,0.28)';
      ctx.fillRect(1331, 360, 3, 98);
      ctx.fillRect(1342, 296, 2, 22);

      // fios do varal, com o bocal de cada lâmpada
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(205,205,205,0.28)';
      ctx.lineWidth = 1.5;
      for (const w of WIRES) {
        ctx.beginPath();
        for (let x = -1100; x <= 2700; x += 12) (x === -1100 ? ctx.moveTo(x, wireY(w, x)) : ctx.lineTo(x, wireY(w, x)));
        ctx.stroke();
      }
      ctx.fillStyle = '#2a2a2a';
      for (const b of this.bulbs) ctx.fillRect(b.x - 2.5, b.y - 11, 5, 7);
    }

    burst(n = 120) {
      const count = Math.max(1, Math.round(n / 60));
      for (let i = 0; i < count; i++) {
        this.rockets.push({ x: 250 + Math.random() * 1100, y: HORIZON, vy: -(190 + Math.random() * 70), fuse: 0.65 + Math.random() * 0.35 });
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
      if (!this.paused && this.c.offsetParent !== null && !document.hidden && now - this.lastFrame >= this.minFrame) {
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
      if (!this.bg) return;
      const ctx = this.ctx;
      const t = (now - this.t0) / 1000;
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      const motion = reduceMotion.matches ? 0 : 1;
      const playing = !!st.playing && !!motion;
      this.level += (this.audioLevel(st) - this.level) * 0.2;
      const wanted = st.energy != null ? st.energy : (st.playing ? 0.35 + 0.65 * Math.min(1, this.level * 1.7) : 0.3);
      this.energy += (wanted - this.energy) * 0.06;
      const e = this.energy;
      const since = st.sinceBeat == null ? 9 : st.sinceBeat;
      const hit = playing ? Math.exp(-since * 7) : 0;
      const beatPos = playing && st.beatPos != null ? st.beatPos : t * 0.5;
      const sad = st.mood === 'miss' && st.moodAt ? Math.max(0, 1 - (now - st.moodAt) / 1000) : 0;
      if (playing && st.chordPc != null && st.chordPc !== this.chordPc) this.waveAt = now;
      this.chordPc = st.chordPc;

      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(this.bg, 0, 0);
      ctx.setTransform(...this.tf);
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = '#fff';

      // estrelas piscando
      const skyH = 190 - this.yTop;
      for (const s of this.twinkle) {
        ctx.globalAlpha = 0.12 + 0.5 * (0.5 + 0.5 * Math.sin(t * 1.6 * motion + s.ph));
        ctx.beginPath(); ctx.arc(s.x, this.yTop + s.y * skyH, s.r, 0, TAU); ctx.fill();
      }
      // o caminho da lua no mar cintila com o som
      for (let i = 0; i < 22; i++) {
        const sw = Math.sin(t * 1.4 * motion + i * 1.7);
        const w = (8 + i * 2.3) * (0.65 + 0.35 * sw) * (0.85 + 0.6 * this.level);
        ctx.globalAlpha = Math.max(0, (0.24 + 0.16 * sw + 0.35 * this.level) * (1 - i / 30));
        ctx.fillRect(MOON.x - w / 2 + Math.sin(t * 0.8 * motion + i) * (2 + i * 0.25), HORIZON + 3 + i * 3.8, w, 1.5);
      }
      for (const g of this.glints) {
        ctx.globalAlpha = Math.max(0, Math.sin(t * g.sp * motion + g.ph)) * (0.12 + 0.3 * this.level + 0.1 * e);
        ctx.fillRect(g.x + Math.sin(t * 0.3 + g.ph) * 5 * motion, g.y, g.w, 1.2);
      }
      // bondinho indo e voltando
      const u = 0.5 + 0.5 * Math.sin(t * 0.09 * motion + 1);
      const cx = CABLE.x0 + (CABLE.x1 - CABLE.x0) * u, cy = CABLE.y0 + (CABLE.y1 - CABLE.y0) * u;
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#262626';
      ctx.fillRect(cx - 4, cy + 1, 8, 6);
      ctx.fillStyle = '#fff';
      ctx.fillRect(cx - 2.5, cy + 2.5, 5, 2);
      // fogos sobre a baía (combos do jogo)
      ctx.globalCompositeOperation = 'lighter';
      for (const r of this.rockets) {
        r.y += r.vy * dt;
        r.fuse -= dt;
        ctx.globalAlpha = 0.9;
        ctx.beginPath(); ctx.arc(r.x, r.y, 1.8, 0, TAU); ctx.fill();
        if (r.fuse <= 0) {
          for (let i = 0; i < 64; i++) {
            const a = (i / 64) * TAU, sp = 45 + Math.random() * 60;
            this.sparks.push({ x: r.x, y: r.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1 });
          }
        }
      }
      this.rockets = this.rockets.filter((r) => r.fuse > 0);
      for (const s of this.sparks) {
        s.x += s.vx * dt; s.y += s.vy * dt; s.vy += 30 * dt; s.vx *= 0.985; s.life -= dt * 0.6;
        ctx.globalAlpha = Math.max(0, s.life);
        ctx.beginPath(); ctx.arc(s.x, s.y, 1.5, 0, TAU); ctx.fill();
      }
      this.sparks = this.sparks.filter((s) => s.life > 0);

      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(this.table, 0, 0);
      ctx.setTransform(...this.tf);
      ctx.globalCompositeOperation = 'lighter';

      // a luz da mesa respira no tempo
      if (hit > 0.02) {
        ctx.globalAlpha = 0.09 * hit;
        ctx.drawImage(this.glow, 120, 300, 1360, 300);
      }
      // platinelas do pandeiro brilhando no toque
      this.jingles.forEach((j, i) => {
        ctx.globalAlpha = 0.18 + 0.75 * hit * (0.5 + 0.5 * Math.sin(i * 2.1 + beatPos * 3));
        ctx.drawImage(this.glow, j.x - 13, j.y - 13, 26, 26);
      });
      // bolhas subindo no chopp
      const G = GLASS;
      ctx.globalAlpha = 0.6;
      ctx.fillStyle = '#fff';
      for (const b of this.bubbles) {
        b.y -= dt * b.sp * (0.4 + e) * motion;
        if (b.y < 0) { b.y = 1; b.x = Math.random(); }
        const y = G.top + 24 + b.y * (G.bottom - G.top - 30);
        const half = (G.w1 + (G.w0 - G.w1) * (1 - b.y)) / 2 - 6;
        ctx.beginPath(); ctx.arc(G.x - half + b.x * half * 2, y, b.r, 0, TAU); ctx.fill();
      }
      // lâmpadas do varal: pulsam em grupos no tempo e acendem em onda quando o acorde muda
      const wave = (now - this.waveAt) / 1000;
      const span = (this.xR - this.xL) * 1.1;
      for (const b of this.bulbs) {
        if (b.x < this.xL - 40 || b.x > this.xR + 40) continue;
        const d = wave - (b.x - this.xL) / span;
        const boost = d >= 0 && d < 0.4 ? 1 - d / 0.4 : 0;
        const pulse = b.g === ((Math.floor(beatPos) % 3) + 3) % 3 ? 0.35 * hit : 0;
        ctx.globalAlpha = Math.min(1, (0.38 + 0.22 * e + pulse + 0.55 * boost) * (1 - 0.4 * sad));
        const gs = 62 + 34 * boost;
        ctx.drawImage(this.glow, b.x - gs / 2, b.y - gs / 2, gs, gs);
        ctx.globalAlpha = 1;
        ctx.beginPath(); ctx.arc(b.x, b.y, 3.6, 0, TAU); ctx.fill();
      }
      // duas lâmpadas bem perto da câmera, desfocadas
      ctx.globalAlpha = 0.22 + 0.15 * hit;
      ctx.drawImage(this.disc, this.xL - 30, this.yTop - 110, 220, 220);
      ctx.drawImage(this.disc, this.xR - 130, this.yTop - 100, 180, 180);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';

      // erro: a noite escurece por um instante
      if (sad > 0) {
        ctx.fillStyle = `rgba(0,0,0,${(0.4 * sad).toFixed(3)})`;
        ctx.fillRect(-3000, -3000, 7600, 6000);
      }
      // granulado de filme e vinheta
      ctx.setTransform(1, 0, 0, 1, Math.random() * 128, Math.random() * 128);
      ctx.globalAlpha = 0.06;
      ctx.fillStyle = this.grain;
      ctx.fillRect(-128, -128, this.c.width + 128, this.c.height + 128);
      ctx.globalAlpha = 1;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(this.vignette, 0, 0);
    }
  }

  window.MesaScene = MesaScene;
})();
