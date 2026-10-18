// Pistas com a FORMAÇÃO de cada acorde (o desenho de onde pôr os dedos, o mesmo do cartão "Como tocar"),
// uma vez por acorde, do tamanho que ele dura. Nada de nota por nota com número: o usuário reprovou
// ("muita coisa exibindo, só a formação").
// - Em pé (orient 'v', Modo Show, jeito Guitar Hero): a pista desce em perspectiva até a linha de tocar; cada
//   acorde chega como um cartão (nome + formação) e a faixa dele mostra quanto dura. Violão, cavaco e baixo
//   têm uma corda por faixa, da mais grave (à esquerda) para a mais aguda, como no diagrama; na linha de
//   tocar acendem as cordas que o acorde de agora toca. "Voz": as notas da melodia caem sobre um teclado.
// - Deitada (orient 'h', "Tocando agora", em cima da partitura): os acordes correm até a linha, cada bloco
//   do tamanho que dura, com o nome e a formação dentro.
// Preto e branco; a cor da música só no acorde de agora e na linha de tocar.
// Canvas a 30 quadros, sem desfoque nem sombra (o computador do usuário é fraco); parada, não redesenha.
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
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

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

  // formação do acorde no instrumento (cache por acorde: a lista de acordes só muda com a música/nível)
  const shapeCache = new WeakMap();
  function shapeOf(c, inst) {
    if (!c || c.kind === 'N' || !window.ChordDiagram || !window.ChordDiagram.shapeFor) return null;
    let m = shapeCache.get(c);
    if (!m) shapeCache.set(c, (m = new Map()));
    if (!m.has(inst)) m.set(inst, window.ChordDiagram.shapeFor(c, inst));
    return m.get(inst);
  }

  // Desenho da formação dentro da caixa (x, y, w, h): diagrama de cordas (cordas em pé, a mais grave à
  // esquerda, 4 casas; "5ª" ao lado quando a forma é mais para cima) ou teclado de 2 oitavas com as teclas
  // do acorde. `on`: acorde de agora (bolinhas/teclas na cor da música).
  function drawShape(ctx, x, y, w, h, shape, on, col, alpha = 1) {
    if (!shape) return;
    const dot = on ? rgba(col, alpha) : `rgba(255,255,255,${alpha.toFixed(3)})`;
    if (shape.keys) {
      // tecla marcada pintada inteira (branco sobre tecla clara não se via): cinza nos acordes que vêm, na
      // cor da música no de agora (sem cor da música, cinza também)
      const all = [...shape.keys.left, ...shape.keys.right];
      if (!all.length) return;
      const lo = Math.floor(Math.min(...all) / 12) * 12;
      const hi = Math.max(lo + 23, Math.ceil((Math.max(...all) + 1) / 12) * 12 - 1);
      const whites = [];
      for (let m = lo; m <= hi; m++) if (!BLACK.has(m % 12)) whites.push(m);
      const kw = w / whites.length, marked = new Set(all);
      const tint = on && col !== WHITE;
      const a = alpha.toFixed(3);
      whites.forEach((m, i) => {
        ctx.fillStyle = !marked.has(m) ? `rgba(236,236,236,${(0.92 * alpha).toFixed(3)})` : tint ? rgba(col, alpha) : `rgba(96,96,96,${a})`;
        ctx.fillRect(x + i * kw + 0.5, y, kw - 1, h);
      });
      whites.forEach((m, i) => {
        if (!BLACK.has((m + 1) % 12) || m + 1 > hi) return;
        ctx.fillStyle = !marked.has(m + 1) ? `rgba(17,17,17,${a})` : tint ? rgba(col, alpha) : `rgba(165,165,165,${a})`;
        ctx.fillRect(x + (i + 0.68) * kw, y, kw * 0.64, h * 0.6);
      });
      return;
    }
    const frets = shape.frets, n = frets.length;
    const played = frets.filter((f) => f !== null && f > 0);
    const solo = frets.filter((f) => f !== null).length === 1; // baixo: uma nota só
    const maxF = played.length ? Math.max(...played) : 0, minF = played.length ? Math.min(...played) : 1;
    // 4 casas à vista; forma mais aberta (sus2 com a forma de Mi abre 5) ganha as casas que precisar
    const start = maxF <= 4 ? 1 : minF, nF = Math.max(4, maxF - start + 1);
    const padL = w * 0.2, padR = w * 0.06, markH = Math.min(12, h * 0.17);
    const gx0 = x + padL, gx1 = x + w - padR, gy0 = y + markH + 2, gy1 = y + h - 1;
    const sx = (gx1 - gx0) / (n - 1), fy = (gy1 - gy0) / nF;
    const r = Math.max(2, Math.min(sx, fy) * 0.36);
    ctx.strokeStyle = `rgba(255,255,255,${(0.55 * alpha).toFixed(3)})`;
    for (let i = 0; i <= nF; i++) {
      ctx.lineWidth = i === 0 && start === 1 ? 3 : 1;
      line(ctx, gx0, gy0 + i * fy, gx1, gy0 + i * fy);
    }
    ctx.lineWidth = 1;
    for (let s = 0; s < n; s++) line(ctx, gx0 + s * sx, gy0, gx0 + s * sx, gy1);
    if (start > 1) {
      ctx.fillStyle = `rgba(255,255,255,${(0.75 * alpha).toFixed(3)})`;
      ctx.font = `700 ${Math.round(clamp(fy * 0.7, 8, 12))}px ${SANS}`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${start}ª`, gx0 - 3, gy0 + fy * 0.5);
    }
    ctx.fillStyle = dot;
    if (shape.barre) {
      const yb = gy0 + (shape.barre.f - start + 0.5) * fy;
      roundRect(ctx, gx0 + shape.barre.from * sx - r, yb - r, (shape.barre.to - shape.barre.from) * sx + 2 * r, 2 * r, r);
      ctx.fill();
    }
    frets.forEach((f, s) => {
      const cx = gx0 + s * sx, my = y + markH / 2 + 1;
      if (solo && f === null) return; // baixo: só a nota, sem × nas outras cordas
      if (solo && f === 0) { // baixo em corda solta: bolinha cheia em cima da pestana
        ctx.fillStyle = dot;
        ctx.beginPath();
        ctx.arc(cx, my, Math.min(r, markH * 0.5), 0, Math.PI * 2);
        ctx.fill();
        return;
      }
      if (f === null) { // não toca: ×
        const k = Math.min(markH, sx) * 0.28;
        ctx.strokeStyle = `rgba(255,255,255,${(0.55 * alpha).toFixed(3)})`;
        ctx.lineWidth = 1.2;
        line(ctx, cx - k, my - k, cx + k, my + k);
        line(ctx, cx - k, my + k, cx + k, my - k);
      } else if (f === 0) { // solta: bolinha vazada
        ctx.strokeStyle = dot;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(cx, my, Math.min(markH, sx) * 0.3, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(cx, gy0 + (f - start + 0.5) * fy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }

  // acorde que está soando no tempo b (índice) e o próximo de verdade
  function chordNow(chords, b) {
    let lo = 0, hi = chords.length - 1, i = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (chords[mid].start_beat <= b) { i = mid; lo = mid + 1; } else hi = mid - 1; }
    const cur = i >= 0 && b < chords[i].end_beat && chords[i].kind !== 'N' ? chords[i] : null;
    let next = null;
    for (let j = i + 1; j < chords.length; j++) if (chords[j].kind !== 'N') { next = chords[j]; break; }
    return { cur, next };
  }

  class Highway {
    // source() devolve { b, ahead, inst, chords, notes (só a voz), color, flash, names } ou null; b e ahead em tempos
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
        // parado (pausa): só redesenha quando algo muda (inclusive outra lista de acordes do mesmo tamanho:
        // cifra colada, Simples ↔ Detalhada)
        const key = st ? `${st.b.toFixed(4)}|${st.inst}|${st.color}|${this.W}x${this.H}` : '-';
        const flashing = st && st.flash && now - st.flash.at < 520;
        const lists = st && (st.chords !== this.lastChords || st.notes !== this.lastNotes);
        if (key !== this.lastKey || flashing || lists) {
          this.lastKey = key;
          this.lastChords = st && st.chords;
          this.lastNotes = st && st.notes;
          this.draw(now, st);
        }
      }
      requestAnimationFrame(this.loop);
    }

    // altura que a pista deitada precisa (CSS px)
    static flatHeight(narrow) { return narrow ? 112 : 128; }

    draw(now, st) {
      const ctx = this.ctx;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, this.W, this.H);
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
      else if (this.orient === 'h') this.drawFlat(now, st);
      else this.drawHighway(now, st);
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

    // altura do cartão de largura w (o mesmo cálculo de card())
    static cardH(w, keys) {
      return Math.round(clamp(w * 0.2, 11, 26)) + (keys ? w * 0.86 * 0.36 : w * 0.7 * 0.9) + w * 0.16;
    }

    // cartão do acorde: nome em cima, formação embaixo; (cx, bottom) = meio da borda de baixo
    card(c, inst, cx, bottom, w, on, col, alpha) {
      const ctx = this.ctx;
      const shape = shapeOf(c, inst);
      const keys = shape && shape.keys;
      const nameH = Math.round(clamp(w * 0.2, 11, 26));
      const dw = keys ? w * 0.86 : w * 0.7, dh = keys ? dw * 0.36 : dw * 0.9;
      const h = Highway.cardH(w, keys);
      const x = cx - w / 2, y = bottom - h;
      ctx.fillStyle = `rgba(8,8,8,${(0.9 * alpha).toFixed(3)})`;
      roundRect(ctx, x, y, w, h, Math.min(12, w * 0.08));
      ctx.fill();
      ctx.strokeStyle = on ? rgba(col, alpha) : `rgba(255,255,255,${(0.35 * alpha).toFixed(3)})`;
      ctx.lineWidth = on ? 3 : 1.2;
      ctx.stroke();
      ctx.fillStyle = on ? rgba(col, alpha) : `rgba(255,255,255,${alpha.toFixed(3)})`;
      ctx.font = `650 ${nameH}px ${SERIF}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(c.display, cx, y + w * 0.05, w - 8);
      drawShape(ctx, cx - dw / 2 - (keys ? 0 : w * 0.04), y + nameH + w * 0.09, dw, dh, shape, on, col, alpha);
      return h;
    }

    // ---------------------------------------------------------------- Modo Show (em pé)
    drawHighway(now, st) {
      const ctx = this.ctx, W = this.W, H = this.H;
      const cfg = STRINGS[st.inst];
      const n = cfg ? cfg.names.length : 0;
      const col = st.color || WHITE;
      const narrow = W < 640;
      const P = narrow ? 1.3 : 1.8; // quanto a pista afina lá no fundo
      const top = 4, hit = H - (cfg ? (narrow ? 44 : 50) : 14);
      const hwW = Math.min(W - 12, Math.max(W * 0.5, Math.min(H * 1.1, 780)));
      const cx = W / 2, s1 = 1 / (1 + P);
      const sOf = (u) => 1 / (1 + P * u);
      const yOf = (u) => hit - ((hit - top) * (1 - sOf(u))) / (1 - s1);
      const uLow = (1 / (1 + ((1 - s1) * (H - hit)) / (hit - top)) - 1) / P; // abaixo da linha, até a borda
      const laneW = n ? hwW / n : hwW;
      const xOf = (u, lane) => cx + (lane + 0.5 - n / 2) * laneW * sOf(u);
      const edge = (u, side) => cx + side * (hwW / 2) * sOf(u);
      const fade = (u) => (u > 0.72 ? Math.max(0, (1 - u) / 0.28) : 1);
      const { b, ahead } = st, chords = st.chords || [];
      const uAt = (beat) => (beat - b) / ahead;
      const from = b + uLow * ahead;
      const band = (u0, u1) => {
        ctx.beginPath();
        ctx.moveTo(edge(u0, -1), yOf(u0));
        ctx.lineTo(edge(u1, -1), yOf(u1));
        ctx.lineTo(edge(u1, 1), yOf(u1));
        ctx.lineTo(edge(u0, 1), yOf(u0));
        ctx.closePath();
      };
      const { cur } = chordNow(chords, b);

      // pista
      const g = ctx.createLinearGradient(0, top, 0, hit);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(0.3, 'rgba(0,0,0,.66)');
      g.addColorStop(1, 'rgba(0,0,0,.8)');
      ctx.fillStyle = g;
      band(uLow, 1);
      ctx.fill();
      // cada acorde pinta a faixa do tempo que dura (o de agora na cor da música); o tom alternado vem da
      // posição do acorde na música, para não trocar quando o mais antigo sai da janela
      for (let i = 0; i < chords.length; i++) {
        const c = chords[i];
        if (c.start_beat > b + ahead) break;
        if (c.end_beat < from || c.kind === 'N') continue;
        const u0 = Math.max(uAt(c.start_beat), uLow), u1 = Math.min(uAt(c.end_beat), 1);
        ctx.fillStyle = c === cur ? rgba(col, 0.16) : `rgba(255,255,255,${i % 2 ? 0.025 : 0.055})`;
        band(u0, u1);
        ctx.fill();
      }
      ctx.strokeStyle = 'rgba(255,255,255,.3)';
      ctx.lineWidth = 2;
      line(ctx, edge(uLow, -1), H, edge(1, -1), top);
      line(ctx, edge(uLow, 1), H, edge(1, 1), top);
      // só o 1 de cada compasso, bem de leve
      for (let q = Math.ceil(from / 4) * 4; q <= b + ahead; q += 4) {
        const u = uAt(q);
        ctx.strokeStyle = `rgba(255,255,255,${(0.14 * fade(u)).toFixed(3)})`;
        ctx.lineWidth = 1;
        line(ctx, edge(u, -1), yOf(u), edge(u, 1), yOf(u));
      }
      // cordas: as que o acorde de agora toca ficam acesas
      const shapeNow = cur ? shapeOf(cur, st.inst) : null;
      const plays = (i) => !!(shapeNow && shapeNow.frets && shapeNow.frets[i] !== null);
      for (let i = 0; i < n; i++) {
        ctx.strokeStyle = plays(i) ? rgba(col, 0.75) : 'rgba(255,255,255,.3)';
        ctx.lineWidth = cfg.widths[i] * (narrow ? 0.85 : 1);
        line(ctx, xOf(uLow, i), H, xOf(1, i), top);
      }
      // troca de acorde: linha na cor da música
      for (const c of chords) {
        if (c.start_beat > b + ahead) break;
        if (c.start_beat <= b || c.kind === 'N') continue;
        const u = uAt(c.start_beat);
        ctx.strokeStyle = rgba(col, 0.7 * fade(u));
        ctx.lineWidth = 2.5;
        line(ctx, edge(u, -1), yOf(u), edge(u, 1), yOf(u));
      }

      // cartões: o de agora fica parado na linha o acorde inteiro; os que vêm descem e, chegando perto,
      // empilham em cima dele (nunca o cobrem). Tamanho limitado pela altura da pista (celular deitado).
      const keys = st.inst === 'teclado';
      const hOf = (w) => Highway.cardH(w, keys);
      let maxW = Math.min(hwW * 0.44, 190);
      while (maxW > 40 && hOf(maxW) > (hit - top) * 0.5) maxW -= 4;
      const cardW = (s) => clamp(maxW * s, Math.min(46, maxW), maxW);
      let limit = hit - 8; // borda de baixo que o próximo cartão pode ocupar
      if (cur) limit -= this.card(cur, st.inst, cx, hit - 8, maxW, true, col, 1) + 6;
      const placed = [];
      for (let i = 0; i < chords.length; i++) { // de perto para longe, calculando onde cada um fica
        const c = chords[i];
        if (c.start_beat > b + ahead) break;
        if (c.kind === 'N' || c.start_beat <= b) continue;
        const u = uAt(c.start_beat), w = cardW(sOf(u)), bottom = Math.min(yOf(u) - 3, limit);
        if (bottom - hOf(w) < top - 2) break; // não cabe mais nada em cima
        placed.push([c, bottom, w, fade(u)]);
        limit = bottom - hOf(w) - 4;
      }
      for (let j = placed.length - 1; j >= 0; j--) { // desenha de longe para perto
        const [c, bottom, w, a] = placed[j];
        if (a > 0) this.card(c, st.inst, cx, bottom, w, false, col, a);
      }

      this.flash(now, st, () => band(-0.05, 0.07), col);

      // linha de tocar; embaixo, o nome de cada corda (acesa se o acorde de agora toca nela)
      ctx.strokeStyle = rgba(col, 0.95);
      ctx.lineWidth = 4;
      line(ctx, edge(0, -1), hit, edge(0, 1), hit);
      for (let i = 0; i < n; i++) {
        const x = xOf(0, i), on = plays(i);
        ctx.fillStyle = on ? rgba(col, 1) : 'rgba(255,255,255,.55)';
        ctx.font = `${on ? 800 : 600} ${narrow ? 13 : 15}px ${SANS}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(cfg.names[i], x, hit + 8);
      }
    }

    // ---------------------------------------------------------------- "Tocando agora" (deitada)
    drawFlat(now, st) {
      const ctx = this.ctx, W = this.W, H = this.H;
      const col = st.color || WHITE;
      const narrow = W < 560;
      const rulerH = 10, top = 2, bot = H - rulerH - 4;
      const hitX = W * (narrow ? 0.16 : 0.12);
      const { b, ahead } = st, chords = st.chords || [];
      const pxb = (W - hitX) / ahead; // pixels por tempo
      const xOf = (beat) => hitX + (beat - b) * pxb;
      const from = b - hitX / pxb;
      const isKeys = st.inst === 'teclado';

      // régua: um risquinho por tempo, maior no 1 do compasso
      for (let q = Math.ceil(from); q <= b + ahead; q++) {
        const x = xOf(q), down = ((q % 4) + 4) % 4 === 0;
        ctx.strokeStyle = down ? 'rgba(255,255,255,.45)' : 'rgba(255,255,255,.18)';
        ctx.lineWidth = down ? 1.5 : 1;
        line(ctx, x, H - (down ? rulerH : rulerH * 0.5), x, H);
      }
      // blocos de acorde: do tamanho que duram, com o nome e a formação (que ficam à vista enquanto soa)
      for (const c of chords) {
        if (c.start_beat > b + ahead) break;
        if (c.end_beat < from || c.kind === 'N') continue;
        const x0 = xOf(c.start_beat) + 2, x1 = xOf(c.end_beat) - 2;
        if (x1 - x0 < 6) continue;
        const on = c.start_beat <= b && b < c.end_beat, past = c.end_beat <= b;
        ctx.fillStyle = on ? rgba(col, 0.2) : past ? 'rgba(255,255,255,.03)' : 'rgba(255,255,255,.07)';
        roundRect(ctx, x0, top, x1 - x0, bot - top, 9);
        ctx.fill();
        if (on) { ctx.strokeStyle = rgba(col, 1); ctx.lineWidth = 2; ctx.stroke(); }
        const a = past ? 0.35 : 1;
        const nameH = narrow ? 15 : 17;
        const dh0 = bot - top - nameH - 16, dw0 = isKeys ? Math.min(dh0 * 2.2, 100) : dh0 * 1.05;
        if (x1 - x0 < 30) continue;
        // bloco estreito (acorde curto, celular): a formação encolhe para caber, em vez de sumir
        const room = (on ? x1 - Math.max(x0, hitX) : x1 - x0) - 16;
        const fit = clamp(room / dw0, 0, 1);
        const dw = dw0 * fit, dh = dh0 * fit;
        const left = clamp(on ? Math.max(x0 + 8, hitX + 8) : x0 + 8, x0 + 8, Math.max(x0 + 8, x1 - Math.max(dw, 24) - 8));
        ctx.save();
        ctx.beginPath();
        ctx.rect(x0, top, x1 - x0, bot - top);
        ctx.clip();
        ctx.fillStyle = on ? rgba(col, 1) : `rgba(255,255,255,${a})`;
        ctx.font = `650 ${nameH}px ${SERIF}`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(c.display, left, top + 6);
        if (dw >= 26) drawShape(ctx, left - (isKeys ? 0 : dw * 0.1), top + nameH + 11, dw, dh, shapeOf(c, st.inst), on, col, a);
        ctx.restore();
      }
      // linha de tocar
      ctx.strokeStyle = rgba(col, 0.95);
      ctx.lineWidth = 3;
      line(ctx, hitX, 0, hitX, H);
    }

    // ---------------------------------------------------------------- voz (Modo Show): melodia sobre teclas
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

      const g = ctx.createLinearGradient(0, top, 0, hit);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(0.3, 'rgba(0,0,0,.66)');
      g.addColorStop(1, 'rgba(0,0,0,.8)');
      ctx.fillStyle = g;
      ctx.fillRect(left, top, kbW, hit - top);
      for (let q = Math.ceil(b / 4) * 4; q <= b + ahead; q += 4) {
        const y = yOf(uAt(q));
        ctx.strokeStyle = `rgba(255,255,255,${(0.14 * fade(uAt(q))).toFixed(3)})`;
        ctx.lineWidth = 1;
        line(ctx, left, y, left + kbW, y);
      }
      const active = new Set();
      for (let i = firstFrom(V, b); i < V.length; i++) {
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
          roundRect(ctx, kx[0] + 1.5, y1, kx[1] - 3, y0 - y1, Math.min(5, kx[1] / 3));
          ctx.fillStyle = on ? rgba(col, 1) : `rgba(255,255,255,${(0.92 * fade(u0)).toFixed(3)})`;
          ctx.fill();
        }
      }
      this.flash(now, st, () => { ctx.beginPath(); ctx.rect(left, hit - 26, kbW, 26); }, col);
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
        ctx.fillStyle = active.has(m) ? rgba(col, 1) : '#111';
        ctx.fillRect(kx[0], hit, kx[1], kbH * 0.62);
      }
      ctx.strokeStyle = rgba(col, 0.95);
      ctx.lineWidth = 3;
      line(ctx, left, hit, left + kbW, hit);
    }
  }

  window.Pista = { Highway, STRINGS };
})();
