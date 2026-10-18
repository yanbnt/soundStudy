// Pista do braço: o desenho de cada acorde (a formação, com a pestana e tudo, a mesma do cartão "Como
// tocar": shapeFor no chords.js) deitado no braço do instrumento, como ele é de verdade. Embaixo fica o braço
// real (casas com o espaçamento de verdade, nome das cordas; a corda mais grave em cima, como o braço visto
// por quem toca). As bolinhas dos acordes que vêm entram pela direita do braço e andam para a esquerda, em
// velocidade constante, até chegar na casa certa exatamente na hora de tocar; aí ficam na cor da música
// enquanto o acorde soa.
// Histórico: nota por nota com número (reprovado: "muita coisa"), cartão com diagrama ("quadrado grande"),
// faixas de corda com bolinhas no jeito do Guitar Hero ("não precisa imitar; quero o desenho no braço"),
// braços pequenos crescendo em perspectiva ("nada de zoom") e descendo de cima ("nada de cima para baixo;
// as notas vêm chegando da direita para a esquerda"). Casas estreitas: 12 à vista (9 no celular).
// - Em pé (orient 'v', Modo Show): com o jogo valendo pontos, os indicadores em cima (pontos, multiplicador,
//   sequência, plateia e o retorno "Perfeito!/Errou"); o acerto do microfone (game.js confere cada tempo
//   contra o acorde) solta raios do desenho daquele acorde.
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
  const FEEDBACK = { perfect: 'Perfeito!', good: 'Boa!', miss: 'Errou', silence: 'Toque!' };
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

  // casas presas de uma formação (para escolher as casas à vista)
  const frettedOf = (sh) => (sh && sh.frets ? sh.frets.filter((f) => f !== null && f > 0) : []);

  // nota de cada corda solta (MIDI), da mais grave para a mais aguda (a mesma afinação do chords.js)
  const OPEN = { violao: [40, 45, 50, 55, 59, 64], cavaco: [62, 67, 71, 74], baixo: [28, 33, 38, 43] };

  // Onde cada nota de uma batida do instrumento cai no braço: na formação do acorde daquele momento (a nota
  // exata na corda da formação); senão a nota de verdade na corda mais perto da região do acorde; senão a
  // mesma nota (outra oitava) numa corda da formação. Uma bolinha por corda. Cache por batida.
  const posCache = new WeakMap();
  function attackPositions(e, chords, inst) {
    const hit = posCache.get(e);
    if (hit && hit.chords === chords && hit.inst === inst) return hit.pos;
    const open = OPEN[inst];
    let pos = [];
    if (open) {
      const c = chordNow(chords, e[0] + 0.01);
      const fr = c && shapeOf(c, inst) && shapeOf(c, inst).frets;
      const used = fr ? fr.filter((f) => f !== null && f > 0) : [];
      const center = used.length ? used.reduce((a, f) => a + f, 0) / used.length : 2;
      const byString = new Map(); // corda -> [casa, quão boa é a escolha (menor = melhor)]
      for (const x of e[2]) {
        const m = x[0];
        let best = null;
        const consider = (i, f, score) => { if (f >= 0 && f <= 14 && (!best || score < best[2])) best = [i, f, score]; };
        if (fr) fr.forEach((f, i) => { if (f !== null && open[i] + f === m) consider(i, f, 0); });
        open.forEach((o, i) => consider(i, m - o, 1 + Math.abs(m - o - center) * 0.5 + (fr && fr[i] === null ? 0.3 : 0)));
        if (fr) fr.forEach((f, i) => { if (f !== null && (((open[i] + f - m) % 12) + 12) % 12 === 0) consider(i, f, 3); });
        if (best && (!byString.has(best[0]) || byString.get(best[0])[1] > best[2])) byString.set(best[0], [best[1], best[2]]);
      }
      pos = [...byString].map(([i, v]) => [i, v[0]]);
    } else { // teclado: a própria tecla
      pos = e[2].map((x) => [x[0], 0]);
    }
    posCache.set(e, { chords, inst, pos });
    return pos;
  }

  // sem notas do instrumento na música: uma batida por acorde, com as notas da formação
  const synthCache = new WeakMap();
  function chordAttacks(chords, inst) {
    let m = synthCache.get(chords);
    if (!m) synthCache.set(chords, (m = new Map()));
    if (m.has(inst)) return m.get(inst);
    const ev = [];
    for (const c of chords) {
      const sh = shapeOf(c, inst);
      if (!sh) continue;
      const open = OPEN[inst];
      const notes = sh.keys ? [...sh.keys.left, ...sh.keys.right].map((k) => [k, 0, 0])
        : sh.frets.map((f, i) => (f === null ? null : [open[i] + f, 0, 0])).filter(Boolean);
      ev.push([c.start_beat, c.end_beat - c.start_beat, notes]);
    }
    m.set(inst, ev);
    return ev;
  }

  // 1ª casa à vista para mostrar as casas `u` em `count` casas (null se não cabem)
  function fitStart(u, count) {
    if (!u.length) return 1;
    const lo = Math.min(...u), hi = Math.max(...u);
    let s = Math.max(1, lo - 1);
    if (hi > s + count - 1) s = hi - count + 1;
    return s > lo ? null : s;
  }

  // acorde que está soando no tempo b
  function chordNow(chords, b) {
    let lo = 0, hi = chords.length - 1, i = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (chords[mid].start_beat <= b) { i = mid; lo = mid + 1; } else hi = mid - 1; }
    return i >= 0 && b < chords[i].end_beat && chords[i].kind !== 'N' ? chords[i] : null;
  }

  // A casa mais alta que a música usa nesse instrumento: define se o braço fica parado. Calculada aos poucos
  // fora dos quadros (searchFrets pesa no PC fraco); enquanto não fica pronta, devolve null e o braço
  // acompanha o acorde de agora e o próximo.
  const reachCache = new WeakMap();
  function songReach(chords, inst) {
    let m = reachCache.get(chords);
    if (!m) reachCache.set(chords, (m = new Map()));
    const job = m.get(inst);
    if (job) return job.done ? job.hi : null;
    const j = { hi: 0, i: 0, done: false };
    m.set(inst, j);
    const step = () => {
      const end = Math.min(chords.length, j.i + 4);
      for (; j.i < end; j.i++) for (const f of frettedOf(shapeOf(chords[j.i], inst))) if (f > j.hi) j.hi = f;
      if (j.i < chords.length) setTimeout(step, 20);
      else j.done = true;
    };
    setTimeout(step, 0);
    return null;
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
    // tempos; flash = { result, at, b (tempo conferido) }; game = { score, combo, mult, energy }
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
        const flashing = st && st.flash && now - st.flash.at < 850;
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

    // altura que a pista deitada precisa (CSS px): o nome do acorde, o braço (ou teclado) e as casas embaixo
    static flatHeight(narrow, inst) {
      const cfg = STRINGS[inst];
      if (!cfg) return narrow ? 210 : 250; // teclado: teclas embaixo e o espaço por onde o próximo acorde cai
      return Math.round(cfg.names.length * (narrow ? 24 : 30) + 66);
    }

    // Texto sempre em pé, mesmo com o braço girado (Modo Show): (x, y) no braço deitado; em pé o ponto vai
    // para (y, H - x) da tela, com o alinhamento `vAlign/vBase` próprio de lá.
    txt(s, x, y, align, base, vAlign, vBase) {
      const ctx = this.ctx;
      if (!this.vert) {
        ctx.textAlign = align;
        ctx.textBaseline = base;
        ctx.fillText(s, x, y);
        return;
      }
      ctx.save();
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.textAlign = vAlign;
      ctx.textBaseline = vBase;
      ctx.fillText(s, y, this.H - x);
      ctx.restore();
    }

    draw(now, st) {
      const ctx = this.ctx;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, this.W, this.H);
      this.moving = false;
      this.vert = false;
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
    // e o próximo (quando os dois não cabem juntos, o de agora; e o próximo quando ele está pousando)
    fretWindow(chords, inst, cur, next, nextLanding, count, now) {
      let target = 1;
      const reach = songReach(chords, inst);
      if (reach === null || reach > count) {
        const fc = frettedOf(shapeOf(cur, inst)), fn = frettedOf(shapeOf(next, inst));
        target = fitStart([...fc, ...fn], count);
        if (target === null) target = (nextLanding ? fitStart(fn, count) : fitStart(fc, count)) || 1;
      }
      if (this.view === null || this.viewInst !== inst || this.viewChords !== chords) {
        this.view = target;
        this.viewInst = inst;
        this.viewChords = chords;
      }
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
      const col = st.color || WHITE;
      // compacto pela largura e também pela altura (celular deitado)
      const narrow = W < 640 || (!compact && H < 420);
      const { b, ahead } = st, chords = st.chords || [];
      const cur = chordNow(chords, b);
      const coming = [];
      for (const c of chords) {
        if (c.start_beat > b + ahead) break;
        if (c.kind !== 'N' && c.start_beat > b) coming.push(c);
      }
      const next = coming[0] || null;
      const nextLanding = !!next && next.start_beat - b <= 0.25; // o próximo já está entrando no braço
      const fl = st.flash && now - st.flash.at < 600 ? st.flash : null;

      // em cima: indicadores do jogo (show) e o nome do acorde de agora
      let top = compact ? 2 : narrow ? 38 : 46;
      if (st.game && !compact) top = this.drawHud(st.game, col, top, narrow, st.flash, now) + 6;
      const nameSize = compact ? (narrow ? 15 : 17) : narrow ? 20 : 30;
      const padX = compact ? 4 : narrow ? 10 : 28;
      const numH = keys ? 6 : compact ? 14 : narrow ? 16 : 20; // números das casas embaixo do braço
      const labelH = Math.round(nameSize * 0.7) + 6; // nome dos acordes que vêm, em cima do braço
      const room = Math.max(30, H - top - nameSize - 8 - labelH - numH);
      // o braço ocupa o quadro (nada desce de cima: as bolinhas vêm pela direita, dentro dele)
      // no teclado sobra espaço em cima: o próximo acorde cai de lá até as teclas
      const boardH = keys
        ? clamp((W - 2 * padX) * 0.1, Math.min(36, room * 0.45), room * 0.45)
        : Math.min(room, Math.max(40, n * (compact ? (narrow ? 24 : 30) : narrow ? 30 : 40)));
      // à esquerda do braço: o nome das cordas e, antes da pestana do braço, os anéis (solta) e × (não toca)
      const rEst = clamp((boardH / n) * 0.4, 3, 17);
      const labelW = keys ? 0 : (compact ? (narrow ? 24 : 30) : narrow ? 30 : 40) + rEst * 1.9 + 6;
      let nx0 = padX + labelW, nx1 = W - padX;
      let ny1 = H - numH - 2, ny0 = ny1 - boardH;
      const nameY = top + 2;
      const T = () => (x, y) => [x, y]; // o braço de verdade, sem deslocamento
      // Modo Show: o braço em pé (o usuário: "no modo ao vivo o braço voltou a ser horizontal"). É o mesmo
      // braço deitado, girado: a pestana do braço embaixo, as casas subindo, a corda mais grave à esquerda (a
      // ordem do diagrama); o próximo acorde desce de cima até a casa certa. Os textos ficam em pé (txt).
      const vert = !compact && !keys;
      this.vert = vert;
      let vBoard = boardH;
      if (vert) {
        vBoard = clamp(n * (narrow ? 44 : 56), 120, W - 2 * padX - 44); // largura do braço na tela
        const rV = clamp((vBoard / n) * 0.4, 3, 17);
        nx0 = 8 + rV * 1.9 + 30;               // pestana perto da borda de baixo (embaixo: anéis e nomes)
        nx1 = H - (top + nameSize + 14);       // fim do braço logo abaixo do nome do acorde
        ny0 = (W - vBoard) / 2;
        ny1 = ny0 + vBoard;
      }

      // geometria do braço (ou do teclado) em coordenadas do braço de verdade
      let geo;
      // casas à vista: mais casas, cada uma mais estreita (estava comprido); em pé o braço é mais curto
      const count = vert ? (narrow ? 7 : 9) : narrow ? 9 : 12;
      const stringGeo = (fs) => {
        const F0 = fs - 1, F1 = F0 + count, p0 = fretPos(F0), p1 = fretPos(F1);
        const fx = (F) => nx0 + ((fretPos(F) - p0) / (p1 - p0)) * (nx1 - nx0);
        const gap = (vert ? vBoard : boardH) / n;
        const R = clamp(Math.min(gap * 0.4, (fx(F1) - fx(F1 - 1)) * 0.3), 3, 17);
        return {
          keys: false, inst: st.inst, F0, F1, fx, gap, R, sy: (i) => ny0 + (i + 0.5) * gap,
          dotX: (f) => fx(f - 1) + (fx(f) - fx(f - 1)) * 0.56,
        };
      };
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
        geo = stringGeo(this.fretWindow(chords, st.inst, cur, next, nextLanding, count, now));
      }
      // o braço pequeno de um acorde que não cabe nas casas à vista ganha as casas dele
      const geoOf = (sh) => {
        if (keys || !sh || !sh.frets) return geo;
        const u = frettedOf(sh);
        if (!u.length || (Math.min(...u) - 0.5 >= geo.F0 && Math.max(...u) - 0.5 <= geo.F1)) return geo;
        return stringGeo(fitStart(u, count) || Math.max(1, Math.max(...u) - count + 1));
      };

      // em pé: tudo é desenhado no braço deitado e girado 90° (x deitado -> altura, de baixo para cima)
      ctx.save();
      if (vert) ctx.transform(0, -1, 1, 0, 0, H);

      // o braço de verdade
      this.boardBase(geo, T(), 1, true, cfg, n, col, cur, compact, narrow, nx0, nx1, ny0, ny1);

      // Só os acordes, como na cifra (o usuário reprovou mostrar cada batida: "muita informação"): o acorde
      // de agora na casa dele, na cor da música; e só o PRÓXIMO chegando pela direita, andando para a
      // esquerda até a casa certa na hora (dois compassos para atravessar o braço), só bolinhas e pestana.
      if (cur) {
        const sh = shapeOf(cur, st.inst);
        if (sh) this.shape(geo, T(), 1, sh, true, col, 1, false);
      }
      const pxb = (nx1 - nx0) / 8;
      const gutter = keys ? 0 : geo.R * 2.2;
      ctx.save();
      ctx.beginPath();
      ctx.rect(nx0 - gutter, ny0 - labelH, nx1 - nx0 + gutter + padX, ny1 - ny0 + labelH + 1);
      ctx.clip();
      if (next && keys) {
        // teclado: as teclas do próximo acorde caem de cima até o teclado, chegando na hora (um compasso)
        ctx.restore();
        const fallTop = nameY + nameSize + 6, laneH = ny0 - fallTop;
        const sh = shapeOf(next, st.inst);
        if (sh && sh.keys && laneH > 20) {
          ctx.fillStyle = 'rgba(0,0,0,.35)';
          ctx.fillRect(nx0, fallTop, nx1 - nx0, laneH);
          for (let m = geo.lo; m <= geo.hi; m++) { // faixas das teclas pretas, de leve, para guiar o olho
            const kk = geo.keyX.get(m);
            if (kk && kk[2]) { ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(kk[0], fallTop, kk[1], laneH); }
          }
          const dy = (next.start_beat - b) * (laneH / 4);
          if (dy <= laneH) {
            const yb = ny0 - dy, mh = Math.max(8, Math.min(14, laneH * 0.16));
            let lx = nx1;
            for (const m of [...sh.keys.left, ...sh.keys.right]) {
              const kk = geo.keyX.get(m);
              if (!kk) continue;
              lx = Math.min(lx, kk[0]);
              ctx.fillStyle = col === WHITE ? (kk[2] ? '#888' : '#bbb') : kk[2] ? 'rgba(200,200,200,.95)' : 'rgba(255,255,255,.95)';
              roundRect(ctx, kk[0] + 1.5, yb - mh, kk[1] - 3, mh, Math.min(4, kk[1] / 3));
              ctx.fill();
            }
            ctx.fillStyle = 'rgba(255,255,255,.9)';
            ctx.font = `650 ${Math.round(nameSize * 0.7)}px ${SERIF}`;
            ctx.textAlign = 'right';
            ctx.textBaseline = 'bottom';
            ctx.fillText(next.display, Math.max(nx0 + 40, lx - 6), yb);
          }
        }
        ctx.save();
      } else if (next) {
        const dx = (next.start_beat - b) * pxb;
        const sh = shapeOf(next, st.inst);
        if (sh && dx <= nx1 - nx0 + 80) {
          const g2 = geoOf(sh);
          this.shape(g2, (x, y) => [x + dx, y], 1, sh, false, col, 1, true);
          const u = frettedOf(sh);
          const lx = keys ? nx0 : u.length ? g2.dotX(Math.min(...u)) - g2.R : g2.fx(Math.max(g2.F0, 0));
          ctx.fillStyle = 'rgba(255,255,255,.9)';
          ctx.font = `650 ${Math.round(nameSize * 0.7)}px ${SERIF}`;
          if (vert) { // em pé: o nome ao lado do braço, descendo junto com o desenho
            ctx.restore();
            this.txt(next.display, lx + dx, ny0 - 8, 'left', 'bottom', 'right', 'middle');
            ctx.save();
          } else {
            this.txt(next.display, lx + dx, ny0 - 3, 'left', 'bottom', 'right', 'middle');
          }
        }
      }
      ctx.restore();
      // retorno do microfone sobre o acorde conferido (o tempo que acabou: na troca, ainda o anterior)
      if (fl) {
        const t = (now - fl.at) / 600;
        const judged = fl.b != null ? chordNow(chords, fl.b + 0.5) : cur;
        const hit = fl.result === 'perfect' || fl.result === 'good';
        if (hit && judged && judged === cur) this.rays(geo, shapeOf(judged, st.inst), col, t);
        else {
          ctx.fillStyle = hit ? rgba(col, 0.18 * (1 - t)) : `rgba(255,255,255,${(0.1 * (1 - t)).toFixed(3)})`;
          ctx.fillRect(nx0, ny0, nx1 - nx0, ny1 - ny0);
        }
      }
      ctx.restore(); // fim do braço girado
      // nome do acorde de agora, grande
      if (cur) {
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillStyle = rgba(col, 1);
        ctx.font = `650 ${nameSize}px ${SERIF}`;
        ctx.fillText(cur.display, padX + (compact ? 0 : 4), nameY);
      }
    }

    // o braço (ou teclado): madeira escura, trastes, pestana do braço (nut), marcações, cordas.
    // `real`: o braço de verdade (com nome das cordas e números das casas); senão um braço pequeno que vem
    boardBase(geo, tr, k, real, cfg, n, col, cur, compact, narrow, nx0, nx1, ny0, ny1, alpha = 1) {
      const ctx = this.ctx;
      const [x0, y0] = tr(nx0, ny0), [x1, y1] = tr(nx1, ny1);
      const a = alpha.toFixed(3);
      if (geo.keys) {
        for (const m of geo.whites) {
          const [kx, kw] = geo.keyX.get(m);
          const [ax] = tr(kx, ny0), [bx] = tr(kx + kw, ny0);
          ctx.fillStyle = real ? '#e8e8e8' : `rgba(232,232,232,${(0.85 * alpha).toFixed(3)})`;
          ctx.fillRect(ax + 0.5, y0, bx - ax - 1, y1 - y0);
        }
        for (let m = geo.lo; m <= geo.hi; m++) {
          const kk = geo.keyX.get(m);
          if (!kk || !kk[2]) continue;
          const [ax] = tr(kk[0], ny0), [bx] = tr(kk[0] + kk[1], ny0);
          ctx.fillStyle = real ? '#111' : `rgba(17,17,17,${a})`;
          ctx.fillRect(ax, y0, bx - ax, (y1 - y0) * 0.6);
        }
        return;
      }
      ctx.fillStyle = real ? '#171717' : `rgba(16,16,16,${(0.88 * alpha).toFixed(3)})`;
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      // marcações do braço (3, 5, 7, 9, 12): desligadas — mesmo bem de leve pareciam notas
      for (const F of []) {
        if (F - 0.5 < geo.F0 || F - 0.5 > geo.F1) continue;
        const mx = (geo.fx(F - 1) + geo.fx(F)) / 2;
        const ys = F === 12 ? [ny0 + (ny1 - ny0) * 0.3, ny0 + (ny1 - ny0) * 0.7] : [(ny0 + ny1) / 2];
        ctx.fillStyle = 'rgba(255,255,255,.05)';
        for (const yy of ys) {
          ctx.beginPath();
          ctx.arc(mx, yy, Math.max(1.5, geo.gap * 0.17), 0, Math.PI * 2);
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
      const startFret = Math.round(geo.F0) + 1;
      if (!real) { // braço pequeno com as casas dele: a 1ª casa escrita ao lado
        if (startFret > 1) {
          ctx.fillStyle = `rgba(255,255,255,${(0.8 * alpha).toFixed(3)})`;
          ctx.font = `700 ${Math.round(clamp(11 * Math.sqrt(k / 0.5), 9, 13))}px ${SANS}`;
          ctx.textAlign = 'right';
          ctx.textBaseline = 'middle';
          ctx.fillText(`${startFret}ª`, x0 - 4, (y0 + y1) / 2);
        }
        return;
      }
      // nome das cordas à esquerda (aceso se o acorde de agora toca nela) e o número das casas embaixo
      const sh = cur ? shapeOf(cur, geo.inst) : null;
      const fs = Math.min(compact ? (narrow ? 11 : 12) : narrow ? 12 : 15, geo.gap * 0.8);
      ctx.textBaseline = 'middle';
      for (let i = 0; i < n; i++) {
        const plays = !!(sh && sh.frets && sh.frets[i] !== null);
        ctx.fillStyle = plays ? rgba(col, 1) : 'rgba(255,255,255,.7)';
        ctx.font = `${plays ? 800 : 600} ${Math.round(fs)}px ${SANS}`;
        // deitado: à esquerda da pestana do braço; em pé: embaixo dela, debaixo de cada corda
        this.txt(cfg.names[i], nx0 - geo.R * 1.9 - 6, geo.sy(i) + 0.5, 'right', 'middle', 'center', 'top');
      }
      ctx.fillStyle = 'rgba(255,255,255,.45)';
      ctx.font = `700 ${compact ? 10 : narrow ? 11 : 13}px ${SANS}`;
      for (let F = Math.max(1, Math.ceil(geo.F0 + 0.5)); F <= Math.floor(geo.F1 + 0.5); F++) {
        const mx = (geo.fx(F - 1) + geo.fx(F)) / 2;
        if (mx < nx0 || mx > nx1) continue;
        // deitado: embaixo do braço; em pé: à direita dele
        this.txt(String(F), mx, ny1 + 3, 'center', 'top', 'left', 'middle');
      }
    }

    // O desenho do acorde: bolinhas nas casas, pestana, cordas soltas (anel) e que não tocam (×) antes do
    // braço; no teclado, as teclas. `on` (o de agora): na cor da música. Os que vêm (`moving`, andando da
    // direita para a esquerda): bolinhas brancas (cinza sem cor da música, para não confundir com o de
    // agora), sem os × (que ficam só no de agora).
    shape(geo, tr, k, sh, on, col, alpha, moving) {
      const ctx = this.ctx;
      const color = on ? rgba(col, alpha) : col === WHITE ? `rgba(150,150,150,${alpha.toFixed(3)})` : `rgba(255,255,255,${(0.95 * alpha).toFixed(3)})`;
      if (geo.keys) {
        if (!sh || !sh.keys) return;
        const marked = new Set([...sh.keys.left, ...sh.keys.right]);
        const lit = col === WHITE ? `rgba(85,85,85,${alpha.toFixed(3)})` : rgba(col, alpha);
        const keyBox = (kk) => {
          const [ax] = tr(kk[0], 0), [bx] = tr(kk[0] + kk[1], 0);
          const top = tr(0, geo.ny0)[1], bot = tr(0, geo.ny0 + (kk[2] ? geo.boardH * 0.6 : geo.boardH))[1];
          return [ax, bx, top, bot];
        };
        if (on) {
          // 1º as brancas acesas, depois TODAS as pretas por cima (a branca acesa não pinta a preta vizinha)
          for (const m of marked) {
            const kk = geo.keyX.get(m);
            if (!kk || kk[2]) continue;
            const [ax, bx, top, bot] = keyBox(kk);
            ctx.fillStyle = lit;
            ctx.fillRect(ax + 0.5, top, bx - ax - 1, bot - top);
          }
          for (let m = geo.lo; m <= geo.hi; m++) {
            const kk = geo.keyX.get(m);
            if (!kk || !kk[2]) continue;
            const [ax, bx, top, bot] = keyBox(kk);
            ctx.fillStyle = marked.has(m) ? lit : '#111';
            ctx.fillRect(ax, top, bx - ax, bot - top);
          }
          return;
        }
        for (const m of marked) { // que vem: anel no pé da tecla
          const kk = geo.keyX.get(m);
          if (!kk) continue;
          const [ax, bx, top, bot] = keyBox(kk);
          const r = Math.max(2, Math.min((bx - ax) * 0.3, (bot - top) * 0.2));
          ctx.strokeStyle = kk[2] ? `rgba(255,255,255,${alpha.toFixed(3)})` : `rgba(20,20,20,${alpha.toFixed(3)})`;
          ctx.lineWidth = Math.max(1.2, 2 * k);
          ctx.beginPath();
          ctx.arc((ax + bx) / 2, bot - r - 3 * k, r, 0, Math.PI * 2);
          ctx.stroke();
        }
        return;
      }
      if (!sh || !sh.frets) return;
      const R = geo.R * k, lw = Math.max(1.3, 2.4 * k);
      const paint = () => { ctx.fillStyle = color; ctx.fill(); };
      const solo = sh.frets.filter((f) => f !== null).length === 1; // baixo: uma nota só
      if (sh.barre && sh.barre.f - 0.5 >= geo.F0 && sh.barre.f - 0.5 <= geo.F1) {
        const [px, y0] = tr(geo.dotX(sh.barre.f), geo.sy(sh.barre.from));
        const [, y1] = tr(0, geo.sy(sh.barre.to));
        roundRect(ctx, px - R * 0.85, y0 - R * 0.85, R * 1.7, y1 - y0 + R * 1.7, R * 0.85);
        paint();
      }
      sh.frets.forEach((f, i) => {
        const [, py] = tr(0, geo.sy(i));
        const [nutX] = tr(geo.fx(Math.max(geo.F0, 0)), 0);
        if (f === null) { // não toca: × antes do braço (no baixo, nada: só a nota; nos que vêm, nada)
          if (solo || moving) return;
          const s = R * 0.45, cx = nutX - R * 0.95;
          ctx.strokeStyle = `rgba(255,255,255,${(0.5 * alpha).toFixed(3)})`;
          ctx.lineWidth = Math.max(1, 1.8 * k);
          line(ctx, cx - s, py - s, cx + s, py + s);
          line(ctx, cx - s, py + s, cx + s, py - s);
          return;
        }
        if (f === 0) { // solta: anel antes do braço (no baixo, a nota é ela: bolinha do tamanho das outras)
          if (moving && !solo) return; // no que está chegando, só bolinhas e pestana
          ctx.beginPath();
          ctx.arc(nutX - R * 0.95, py, solo ? R * 0.8 : R * 0.55, 0, Math.PI * 2);
          if (solo) paint();
          else { ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.stroke(); }
          return;
        }
        if (f - 0.5 < geo.F0 || f - 0.5 > geo.F1) return; // fora das casas à vista
        if (sh.barre && f === sh.barre.f && i >= sh.barre.from && i <= sh.barre.to) return; // já na pestana
        const [px] = tr(geo.dotX(f), 0);
        ctx.beginPath();
        ctx.arc(px, py, R, 0, Math.PI * 2);
        paint();
      });
    }

    // acertou (microfone): raios saindo das bolinhas do acorde conferido; no teclado, as teclas brilham
    rays(geo, sh, col, t) {
      const ctx = this.ctx;
      if (!sh) return;
      if (geo.keys) {
        if (!sh.keys) return;
        ctx.fillStyle = rgba(col === WHITE ? [150, 150, 150] : col, 0.45 * (1 - t));
        for (const m of [...sh.keys.left, ...sh.keys.right]) {
          const kk = geo.keyX.get(m);
          if (kk) ctx.fillRect(kk[0], geo.ny0 - 8, kk[1], 6);
        }
        return;
      }
      if (!sh.frets) return;
      ctx.strokeStyle = rgba(col, 0.9 * (1 - t));
      ctx.lineWidth = 2;
      sh.frets.forEach((f, i) => {
        if (f === null || f <= 0 || f - 0.5 < geo.F0 || f - 0.5 > geo.F1) return;
        const x = geo.dotX(f), y = geo.sy(i);
        for (let r = 0; r < 8; r++) {
          const ang = (r / 8) * Math.PI * 2, d0 = geo.R * (1.2 + t * 0.5), d1 = geo.R * (1.8 + t * 1.2);
          line(ctx, x + Math.cos(ang) * d0, y + Math.sin(ang) * d0, x + Math.cos(ang) * d1, y + Math.sin(ang) * d1);
        }
      });
    }

    // Indicadores do jogo, como no Guitar Hero, numa faixa em cima: à esquerda os pontos, o multiplicador (o
    // anel enche a cada acerto até o próximo), a sequência e, embaixo, o retorno do microfone ("Perfeito!");
    // à direita o medidor da plateia. Devolve onde a faixa termina.
    drawHud(g, col, by, narrow, flash, now) {
      const ctx = this.ctx, W = this.W;
      const bw = narrow ? 124 : 158, bh = narrow ? 62 : 86, r = narrow ? 28 : 40;
      const bx = narrow ? 8 : 24;
      ctx.fillStyle = 'rgba(0,0,0,.78)';
      roundRect(ctx, bx, by, bw, bh, 10);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = `800 ${narrow ? 18 : 26}px ${SANS}`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'top';
      ctx.fillText(g.score.toLocaleString('pt-BR'), bx + bw - 10, by + 8, bw - 20);
      const mr = narrow ? 13 : 18, mx = bx + 10 + mr, my = by + bh - mr - 9;
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
      ctx.font = `800 ${narrow ? 12 : 16}px ${SANS}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`x${g.mult}`, mx, my + 0.5);
      ctx.fillStyle = 'rgba(255,255,255,.85)';
      ctx.font = `700 ${narrow ? 11 : 14}px ${SANS}`;
      ctx.textAlign = 'right';
      ctx.fillText(`${g.combo} seguidos`, bx + bw - 10, my + 0.5, bx + bw - 10 - (mx + mr + 6));
      // retorno do microfone embaixo da caixa (fora da área onde os acordes chegam)
      const fbH = narrow ? 22 : 28;
      if (flash && now - flash.at < 850) {
        const t = (now - flash.at) / 850;
        const res = flash.result;
        ctx.fillStyle = res === 'perfect' ? rgba(col, 1 - t * t) : `rgba(255,255,255,${((res === 'good' ? 0.9 : 0.55) * (1 - t * t)).toFixed(3)})`;
        ctx.font = `italic 650 ${narrow ? 18 : 24}px ${SERIF}`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(FEEDBACK[res] || '', bx + 4, by + bh + 4);
      }
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
      return by + Math.max(bh + fbH, r + 18);
    }

    // ---------------------------------------------------------------- voz (só no show): melodia sobre teclas
    keyRange(V) {
      if (this.rangeOf === V) return this.range;
      let lo = 127, hi = 0, longest = 4;
      for (const e of V) {
        if (e[1] > longest) longest = e[1];
        for (const x of e[2]) { lo = Math.min(lo, x[0]); hi = Math.max(hi, x[0]); }
      }
      lo = Math.max(24, Math.floor(lo / 12) * 12);
      hi = Math.min(108, Math.ceil((hi + 1) / 12) * 12 - 1);
      while (hi - lo < 23) { if (lo > 24) lo -= 12; else hi += 12; }
      this.rangeOf = V;
      this.range = [lo, hi];
      this.longest = longest; // nota mais longa (de onde começar a procurar as que ainda soam)
      return this.range;
    }

    drawVoice(now, st) {
      const ctx = this.ctx, W = this.W, H = this.H;
      const V = st.notes, col = st.color || WHITE;
      const narrow = W < 640 || H < 420;
      const [lo, hi] = this.keyRange(V);
      const whites = [];
      for (let m = lo; m <= hi; m++) if (!BLACK.has(m % 12)) whites.push(m);
      const kbW = Math.min(W - 12, Math.max(W * 0.55, Math.min(H * 1.3, 920)));
      const kw = kbW / whites.length, left = (W - kbW) / 2;
      let top = 4;
      if (st.game) top = this.drawHud(st.game, col, narrow ? 38 : 46, narrow, st.flash, now) + 6;
      // o teclado nunca come o espaço por onde as notas caem
      const kbH = Math.max(30, Math.min(100, kw * 4.6, H - top - 80));
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
      for (let i = firstFrom(V, b, this.longest); i < V.length; i++) {
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
