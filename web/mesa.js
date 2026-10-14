// "Mesa de samba" sem pessoas, em preto e branco: noite de lua sobre a baía, morros com as luzes
// das casas, o bondinho, um varal de lâmpadas e, na mesa, chapéu, tamborim, pandeiro, violão,
// um violão em pé e uma partitura, com luz e sombra. Tudo desenhado aqui. Mexe com a música: as lâmpadas pulsam no
// tempo e acendem em onda na troca de acorde, as platinelas brilham e o caminho
// da lua no mar cintila com o som; nos combos do jogo sobem fogos sobre a baía.
(function () {
  'use strict';

  // O desenho tem 1600 x 500 unidades; a beira da mesa fica sempre embaixo da área visível.
  // Em telas mais largas aparece mais dos lados; em telas mais altas, mais céu.
  const W = 1600, D = 500, TAU = Math.PI * 2;
  const HORIZON = 232, TABLE = 318;
  const MOON = { x: 960, y: 112, r: 24 };
  const PANDEIRO = { x: 590, y: 418, rx: 108, ry: 34 };
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
      this.jingles = Array.from({ length: 7 }, (_, i) => {
        const a = Math.PI * (0.14 + (i * 0.72) / 6);
        return { x: PANDEIRO.x + Math.cos(a) * PANDEIRO.rx, y: PANDEIRO.y + 7.5 + Math.sin(a) * PANDEIRO.ry };
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
      const rand = seeded(42);
      const shade = (blur, dy) => { ctx.shadowColor = 'rgba(0,0,0,0.75)'; ctx.shadowBlur = blur * k; ctx.shadowOffsetY = dy * k; };
      const noShade = () => { ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0; };
      const ellipse = (x, y, rx, ry, fill) => { ctx.fillStyle = fill; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, TAU); ctx.fill(); };
      // sombra macia no tampo: desenha a forma longe e traz só a sombra de volta (funciona em todo navegador)
      const floorShadow = (x, y, rx, ry, blur, a) => {
        ctx.save();
        ctx.shadowColor = `rgba(0,0,0,${a})`;
        ctx.shadowBlur = blur * k;
        ctx.shadowOffsetX = 10000 * k;
        ctx.fillStyle = '#000';
        ctx.beginPath(); ctx.ellipse(x - 10000, y, rx, ry, 0, 0, TAU); ctx.fill();
        ctx.restore();
      };
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

      this.paintHat(ctx, floorShadow, rand);
      this.paintPandeiro(ctx, floorShadow, rand);
      this.paintSheet(ctx, shade, noShade);
      this.paintTamborim(ctx, floorShadow, ellipse);
      this.paintViolao(ctx, floorShadow, rand);

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

    // chapéu panamá de palha trançada, com a fita preta e o laço do lado
    paintHat(ctx, floorShadow, rand) {
      const hx = 300, hy = 392;
      floorShadow(hx + 18, hy + 10, 126, 26, 16, 0.75);
      // aba: palha clara, a borda um pouco virada pra cima, trama em raios e em voltas
      const brim = new Path2D();
      brim.ellipse(hx, hy, 128, 30, 0, 0, TAU);
      const bg = ctx.createLinearGradient(0, hy - 30, 0, hy + 30);
      bg.addColorStop(0, '#cfcfcf'); bg.addColorStop(0.55, '#b4b4b4'); bg.addColorStop(1, '#7c7c7c');
      ctx.fillStyle = bg;
      ctx.fill(brim);
      ctx.save();
      ctx.clip(brim);
      ctx.lineWidth = 0.7;
      for (let a = 0; a < TAU; a += TAU / 90) { // fibras saindo da copa
        ctx.strokeStyle = `rgba(0,0,0,${0.06 + rand() * 0.06})`;
        ctx.beginPath(); ctx.moveTo(hx + Math.cos(a) * 66, hy + Math.sin(a) * 15); ctx.lineTo(hx + Math.cos(a) * 130, hy + Math.sin(a) * 31); ctx.stroke();
      }
      for (let r = 0.56; r < 1; r += 0.055) { // voltas da trança
        ctx.strokeStyle = 'rgba(255,255,255,0.09)';
        ctx.beginPath(); ctx.ellipse(hx, hy, 128 * r, 30 * r, 0, 0, TAU); ctx.stroke();
      }
      ctx.restore();
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'; // a borda pega a luz
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.ellipse(hx, hy - 1, 127, 29, 0, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke();
      ctx.fillStyle = 'rgba(0,0,0,0.28)'; // sombra da copa na aba
      ctx.beginPath(); ctx.ellipse(hx + 10, hy + 2, 78, 17, 0, 0, TAU); ctx.fill();
      // copa com o vinco no meio
      const crown = new Path2D();
      crown.moveTo(hx - 68, hy - 6);
      crown.bezierCurveTo(hx - 72, hy - 40, hx - 58, hy - 62, hx - 22, hy - 64);
      crown.quadraticCurveTo(hx, hy - 54, hx + 22, hy - 64);
      crown.bezierCurveTo(hx + 58, hy - 62, hx + 72, hy - 40, hx + 68, hy - 6);
      crown.ellipse(hx, hy - 6, 68, 15, 0, 0, Math.PI);
      crown.closePath();
      const cg = ctx.createLinearGradient(hx - 70, 0, hx + 70, 0);
      cg.addColorStop(0, '#8a8a8a'); cg.addColorStop(0.28, '#e2e2e2'); cg.addColorStop(0.55, '#c2c2c2'); cg.addColorStop(1, '#6e6e6e');
      ctx.fillStyle = cg;
      ctx.fill(crown);
      ctx.save();
      ctx.clip(crown);
      ctx.lineWidth = 0.6; // trama cruzada da palha
      for (let i = -16; i < 16; i++) {
        ctx.strokeStyle = 'rgba(0,0,0,0.09)';
        ctx.beginPath(); ctx.moveTo(hx + i * 9, hy - 70); ctx.lineTo(hx + i * 9 + 46, hy + 10); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.beginPath(); ctx.moveTo(hx + i * 9, hy - 70); ctx.lineTo(hx + i * 9 - 46, hy + 10); ctx.stroke();
      }
      const crease = ctx.createLinearGradient(hx - 20, 0, hx + 20, 0); // vinco: sombra de um lado, luz do outro
      crease.addColorStop(0, 'rgba(0,0,0,0)'); crease.addColorStop(0.45, 'rgba(0,0,0,0.3)'); crease.addColorStop(0.55, 'rgba(255,255,255,0.18)'); crease.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = crease;
      ctx.beginPath(); ctx.moveTo(hx - 22, hy - 64); ctx.quadraticCurveTo(hx, hy - 40, hx - 4, hy - 26); ctx.lineTo(hx + 8, hy - 26); ctx.quadraticCurveTo(hx + 6, hy - 44, hx + 22, hy - 64); ctx.fill();
      // fita preta de gorgorão, com um brilho fino
      ctx.strokeStyle = '#0b0b0b';
      ctx.lineWidth = 12;
      ctx.beginPath(); ctx.ellipse(hx, hy - 20, 70, 15, 0, 0, Math.PI); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.16)';
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.ellipse(hx, hy - 25, 70, 15, 0, Math.PI * 0.15, Math.PI * 0.6); ctx.stroke();
      ctx.restore();
      ctx.fillStyle = '#0b0b0b'; // o laço, do lado esquerdo
      ctx.beginPath(); ctx.moveTo(hx - 58, hy - 16); ctx.lineTo(hx - 76, hy - 24); ctx.lineTo(hx - 74, hy - 8); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(hx - 58, hy - 16); ctx.lineTo(hx - 72, hy - 2); ctx.lineTo(hx - 62, hy - 4); ctx.closePath(); ctx.fill();
    }

    // pandeiro deitado: aro de madeira com as platinelas nas janelas e os afinadores de metal; pele por cima
    paintPandeiro(ctx, floorShadow, rand) {
      const P = PANDEIRO, depth = 15;
      floorShadow(P.x + 16, P.y + depth + 8, P.rx + 2, P.ry + 4, 14, 0.75);
      // lateral do aro
      const side = new Path2D();
      side.moveTo(P.x + P.rx, P.y);
      side.lineTo(P.x + P.rx, P.y + depth);
      side.ellipse(P.x, P.y + depth, P.rx, P.ry, 0, 0, Math.PI);
      side.lineTo(P.x - P.rx, P.y);
      side.ellipse(P.x, P.y, P.rx, P.ry, 0, Math.PI, 0, true);
      side.closePath();
      const wood = ctx.createLinearGradient(P.x - P.rx, 0, P.x + P.rx, 0);
      wood.addColorStop(0, '#0e0e0e'); wood.addColorStop(0.22, '#3a3a3a'); wood.addColorStop(0.38, '#5c5c5c');
      wood.addColorStop(0.6, '#2f2f2f'); wood.addColorStop(1, '#0c0c0c');
      ctx.fillStyle = wood;
      ctx.fill(side);
      ctx.save();
      ctx.clip(side);
      ctx.lineWidth = 0.7; // veios da madeira, acompanhando a curva
      for (let d = 1.5; d < depth; d += 1.6) {
        ctx.strokeStyle = `rgba(0,0,0,${0.18 + rand() * 0.2})`;
        ctx.beginPath(); ctx.ellipse(P.x, P.y + d, P.rx, P.ry, 0, 0.05, Math.PI - 0.05); ctx.stroke();
      }
      ctx.restore();
      // afinadores entre as janelas: hastes de metal com a porca embaixo
      for (let i = 0; i < 8; i++) {
        const a = Math.PI * (0.07 + (i * 0.86) / 7);
        const x = P.x + Math.cos(a) * P.rx, y = P.y + Math.sin(a) * P.ry;
        const m = ctx.createLinearGradient(x - 2, 0, x + 2, 0);
        m.addColorStop(0, '#5a5a5a'); m.addColorStop(0.4, '#efefef'); m.addColorStop(1, '#4a4a4a');
        ctx.fillStyle = m;
        ctx.fillRect(x - 1.3, y + 1, 2.6, depth - 3);
        ctx.fillRect(x - 2.6, y + depth - 5, 5.2, 4);
      }
      // janelas com as platinelas (pares de discos de metal, de lado)
      for (const j of this.jingles) {
        ctx.fillStyle = '#030303';
        ctx.beginPath(); ctx.ellipse(j.x, j.y, 10, 4.2, 0, 0, TAU); ctx.fill();
        for (const dx of [-3.4, 3.4]) {
          const g = ctx.createRadialGradient(j.x + dx - 1.2, j.y - 0.8, 0.2, j.x + dx, j.y, 4.2);
          g.addColorStop(0, '#ffffff'); g.addColorStop(0.35, '#c4c4c4'); g.addColorStop(1, '#4d4d4d');
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.ellipse(j.x + dx, j.y, 4, 2.6, 0, 0, TAU); ctx.fill();
        }
      }
      // aro de cima (madeira) e o aro de tensão de metal
      ctx.fillStyle = '#2b2b2b';
      ctx.beginPath(); ctx.ellipse(P.x, P.y, P.rx, P.ry, 0, 0, TAU); ctx.fill();
      const ring = ctx.createLinearGradient(P.x - P.rx, 0, P.x + P.rx, 0);
      ring.addColorStop(0, '#5a5a5a'); ring.addColorStop(0.3, '#f2f2f2'); ring.addColorStop(0.55, '#9a9a9a'); ring.addColorStop(1, '#3d3d3d');
      ctx.strokeStyle = ring;
      ctx.lineWidth = 3.4;
      ctx.beginPath(); ctx.ellipse(P.x, P.y, P.rx - 4, P.ry - 1.6, 0, 0, TAU); ctx.stroke();
      // pele: couro claro, com manchas e a marca de uso no meio
      const skin = ctx.createRadialGradient(P.x - 30, P.y - 12, 4, P.x, P.y, P.rx);
      skin.addColorStop(0, '#f1f1f1'); skin.addColorStop(0.6, '#d4d4d4'); skin.addColorStop(1, '#9c9c9c');
      const skinPath = new Path2D();
      skinPath.ellipse(P.x, P.y, P.rx - 8, P.ry - 3.6, 0, 0, TAU);
      ctx.fillStyle = skin;
      ctx.fill(skinPath);
      ctx.save();
      ctx.clip(skinPath);
      for (let i = 0; i < 26; i++) {
        const x = P.x + (rand() - 0.5) * P.rx * 1.7, y = P.y + (rand() - 0.5) * P.ry * 1.6;
        ctx.fillStyle = `rgba(90,90,90,${0.03 + rand() * 0.05})`;
        ctx.beginPath(); ctx.ellipse(x, y, 4 + rand() * 14, 2 + rand() * 4, rand() * 3, 0, TAU); ctx.fill();
      }
      ctx.fillStyle = 'rgba(70,70,70,0.08)';
      ctx.beginPath(); ctx.ellipse(P.x + 6, P.y + 2, 30, 9, 0, 0, TAU); ctx.fill();
      ctx.restore();
    }

    // partitura numa folha de verdade: título, claves, compasso, notas com colchete, marca de copo
    paintSheet(ctx, shade, noShade) {
      ctx.save();
      ctx.translate(800, 454);
      ctx.rotate(-0.06);
      shade(22, 8);
      const paper = ctx.createLinearGradient(-125, -46, 125, 46);
      paper.addColorStop(0, '#f6f6f6'); paper.addColorStop(0.7, '#e2e2e2'); paper.addColorStop(1, '#c4c4c4');
      ctx.fillStyle = paper;
      ctx.beginPath(); // canto de baixo levemente levantado
      ctx.moveTo(-125, -45); ctx.lineTo(125, -45); ctx.lineTo(125, 38); ctx.quadraticCurveTo(122, 45, 112, 46); ctx.lineTo(-125, 45); ctx.closePath();
      ctx.fill();
      noShade();
      const curl = ctx.createLinearGradient(104, 30, 125, 46);
      curl.addColorStop(0, 'rgba(0,0,0,0)'); curl.addColorStop(1, 'rgba(0,0,0,0.18)');
      ctx.fillStyle = curl;
      ctx.fillRect(100, 26, 26, 21);
      ctx.fillStyle = 'rgba(0,0,0,0.55)'; // título e autor
      ctx.fillRect(-34, -41, 68, 3.4);
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(58, -36, 40, 1.8);
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.lineWidth = 0.8;
      const staves = [-26, 10];
      for (const y0 of staves) {
        for (let l = 0; l < 5; l++) { ctx.beginPath(); ctx.moveTo(-110, y0 + l * 4.6); ctx.lineTo(110, y0 + l * 4.6); ctx.stroke(); }
        for (const x of [-110, -48, 14, 76, 110]) { ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y0 + 18.4); ctx.stroke(); }
        // clave de sol
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.moveTo(-101, y0 + 24); ctx.bezierCurveTo(-96, y0 + 26, -95, y0 + 19, -99, y0 + 18);
        ctx.bezierCurveTo(-105, y0 + 17, -106, y0 + 9, -100, y0 + 6); ctx.bezierCurveTo(-96, y0 + 3, -96, y0 - 4, -99, y0 - 5);
        ctx.bezierCurveTo(-103, y0 - 3, -101, y0 + 8, -98, y0 + 22);
        ctx.stroke();
        ctx.lineWidth = 0.8;
        ctx.fillStyle = 'rgba(0,0,0,0.75)'; // 4/4
        ctx.font = 'bold 8px Georgia, serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('4', -88, y0 + 4.6);
        ctx.fillText('4', -88, y0 + 13.8);
      }
      // notas: semínimas e pares de colcheias ligados pelo colchete
      ctx.fillStyle = 'rgba(0,0,0,0.85)';
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      const head = (x, y) => { ctx.beginPath(); ctx.ellipse(x, y, 2.9, 2.1, -0.4, 0, TAU); ctx.fill(); };
      const stem = (x, y, h = 13) => { ctx.fillRect(x + 2.2, y - h, 0.9, h); };
      const notes = [[-74, -17, 'q'], [-62, -21, 'q'], [-36, -14, 'b'], [-28, -19, 'b'], [-16, -12, 'q'], [-2, -21, 'q'],
        [26, -16, 'b'], [34, -12, 'b'], [46, -19, 'q'], [60, -23, 'q'], [86, -14, 'q'], [98, -17, 'q'],
        [-74, 21, 'b'], [-66, 17, 'b'], [-54, 14, 'q'], [-36, 19, 'q'], [-20, 12, 'b'], [-12, 16, 'b'],
        [24, 21, 'q'], [40, 14, 'q'], [56, 18, 'b'], [64, 22, 'b'], [86, 16, 'q'], [100, 12, 'q']];
      notes.forEach(([x, y, kind], i) => {
        head(x, y);
        stem(x, y);
        if (kind === 'b' && notes[i + 1] && notes[i + 1][2] === 'b' && (i === 0 || notes[i - 1][2] !== 'b' || i % 2 === 0)) {
          const [x2, y2] = notes[i + 1];
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(x + 2.6, y - 13); ctx.lineTo(x2 + 2.6, y2 - 13); ctx.stroke();
        }
      });
      // marca redonda de um copo molhado, como em toda mesa de bar
      ctx.strokeStyle = 'rgba(70,70,70,0.16)';
      ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.arc(70, 4, 19, 0.3, TAU - 0.5); ctx.stroke();
      ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.arc(71, 5, 16.5, 1.2, TAU - 0.2); ctx.stroke();
      ctx.restore();
    }

    // Violão clássico em pé na ponta da mesa, de frente: tampo de pinho com sombreado na borda e veios,
    // filete, boca com roseta, cavalete com rastilho e amarras, escala de ébano com trastes, mão com as
    // janelas e seis tarraxas, três bordões revestidos e três cordas de nylon. Medidas de um violão de
    // verdade (o braço encontra o corpo na casa 12).
    paintViolao(ctx, floorShadow, rand) {
      const gx = 1300, gy = 474; // pé do violão, em cima da mesa
      floorShadow(gx + 22, gy + 2, 70, 11, 14, 0.8);
      ctx.save();
      ctx.translate(gx, gy);
      ctx.rotate(0.09);
      ctx.scale(1.12, 1.12);
      const body = new Path2D();
      body.moveTo(0, 0);
      body.bezierCurveTo(34, 0, 58, -18, 58, -44);
      body.bezierCurveTo(58, -68, 37, -77, 37, -92);
      body.bezierCurveTo(37, -104, 47, -111, 47, -126);
      body.bezierCurveTo(47, -142, 30, -151, 12, -151);
      body.lineTo(-12, -151);
      body.bezierCurveTo(-30, -151, -47, -142, -47, -126);
      body.bezierCurveTo(-47, -111, -37, -104, -37, -92);
      body.bezierCurveTo(-37, -77, -58, -68, -58, -44);
      body.bezierCurveTo(-58, -18, -34, 0, 0, 0);
      body.closePath();
      // lateral aparecendo de leve do lado da sombra
      ctx.save();
      ctx.translate(4, 1);
      ctx.fillStyle = '#0d0d0d';
      ctx.fill(body);
      ctx.restore();
      // tampo: claro no meio e escurecendo na borda
      const top = ctx.createRadialGradient(-8, -70, 10, 0, -70, 92);
      top.addColorStop(0, '#d9d9d9'); top.addColorStop(0.55, '#b3b3b3'); top.addColorStop(0.85, '#7a7a7a'); top.addColorStop(1, '#3c3c3c');
      ctx.fillStyle = top;
      ctx.fill(body);
      ctx.save();
      ctx.clip(body);
      ctx.lineWidth = 0.5; // veios do pinho, no comprimento do violão
      for (let x = -60; x < 60; x += 1.6 + rand() * 1.4) {
        ctx.strokeStyle = `rgba(0,0,0,${0.05 + rand() * 0.06})`;
        ctx.beginPath(); ctx.moveTo(x, 2); ctx.bezierCurveTo(x + rand() - 0.5, -50, x + rand() - 0.5, -100, x, -155); ctx.stroke();
      }
      const sheen = ctx.createRadialGradient(-22, -52, 2, -22, -52, 42); // brilho do verniz
      sheen.addColorStop(0, 'rgba(255,255,255,0.38)'); sheen.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = sheen;
      ctx.fillRect(-70, -110, 100, 110);
      ctx.restore();
      ctx.lineWidth = 2.2; // filete claro na borda e o fio escuro de dentro
      ctx.strokeStyle = 'rgba(240,240,240,0.85)';
      ctx.stroke(body);
      ctx.save();
      ctx.clip(body);
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.translate(0, -75.5);
      ctx.scale(0.955, 0.97);
      ctx.translate(0, 75.5);
      ctx.stroke(body);
      ctx.restore();
      // boca com a roseta de mosaico
      const hy = -108;
      for (const [r, c, w] of [[19.5, 'rgba(0,0,0,0.75)', 2.4], [17.3, 'rgba(255,255,255,0.8)', 1], [15.6, 'rgba(0,0,0,0.7)', 1.6]]) {
        ctx.strokeStyle = c; ctx.lineWidth = w;
        ctx.beginPath(); ctx.arc(0, hy, r, 0, TAU); ctx.stroke();
      }
      ctx.save();
      ctx.setLineDash([1.4, 1.2]);
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(0, hy, 19.5, 0, TAU); ctx.stroke();
      ctx.restore();
      const hole = ctx.createRadialGradient(-3, hy - 3, 2, 0, hy, 14);
      hole.addColorStop(0, '#151515'); hole.addColorStop(1, '#020202');
      ctx.fillStyle = hole;
      ctx.beginPath(); ctx.arc(0, hy, 13.6, 0, TAU); ctx.fill();
      // cavalete de jacarandá: rastilho de osso e as amarras das cordas
      const br = ctx.createLinearGradient(0, -42, 0, -30);
      br.addColorStop(0, '#3a3a3a'); br.addColorStop(1, '#0c0c0c');
      ctx.fillStyle = br;
      ctx.beginPath();
      ctx.moveTo(-30, -33); ctx.quadraticCurveTo(-30, -41, -22, -41); ctx.lineTo(22, -41); ctx.quadraticCurveTo(30, -41, 30, -33);
      ctx.lineTo(28, -30); ctx.lineTo(-28, -30); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#efefef';
      ctx.fillRect(-13, -39.4, 26, 1.6);
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      for (let i = 0; i < 6; i++) ctx.fillRect(-10.5 + i * 4.2 - 0.8, -35, 1.6, 3);
      // braço e escala de ébano (do corpo até a pestana), com os trastes pela regra das 12 casas
      const saddle = -38.6, nut = saddle - 227;
      const fretY = (n) => nut + 227 * (1 - Math.pow(2, -n / 12));
      ctx.fillStyle = '#1a1a1a'; // braço por trás da escala
      ctx.beginPath(); ctx.moveTo(-14.5, -151); ctx.lineTo(-12.6, nut); ctx.lineTo(12.6, nut); ctx.lineTo(14.5, -151); ctx.closePath(); ctx.fill();
      const fb = ctx.createLinearGradient(-14, 0, 14, 0);
      fb.addColorStop(0, '#080808'); fb.addColorStop(0.35, '#2e2e2e'); fb.addColorStop(0.65, '#1c1c1c'); fb.addColorStop(1, '#060606');
      ctx.fillStyle = fb;
      ctx.beginPath(); ctx.moveTo(-14, -126); ctx.lineTo(-11.8, nut); ctx.lineTo(11.8, nut); ctx.lineTo(14, -126); ctx.closePath(); ctx.fill();
      for (let n = 1; n <= 19; n++) {
        const y = fretY(n);
        if (y > -127) break;
        const half = 11.8 + (14 - 11.8) * ((y - nut) / (-126 - nut));
        ctx.fillStyle = '#a6a6a6'; ctx.fillRect(-half, y - 0.7, half * 2, 1.4);
        ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.fillRect(-half, y - 0.7, half * 2, 0.5);
      }
      ctx.fillStyle = '#ececec'; // pestana de osso
      ctx.fillRect(-12.2, nut - 2.4, 24.4, 2.6);
      // mão: madeira escura com crista no topo, duas janelas e seis tarraxas
      const head = new Path2D();
      head.moveTo(-12.6, nut - 2);
      head.lineTo(-16.5, nut - 50);
      head.quadraticCurveTo(-9, nut - 56, 0, nut - 52);
      head.quadraticCurveTo(9, nut - 56, 16.5, nut - 50);
      head.lineTo(12.6, nut - 2);
      head.closePath();
      const hg = ctx.createLinearGradient(-17, 0, 17, 0);
      hg.addColorStop(0, '#0a0a0a'); hg.addColorStop(0.4, '#353535'); hg.addColorStop(1, '#090909');
      ctx.fillStyle = hg;
      ctx.fill(head);
      ctx.fillStyle = '#000';
      ctx.fillRect(-9.5, nut - 44, 5.4, 36);
      ctx.fillRect(4.1, nut - 44, 5.4, 36);
      const rows = [nut - 14, nut - 25, nut - 36];
      for (const y of rows) {
        for (const s of [-1, 1]) {
          ctx.fillStyle = '#efefef'; // rolete na janela
          ctx.fillRect(s * 6.8 - 2.3, y - 1.4, 4.6, 2.8);
          ctx.strokeStyle = '#8c8c8c'; ctx.lineWidth = 1.6; // eixo saindo pelo lado
          ctx.beginPath(); ctx.moveTo(s * 15, y); ctx.lineTo(s * 22, y); ctx.stroke();
          const btn = ctx.createRadialGradient(s * 25 - 1, y - 1, 0.4, s * 25, y, 4.4);
          btn.addColorStop(0, '#ffffff'); btn.addColorStop(1, '#9a9a9a');
          ctx.fillStyle = btn;
          ctx.beginPath(); ctx.ellipse(s * 25, y, 3.8, 3, 0, 0, TAU); ctx.fill();
        }
      }
      // cordas: bordões à esquerda (mais grossos e claros), nylon à direita; cada uma com a sua sombra
      const atSaddle = [-10.5, -6.3, -2.1, 2.1, 6.3, 10.5];
      const atNut = [-9.4, -5.6, -1.9, 1.9, 5.6, 9.4];
      const toRoller = [[-6.8, rows[2]], [-6.8, rows[1]], [-6.8, rows[0]], [6.8, rows[0]], [6.8, rows[1]], [6.8, rows[2]]];
      atSaddle.forEach((x, i) => {
        const bass = i < 3, w = bass ? 1.2 - i * 0.14 : 0.72 - (i - 3) * 0.07;
        ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = w;
        ctx.beginPath(); ctx.moveTo(x + 1.3, saddle); ctx.lineTo(atNut[i] + 1.3, nut); ctx.stroke();
        ctx.strokeStyle = bass ? 'rgba(248,248,248,0.95)' : 'rgba(225,225,225,0.8)';
        ctx.beginPath(); ctx.moveTo(x, -33); ctx.lineTo(x, saddle); ctx.lineTo(atNut[i], nut); ctx.lineTo(toRoller[i][0], toRoller[i][1]); ctx.stroke();
      });
      ctx.restore();
    }

    // tamborim: aro de metal com os parafusos de afinar, pele branca, e a baqueta de varetas
    paintTamborim(ctx, floorShadow, ellipse) {
      const tx = 128, ty = 449, rx = 50, ry = 16, depth = 9;
      floorShadow(tx + 10, ty + depth + 6, rx + 2, ry + 3, 10, 0.75);
      const side = ctx.createLinearGradient(tx - rx, 0, tx + rx, 0);
      side.addColorStop(0, '#0c0c0c'); side.addColorStop(0.3, '#5a5a5a'); side.addColorStop(0.45, '#2a2a2a'); side.addColorStop(1, '#080808');
      ctx.fillStyle = side;
      ctx.beginPath();
      ctx.moveTo(tx + rx, ty); ctx.lineTo(tx + rx, ty + depth);
      ctx.ellipse(tx, ty + depth, rx, ry, 0, 0, Math.PI);
      ctx.lineTo(tx - rx, ty);
      ctx.ellipse(tx, ty, rx, ry, 0, Math.PI, 0, true);
      ctx.closePath();
      ctx.fill();
      for (let i = 0; i < 6; i++) { // parafusos de afinar
        const a = Math.PI * (0.1 + (i * 0.8) / 5);
        const x = tx + Math.cos(a) * rx, y = ty + Math.sin(a) * ry;
        ctx.fillStyle = '#bdbdbd'; ctx.fillRect(x - 1.6, y + 1, 3.2, depth - 2);
        ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.fillRect(x - 1.6, y + 1, 1, depth - 2);
      }
      ellipse(tx, ty, rx, ry, '#151515');
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.ellipse(tx, ty, rx - 1, ry - 0.5, 0, Math.PI * 1.08, Math.PI * 1.92); ctx.stroke();
      const tskin = ctx.createRadialGradient(tx - 14, ty - 5, 2, tx, ty, rx);
      tskin.addColorStop(0, '#f6f6f6'); tskin.addColorStop(1, '#a3a3a3');
      ellipse(tx, ty, rx - 5, ry - 2.4, tskin);
      // baqueta de tamborim: três varetas de plástico presas no cabo com fita
      ctx.lineCap = 'round';
      for (const off of [-2.6, 0, 2.6]) {
        ctx.strokeStyle = '#0a0a0a'; ctx.lineWidth = 2.2;
        ctx.beginPath(); ctx.moveTo(118, 461 + off * 0.4); ctx.lineTo(214, 430 + off); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 0.6;
        ctx.beginPath(); ctx.moveTo(120, 460 + off * 0.4); ctx.lineTo(212, 429 + off); ctx.stroke();
      }
      ctx.strokeStyle = '#1b1b1b'; ctx.lineWidth = 7.5; // cabo com fita
      ctx.beginPath(); ctx.moveTo(62, 486); ctx.lineTo(120, 462); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 1;
      for (let i = 0; i < 9; i++) { // voltas da fita
        const u = i / 9, x = 64 + u * 52, y = 485 - u * 22;
        ctx.beginPath(); ctx.moveTo(x - 1.4, y - 3.4); ctx.lineTo(x + 1.6, y + 3.2); ctx.stroke();
      }
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
