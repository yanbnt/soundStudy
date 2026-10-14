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
    const sx = (right - left) / 5, fy = (H - top - 10) / frets;
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
    return o + '</svg>';
  }

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
    return { notes, barre };
  }

  // O braço do violão visto por quem toca (a corda mais grossa em cima), mostrando 5 casas a partir de `start`.
  const NK = { left: 40, right: 296, top: 26, bottom: 120, frets: 5 };
  NK.fw = (NK.right - NK.left) / NK.frets;
  const nkY = (s) => 34 + s * 15.6;               // s = 0 é a 6ª corda (Mi grave), 5 é a 1ª (Mi agudo)
  const nkX = (f, start) => NK.left + (f - start + 0.6) * NK.fw;
  const nkStart = (frets) => {
    const fretted = frets.filter((f) => f > 0);
    if (!fretted.length || Math.max(...fretted) <= NK.frets) return 1;
    return Math.max(1, Math.min(...fretted) - 1);
  };

  function board(start, label) {
    const { left, right, top, bottom, frets, fw } = NK;
    let o = `<svg viewBox="0 0 300 130" class="hand" role="img" aria-label="${label}">`;
    o += `<rect x="${left - 6}" y="${top}" width="${right - left + 10}" height="${bottom - top}" class="hn-wood"/>`;
    for (let i = 0; i < frets; i++) {
      const f = start + i, cx = left + (i + 0.5) * fw;
      if ([3, 5, 7, 9, 15].includes(f)) o += `<circle cx="${cx}" cy="${(top + bottom) / 2}" r="4.5" class="hn-inlay"/>`;
      if (f === 12) o += `<circle cx="${cx}" cy="${top + 24}" r="4" class="hn-inlay"/><circle cx="${cx}" cy="${bottom - 24}" r="4" class="hn-inlay"/>`;
    }
    for (let i = 1; i <= frets; i++) o += `<line x1="${left + i * fw}" y1="${top}" x2="${left + i * fw}" y2="${bottom}" class="hn-fret"/>`;
    if (start === 1) o += `<rect x="${left - 6}" y="${top}" width="6" height="${bottom - top}" class="hn-nut"/>`;
    else {
      o += `<line x1="${left}" y1="${top}" x2="${left}" y2="${bottom}" class="hn-fret"/>`;
      o += `<text x="${left + fw / 2}" y="${top - 8}" text-anchor="middle" class="hn-label">${start}ª casa</text>`;
    }
    [2.3, 2, 1.6, 1.3, 1, 0.8].forEach((w, s) => {
      o += `<line x1="18" y1="${nkY(s)}" x2="${right + 4}" y2="${nkY(s)}" class="hn-string" stroke-width="${w}"/>`;
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
        if (f === null) o += `<text x="12" y="${sy(s) + 4}" text-anchor="middle" class="hn-mute">×</text>`;
        else if (f === 0) o += `<circle cx="12" cy="${sy(s)}" r="4.2" class="hn-open"/>`;
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
  function play(now, next, names) {
    const start = nkStart((now && now.length ? now : next || []).map((n) => n[2]));
    const dot = (n, cls) => {
      const y = nkY(6 - n[1]);
      if (n[2] === 0) return `<circle cx="12" cy="${y}" r="5.4" class="${cls} hn-openplay"/>`;
      if (n[2] < start || n[2] > start + NK.frets - 1) return ''; // fora das 5 casas à vista
      const x = nkX(n[2], start);
      return `<circle cx="${x}" cy="${y}" r="7.8" class="${cls}"/>` +
        (cls === 'hn-badge' ? `<text x="${x}" y="${y + 3.3}" text-anchor="middle" class="hn-name">${names(n[0])}</text>` : '');
    };
    let o = board(start, 'Notas que o violão toca agora');
    for (const n of next || []) o += dot(n, 'hn-next');
    for (const n of now || []) o += dot(n, 'hn-badge');
    return o + '</svg>';
  }

  window.ChordDiagram = { svg, voicing, neck, play };
})();
