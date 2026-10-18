// Pista do braço: o desenho de cada acorde (a formação, com a pestana e tudo, a mesma do cartão "Como
// tocar": shapeFor no chords.js) deitado no braço do instrumento, como ele é de verdade. Embaixo fica o braço
// real (casas com o espaçamento de verdade, marcações, nome das cordas; a corda mais grave em cima, como o
// braço visto por quem toca). Cada acorde que vem chega do fundo como um braço pequeno com o desenho dele,
// crescendo, e pousa no braço de verdade na hora de tocar; aí fica na cor da música enquanto soa.
// Histórico: nota por nota com número (reprovado: "muita coisa"), cartão com diagrama ("quadrado grande"),
// faixas de corda com bolinhas no jeito do Guitar Hero ("não precisa imitar; quero o desenho no braço").
// - Em pé (orient 'v', Modo Show): com o jogo valendo pontos, os indicadores em cima (pontos,
//   multiplicador, sequência de acertos e o medidor da plateia); o acerto do microfone (game.js confere cada
//   tempo contra o acorde) faz o desenho no braço soltar raios.
// - Deitada (orient 'h', "Tocando agora", em cima da partitura): o mesmo, mais baixo.
// - Teclado: o mesmo com um teclado no lugar do braço. "Voz" (só no show): a melodia caindo sobre teclas.
// Preto e branco; a cor da música só no acorde de agora e nos indicadores.
// Canvas a 30 quadros, sem desfoque nem sombra (o computador do usuário é fraco); parado, não redesenha.
(function () {
  'use strict';

  // da corda mais grave (em cima no braço) para a mais aguda; espessura de cada corda
  const STRINGS = {
    violao: { names: ['Mi', 'Lá', 'Ré', 'Sol', 'Si', 'Mi'], widths: [3, 2.5, 2.1, 1.7, 1.3, 1.1] },
    cavaco: { names: ['Ré', 'Sol', 'Si', 'Ré'], widths: [2, 1.7, 1.4, 1.2] },
    baixo: { names: ['Mi', 'Lá', 'Ré', 'Sol'], widths: [4.2, 3.5, 2.9, 2.3] },
  };
  const BLACK = new Set([1, 3, 6, 8, 10]);
  const WHITE = [255, 255, 255];
  const SANS = 'Figtree, "Segoe UI", system-ui, sans-serif';
  const SERIF = 'Fraunces, Georgia, serif';
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  // posição de uma casa ao longo da corda (regra das 12 notas: as casas vão ficando mais curtas)
  const fretPos = (f) => 1 - Math.pow(2, -f / 12);

  // texto em cima da cor da música: preto ou branco, o de mais contraste (mesma conta da WCAG do inkFor do
  // app.js, para combinar com o --song-ink dos botões)
  function inkOn(c) {
    const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const L = 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
    return (L + 0.05) / 0.05 >= 1.05 / (L + 0.05) ? '#000' : '#fff';
  }

  function firstFrom(V, from, back = 4) {
    let lo = 0, hi = V.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (V[mid][0] < from - back) lo = mid + 1; else hi = mid; }
    return lo;
  }

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function line(ctx, x0, y0, x1, y1) {
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }

  // formação do acorde no instrumento (cache por acorde: a lista de acordes só muda com a música/nível)
  const shapeCache = new WeakMap();
  function shapeOf(c, inst) {
    if (!c || c.kind === 'N' || !window.ChordDiagram || !window.ChordDiagram.shapeFor) return null;
    let m = shapeCache.get(c);
    if (!m) shapeCache.set(c, (m = new Map()));
    if (!m.has(inst)) m.set(inst, window.ChordDiagram.shapeFor(c, inst));
    return m.get(inst);
  }

  // acorde que está soando no tempo b
  function chordNow(chords, b) {
    let lo = 0, hi = chords.length - 1, i = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (chords[mid].start_beat <= b) { i = mid; lo = mid + 1; } else hi = mid - 1; }
    return i >= 0 && b < chords[i].end_beat && chords[i].kind !== 'N' ? chords[i] : null;
  }

  // a casa mais alta que a música usa nesse instrumento (cache por lista): define se o braço fica parado
  const reachCache = new WeakMap();
  function songReach(chords, inst) {
    let m = reachCache.get(chords);
    if (!m) reachCache.set(chords, (m = new Map()));
    if (!m.has(inst)) {
      let hi = 0;
      for (const c of chords) {
        const sh = shapeOf(c, inst);
        if (sh && sh.frets) for (const f of sh.frets) if (f !== null && f > hi) hi = f;
      }
      m.set(inst, hi);
    }
    return m.get(inst);
  }

  // teclas que os acordes da música usam (cache por lista): a faixa do teclado desenhado
  const keySpanCache = new WeakMap();
  function keySpan(chords) {
    if (keySpanCache.has(chords)) return keySpanCache.get(chords);
    let lo = 127, hi = 0;
    for (const c of chords) {
      const sh = shapeOf(c, 'teclado');
      if (sh && sh.keys) for (const m of [...sh.keys.left, ...sh.keys.right]) { lo = Math.min(lo, m); hi = Math.max(hi, m); }
    }
    let span = hi < lo ? [48, 71] : [Math.floor(lo / 12) * 12, Math.ceil((hi + 1) / 12) * 12 - 1];
    if (span[1] - span[0] < 23) span = [span[0], span[0] + 23];
    keySpanCache.set(chords, span);
    return span;
  }

  class Highway {
    // source() devolve { b, ahead, inst, chords, notes (só a voz), color, flash, game } ou null; b e ahead em
    // tempos; game = { score, combo, mult, energy } com o jogo valendo pontos ligado
    constructor(canvas, source, opts = {}) {
      this.c = canvas;
      this.ctx = canvas.getContext('2d');
      this.source = source;
      this.orient = opts.orient || 'v';
      this.minFrame = 1000 / 30;
      this.lastFrame = 0;
      this.running = false;
      this.W = 0;
      this.H = 0;
      this.view = null; // 1ª casa à vista no braço (anda devagar quando muda)
      this.moving = false;
      this.loop = this.loop.bind(this);
      this.ro = new ResizeObserver(() => this.resize());
      this.ro.observe(canvas);
      this.resize();
    }

    resize() {
      const r = this.c.getBoundingClientRect();
      if (!r.width || !r.height) return;
      this.dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      this.W = r.width;
      this.H = r.height;
      this.c.width = Math.max(1, Math.round(r.width * this.dpr));
      this.c.height = Math.max(1, Math.round(r.height * this.dpr));
      this.lastFrame = 0;
      this.lastKey = null;
    }

    start() {
      if (this.running) return;
      this.running = true;
      this.resize();
      requestAnimationFrame(this.loop);
    }

    stop() { this.running = false; }

    loop(now) {
      if (!this.running) return;
      if (this.c.offsetParent !== null && !document.hidden && now - this.lastFrame >= this.minFrame - 2) {
        this.lastFrame = now;
        if (!this.W) this.resize();
        const st = this.source();
        // parado (pausa): só redesenha quando algo muda (outra lista de acordes, pontos do jogo, o braço andando)
        const g = st && st.game;
        const key = st ? `${st.b.toFixed(4)}|${st.inst}|${st.color}|${this.W}x${this.H}|${g ? `${g.score},${g.combo},${g.energy}` : ''}` : '-';
        const flashing = st && st.flash && now - st.flash.at < 620;
        const lists = st && (st.chords !== this.lastChords || st.notes !== this.lastNotes);
        if (key !== this.lastKey || flashing || lists || this.moving) {
          this.lastKey = key;
          this.lastChords = st && st.chords;
          this.lastNotes = st && st.notes;
          this.draw(now, st);
        }
      }
      requestAnimationFrame(this.loop);
    }

    // altura que a pista deitada precisa (CSS px): o braço (ou teclado) e o espaço de onde os acordes chegam
    static flatHeight(narrow, inst) {
      const cfg = STRINGS[inst];
      const board = cfg ? cfg.names.length * (narrow ? 17 : 20) : (narrow ? 58 : 70);
      return Math.round(board + (narrow ? 70 : 84) + 18);
    }

    draw(now, st) {
      const ctx = this.ctx;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, this.W, this.H);
      this.moving = false;
      if (!st || !this.W) return;
      const voice = st.inst === 'voz';
      const empty = voice ? !(st.notes && st.notes.length) : !(st.chords || []).some((c) => c.kind !== 'N');
      if (empty) {
        ctx.fillStyle = 'rgba(255,255,255,.6)';
        ctx.font = `600 15px ${SANS}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(voice ? 'A voz não aparece nesta música' : 'Esta música não tem acordes', this.W / 2, this.H / 2);
        return;
      }
      if (voice) this.drawVoice(now, st);
      else this.drawBoard(now, st);
    }

    // 1ª casa à vista: parada se a música inteira cabe nas casas à vista; senão acompanha o acorde de agora
    // e o próximo, andando devagar
    fretWindow(chords, inst, cur, next, count, now) {
      let target = 1;
      if (songReach(chords, inst) > count) {
        const fr = (c) => { const sh = c && shapeOf(c, inst); return sh && sh.frets ? sh.frets.filter((f) => f !== null && f > 0) : []; };
        let used = [...fr(cur), ...fr(next)];
        const fit = (u) => {
          if (!u.length) return 1;
          const lo = Math.min(...u), hi = Math.max(...u);
          let s = Math.max(1, lo - 1);
          if (hi > s + count - 1) s = hi - count + 1;
          return s > lo ? null : s;
        };
        target = fit(used);
        if (target === null) target = fit(fr(cur)) || 1;
      }
      if (this.view === null || this.viewInst !== inst) { this.view = target; this.viewInst = inst; }
      const dt = Math.min(0.1, (now - (this.viewAt || now)) / 1000);
      this.viewAt = now;
      this.view += (target - this.view) * Math.min(1, dt * 7);
      if (Math.abs(target - this.view) < 0.01) this.view = target;
      else this.moving = true;
      return this.view;
    }

    // ---------------------------------------------------------------- braço (ou teclado) e os acordes chegando
    drawBoard(now, st) {
      const compact = this.orient === 'h';
      const ctx = this.ctx, W = this.W, H = this.H;
      const keys = st.inst === 'teclado';
      const cfg = STRINGS[st.inst] || STRINGS.violao, n = cfg.names.length;
      const col = st.color || WHITE, ink = inkOn(col);
      const narrow = W < 640;
      const { b, ahead } = st, chords = st.chords || [];
      const cur = chordNow(chords, b);
      let next = null;
      const coming = [];
      for (const c of chords) {
        if (c.start_beat > b + ahead) break;
        if (c.kind === 'N' || c.start_beat <= b) continue;
        if (!next) next = c;
        coming.push(c);
      }

      // em cima: indicadores do jogo (show) e o nome do acorde de agora
      let top = compact ? 2 : narrow ? 38 : 46;
      if (st.game && !compact) top = this.drawHud(st.game, col, top, narrow) + 8;
      const nameSize = compact ? (narrow ? 15 : 17) : narrow ? 22 : 30;
      const padX = compact ? 4 : narrow ? 10 : 28;
      const numH = keys ? 6 : compact ? 14 : 20; // números das casas embaixo do braço
      const room = H - top - numH - 4;
      const boardH = keys
        ? clamp((W - 2 * padX) * 0.14, compact ? 46 : 60, room * 0.5)
        : clamp(n * (compact ? (narrow ? 17 : 20) : narrow ? 28 : 38), 50, room * 0.56);
      // à esquerda do braço: o nome das cordas e, antes da pestana do braço, os anéis (solta) e × (não toca)
      const rEst = clamp((boardH / n) * 0.4, 4, 17);
      const labelW = keys ? 0 : (compact ? (narrow ? 24 : 30) : narrow ? 30 : 40) + rEst * 1.9 + 6;
      const nx0 = padX + labelW, nx1 = W - padX;
      const ny1 = H - numH - 2, ny0 = ny1 - boardH;
      const nameY = top + 2;
      const zoneTop = top + nameSize + 8; // de onde os acordes chegam
      // braço pequeno de um acorde que vem: escala k, borda de baixo em `bottom`, centrado no braço
      const vx = (nx0 + nx1) / 2;
      const kMax = clamp((ny0 - 8 - zoneTop) / boardH, 0.2, 0.55), kMin = kMax * 0.4;
      const T = (k, bottom) => (x, y) => [vx + (x - vx) * k, bottom - (ny1 - y) * k];

      // geometria do braço (ou do teclado) em coordenadas do braço de verdade
      let geo;
      if (keys) {
        const [lo, hi] = keySpan(chords);
        const whites = [];
        for (let m = lo; m <= hi; m++) if (!BLACK.has(m % 12)) whites.push(m);
        const kw = (nx1 - nx0) / whites.length;
        const keyX = new Map();
        whites.forEach((m, i) => keyX.set(m, [nx0 + i * kw, kw, false]));
        for (let m = lo; m <= hi; m++) {
          if (BLACK.has(m % 12) && keyX.has(m - 1)) keyX.set(m, [keyX.get(m - 1)[0] + kw * 0.68, kw * 0.64, true]);
        }
        geo = { keys: true, inst: st.inst, lo, hi, whites, keyX, kw, ny0, boardH };
      } else {
        const count = narrow ? 5 : 7;
        const fs = this.fretWindow(chords, st.inst, cur, next, count, now);
        const F0 = fs - 1, F1 = F0 + count, p0 = fretPos(F0), p1 = fretPos(F1);
        const fx = (F) => nx0 + ((fretPos(F) - p0) / (p1 - p0)) * (nx1 - nx0);
        const gap = boardH / n;
        const sy = (i) => ny0 + (i + 0.5) * gap;
        const R = clamp(Math.min(gap * 0.4, (fx(F1) - fx(F1 - 1)) * 0.3), 4, 17);
        geo = { keys: false, inst: st.inst, F0, F1, fx, sy, gap, R, dotX: (f) => fx(f - 1) + (fx(f) - fx(f - 1)) * 0.56 };
      }

      // linhas de fuga: dos cantos do braço até o fundo, de onde os acordes vêm
      const far = T(kMin, zoneTop + boardH * kMin);
      ctx.fillStyle = 'rgba(0,0,0,.45)';
      ctx.beginPath();
      ctx.moveTo(nx0, ny0);
      ctx.lineTo(...far(nx0, ny0));
      ctx.lineTo(...far(nx1, ny0));
      ctx.lineTo(nx1, ny0);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.14)';
      ctx.lineWidth = 1;
      line(ctx, nx0, ny0, ...far(nx0, ny0));
      line(ctx, nx1, ny0, ...far(nx1, ny0));

      // o braço de verdade
      this.boardBase(geo, T(1, ny1), 1, true, cfg, n, col, cur, compact, narrow, nx0, nx1, ny0, ny1);

      // os acordes que vêm (o próximo e, no show, o seguinte): do mais longe para o mais perto; perto da hora,
      // pousam no braço
      const LAND = 0.07;
      coming.splice(compact ? 1 : 2);
      for (let j = coming.length - 1; j >= 0; j--) {
        const c = coming[j], u = (c.start_beat - b) / ahead;
        const sh = shapeOf(c, st.inst);
        if (!sh) continue;
        let k, bottom, a;
        if (u > LAND) {
          const t = clamp((1 - u) / (1 - LAND), 0, 1), e = t * t; // acelera chegando, como em perspectiva
          k = kMin + (kMax - kMin) * e;
          bottom = zoneTop + boardH * kMin + (ny0 - 6 - zoneTop - boardH * kMin) * e;
          a = clamp((1 - u) / 0.25, 0, 1) * (j === 0 ? 1 : 0.55); // o de depois do próximo, mais apagado
        } else { // pousando
          const t = 1 - u / LAND;
          k = kMax + (1 - kMax) * t;
          bottom = ny0 - 6 + (ny1 - ny0 + 6) * t;
          a = 1;
        }
        const tr = T(k, bottom);
        this.boardBase(geo, tr, k, false, cfg, n, col, null, compact, narrow, nx0, nx1, ny0, ny1, a);
        this.shape(geo, tr, k, sh, false, col, a);
        // nome do acorde em cima do braço pequeno
        const [lx, ly] = tr(nx0, ny0);
        ctx.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`;
        ctx.font = `650 ${Math.round(clamp(nameSize * 0.75 * Math.sqrt(k / kMax), 10, nameSize))}px ${SERIF}`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        ctx.fillText(c.display, lx, ly - 3);
      }

      // o acorde de agora no braço, na cor da música; o acerto do microfone solta raios dele
      if (cur) {
        const sh = shapeOf(cur, st.inst);
        if (sh) this.shape(geo, T(1, ny1), 1, sh, true, col, 1, ink);
        const fl = st.flash && now - st.flash.at < 600 ? st.flash : null;
        if (fl && sh && (fl.result === 'perfect' || fl.result === 'good')) this.rays(geo, sh, col, (now - fl.at) / 600);
        if (fl && (fl.result === 'miss' || fl.result === 'silence')) {
          ctx.fillStyle = `rgba(255,255,255,${(0.1 * (1 - (now - fl.at) / 600)).toFixed(3)})`;
          ctx.fillRect(nx0, ny0, nx1 - nx0, ny1 - ny0);
        }
      }
      // nome do acorde de agora, grande (o que vem já aparece no braço pequeno, com o nome)
      if (cur) {
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillStyle = rgba(col, 1);
        ctx.font = `650 ${nameSize}px ${SERIF}`;
        ctx.fillText(cur.display, padX + (compact ? 0 : 4), nameY);
      }
    }

    // o braço (ou teclado): madeira escura, casas, pestana do braço (nut), marcações, cordas.
    // `real`: o braço de verdade (com nome das cordas e números das casas); senão um braço pequeno que vem
    boardBase(geo, tr, k, real, cfg, n, col, cur, compact, narrow, nx0, nx1, ny0, ny1, alpha = 1) {
      const ctx = this.ctx;
      const [x0, y0] = tr(nx0, ny0), [x1, y1] = tr(nx1, ny1);
      const a = alpha.toFixed(3);
      if (geo.keys) {
        for (const m of geo.whites) {
          const [kx, kw] = geo.keyX.get(m);
          const [ax] = tr(kx, ny0), [bx] = tr(kx + kw, ny0);
          ctx.fillStyle = `rgba(232,232,232,${real ? 1 : (0.85 * alpha).toFixed(3)})`;
          ctx.fillRect(ax + 0.5, y0, bx - ax - 1, y1 - y0);
        }
        for (let m = geo.lo; m <= geo.hi; m++) {
          const kk = geo.keyX.get(m);
          if (!kk || !kk[2]) continue;
          const [ax] = tr(kk[0], ny0), [bx] = tr(kk[0] + kk[1], ny0);
          ctx.fillStyle = `rgba(17,17,17,${real ? 1 : a})`;
          ctx.fillRect(ax, y0, bx - ax, (y1 - y0) * 0.6);
        }
        return;
      }
      ctx.fillStyle = real ? '#171717' : `rgba(16,16,16,${(0.88 * alpha).toFixed(3)})`;
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      ctx.strokeStyle = `rgba(255,255,255,${(real ? 0.28 : 0.3 * alpha).toFixed(3)})`;
      ctx.lineWidth = 1;
      ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
      // marcações do braço (3, 5, 7, 9; duas na 12), bem de leve para não parecerem notas; só no de verdade
      for (const F of real ? [3, 5, 7, 9, 12, 15] : []) {
        if (F - 0.5 < geo.F0 || F - 0.5 > geo.F1) continue;
        const mx = (geo.fx(F - 1) + geo.fx(F)) / 2;
        const ys = F === 12 ? [ny0 + (ny1 - ny0) * 0.3, ny0 + (ny1 - ny0) * 0.7] : [(ny0 + ny1) / 2];
        ctx.fillStyle = 'rgba(255,255,255,.05)';
        for (const yy of ys) {
          const [px, py] = tr(mx, yy);
          ctx.beginPath();
          ctx.arc(px, py, Math.max(1.5, geo.gap * 0.17 * k), 0, Math.PI * 2);
          ctx.fill();
        }
      }
      // trastes; no começo do braço, a pestana do braço (nut) grossa
      for (let F = Math.ceil(geo.F0); F <= Math.floor(geo.F1); F++) {
        const [px] = tr(geo.fx(F), ny0);
        if (F === 0) {
          ctx.fillStyle = `rgba(235,235,235,${a})`;
          ctx.fillRect(px - 3 * k, y0, Math.max(2, 6 * k), y1 - y0);
        } else {
          ctx.strokeStyle = `rgba(190,190,190,${(0.55 * alpha).toFixed(3)})`;
          ctx.lineWidth = Math.max(1, 2 * k);
          line(ctx, px, y0, px, y1);
        }
      }
      // cordas (a mais grave em cima)
      for (let i = 0; i < n; i++) {
        const [, py] = tr(nx0, geo.sy(i));
        ctx.strokeStyle = `rgba(255,255,255,${(0.6 * alpha).toFixed(3)})`;
        ctx.lineWidth = Math.max(0.6, cfg.widths[i] * (compact ? 0.6 : 0.85) * k);
        line(ctx, x0, py, x1, py);
      }
      if (!real) return;
      // nome das cordas à esquerda (aceso se o acorde de agora toca nela) e o número das casas embaixo
      const sh = cur ? shapeOf(cur, geo.inst) : null;
      ctx.textBaseline = 'middle';
      for (let i = 0; i < n; i++) {
        const plays = !!(sh && sh.frets && sh.frets[i] !== null);
        ctx.fillStyle = plays ? rgba(col, 1) : 'rgba(255,255,255,.7)';
        ctx.font = `${plays ? 800 : 600} ${compact ? (narrow ? 11 : 12) : narrow ? 12 : 15}px ${SANS}`;
        ctx.textAlign = 'right';
        ctx.fillText(cfg.names[i], nx0 - geo.R * 1.9 - 6, geo.sy(i) + 0.5);
      }
      ctx.fillStyle = 'rgba(255,255,255,.45)';
      ctx.font = `700 ${compact ? 10 : narrow ? 11 : 13}px ${SANS}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      for (let F = Math.max(1, Math.ceil(geo.F0 + 0.5)); F <= Math.floor(geo.F1 + 0.5); F++) {
        const mx = (geo.fx(F - 1) + geo.fx(F)) / 2;
        if (mx < nx0 || mx > nx1) continue;
        ctx.fillText(String(F), mx, ny1 + 3);
      }
    }

    // o desenho do acorde: bolinhas nas casas, pestana, cordas soltas (anel) e que não tocam (×) antes do
    // braço; no teclado, as teclas marcadas
    shape(geo, tr, k, sh, on, col, alpha, ink) {
      const ctx = this.ctx;
      const fill = on ? rgba(col, alpha) : `rgba(255,255,255,${(0.95 * alpha).toFixed(3)})`;
      if (geo.keys) {
        if (!sh.keys) return;
        for (const m of [...sh.keys.left, ...sh.keys.right]) {
          const kk = geo.keyX.get(m);
          if (!kk) continue;
          const [ax] = tr(kk[0], 0), [bx] = tr(kk[0] + kk[1], 0);
          const top = tr(0, geo.ny0)[1], bot = tr(0, geo.ny0 + (kk[2] ? geo.boardH * 0.6 : geo.boardH))[1];
          const r = Math.max(2, Math.min((bx - ax) * 0.32, (bot - top) * 0.2));
          ctx.fillStyle = on ? (col === WHITE ? '#555' : rgba(col, alpha)) : kk[2] ? `rgba(255,255,255,${alpha.toFixed(3)})` : `rgba(30,30,30,${alpha.toFixed(3)})`;
          if (on) { // tecla de agora pintada inteira
            ctx.fillRect(ax + (kk[2] ? 0 : 0.5), top, bx - ax - (kk[2] ? 0 : 1), bot - top);
          } else { // tecla do acorde que vem: bolinha no pé da tecla
            ctx.beginPath();
            ctx.arc((ax + bx) / 2, bot - r - 3 * k, r, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        return;
      }
      if (!sh.frets) return;
      const R = geo.R * k;
      if (sh.barre && sh.barre.f - 0.5 >= geo.F0 && sh.barre.f - 0.5 <= geo.F1) {
        const [px, y0] = tr(geo.dotX(sh.barre.f), geo.sy(sh.barre.from));
        const [, y1] = tr(0, geo.sy(sh.barre.to));
        ctx.fillStyle = fill;
        roundRect(ctx, px - R * 0.85, y0 - R * 0.85, R * 1.7, y1 - y0 + R * 1.7, R * 0.85);
        ctx.fill();
      }
      sh.frets.forEach((f, i) => {
        const [, py] = tr(0, geo.sy(i));
        const [nutX] = tr(geo.fx(Math.max(geo.F0, 0)), 0);
        if (f === null) { // não toca: × antes do braço
          const s = R * 0.45, cx = nutX - R * 0.95;
          ctx.strokeStyle = `rgba(255,255,255,${(0.5 * alpha).toFixed(3)})`;
          ctx.lineWidth = Math.max(1, 1.8 * k);
          line(ctx, cx - s, py - s, cx + s, py + s);
          line(ctx, cx - s, py + s, cx + s, py - s);
          return;
        }
        if (f === 0) { // solta: anel antes do braço
          ctx.strokeStyle = fill;
          ctx.lineWidth = Math.max(1.2, 2.4 * k);
          ctx.beginPath();
          ctx.arc(nutX - R * 0.95, py, R * 0.55, 0, Math.PI * 2);
          ctx.stroke();
          return;
        }
        if (f - 0.5 < geo.F0 || f - 0.5 > geo.F1) return; // fora das casas à vista
        if (sh.barre && f === sh.barre.f && i >= sh.barre.from && i <= sh.barre.to) return; // já na pestana
        const [px] = tr(geo.dotX(f), 0);
        ctx.fillStyle = fill;
        ctx.beginPath();
        ctx.arc(px, py, R, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    // acertou (microfone): raios saindo das bolinhas do acorde de agora
    rays(geo, sh, col, t) {
      const ctx = this.ctx;
      ctx.strokeStyle = rgba(col, 0.9 * (1 - t));
      ctx.lineWidth = 2;
      const pts = [];
      if (geo.keys) return;
      if (!sh.frets) return;
      sh.frets.forEach((f, i) => { if (f !== null && f > 0 && f - 0.5 >= geo.F0 && f - 0.5 <= geo.F1) pts.push([geo.dotX(f), geo.sy(i)]); });
      for (const [x, y] of pts) {
        for (let r = 0; r < 8; r++) {
          const ang = (r / 8) * Math.PI * 2, d0 = geo.R * (1.2 + t * 0.5), d1 = geo.R * (1.8 + t * 1.2);
          line(ctx, x + Math.cos(ang) * d0, y + Math.sin(ang) * d0, x + Math.cos(ang) * d1, y + Math.sin(ang) * d1);
        }
      }
    }

    // Indicadores do jogo, como no Guitar Hero, numa faixa em cima: à esquerda os pontos, o multiplicador (o
    // anel enche a cada acerto até o próximo) e a sequência; à direita o medidor da plateia. Devolve o fim.
    drawHud(g, col, by, narrow) {
      const ctx = this.ctx, W = this.W;
      const bw = narrow ? 112 : 150, bh = narrow ? 66 : 90, r = narrow ? 30 : 42;
      const bx = narrow ? 8 : 24;
      ctx.fillStyle = 'rgba(0,0,0,.78)';
      roundRect(ctx, bx, by, bw, bh, 10);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.25)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = `800 ${narrow ? 18 : 26}px ${SANS}`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'top';
      ctx.fillText(g.score.toLocaleString('pt-BR'), bx + bw - 10, by + 8);
      const mr = narrow ? 14 : 19, mx = bx + 10 + mr, my = by + bh - mr - 9;
      ctx.beginPath(); // anel do multiplicador: enche até o próximo (8 acertos), cheio no x4
      ctx.arc(mx, my, mr, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,.08)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.22)';
      ctx.lineWidth = narrow ? 3 : 4;
      ctx.stroke();
      const prog = g.mult >= 4 ? 1 : (g.combo % 8) / 8;
      if (prog > 0) {
        ctx.strokeStyle = rgba(col, 1);
        ctx.beginPath();
        ctx.arc(mx, my, mr, -Math.PI / 2, -Math.PI / 2 + prog * Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = g.mult > 1 ? rgba(col, 1) : '#fff';
      ctx.font = `800 ${narrow ? 13 : 17}px ${SANS}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`x${g.mult}`, mx, my + 0.5);
      ctx.fillStyle = 'rgba(255,255,255,.85)';
      ctx.font = `700 ${narrow ? 11 : 14}px ${SANS}`;
      ctx.textAlign = 'right';
      ctx.fillText(`${g.combo} seguidos`, bx + bw - 10, my + 0.5);
      // medidor da plateia: meia-lua com o ponteiro (fraca à esquerda, animada à direita)
      const gx = W - (narrow ? 8 : 24) - r - 8, gy = by + r + 10;
      ctx.fillStyle = 'rgba(0,0,0,.78)';
      ctx.beginPath();
      ctx.arc(gx, gy, r + 8, Math.PI, 0);
      ctx.closePath();
      ctx.fill();
      ctx.lineWidth = narrow ? 6 : 9;
      ctx.strokeStyle = 'rgba(255,255,255,.18)';
      ctx.beginPath();
      ctx.arc(gx, gy, r - 4, Math.PI, 0);
      ctx.stroke();
      const e = clamp(g.energy, 0, 1);
      ctx.strokeStyle = rgba(col, 1);
      ctx.beginPath();
      ctx.arc(gx, gy, r - 4, Math.PI, Math.PI + e * Math.PI);
      ctx.stroke();
      const ang = Math.PI + e * Math.PI;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2.5;
      line(ctx, gx, gy, gx + Math.cos(ang) * (r - 10), gy + Math.sin(ang) * (r - 10));
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(gx, gy, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.75)';
      ctx.font = `800 ${narrow ? 9 : 11}px ${SANS}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText('PLATEIA', gx, gy + 4);
      return by + Math.max(bh, r + 18);
    }

    // ---------------------------------------------------------------- voz (só no show): melodia sobre teclas
    keyRange(V) {
      if (this.rangeOf === V) return this.range;
      let lo = 127, hi = 0;
      for (const e of V) for (const x of e[2]) { lo = Math.min(lo, x[0]); hi = Math.max(hi, x[0]); }
      lo = Math.max(24, Math.floor(lo / 12) * 12);
      hi = Math.min(108, Math.ceil((hi + 1) / 12) * 12 - 1);
      while (hi - lo < 23) { if (lo > 24) lo -= 12; else hi += 12; }
      this.rangeOf = V;
      this.range = [lo, hi];
      return this.range;
    }

    drawVoice(now, st) {
      const ctx = this.ctx, W = this.W, H = this.H;
      const V = st.notes, col = st.color || WHITE;
      const narrow = W < 640;
      const [lo, hi] = this.keyRange(V);
      const whites = [];
      for (let m = lo; m <= hi; m++) if (!BLACK.has(m % 12)) whites.push(m);
      const kbW = Math.min(W - 12, Math.max(W * 0.55, Math.min(H * 1.3, 920)));
      const kw = kbW / whites.length, left = (W - kbW) / 2;
      const kbH = Math.max(44, Math.min(100, kw * 4.6));
      let top = 4;
      if (st.game) top = this.drawHud(st.game, col, narrow ? 38 : 46, narrow) + 8;
      const hit = H - kbH;
      const keyX = new Map();
      whites.forEach((m, i) => keyX.set(m, [left + i * kw, kw, false]));
      for (let m = lo; m <= hi; m++) {
        if (BLACK.has(m % 12) && keyX.has(m - 1)) keyX.set(m, [keyX.get(m - 1)[0] + kw * 0.69, kw * 0.62, true]);
      }
      const { b, ahead } = st;
      const uAt = (beat) => (beat - b) / ahead;
      const yOf = (u) => hit - (hit - top) * u;
      const fade = (u) => (u > 0.72 ? Math.max(0, (1 - u) / 0.28) : 1);
      const g = ctx.createLinearGradient(0, top, 0, hit);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(0.3, 'rgba(0,0,0,.66)');
      g.addColorStop(1, 'rgba(0,0,0,.8)');
      ctx.fillStyle = g;
      ctx.fillRect(left, top, kbW, hit - top);
      const active = new Set();
      let longest = 4;
      for (const e of V) if (e[1] > longest) longest = e[1];
      for (let i = firstFrom(V, b, longest); i < V.length; i++) {
        const e = V[i];
        if (e[0] > b + ahead) break;
        const u0 = uAt(e[0]), u1 = uAt(e[0] + Math.max(e[1], 0.12));
        if (u1 <= 0) continue;
        const on = u0 <= 0;
        const y0 = yOf(Math.max(u0, 0));
        let y1 = yOf(Math.min(u1, 1));
        if (y0 - y1 < 6) y1 = y0 - 6;
        for (const x of e[2]) {
          const kx = keyX.get(x[0]);
          if (!kx) continue;
          if (on) active.add(x[0]);
          roundRect(ctx, kx[0] + 1.5, y1, kx[1] - 3, y0 - y1, Math.min(6, kx[1] / 2));
          ctx.fillStyle = on ? rgba(col, 1) : kx[2] ? `rgba(170,170,170,${(0.92 * fade(u0)).toFixed(3)})` : `rgba(255,255,255,${(0.92 * fade(u0)).toFixed(3)})`;
          ctx.fill();
        }
      }
      const fl = st.flash && now - st.flash.at < 600 ? st.flash : null;
      if (fl) {
        const ft = (now - fl.at) / 600;
        ctx.fillStyle = rgba(fl.result === 'perfect' || fl.result === 'good' ? col : WHITE, (fl.result === 'perfect' ? 0.45 : fl.result === 'good' ? 0.3 : 0.1) * (1 - ft));
        ctx.fillRect(left, hit - 26, kbW, 26);
      }
      // sem cor da música, a tecla acesa fica cinza-escura (branco sobre tecla branca não se via)
      const lit = col === WHITE ? '#5a5a5a' : rgba(col, 1);
      for (const m of whites) {
        const [x] = keyX.get(m);
        ctx.fillStyle = active.has(m) ? lit : '#ececec';
        ctx.fillRect(x + 0.5, hit, kw - 1, kbH);
      }
      for (let m = lo; m <= hi; m++) {
        const kx = keyX.get(m);
        if (!kx || !kx[2]) continue;
        ctx.fillStyle = active.has(m) ? lit : '#111';
        ctx.fillRect(kx[0], hit, kx[1], kbH * 0.62);
      }
      ctx.strokeStyle = rgba(col, 0.95);
      ctx.lineWidth = 3;
      line(ctx, left, hit, left + kbW, hit);
    }
  }

  window.Pista = { Highway, STRINGS };
})();
