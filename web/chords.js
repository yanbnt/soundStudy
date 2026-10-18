// Diagramas de acordes para violão (afinação padrão), a partir de raiz + tipo.
(function () {
  const OPEN_PC = [4, 9, 2, 7, 11, 4]; // cordas 6..1: Mi Lá Ré Sol Si Mi

  // Formas móveis: deslocamento de traste por corda (6..1), null = não tocar.
  const SHAPES = {
    E: { // raiz na 6ª corda
      maj: [0, 2, 2, 1, 0, 0], min: [0, 2, 2, 0, 0, 0], '7': [0, 2, 0, 1, 0, 0],
      m7: [0, 2, 0, 0, 0, 0], maj7: [0, null, 1, 1, 0, null], m7b5: [0, null, 0, 0, -1, null],
      dim7: [0, null, -1, 0, -1, null], dim: [0, 1, 2, 0, null, null], m6: [0, 2, 2, 0, 2, 0],
      mmaj7: [0, 2, 1, 0, 0, 0], '6': [0, 2, 2, 1, 2, 0], aug: [0, 3, 2, 1, 1, 0],
      sus2: [0, 2, 4, 4, 0, 0], sus4: [0, 2, 2, 2, 0, 0],
      '7sus4': [0, 2, 0, 2, 0, 0], '9': [0, null, 0, 1, 0, 2], m9: [0, null, 0, 0, 0, 2],
      '13': [0, null, 0, 1, 2, null],
    },
    A: { // raiz na 5ª corda
      maj: [null, 0, 2, 2, 2, 0], min: [null, 0, 2, 2, 1, 0], '7': [null, 0, 2, 0, 2, 0],
      m7: [null, 0, 2, 0, 1, 0], maj7: [null, 0, 2, 1, 2, 0], m7b5: [null, 0, 1, 0, 1, null],
      dim7: [null, 0, 1, -1, 1, null], dim: [null, 0, 1, 2, 1, null], m6: [null, 0, 2, 2, 1, 2],
      mmaj7: [null, 0, 2, 1, 1, 0], '6': [null, 0, 2, 2, 2, 2], aug: [null, 0, 3, 2, 2, 1],
      sus2: [null, 0, 2, 2, 0, 0], sus4: [null, 0, 2, 2, 3, 0],
      '7sus4': [null, 0, 0, 0, -2, null], '9': [null, 0, -1, 0, 0, 0], maj9: [null, 0, -1, 1, 0, null],
      m9: [null, 0, -2, 0, 0, null], '11': [null, 0, 0, 0, 0, null], '13': [null, 0, -1, 0, 2, 2],
    },
  };
  const ROOT_STRING_PC = { E: 4, A: 9 };

  // Acordes abertos clássicos (trastes absolutos).
  const OPEN = {
    '0:maj': [null, 3, 2, 0, 1, 0], '0:7': [null, 3, 2, 3, 1, 0], '0:maj7': [null, 3, 2, 0, 0, 0],
    '2:maj': [null, null, 0, 2, 3, 2], '2:min': [null, null, 0, 2, 3, 1],
    '2:7': [null, null, 0, 2, 1, 2], '2:m7': [null, null, 0, 2, 1, 1],
    '2:maj7': [null, null, 0, 2, 2, 2], '7:maj': [3, 2, 0, 0, 0, 3], '7:7': [3, 2, 0, 0, 0, 1],
  };

  function voicing(root, kind) {
    const options = [];
    const open = OPEN[root + ':' + kind];
    if (open) options.push({ frets: open, cost: 0, barre: false });
    for (const s of ['E', 'A']) {
      const shape = SHAPES[s][kind];
      if (!shape) continue;
      let f = (root - ROOT_STRING_PC[s] + 12) % 12;
      if (f === 0 && shape.some((x) => x !== null && x < 0)) f = 12;
      const frets = shape.map((x) => (x === null ? null : x + f));
      const isOpen = f === 0;
      options.push({ frets, cost: isOpen ? 0.1 : f + (s === 'A' ? 0.4 : 0.5), barre: !isOpen });
    }
    options.sort((a, b) => a.cost - b.cost);
    return options[0] || null;
  }

  function svg(root, kind, opts = {}) {
    const v = voicing(root, kind);
    if (!v) return '';
    const W = opts.width || 120, H = opts.height || 140;
    const left = 26, right = W - 14, top = 34, frets = 5;
    const sx = (right - left) / 5, fy = (H - top - 20) / frets;
    const played = v.frets.filter((f) => f !== null && f > 0);
    const maxF = played.length ? Math.max(...played) : 0;
    const minF = played.length ? Math.min(...played) : 1;
    const start = maxF <= 5 ? 1 : minF;
    const x = (s) => left + s * sx;
    const y = (f) => top + (f - start + 0.5) * fy;
    let o = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" class="chord-diagram" role="img" aria-label="Diagrama do acorde no violão">`;
    for (let i = 0; i <= frets; i++) {
      const yy = top + i * fy;
      o += `<line x1="${left}" y1="${yy}" x2="${right}" y2="${yy}" class="cd-fret" stroke-width="${i === 0 && start === 1 ? 4 : 1}"/>`;
    }
    for (let s = 0; s < 6; s++) o += `<line x1="${x(s)}" y1="${top}" x2="${x(s)}" y2="${top + frets * fy}" class="cd-string"/>`;
    if (start > 1) o += `<text x="${left - 8}" y="${top + fy * 0.5 + 4}" text-anchor="end" class="cd-label">${start}ª</text>`;
    v.frets.forEach((f, s) => {
      if (f === null) o += `<text x="${x(s)}" y="${top - 10}" text-anchor="middle" class="cd-mark">×</text>`;
      else if (f === 0) o += `<circle cx="${x(s)}" cy="${top - 14}" r="4" class="cd-open"/>`;
    });
    if (v.barre) {
      const at = Math.min(...played);
      const strings = v.frets.map((f, s) => (f === at ? s : -1)).filter((s) => s >= 0);
      if (strings.length >= 3) {
        const a = x(strings[0]), b = x(strings[strings.length - 1]);
        o += `<rect x="${a - 7}" y="${y(at) - 7}" width="${b - a + 14}" height="14" rx="7" class="cd-dot"/>`;
      }
    }
    v.frets.forEach((f, s) => {
      if (f === null || f === 0) return;
      const isRoot = (OPEN_PC[s] + f) % 12 === root;
      o += `<circle cx="${x(s)}" cy="${y(f)}" r="7" class="${isRoot ? 'cd-root' : 'cd-dot'}"/>`;
    });
    LETTERS.violao.forEach((l, s) => { o += `<text x="${x(s)}" y="${H - 4}" text-anchor="middle" class="cd-tun">${l}</text>`; });
    return o + '</svg>';
  }
  // letra de cada corda solta, embaixo dos diagramas pequenos (da mais grave para a mais aguda)
  const LETTERS = { violao: ['E', 'A', 'D', 'G', 'B', 'E'], cavaco: ['D', 'G', 'B', 'D'], baixo: ['E', 'A', 'D', 'G'] };

  // Qual dedo vai em cada nota: pestana com o indicador; o resto, um dedo por casa
  // (1 indicador, 2 médio, 3 anelar, 4 mínimo), sem passar do mínimo.
  function fingering(v) {
    const notes = [];
    v.frets.forEach((f, s) => { if (f !== null && f > 0) notes.push({ s, f, finger: 0 }); });
    if (!notes.length) return { notes, barre: null };
    const minF = Math.min(...notes.map((n) => n.f));
    const atMin = notes.filter((n) => n.f === minF);
    let barre = null;
    if (v.barre && atMin.length >= 2) {
      barre = { f: minF, from: atMin[0].s, to: atMin[atMin.length - 1].s };
      atMin.forEach((n) => { n.finger = 1; });
    }
    const base = minF - 1;
    const rest = notes.filter((n) => !n.finger).sort((a, b) => a.f - b.f || a.s - b.s);
    let prev = barre ? 1 : 0;
    for (let i = 0; i < rest.length;) {
      let j = i;
      while (j < rest.length && rest[j].f === rest[i].f) j++;
      const count = j - i;
      let start = Math.max(prev + 1, rest[i].f - base);
      if (start + count - 1 > 4) start = Math.max(prev + 1, 5 - count);
      for (let q = i; q < j; q++) rest[q].finger = Math.min(4, start + (q - i));
      prev = rest[j - 1].finger;
      i = j;
    }
    // o mesmo dedo não pode ficar em duas casas diferentes: renumera em ordem (casa, depois corda)
    const where = {};
    if (rest.some((n) => (where[n.finger] = where[n.finger] || new Set()).add(n.f).size > 1)) {
      rest.forEach((n, k) => { n.finger = Math.min(4, (barre ? 2 : 1) + k); });
    }
    return { notes, barre };
  }

  // O braço do violão visto por quem toca (a corda mais grossa em cima), mostrando 5 casas a partir de `start`.
  const NK = { left: 40, right: 296, top: 26, bottom: 120, frets: 5 };
  NK.fw = (NK.right - NK.left) / NK.frets;
  // s = 0 é a corda mais grave (em cima); com 6 cordas como antes, com 4 (cavaco, baixo) mais espaçadas
  const nkY = (s, n = 6) => (n === 6 ? 34 + s * 15.6 : 38 + s * ((112 - 38) / (n - 1)));
  const nkX = (f, start) => NK.left + (f - start + 0.6) * NK.fw;
  // primeira casa à vista: uma antes da mais baixa, mas sem deixar a mais alta de fora (formas e notas
  // da gravação com 4 casas de abertura cabem nas 5 casas desenhadas)
  const nkStart = (frets) => {
    const fretted = frets.filter((f) => f > 0);
    if (!fretted.length || Math.max(...fretted) <= NK.frets) return 1;
    const lo = Math.min(...fretted), hi = Math.max(...fretted);
    return Math.max(1, Math.min(lo, Math.max(lo - 1, hi - NK.frets + 1)));
  };

  // Marcas de corda solta (○) e de corda que não toca (×), logo antes da pestana.
  const MARK_X = 27;
  const STRING_NAMES = { violao: ['Mi', 'Lá', 'Ré', 'Sol', 'Si', 'Mi'], cavaco: ['Ré', 'Sol', 'Si', 'Ré'], baixo: ['Mi', 'Lá', 'Ré', 'Sol'] };

  // O braço de cada instrumento, para a pessoa reconhecer na hora: a cabeça com as tarraxas (6 no violão,
  // 4 no cavaco, 4 grandes no baixo), o nome da nota de cada corda, a grossura das cordas, as marcações
  // de casa e o número de cada casa embaixo.
  function board(start, label, nStrings = 6, inst = 'violao') {
    const { left, right, top, bottom, frets, fw } = NK;
    let o = `<svg viewBox="0 0 300 146" class="hand hand-${inst}" role="img" aria-label="${label}">`;
    const tun = { violao: 'Mi Lá Ré Sol Si Mi', cavaco: 'Ré Sol Si Ré', baixo: 'Mi Lá Ré Sol' }[inst];
    if (tun) o += `<text x="${right + 2}" y="${top - 10}" text-anchor="end" class="hn-title">${(INST_NAME[inst] || '').toUpperCase()}<tspan class="hn-label"> · afinação ${tun}</tspan></text>`;
    // cabeça do instrumento (só na pestana, quando o desenho começa na 1ª casa) com as tarraxas
    if (start === 1) {
      o += `<path d="M${left - 6} ${top - 3} L4 ${top - 9} Q0 ${top - 9} 0 ${top - 3} L0 ${bottom + 3} Q0 ${bottom + 9} 4 ${bottom + 9} L${left - 6} ${bottom + 3} Z" class="hn-head"/>`;
      const half = Math.ceil(nStrings / 2), r = inst === 'baixo' ? 4.6 : inst === 'cavaco' ? 2.9 : 3.3;
      for (let i = 0; i < half; i++) {
        const x = 7 + i * ((left - 18) / Math.max(1, half - 1 || 1));
        o += `<circle cx="${x}" cy="${top - 11}" r="${r}" class="hn-peg"/><circle cx="${x}" cy="${bottom + 11}" r="${r}" class="hn-peg"/>`;
      }
    }
    o += `<rect x="${left - 6}" y="${top}" width="${right - left + 10}" height="${bottom - top}" class="hn-wood"/>`;
    for (let i = 0; i < frets; i++) {
      const f = start + i, cx = left + (i + 0.5) * fw;
      if ([3, 5, 7, 9, 15].includes(f)) o += `<circle cx="${cx}" cy="${(top + bottom) / 2}" r="4.5" class="hn-inlay"/>`;
      if (f === 12) o += `<circle cx="${cx}" cy="${top + 24}" r="4" class="hn-inlay"/><circle cx="${cx}" cy="${bottom - 24}" r="4" class="hn-inlay"/>`;
      o += `<text x="${cx}" y="${bottom + 16}" text-anchor="middle" class="hn-fretnum">${f}</text>`; // nº da casa
    }
    if (start > 1) o += `<text x="${left - 8}" y="${bottom + 16}" text-anchor="end" class="hn-label">casa</text>`;
    for (let i = 1; i <= frets; i++) o += `<line x1="${left + i * fw}" y1="${top}" x2="${left + i * fw}" y2="${bottom}" class="hn-fret"/>`;
    if (start === 1) o += `<rect x="${left - 6}" y="${top}" width="6" height="${bottom - top}" class="hn-nut"/>`;
    else o += `<line x1="${left}" y1="${top}" x2="${left}" y2="${bottom}" class="hn-fret"/>`;
    const widths = nStrings === 6 ? [2.3, 2, 1.6, 1.3, 1, 0.8] : inst === 'baixo'
      ? [3.6, 3.1, 2.6, 2.1] : [1.4, 1.2, 1, 0.85];
    const names = STRING_NAMES[inst] || STRING_NAMES.violao;
    widths.forEach((w, s) => {
      const y = nkY(s, nStrings);
      o += `<line x1="${start === 1 ? left - 6 : 18}" y1="${y}" x2="${right + 4}" y2="${y}" class="hn-string" stroke-width="${w}"/>`;
      o += `<text x="10" y="${y + 3.2}" text-anchor="middle" class="hn-tun">${names[s] || ''}</text>`; // nota da corda solta
    });
    return o;
  }

  // Onde vai cada dedo no acorde, com o número dele (1 indicador, 2 médio, 3 anelar, 4 mínimo),
  // a pestana e as cordas soltas ou que não tocam.
  function neck(root, kind) {
    const v = root == null ? null : voicing(root, kind);
    const fing = v ? fingering(v) : { notes: [], barre: null };
    const start = nkStart(fing.notes.map((n) => n.f));
    const fx = (f) => nkX(f, start);
    const sy = nkY;
    let o = board(start, 'Onde pôr os dedos no braço do violão');
    if (v) {
      v.frets.forEach((f, s) => {
        if (f === null) o += `<text x="${MARK_X}" y="${sy(s) + 4}" text-anchor="middle" class="hn-mute">×</text>`;
        else if (f === 0) o += `<circle cx="${MARK_X}" cy="${sy(s)}" r="4.2" class="hn-open"/>`;
      });
    }

    // pestana: o indicador deitado sobre as cordas, numa barra só
    if (fing.barre) {
      const x = fx(fing.barre.f), y0 = sy(fing.barre.from), y1 = sy(fing.barre.to);
      o += `<rect x="${x - 8}" y="${y0 - 8}" width="16" height="${y1 - y0 + 16}" rx="8" class="hn-badge"/>` +
        `<text x="${x}" y="${(y0 + y1) / 2 + 3.8}" text-anchor="middle" class="hn-num">1</text>`;
    }
    // cada dedo: uma bolinha na casa, perto do traste, com o número do dedo
    for (const n of fing.notes) {
      if (fing.barre && n.finger === 1) continue;
      const x = fx(n.f), y = sy(n.s);
      o += `<circle cx="${x}" cy="${y}" r="7.6" class="hn-badge"/>` +
        `<text x="${x}" y="${y + 3.8}" text-anchor="middle" class="hn-num">${n.finger}</text>`;
    }
    return o + '</svg>';
  }

  // O que o violão toca agora, como na gravação: cada nota no lugar dela (corda e casa), com o nome
  // da nota; corda solta é a bolinha cheia antes do braço. `next` aparece apagado, para já preparar.
  // notas: [[nota MIDI, corda (1 = Mi agudo), casa], ...]
  // `inst`: 'violao' (6 cordas), 'cavaco' ou 'baixo' (4 cordas); a corda 1 é sempre a mais aguda.
  function play(now, next, names, inst = 'violao') {
    const n = (TUNING[inst] || TUNING.violao).length;
    const start = nkStart((now && now.length ? now : next || []).map((x) => x[2]));
    const dot = (x, cls) => {
      const y = nkY(n - x[1], n);
      if (x[2] === 0) return `<circle cx="${MARK_X}" cy="${y}" r="5.4" class="${cls} hn-openplay"/>`;
      if (x[2] < start || x[2] > start + NK.frets - 1) return ''; // fora das 5 casas à vista
      const cx = nkX(x[2], start);
      return `<circle cx="${cx}" cy="${y}" r="7.8" class="${cls}"/>` +
        (cls === 'hn-badge' ? `<text x="${cx}" y="${y + 3.3}" text-anchor="middle" class="hn-name">${names(x[0])}</text>` : '');
    };
    let o = board(start, `Notas que o ${INST_NAME[inst] || 'violão'} toca agora`, n, inst);
    for (const x of next || []) o += dot(x, 'hn-next');
    for (const x of now || []) o += dot(x, 'hn-badge');
    return o + '</svg>';
  }

  // "Como tocar" no instrumento escolhido: a forma do acorde no braço dele, com o número do dedo
  // (violão, cavaco), a nota do baixo (uma só), ou as teclas do teclado.
  // `names`: nome da nota (MIDI -> texto) na grafia do tom da música (Sol♯ em Lá maior, não Lá♭)
  function neckFor(c, inst, names = KEY_NAMES) {
    if (!c || c.root == null) return inst === 'teclado' ? '' : board(1, 'Braço do instrumento', (TUNING[inst] || TUNING.violao).length, inst) + '</svg>';
    if (inst === 'teclado') {
      return keysSvg(keyVoicing(c), { width: 300, height: 146, labels: true, names, rootPc: c.root, minOctaves: 3,
        label: 'Teclas do acorde: mão esquerda no baixo, mão direita no acorde' });
    }
    if (inst === 'violao') {
      const simple = !(c.ext && c.ext.length) && !c.alt5 && c.bass == null;
      if (simple && voicing(c.root, c.kind)) return neck(c.root, c.kind);
    }
    const v = searchFrets(c, inst);
    const n = TUNING[inst].length;
    const fing = v ? fingering(v) : { notes: [], barre: null };
    const start = nkStart(fing.notes.map((x) => x.f));
    let o = board(start, `Onde pôr os dedos no braço do ${INST_NAME[inst]}`, n, inst);
    if (v) {
      v.frets.forEach((f, s) => {
        if (inst === 'baixo') { // só a nota a tocar; corda solta ganha o nome junto da pestana
          if (f === 0) {
            o += `<circle cx="${MARK_X}" cy="${nkY(s, n)}" r="9" class="hn-badge"/>` +
              `<text x="${MARK_X}" y="${nkY(s, n) + 3.6}" text-anchor="middle" class="hn-name">${names(TUNING.baixo[s])}</text>`;
          }
        } else if (f === null) o += `<text x="${MARK_X}" y="${nkY(s, n) + 4}" text-anchor="middle" class="hn-mute">×</text>`;
        else if (f === 0) o += `<circle cx="${MARK_X}" cy="${nkY(s, n)}" r="4.2" class="hn-open"/>`;
      });
    }
    if (fing.barre) {
      const x = nkX(fing.barre.f, start), y0 = nkY(fing.barre.from, n), y1 = nkY(fing.barre.to, n);
      o += `<rect x="${x - 8}" y="${y0 - 8}" width="16" height="${y1 - y0 + 16}" rx="8" class="hn-badge"/>` +
        `<text x="${x}" y="${(y0 + y1) / 2 + 3.8}" text-anchor="middle" class="hn-num">1</text>`;
    }
    for (const nt of fing.notes) {
      if (fing.barre && nt.finger === 1) continue;
      const x = nkX(nt.f, start), y = nkY(nt.s, n);
      // no baixo as notas são tocadas uma de cada vez: mostra o nome da nota em vez do dedo
      const txt = inst === 'baixo' ? names(TUNING.baixo[nt.s] + nt.f) : nt.finger;
      o += `<circle cx="${x}" cy="${y}" r="${inst === 'baixo' ? 9 : 7.6}" class="hn-badge"/>` +
        `<text x="${x}" y="${y + 3.6}" text-anchor="middle" class="${inst === 'baixo' ? 'hn-name' : 'hn-num'}">${txt}</text>`;
    }
    return o + '</svg>';
  }
  const KEY_NAMES = (m) => ['Dó', 'Dó♯', 'Ré', 'Mi♭', 'Mi', 'Fá', 'Fá♯', 'Sol', 'Lá♭', 'Lá', 'Si♭', 'Si'][((m % 12) + 12) % 12];

  // ------------------------------------------------------------ outros instrumentos
  // Afinação de cada instrumento, da corda mais grave para a mais aguda (nota MIDI).
  const TUNING = { violao: [40, 45, 50, 55, 59, 64], cavaco: [62, 67, 71, 74], baixo: [28, 33, 38, 43] };
  const INST_NAME = { violao: 'violão', cavaco: 'cavaquinho', baixo: 'baixo', teclado: 'teclado' };
  // notas de cada tipo de acorde (semitons sobre a raiz), as mesmas de CHORD_TYPES no app/analysis.py
  const KIND_INTS = {
    maj: [0, 4, 7], min: [0, 3, 7], 7: [0, 4, 7, 10], m7: [0, 3, 7, 10], maj7: [0, 4, 7, 11], m7b5: [0, 3, 6, 10],
    dim7: [0, 3, 6, 9], m6: [0, 3, 7, 9], mmaj7: [0, 3, 7, 11], 6: [0, 4, 7, 9], aug: [0, 4, 8], dim: [0, 3, 6],
    sus2: [0, 2, 7], sus4: [0, 5, 7], '7sus4': [0, 5, 7, 10], 9: [0, 4, 7, 10, 14], maj9: [0, 4, 7, 11, 14],
    m9: [0, 3, 7, 10, 14], 11: [0, 7, 10, 14, 17], 13: [0, 4, 7, 10, 14, 21], '7sus2': [0, 2, 7, 10],
    maj7sus4: [0, 5, 7, 11], aug7: [0, 4, 8, 10], power: [0, 7],
  };

  // Notas do acorde (intervalos mod 12): tipo, quinta alterada (5-/5+) e extensões (6, 9, 11, 13).
  function chordInts(c) {
    let ints = (KIND_INTS[c.kind] || [0, 4, 7]).map((iv) => iv % 12);
    if (c.alt5) ints = ints.map((iv) => (iv === 7 ? 7 + c.alt5 : iv));
    for (const e of c.ext || []) ints.push(e % 12);
    return [...new Set(ints)];
  }
  const chordKey = (c) => [c.root, c.kind, (c.ext || []).join('.'), c.alt5 || 0, c.bass == null ? '' : c.bass].join('|');

  // Procura uma forma tocável no braço de qualquer instrumento de cordas: só notas do acorde, até 4 casas
  // de abertura e 4 dedos (pestana conta como um), cobrindo as notas que fazem o acorde (a quinta justa
  // pode faltar). No violão e no baixo a nota mais grave é o baixo do acorde; o cavaco toca as 4 cordas.
  const searchCache = new Map();
  function searchFrets(c, inst) {
    const key = inst + '#' + chordKey(c);
    if (searchCache.has(key)) return searchCache.get(key);
    if (inst === 'baixo') { // baixo toca uma nota só: a do baixo do acorde (C7 -> Dó; C/E -> Mi)
      const v = { frets: bassFret(c.bass != null ? c.bass : c.root), cost: 0, barre: false };
      searchCache.set(key, v);
      return v;
    }
    const tuning = TUNING[inst];
    const n = tuning.length;
    const ints = chordInts(c);
    const pcs = new Set(ints.map((iv) => (c.root + iv) % 12));
    const need = (ints.length >= 4 ? ints.filter((iv) => iv !== 7) : ints).map((iv) => (c.root + iv) % 12);
    const lowPc = c.bass != null ? c.bass : c.root;
    // o baixo do acorde com barra (D/C) também pode ser tocado, mas só como a nota mais grave
    const optPcs = new Set(pcs);
    const extraBass = inst !== 'cavaco' && c.bass != null && !pcs.has(c.bass);
    if (extraBass) optPcs.add(c.bass);
    // cavaco: as 4 cordas (o baixo já saiu lá em cima, com uma nota só)
    const minSound = inst === 'violao' ? Math.min(4, Math.max(3, ints.length)) : 4;
    let best = null;
    const evaluate = (fr) => {
      const firstSound = fr.findIndex((f) => f !== null);
      if (firstSound < 0) return;
      const cnt = fr.filter((f) => f !== null).length;
      if (cnt < minSound) return;
      if (extraBass) {
        for (let s = firstSound + 1; s < n; s++) if (fr[s] !== null && (tuning[s] + fr[s]) % 12 === c.bass) return;
      }
      let interior = 0;
      for (let s = firstSound; s < n; s++) if (fr[s] === null) interior++;
      if (interior > (inst === 'violao' ? 1 : 0)) return;
      const fretted = fr.filter((f) => f !== null && f > 0);
      const minF = fretted.length ? Math.min(...fretted) : 0;
      const maxF = fretted.length ? Math.max(...fretted) : 0;
      if (maxF - minF > 3) return;
      const atMin = fretted.filter((f) => f === minF).length;
      // pestana de verdade: entre a 1ª e a última corda presa na casa mais baixa não pode haver corda
      // solta nem corda que não toca (o dedo deitado prenderia as duas)
      let barreOk = false;
      if (atMin >= 2) {
        const idx = fr.map((f, s) => (f === minF ? s : -1)).filter((s) => s >= 0);
        barreOk = true;
        for (let s = idx[0]; s <= idx[idx.length - 1]; s++) if (fr[s] === null || fr[s] < minF) barreOk = false;
      }
      const barre = inst !== 'baixo' && barreOk && fretted.length > 4 - (inst === 'violao' ? 0 : 1);
      const fingers = barre ? fretted.length - atMin + 1 : fretted.length;
      if (inst !== 'baixo' && fingers > 4) return;
      const have = new Set(fr.map((f, s) => (f === null ? null : (tuning[s] + f) % 12)).filter((x) => x !== null));
      const missing = need.filter((pc) => !have.has(pc)).length;
      const lowest = (tuning[firstSound] + fr[firstSound]) % 12;
      let cost = missing * 3 + interior * 1.5 + 0.22 * minF + (maxF - minF) * 0.3 + 0.12 * (n - cnt);
      if (inst !== 'cavaco' && lowest !== lowPc) cost += 4;
      if (inst === 'violao' && firstSound > 2) cost += 2; // acorde só nas cordas agudas: pouco som
      cost -= 0.15 * fr.filter((f) => f === 0).length; // corda solta ajuda
      if (!best || cost < best.cost) best = { frets: fr.slice(), cost, barre };
    };
    for (let base = 1; base <= 10; base++) {
      const opts = tuning.map((open) => {
        const o = [null];
        if (base <= 3 && optPcs.has(open % 12)) o.push(0);
        for (let f = base; f <= base + 3; f++) if (optPcs.has((open + f) % 12)) o.push(f);
        return o;
      });
      const cur = new Array(n);
      const rec = (i) => {
        if (i === n) { evaluate(cur); return; }
        for (const f of opts[i]) { cur[i] = f; rec(i + 1); }
      };
      rec(0);
    }
    searchCache.set(key, best);
    return best;
  }

  // A nota no baixo onde o baixista põe a mão: na corda Mi ou na Lá, na casa mais baixa
  // (Mi, Fá, Sol na corda Mi; Lá, Si, Dó, Ré na corda Lá).
  function bassFret(pc) {
    const t = TUNING.baixo;
    const onE = (((pc - t[0]) % 12) + 12) % 12, onA = (((pc - t[1]) % 12) + 12) % 12;
    return onE <= onA ? [onE, null, null, null] : [null, onA, null, null];
  }

  // Diagrama vertical (como numa revista de cifras) para qualquer número de cordas.
  function fretSvg(v, tuning, rootPc, W, H, label, inst = 'violao') {
    const n = tuning.length;
    const left = n === 6 ? 26 : 30, right = W - (n === 6 ? 14 : 18), top = 34, frets = 5;
    const sx = (right - left) / (n - 1), fy = (H - top - 20) / frets;
    const played = v.frets.filter((f) => f !== null && f > 0);
    const maxF = played.length ? Math.max(...played) : 0;
    const minF = played.length ? Math.min(...played) : 1;
    const start = maxF <= 5 ? 1 : minF;
    const x = (s) => left + s * sx;
    const y = (f) => top + (f - start + 0.5) * fy;
    let o = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" class="chord-diagram" role="img" aria-label="${label}">`;
    for (let i = 0; i <= frets; i++) {
      const yy = top + i * fy;
      o += `<line x1="${left}" y1="${yy}" x2="${right}" y2="${yy}" class="cd-fret" stroke-width="${i === 0 && start === 1 ? 4 : 1}"/>`;
    }
    for (let s = 0; s < n; s++) o += `<line x1="${x(s)}" y1="${top}" x2="${x(s)}" y2="${top + frets * fy}" class="cd-string"/>`;
    if (start > 1) o += `<text x="${left - 8}" y="${top + fy * 0.5 + 4}" text-anchor="end" class="cd-label">${start}ª</text>`;
    v.frets.forEach((f, s) => {
      if (f === null && inst !== 'baixo') o += `<text x="${x(s)}" y="${top - 10}" text-anchor="middle" class="cd-mark">×</text>`;
      else if (f === 0) o += `<circle cx="${x(s)}" cy="${top - 14}" r="${inst === 'baixo' ? 6 : 4}" class="${inst === 'baixo' ? 'cd-root' : 'cd-open'}"/>`;
    });
    if (v.barre && played.length) {
      const strings = v.frets.map((f, s) => (f === minF ? s : -1)).filter((s) => s >= 0);
      if (strings.length >= 2) {
        const a = x(strings[0]), b = x(strings[strings.length - 1]);
        o += `<rect x="${a - 7}" y="${y(minF) - 7}" width="${b - a + 14}" height="14" rx="7" class="cd-dot"/>`;
      }
    }
    v.frets.forEach((f, s) => {
      if (f === null || f === 0) return;
      const isRoot = inst === 'baixo' || (tuning[s] + f) % 12 === rootPc;
      o += `<circle cx="${x(s)}" cy="${y(f)}" r="${inst === 'baixo' ? 7.5 : 7}" class="${isRoot ? 'cd-root' : 'cd-dot'}"/>`;
    });
    (LETTERS[inst] || []).forEach((l, s) => { o += `<text x="${x(s)}" y="${H - 4}" text-anchor="middle" class="cd-tun">${l}</text>`; });
    // cordas grossas no baixo, finas no cavaco
    if (inst !== 'violao') o = o.replace(/class="cd-string"/g, `class="cd-string" stroke-width="${inst === 'baixo' ? 2.4 : 1}"`);
    return o + '</svg>';
  }

  // Teclado: mão esquerda com o baixo do acorde (oitava de baixo) e mão direita com o acorde fechado,
  // a partir da raiz. A raiz tem anel; o baixo da mão esquerda é marcado à parte.
  function keyVoicing(c) {
    const ints = chordInts(c).sort((a, b) => a - b);
    const bassPc = c.bass != null ? c.bass : c.root;
    let start = 60 + c.root;   // mão direita perto do Dó central
    if (start > 66) start -= 12;
    const right = ints.map((iv) => start + iv);
    // mão esquerda: a nota do baixo pelo menos uma quarta abaixo da mão direita (nunca na mesma tecla)
    let left = start - 5 - ((start - 5 - bassPc) % 12 + 12) % 12;
    if (left >= start) left -= 12;
    return { left: [left], right };
  }

  // Teclado desenhado como um teclado de verdade (teclas brancas com volume, pretas mais curtas), com as
  // teclas do acorde marcadas. Com `labels`: o nome de cada nota marcada, as faixas "mão esquerda" e
  // "mão direita" e o Dó central apontado embaixo.
  function keysSvg(notes, opts = {}) {
    const W = opts.width || 168, H = opts.height || 70;
    const all = [...(notes.left || []), ...(notes.right || []), ...(notes.ghost || [])];
    if (!all.length) return '';
    let lo = Math.min(...all), hi = Math.max(...all);
    lo = Math.floor(lo / 12) * 12;            // começa num Dó
    hi = Math.max(lo + (opts.minOctaves || 2) * 12 - 1, Math.ceil((hi + 1) / 12) * 12 - 1); // termina num Si
    const BLACK = [1, 3, 6, 8, 10];
    const whites = [];
    for (let m = lo; m <= hi; m++) if (!BLACK.includes(m % 12)) whites.push(m);
    const big = !!opts.labels;
    const top = big ? 32 : 3, bottomPad = big ? 20 : 2;
    const kw = W / whites.length, kh = H - top - bottomPad, bh = kh * 0.62, bw = kw * 0.6;
    const xOf = {};
    whites.forEach((m, i) => { xOf[m] = i * kw; });
    let o = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" class="kb" role="img" aria-label="${opts.label || 'Teclas do acorde no teclado'}">`;
    o += `<rect x="0" y="${top - 2}" width="${W}" height="3" class="kb-felt"/>`; // feltro em cima das teclas
    whites.forEach((m) => {
      o += `<rect x="${xOf[m] + 0.5}" y="${top}" width="${kw - 1}" height="${kh}" rx="2.5" class="kb-white"/>` +
        `<rect x="${xOf[m] + 0.5}" y="${top + kh - Math.max(3, kh * 0.07)}" width="${kw - 1}" height="${Math.max(3, kh * 0.07)}" rx="2" class="kb-edge"/>`;
    });
    for (let m = lo; m <= hi; m++) {
      if (!BLACK.includes(m % 12)) continue;
      xOf[m] = xOf[m - 1] + kw - bw / 2;
      o += `<rect x="${xOf[m]}" y="${top}" width="${bw}" height="${bh}" rx="1.8" class="kb-black"/>` +
        `<rect x="${xOf[m] + bw * 0.18}" y="${top + bh - 4}" width="${bw * 0.64}" height="2.4" rx="1" class="kb-shine"/>`;
    }
    const center = (m) => xOf[m] + (BLACK.includes(m % 12) ? bw : kw) / 2;
    const mark = (m, cls) => {
      if (xOf[m] === undefined) return '';
      const black = BLACK.includes(m % 12);
      const cx = center(m);
      const r = Math.max(3, Math.min(black ? bw : kw, 14) * (big ? 0.4 : 0.36));
      const cy = top + (black ? bh - r - 3 : kh - r - Math.max(5, kh * 0.1));
      let s = `<circle cx="${cx}" cy="${cy}" r="${r}" class="${cls}"/>`;
      if (big && cls !== 'kb-ghost' && opts.names) s += `<text x="${cx}" y="${top - 3}" text-anchor="middle" class="kb-name">${opts.names(m)}</text>`;
      return s;
    };
    if (big) {
      // faixas das mãos: direita (acorde) em cima do teclado, esquerda (baixo) embaixo, para nunca se
      // sobreporem mesmo com as mãos perto
      const span = (ms) => {
        const xs = ms.filter((m) => xOf[m] !== undefined).map(center);
        return xs.length ? [Math.max(2, Math.min(...xs) - 9), Math.min(W - 2, Math.max(...xs) + 9)] : null;
      };
      const label = (a, b, y, txt) => {
        const mid = Math.min(Math.max((a + b) / 2, 40), W - 40); // o texto não sai do desenho
        return `<text x="${mid}" y="${y}" text-anchor="middle" class="kb-hand">${txt}</text>`;
      };
      const r = span(notes.right || []);
      if (r) o += `<path d="M${r[0]} 20 V16 H${r[1]} V20" class="kb-band"/>` + label(r[0], r[1], 11, notes.left && notes.left.length ? 'MÃO DIREITA' : 'NOTAS');
      const l = span(notes.left || []);
      const yb = top + kh;
      if (l) o += `<path d="M${l[0]} ${yb + 3} V${yb + 7} H${l[1]} V${yb + 3}" class="kb-band"/>` + label(l[0], l[1], yb + 17, 'MÃO ESQUERDA');
      if (xOf[60] !== undefined) { // Dó central: um triângulo embaixo da tecla
        const cx = center(60);
        o += `<path d="M${cx - 3.5} ${yb + 13} L${cx} ${yb + 8} L${cx + 3.5} ${yb + 13} Z" class="kb-c4"><title>Dó central</title></path>`;
      }
    }
    for (const m of notes.ghost || []) o += mark(m, 'kb-ghost');
    for (const m of notes.left || []) o += mark(m, 'kb-bass');
    for (const m of notes.right || []) o += mark(m, (opts.rootPc != null && m % 12 === opts.rootPc) ? 'kb-root' : 'kb-on');
    return o + '</svg>';
  }

  // Diagrama do acorde no instrumento escolhido (os cartões "Acorde agora" e "Próximo", palco e show).
  // c: trecho de acorde da análise (root, kind, ext, alt5, bass).
  function forInstrument(c, inst, opts = {}) {
    if (!c || c.root == null) return '';
    if (inst === 'teclado') {
      const W = opts.width ? Math.round(opts.width * 1.5) : 168;
      return keysSvg(keyVoicing(c), { width: W, height: Math.round(W * 0.42), rootPc: c.root,
        label: 'Teclas do acorde no teclado: mão esquerda no baixo, mão direita no acorde' });
    }
    const W = opts.width || 120, H = opts.height || 140;
    if (inst === 'cavaco' || inst === 'baixo') {
      const v = searchFrets(c, inst);
      return v ? fretSvg(v, TUNING[inst], c.root, W, H, `Diagrama do acorde no ${INST_NAME[inst]}`, inst) : '';
    }
    // violão: as formas de sempre quando o acorde é só o tipo; com extensões, 5- ou tipo sem forma, procura
    const simple = !(c.ext && c.ext.length) && !c.alt5 && c.bass == null;
    if (simple && voicing(c.root, c.kind)) return svg(c.root, c.kind, opts);
    const v = searchFrets(c, 'violao');
    return v ? fretSvg(v, TUNING.violao, c.root, W, H, 'Diagrama do acorde no violão') : svg(c.root, c.kind, opts);
  }

  // O que o teclado toca agora (as notas da gravação) e, apagadas, as próximas.
  function keysPlay(now, next, names) {
    const sounding = (now || []).map((x) => x[0]);
    const left = sounding.filter((m) => m < 60), right = sounding.filter((m) => m >= 60);
    const ghost = (next || []).map((x) => x[0]).filter((m) => !sounding.includes(m));
    return keysSvg({ left, right, ghost }, { width: 300, height: 146, labels: true, names, minOctaves: 3,
      label: 'Notas que o teclado toca agora' });
  }

  window.ChordDiagram = { svg, voicing, neck, neckFor, play, forInstrument, keysPlay, chordInts, searchFrets };
})();
