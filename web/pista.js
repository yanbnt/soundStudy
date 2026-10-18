// Pista do Modo Show, no jeito do Guitar Hero: as notas descem por uma pista em perspectiva até a linha de
// tocar. Violão, cavaco e baixo têm uma faixa por corda, da mais grave (à esquerda) para a mais aguda, na
// mesma ordem do diagrama do acorde, com o número da casa escrito na nota. Batida repetida com a mesma forma
// aparece só com o contorno dentro do compasso (os números voltam no compasso seguinte), para a pista não
// virar um paredão de números. Teclado e voz: pista de teclas, com as barras caindo sobre o teclado.
// Deitada (orient 'h', em cima da partitura): as notas correm da direita para a linha de tocar, cada uma do
// comprimento que tem que durar; cordas de cima para baixo da mais grave para a mais aguda (como o braço
// visto por quem toca, igual ao cartão "Como tocar"); os acordes passam numa faixa por cima.
// Preto e branco; a cor da música só no que está soando, na linha de tocar e nas trocas de acorde.
// Canvas a 30 quadros, sem desfoque nem sombra (o computador do usuário é fraco).
(function () {
  'use strict';

  // da corda mais grave (faixa da esquerda) para a mais aguda; espessura de cada corda na pista
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
  // texto em cima da cor da música: preto se a cor é clara
  const inkOn = (c) => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] > 150 ? '#000' : '#fff');

  // primeiro evento que ainda pode aparecer a partir do tempo `from` (nota dura no máximo uns 4 tempos)
  function firstFrom(V, from) {
    let lo = 0, hi = V.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (V[mid][0] < from - 4) lo = mid + 1; else hi = mid; }
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

  class Highway {
    // source() devolve { b, ahead, inst, notes, chords, color, flash, names } ou null.
    // b e ahead em tempos; notes = [[tempo, duração, [[midi, corda (1 = a mais aguda), casa], ...]], ...]
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
        // parado (pausa): só redesenha quando algo muda
        const key = st ? `${st.b.toFixed(4)}|${st.inst}|${st.notes && st.notes.length}|${st.chords && st.chords.length}|${st.color}|${this.W}x${this.H}` : '-';
        const flashing = st && st.flash && now - st.flash.at < 520;
        if (key !== this.lastKey || flashing) {
          this.lastKey = key;
          this.draw(now, st);
        }
      }
      requestAnimationFrame(this.loop);
    }

    draw(now, st) {
      const ctx = this.ctx;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, this.W, this.H);
      if (!st || !this.W) return;
      if (!st.notes || !st.notes.length) {
        ctx.fillStyle = 'rgba(255,255,255,.6)';
        ctx.font = `600 16px ${SANS}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('Este instrumento não aparece nesta música', this.W / 2, this.H / 2);
        return;
      }
      if (this.orient === 'h') this.drawFlat(now, st);
      else if (STRINGS[st.inst]) this.drawStrings(now, st);
      else this.drawKeys(now, st);
    }

    // faixa de teclas que a música usa: oitavas inteiras, 2 no mínimo (`max`: no máximo tantas oitavas).
    // `tight` (pista deitada): só das notas usadas, com uma de folga, para as barras ficarem grossas
    keyRange(V, max = 8, tight = false) {
      if (this.rangeOf === V) return this.range;
      let lo = 127, hi = 0;
      for (const e of V) for (const x of e[2]) { lo = Math.min(lo, x[0]); hi = Math.max(hi, x[0]); }
      if (tight) {
        lo -= 1;
        hi += 1;
        while (hi - lo < 11) { lo -= 1; hi += 1; }
      } else {
        lo = Math.max(24, Math.floor(lo / 12) * 12);
        hi = Math.min(108, Math.ceil((hi + 1) / 12) * 12 - 1);
        while (hi - lo < 23) { if (lo > 24) lo -= 12; else hi += 12; }
      }
      while (hi - lo + 1 > max * 12) { lo += 12; if (hi - lo + 1 > max * 12) hi -= 12; }
      this.rangeOf = V;
      this.range = [lo, hi];
      return this.range;
    }

    // altura que a pista deitada precisa (CSS px) para esse instrumento
    static flatHeight(inst, notes, narrow) {
      const cfg = STRINGS[inst];
      if (cfg) return 34 + cfg.names.length * (narrow ? 19 : 23) + 8;
      let lo = 127, hi = 0;
      for (const e of notes || []) for (const x of e[2]) { lo = Math.min(lo, x[0]); hi = Math.max(hi, x[0]); }
      const span = Math.min(36, Math.max(12, hi - lo + 3));
      return Math.round(Math.min(narrow ? 280 : 400, Math.max(150, 42 + span * (narrow ? 8 : 13))));
    }

    // ---------------------------------------------------------------- pista deitada
    drawFlat(now, st) {
      const ctx = this.ctx, W = this.W, H = this.H;
      const V = st.notes, col = st.color || WHITE, ink = inkOn(col);
      const narrow = W < 560;
      const cfg = STRINGS[st.inst];
      const chordH = 30, laneTop = chordH + 4, padB = 6;
      const labelW = narrow ? 46 : 60;
      const hitX = labelW + (W - labelW) * (narrow ? 0.2 : 0.15);
      const { b, ahead } = st;
      const pxb = (W - hitX) / ahead; // pixels por tempo
      const xOf = (beat) => hitX + (beat - b) * pxb;
      const from = b - (hitX - labelW) / pxb;
      let n, laneOf, lo = 0, hi = 0;
      if (cfg) {
        n = cfg.names.length;
        laneOf = (x) => n - x[1]; // 0 = corda mais grave, em cima
      } else {
        [lo, hi] = this.keyRange(V, 3, true);
        n = hi - lo + 1;
        laneOf = (x) => (x[0] < lo || x[0] > hi ? -1 : hi - x[0]); // agudo em cima
      }
      const laneH = (H - laneTop - padB) / n;
      const yOf = (lane) => laneTop + lane * laneH;

      // fundo das faixas: no teclado, as faixas das teclas pretas mais escuras
      ctx.fillStyle = 'rgba(255,255,255,.035)';
      ctx.fillRect(labelW, laneTop, W - labelW, n * laneH);
      if (!cfg) {
        for (let m = lo; m <= hi; m++) {
          if (BLACK.has(m % 12)) { ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(labelW, yOf(hi - m), W - labelW, laneH); }
          if (m % 12 === 0) {
            ctx.strokeStyle = 'rgba(255,255,255,.12)';
            ctx.lineWidth = 1;
            line(ctx, labelW, yOf(hi - m) + laneH, W, yOf(hi - m) + laneH);
          }
        }
      }

      // o que está soando agora
      const i0 = firstFrom(V, from);
      const activeLanes = new Set();
      for (let i = i0; i < V.length && V[i][0] <= b; i++) {
        const e = V[i];
        if (b < e[0] + Math.max(e[1], 0.15)) for (const x of e[2]) { const l = laneOf(x); if (l >= 0 && l < n) activeLanes.add(l); }
      }

      ctx.save();
      ctx.beginPath();
      ctx.rect(labelW, 0, W - labelW, H);
      ctx.clip();
      // cordas
      if (cfg) {
        for (let l = 0; l < n; l++) {
          ctx.strokeStyle = activeLanes.has(l) ? rgba(col, 0.9) : 'rgba(255,255,255,.3)';
          ctx.lineWidth = cfg.widths[l] * 0.8;
          line(ctx, labelW, yOf(l) + laneH / 2, W, yOf(l) + laneH / 2);
        }
      }
      // tempos e compassos (número do compasso em cima)
      for (let k = Math.ceil(from); k <= b + ahead; k++) {
        const x = xOf(k), down = ((k % 4) + 4) % 4 === 0;
        ctx.strokeStyle = down ? 'rgba(255,255,255,.3)' : 'rgba(255,255,255,.09)';
        ctx.lineWidth = down ? 1.5 : 1;
        line(ctx, x, laneTop, x, laneTop + n * laneH);
      }
      // acordes: blocos do tamanho que duram
      for (const c of st.chords || []) {
        if (c.start_beat > b + ahead) break;
        if (c.end_beat < from || c.kind === 'N') continue;
        const x0 = Math.max(labelW, xOf(c.start_beat)) + 1, x1 = xOf(c.end_beat) - 2;
        if (x1 - x0 < 4) continue;
        const cur = c.start_beat <= b && b < c.end_beat;
        ctx.fillStyle = cur ? rgba(col, 0.92) : 'rgba(255,255,255,.1)';
        roundRect(ctx, x0, 2, x1 - x0, chordH - 4, 6);
        ctx.fill();
        ctx.save();
        ctx.beginPath();
        ctx.rect(x0, 0, x1 - x0 - 4, chordH);
        ctx.clip();
        ctx.fillStyle = cur ? ink : 'rgba(255,255,255,.9)';
        ctx.font = `650 ${narrow ? 15 : 17}px ${SERIF}`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(c.display, Math.max(x0 + 8, Math.min(hitX + 6, x1 - 40)), chordH / 2 + 1);
        ctx.restore();
      }
      // notas: barra do comprimento que a nota dura; a casa (ou o nome da nota) no começo
      let prevKey = '', prevStart = -99, prevEnd = -99;
      for (let i = i0; i < V.length; i++) {
        const e = V[i];
        if (e[0] > b + ahead) break;
        const key = e[2].map((x) => x[1] * 100 + x[2] + x[0] * 10000).sort((p, q) => p - q).join(',');
        const ghost = !!cfg && key === prevKey && e[0] - prevEnd < 0.6 && Math.floor(e[0] / 4) === Math.floor(prevStart / 4);
        prevKey = key;
        prevEnd = e[0] + e[1];
        if (!ghost) prevStart = e[0];
        const end = e[0] + Math.max(e[1], 0.12);
        if (end < from) continue;
        const x0 = xOf(e[0]) + 1, x1 = Math.max(x0 + 6, xOf(end) - 1.5);
        const on = e[0] <= b && b < end, past = end <= b;
        for (const x of e[2]) {
          const l = laneOf(x);
          if (l < 0 || l >= n) continue;
          const h = Math.max(4, laneH * (cfg ? 0.72 : 0.86)), y = yOf(l) + (laneH - h) / 2;
          roundRect(ctx, x0, y, x1 - x0, h, Math.min(5, h / 2));
          ctx.fillStyle = on ? rgba(col, 1) : past ? 'rgba(255,255,255,.22)' : ghost ? 'rgba(255,255,255,.55)' : 'rgba(255,255,255,.93)';
          ctx.fill();
          if (ghost || h < 9) continue;
          const label = cfg ? String(x[2]) : st.names ? st.names(x[0]) : '';
          ctx.font = `800 ${Math.round(Math.min(h * 0.8, 15))}px ${SANS}`;
          if (ctx.measureText(label).width > x1 - x0 - 4) continue;
          ctx.fillStyle = on ? ink : past ? 'rgba(0,0,0,.6)' : '#000';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(label, x0 + 3, y + h / 2 + 0.5);
        }
      }
      this.flash(now, st, () => { ctx.beginPath(); ctx.rect(hitX - 14, laneTop, 28, n * laneH); }, col);
      ctx.restore();

      // linha de tocar
      ctx.strokeStyle = rgba(col, 0.95);
      ctx.lineWidth = 3;
      line(ctx, hitX, 0, hitX, H - padB + 2);

      // nomes das cordas (ou teclas) à esquerda
      ctx.fillStyle = '#000';
      ctx.fillRect(0, laneTop, labelW - 2, n * laneH);
      if (cfg) {
        for (let l = 0; l < n; l++) {
          const y = yOf(l) + laneH / 2, on = activeLanes.has(l);
          if (on) { ctx.fillStyle = rgba(col, 1); roundRect(ctx, 2, yOf(l) + 1, labelW - 8, laneH - 2, 5); ctx.fill(); }
          ctx.textBaseline = 'middle';
          ctx.textAlign = 'left';
          ctx.fillStyle = on ? ink : 'rgba(255,255,255,.95)';
          ctx.font = `700 ${narrow ? 12 : 14}px ${SANS}`;
          ctx.fillText(cfg.names[l], 7, y + 0.5);
          ctx.textAlign = 'right';
          ctx.fillStyle = on ? ink : 'rgba(255,255,255,.5)';
          ctx.font = `700 ${narrow ? 10 : 11}px ${SANS}`;
          ctx.fillText(`${n - l}ª`, labelW - 9, y + 0.5);
        }
      } else {
        // teclado de pé: teclas brancas inteiras, pretas mais curtas
        const activeKeys = new Set([...activeLanes].map((l) => hi - l));
        for (let m = lo; m <= hi; m++) {
          const y = yOf(hi - m), black = BLACK.has(m % 12), on = activeKeys.has(m);
          ctx.fillStyle = on ? rgba(col, 1) : black ? '#151515' : '#e8e8e8';
          ctx.fillRect(black ? labelW * 0.35 : 0, y + 0.5, black ? labelW * 0.65 - 2 : labelW - 2, Math.max(1, laneH - 1));
          if (m % 12 === 0 && laneH >= 7) {
            ctx.fillStyle = on ? ink : m === 60 ? '#000' : '#777';
            ctx.font = `${m === 60 ? 800 : 600} ${Math.min(11, Math.round(laneH * 1.3))}px ${SANS}`;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(m === 60 ? 'Dó' : 'dó', 4, y + laneH / 2);
          }
        }
      }
    }

    // trocas de acorde: uma linha na cor da música atravessando a pista e o nome do acorde
    drawChords(st, from, uAt, yOf, edges, sOf, fade, col, narrow) {
      const ctx = this.ctx;
      for (const c of st.chords || []) {
        if (c.start_beat > st.b + st.ahead) break;
        if (c.start_beat < from || c.kind === 'N') continue;
        const u = uAt(c.start_beat), y = yOf(u), [xl, xr] = edges(u), f = fade(u);
        if (f <= 0) continue;
        ctx.strokeStyle = rgba(col, 0.65 * f);
        ctx.lineWidth = 2;
        line(ctx, xl, y, xr, y);
        const size = Math.round((narrow ? 16 : 21) * (0.6 + 0.4 * sOf(u)));
        ctx.font = `650 ${size}px ${SERIF}`;
        const w = ctx.measureText(c.display).width;
        ctx.fillStyle = `rgba(0,0,0,${(0.72 * f).toFixed(3)})`;
        roundRect(ctx, xl + 4, y - size - 8, w + 14, size + 6, 6);
        ctx.fill();
        ctx.fillStyle = `rgba(255,255,255,${f.toFixed(3)})`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(c.display, xl + 11, y - 7 - size * 0.22);
      }
    }

    flash(now, st, band, col) {
      const fl = st.flash;
      if (!fl || now - fl.at > 500) return;
      const t = (now - fl.at) / 500;
      const a = (fl.result === 'perfect' ? 0.5 : fl.result === 'good' ? 0.28 : 0.12) * (1 - t);
      this.ctx.fillStyle = rgba(fl.result === 'perfect' ? col : WHITE, a);
      band();
      this.ctx.fill();
    }

    // ---------------------------------------------------------------- violão, cavaco, baixo
    drawStrings(now, st) {
      const ctx = this.ctx, W = this.W, H = this.H;
      const cfg = STRINGS[st.inst], n = cfg.names.length;
      const col = st.color || WHITE, ink = inkOn(col);
      const narrow = W < 640;
      const P = narrow ? 1.3 : 1.8; // quanto a pista afina lá no fundo
      const top = 4, hit = H - (narrow ? 54 : 62);
      const hwW = Math.min(W - 12, Math.max(W * 0.5, Math.min(H * 1.1, 780)));
      const cx = W / 2, laneW = hwW / n, s1 = 1 / (1 + P);
      const sOf = (u) => 1 / (1 + P * u);
      const yOf = (u) => hit - ((hit - top) * (1 - sOf(u))) / (1 - s1);
      // a pista continua um pouco abaixo da linha de tocar (u negativo) até a borda de baixo
      const uLow = (1 / (1 + ((1 - s1) * (H - hit)) / (hit - top)) - 1) / P;
      const xOf = (u, lane) => cx + (lane + 0.5 - n / 2) * laneW * sOf(u);
      const edge = (u, side) => cx + side * (hwW / 2) * sOf(u);
      const edges = (u) => [edge(u, -1), edge(u, 1)];
      const fade = (u) => (u > 0.72 ? Math.max(0, (1 - u) / 0.28) : 1);
      const { b, ahead } = st, V = st.notes;
      const uAt = (beat) => (beat - b) / ahead;
      const from = b + uLow * ahead;

      // pista
      const g = ctx.createLinearGradient(0, top, 0, hit);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(0.3, 'rgba(0,0,0,.68)');
      g.addColorStop(1, 'rgba(0,0,0,.82)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(edge(uLow, -1), H);
      ctx.lineTo(edge(1, -1), top);
      ctx.lineTo(edge(1, 1), top);
      ctx.lineTo(edge(uLow, 1), H);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.3)';
      ctx.lineWidth = 2;
      line(ctx, edge(uLow, -1), H, edge(1, -1), top);
      line(ctx, edge(uLow, 1), H, edge(1, 1), top);

      // tempos (o 1 do compasso mais forte)
      for (let k = Math.ceil(from); k <= b + ahead; k++) {
        const u = uAt(k), y = yOf(u), down = ((k % 4) + 4) % 4 === 0;
        ctx.strokeStyle = `rgba(255,255,255,${((down ? 0.3 : 0.09) * fade(u)).toFixed(3)})`;
        ctx.lineWidth = down ? 2 : 1;
        line(ctx, edge(u, -1), y, edge(u, 1), y);
      }

      // cordas soando agora acendem
      const i0 = firstFrom(V, from);
      const active = new Array(n).fill(false);
      for (let i = i0; i < V.length && V[i][0] <= b; i++) {
        const e = V[i];
        if (b < e[0] + Math.max(e[1], 0.25)) {
          for (const x of e[2]) { const l = n - x[1]; if (l >= 0 && l < n) active[l] = true; }
        }
      }
      for (let i = 0; i < n; i++) {
        ctx.strokeStyle = active[i] ? rgba(col, 0.95) : 'rgba(255,255,255,.42)';
        ctx.lineWidth = cfg.widths[i] * (narrow ? 0.85 : 1) + (active[i] ? 1.2 : 0);
        line(ctx, xOf(uLow, i), H, xOf(1, i), top);
      }

      this.drawChords(st, from, uAt, yOf, edges, sOf, fade, col, narrow);

      // notas da janela; a mesma forma repetida dentro do compasso vira só contorno
      const evs = [];
      let prevKey = '', prevStart = -99, prevEnd = -99;
      for (let i = i0; i < V.length; i++) {
        const e = V[i];
        if (e[0] > b + ahead) break;
        const key = e[2].map((x) => x[1] * 100 + x[2]).sort((p, q) => p - q).join(',');
        const ghost = key === prevKey && e[0] - prevEnd < 0.6 && Math.floor(e[0] / 4) === Math.floor(prevStart / 4);
        prevKey = key;
        prevEnd = e[0] + e[1];
        if (!ghost) prevStart = e[0];
        if (e[0] + Math.max(e[1], 0.25) >= from) evs.push([e, ghost]);
      }
      for (let j = evs.length - 1; j >= 0; j--) { // de longe para perto: as de perto ficam por cima
        const [e, ghost] = evs[j];
        const u0 = uAt(e[0]), u1 = uAt(e[0] + e[1]);
        const on = u0 <= 0 && b < e[0] + Math.max(e[1], 0.25);
        // passou da linha: some (a que ainda soa fica presa na linha, acesa)
        if (u0 < -0.02 && !on) continue;
        const uu = Math.max(u0, 0), s = sOf(uu), y = yOf(uu);
        const gw = Math.max(10, laneW * 0.62 * s), gh = Math.max(8, gw * 0.66);
        const alpha = fade(uu);
        if (alpha <= 0) continue;
        const lanes = e[2].map((x) => n - x[1]).filter((l) => l >= 0 && l < n);
        if (!lanes.length) continue;
        if (e[1] >= 0.75 && !ghost) { // nota longa: o rastro até o fim dela
          ctx.strokeStyle = on ? rgba(col, 0.8) : `rgba(255,255,255,${(0.32 * alpha).toFixed(3)})`;
          for (const l of lanes) {
            const ua = Math.max(u0, 0), ub = Math.min(u1, 1);
            if (ub <= ua) continue;
            ctx.lineWidth = Math.max(2, gw * 0.2 * sOf(ua));
            line(ctx, xOf(ua, l), yOf(ua), xOf(ub, l), yOf(ub));
          }
        }
        if (lanes.length >= 2) { // batida: uma barra junta as cordas tocadas juntas
          const lo = Math.min(...lanes), hi = Math.max(...lanes);
          const xa = xOf(uu, lo) - gw / 2 - 3 * s, xb = xOf(uu, hi) + gw / 2 + 3 * s;
          ctx.fillStyle = on ? rgba(col, 0.4) : `rgba(255,255,255,${(0.14 * alpha).toFixed(3)})`;
          roundRect(ctx, xa, y - gh * 0.34, xb - xa, gh * 0.68, gh * 0.3);
          ctx.fill();
        }
        for (const x of e[2]) {
          const l = n - x[1];
          if (l < 0 || l >= n) continue;
          const gx = xOf(uu, l);
          roundRect(ctx, gx - gw / 2, y - gh / 2, gw, gh, gh * 0.32);
          if (ghost) {
            ctx.strokeStyle = on ? rgba(col, 0.95) : `rgba(255,255,255,${(0.6 * alpha).toFixed(3)})`;
            ctx.lineWidth = Math.max(1.2, 2 * s);
            ctx.stroke();
            continue;
          }
          ctx.fillStyle = on ? rgba(col, alpha) : `rgba(255,255,255,${(0.95 * alpha).toFixed(3)})`;
          ctx.fill();
          if (gh >= 9) {
            ctx.fillStyle = on ? ink : '#000';
            ctx.font = `800 ${Math.round(gh * 0.78)}px ${SANS}`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(String(x[2]), gx, y + 1);
          }
        }
      }

      // acerto/erro do jogo: a linha de tocar pisca
      this.flash(now, st, () => {
        ctx.beginPath();
        ctx.moveTo(edge(-0.05, -1), yOf(-0.05));
        ctx.lineTo(edge(0.07, -1), yOf(0.07));
        ctx.lineTo(edge(0.07, 1), yOf(0.07));
        ctx.lineTo(edge(-0.05, 1), yOf(-0.05));
        ctx.closePath();
      }, col);

      // linha de tocar, a "boca" de cada corda e o nome dela embaixo
      ctx.strokeStyle = rgba(col, 0.95);
      ctx.lineWidth = 4;
      line(ctx, edge(0, -1), hit, edge(0, 1), hit);
      const r = Math.min(laneW * 0.3, 19);
      for (let i = 0; i < n; i++) {
        const x = xOf(0, i);
        ctx.beginPath();
        ctx.arc(x, hit, r, 0, Math.PI * 2);
        ctx.fillStyle = active[i] ? rgba(col, 0.95) : 'rgba(0,0,0,.7)';
        ctx.fill();
        ctx.strokeStyle = active[i] ? rgba(col, 1) : 'rgba(255,255,255,.8)';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = active[i] ? ink : 'rgba(255,255,255,.95)';
        ctx.font = `800 ${narrow ? 11 : 12}px ${SANS}`;
        ctx.fillText(`${n - i}ª`, x, hit + 0.5);
        ctx.fillStyle = 'rgba(255,255,255,.92)';
        ctx.font = `700 ${narrow ? 13 : 15}px ${SANS}`;
        ctx.fillText(cfg.names[i], x, hit + r + (narrow ? 13 : 16));
      }
    }

    // ---------------------------------------------------------------- teclado e voz
    drawKeys(now, st) {
      const ctx = this.ctx, W = this.W, H = this.H;
      const V = st.notes, col = st.color || WHITE, ink = inkOn(col);
      const narrow = W < 640;
      const [lo, hi] = this.keyRange(V);
      const whites = [];
      for (let m = lo; m <= hi; m++) if (!BLACK.has(m % 12)) whites.push(m);
      const kbW = Math.min(W - 12, Math.max(W * 0.55, Math.min(H * 1.3, 920)));
      const kw = kbW / whites.length, left = (W - kbW) / 2;
      const kbH = Math.max(44, Math.min(100, kw * 4.6));
      const top = 4, hit = H - kbH;
      const keyX = new Map();
      whites.forEach((m, i) => keyX.set(m, [left + i * kw, kw, false]));
      for (let m = lo; m <= hi; m++) {
        if (BLACK.has(m % 12) && keyX.has(m - 1)) keyX.set(m, [keyX.get(m - 1)[0] + kw * 0.69, kw * 0.62, true]);
      }
      const { b, ahead } = st;
      const uAt = (beat) => (beat - b) / ahead;
      const yOf = (u) => hit - (hit - top) * u;
      const fade = (u) => (u > 0.72 ? Math.max(0, (1 - u) / 0.28) : 1);
      const edges = () => [left, left + kbW];

      const g = ctx.createLinearGradient(0, top, 0, hit);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(0.3, 'rgba(0,0,0,.68)');
      g.addColorStop(1, 'rgba(0,0,0,.82)');
      ctx.fillStyle = g;
      ctx.fillRect(left, top, kbW, hit - top);
      // uma linha clara em cada Dó, para achar a oitava
      for (const m of whites) {
        if (m % 12 !== 0) continue;
        ctx.strokeStyle = 'rgba(255,255,255,.08)';
        ctx.lineWidth = 1;
        line(ctx, keyX.get(m)[0], top, keyX.get(m)[0], hit);
      }
      for (let k = Math.ceil(b); k <= b + ahead; k++) {
        const u = uAt(k), y = yOf(u), down = ((k % 4) + 4) % 4 === 0;
        ctx.strokeStyle = `rgba(255,255,255,${((down ? 0.28 : 0.08) * fade(u)).toFixed(3)})`;
        ctx.lineWidth = down ? 2 : 1;
        line(ctx, left, y, left + kbW, y);
      }
      this.drawChords(st, b, uAt, yOf, edges, () => 1, fade, col, narrow);

      const active = new Set();
      const i0 = firstFrom(V, b);
      for (let i = i0; i < V.length; i++) {
        const e = V[i];
        if (e[0] > b + ahead) break;
        const u0 = uAt(e[0]), u1 = uAt(e[0] + Math.max(e[1], 0.12));
        if (u1 <= 0) continue;
        const on = u0 <= 0;
        const y0 = yOf(Math.max(u0, 0));
        let y1 = yOf(Math.min(u1, 1));
        if (y0 - y1 < 6) y1 = y0 - 6;
        const a = fade(u0);
        for (const x of e[2]) {
          const k = keyX.get(x[0]);
          if (!k) continue;
          if (on) active.add(x[0]);
          roundRect(ctx, k[0] + 1.5, y1, k[1] - 3, y0 - y1, Math.min(5, k[1] / 3));
          ctx.fillStyle = on ? rgba(col, 1) : k[2] ? `rgba(190,190,190,${(0.9 * a).toFixed(3)})` : `rgba(255,255,255,${(0.95 * a).toFixed(3)})`;
          ctx.fill();
          if (k[1] >= 15 && y0 - y1 >= 15 && st.names) {
            ctx.fillStyle = on ? ink : '#000';
            ctx.font = `700 ${Math.min(12, Math.round(k[1] * 0.42))}px ${SANS}`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            ctx.fillText(st.names(x[0]), k[0] + k[1] / 2, y0 - 2);
          }
        }
      }

      this.flash(now, st, () => { ctx.beginPath(); ctx.rect(left, hit - 26, kbW, 26); }, col);

      // teclado: brancas, depois pretas por cima; o que soa fica na cor da música
      for (const m of whites) {
        const [x] = keyX.get(m);
        ctx.fillStyle = active.has(m) ? rgba(col, 1) : '#ececec';
        ctx.fillRect(x + 0.5, hit, kw - 1, kbH);
        if (m % 12 === 0 && kw >= 13) {
          ctx.fillStyle = active.has(m) ? ink : m === 60 ? '#000' : '#8a8a8a';
          ctx.font = `${m === 60 ? 800 : 600} ${Math.min(11, Math.round(kw * 0.45))}px ${SANS}`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          ctx.fillText(m === 60 ? 'Dó' : 'dó', x + kw / 2, hit + kbH - 3);
        }
      }
      for (let m = lo; m <= hi; m++) {
        const k = keyX.get(m);
        if (!k || !k[2]) continue;
        ctx.fillStyle = active.has(m) ? rgba(col, 1) : '#111';
        ctx.fillRect(k[0], hit, k[1], kbH * 0.62);
      }
      ctx.strokeStyle = rgba(col, 0.95);
      ctx.lineWidth = 3;
      line(ctx, left, hit, left + kbW, hit);
    }
  }

  window.Pista = { Highway, STRINGS };
})();
