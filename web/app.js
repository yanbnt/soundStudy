(() => {
  'use strict';

  const $ = (s) => document.querySelector(s);
  // Partes da gravação. Músicas novas vêm em 6 (o violão sozinho); as antigas, em 4.
  const STEM_INFO = {
    vocals: { name: 'Voz', desc: 'A melodia que está na partitura' },
    guitar: { name: 'Violão', desc: 'O que está na tablatura: tire para tocar no lugar' },
    piano: { name: 'Teclado', desc: 'Teclado e piano' },
    other: { name: 'Cavaco e outros', desc: 'Cavaco, banjo, sopros e o resto' },
    bass: { name: 'Baixo', desc: 'As notas graves dos acordes' },
    drums: { name: 'Percussão', desc: 'Pandeiro, tantã, surdo, bateria' },
  };
  const OLD_STEMS = [
    { key: 'vocals', name: 'Voz', desc: 'A melodia que está na partitura' },
    { key: 'other', name: 'Harmonia', desc: 'Violão, cavaco, teclado, sopros' },
    { key: 'bass', name: 'Baixo', desc: 'As notas graves dos acordes' },
    { key: 'drums', name: 'Percussão', desc: 'Pandeiro, tantã, surdo, bateria' },
  ];
  let STEMS = OLD_STEMS; // as partes da música aberta (useStems)
  const STAGE_HINTS = {
    convert: 'Lê o arquivo e prepara o áudio',
    separate: 'A parte mais demorada: isola cada instrumento',
    rhythm: 'Marca cada tempo e onde começa cada compasso',
    harmony: 'Descobre o tom e o acorde de cada tempo',
    melody: 'Ouve a voz e escreve as notas',
    violao: 'Acha cada nota do violão, com corda e casa',
    lyrics: 'Procura a letra na base aberta ou ouve a voz',
    score: 'Monta a partitura simples, a detalhada e a do violão',
  };
  const VIEWS = { home: '#viewHome', processing: '#viewProcessing', error: '#viewError', player: '#viewPlayer' };
  const PX_PER_BEAT = 24;

  // Mesa de som: cada canal tem fader, mudo, solo, pan e um equalizador (corte de grave, grave, médio,
  // agudo, corte de agudo). O master tem fader, limitador e equalizador gráfico de 10 bandas.
  const GEQ_F = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
  const EQ_DEF = () => ({
    on: true, hp: { on: false, f: 80 }, low: { f: 120, g: 0 }, mid: { f: 1000, g: 0, q: 1 },
    high: { f: 6000, g: 0 }, lp: { on: false, f: 12000 },
  });
  const BUS_DEF = () => ({ vol: 1, limiter: true, eq: { on: true, g: GEQ_F.map(() => 0) } });
  const newStrip = () => ({ vol: 1, mute: false, solo: false, pan: 0, eq: EQ_DEF() });
  const LOOP_STEPS = [0, 1, 2, 4];

  const S = {
    songs: [], stages: [], view: 'home', id: null, playerId: null, meta: null, an: null, hue: 140,
    audio: {}, master: null, playing: false, raf: 0, lastSync: 0, actx: null, analyser: null,
    speed: 1, volume: 1, muted: false, syncMs: 0, pos: 0, useBuffers: false, bufs: null, srcs: null,
    // no celular a partitura começa menor (cabem mais compassos na largura da tela)
    level: 'simples', zoom: window.matchMedia('(max-width: 700px)').matches ? 0.7 : 1, osmd: null, cTimes: [], cIdx: 0, sheetStale: false,
    loopN: 0, loopM: 0, loopStart: 0, loopEnd: 0, click: false,
    lastBeat: -1, chordIdx: -2, measure: -1, beat: -2, chips: [], dragging: false,
    pollTimer: 0, libTimer: 0, userScrollAt: 0, filter: 'all', query: '', stageOn: false,
    sheet: null, showSheet: null, showOn: false, gameOn: false, mood: null, moodAt: 0, mixBeforeShow: null,
    mix: Object.fromEntries(Object.keys(STEM_INFO).map((k) => [k, newStrip()])),
    bus: BUS_DEF(), cxTab: 'canais', eqSel: '_bus', eqBand: null,
  };

  function useStems(keys) {
    STEMS = keys && keys.includes('guitar') ? keys.map((k) => ({ key: k, ...STEM_INFO[k] })) : OLD_STEMS;
    buildMixer();
  }

  // ------------------------------------------------------------ util
  const fmtTime = (s) => {
    s = Math.max(0, Math.floor(s || 0));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  };
  const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const hueOf = (id) => {
    let h = 0;
    for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return h % 360;
  };
  const isBusy = (s) => s.status === 'queued' || s.status === 'processing';

  function coverInner(s) {
    return s && s.key_short
      ? `<span class="ck">${esc(s.key_short)}</span>`
      : '<svg class="i"><use href="#i-note"/></svg>';
  }
  // Capa: a de verdade (do arquivo ou da loja, ver cover.py) ou, sem ela, um desenho em preto e branco
  // (cada música cai sempre no mesmo dos quatro: vinil, pauta, retícula, listras).
  const coverVariant = (s) => 'v' + (hueOf(s.id) % 4);
  const coverSrc = (s) => (s && s.capa && s.id ? `/files/${s.id}/${s.capa}?v=${s.capa_v || 0}` : null);
  function coverHTML(s, cls) {
    const src = coverSrc(s);
    if (src) return `<div class="cover ${cls} photo"><img src="${src}" alt="" loading="lazy" decoding="async" onerror="this.remove()"></div>`;
    return `<div class="cover ${cls} ${coverVariant(s)}">${coverInner(s)}</div>`;
  }
  function paintCover(el, s) {
    el.classList.remove('v0', 'v1', 'v2', 'v3', 'photo');
    el.classList.toggle('empty', !s);
    const src = coverSrc(s);
    if (src) {
      el.classList.add('photo');
      el.innerHTML = `<img src="${src}" alt="" decoding="async">`;
      el.firstChild.onerror = () => { // a imagem sumiu: volta para o desenho
        el.classList.remove('photo');
        el.classList.add(coverVariant(s));
        el.innerHTML = coverInner(s);
      };
      return;
    }
    if (s) el.classList.add(coverVariant(s));
    el.innerHTML = s ? coverInner(s) : '';
  }

  // Cor da música: a que salta aos olhos na capa (cover.py) ou, sem capa, a do tom, pelo círculo das
  // quintas (tons vizinhos têm cores vizinhas; menor é mais escuro). A base da tela continua preta: a cor
  // só entra nos destaques (tocar, progresso, escolhas, karaokê, cursor, fundo animado, mesa de som).
  const FIFTHS = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5];
  const NOTE_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const rgbHex = (c) => '#' + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
  function keyPc(k) {
    const m = /^([A-G])([b♭#♯]?)/.exec(k || '');
    if (!m) return null;
    return (NOTE_PC[m[1]] + (m[2] === 'b' || m[2] === '♭' ? 11 : m[2] ? 1 : 0)) % 12;
  }
  function hslRgb(h, s, l) {
    const a = s * Math.min(l, 1 - l);
    const f = (n) => { const k = (n + h / 30) % 12; return 255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))); };
    return [f(0), f(8), f(4)];
  }
  function inkFor(rgb) { // preto ou branco, o que tiver mais contraste (conta da WCAG)
    const lin = rgb.map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    const L = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
    return (L + 0.05) / 0.05 >= 1.05 / (L + 0.05) ? '#000000' : '#ffffff';
  }
  function songColors(s) {
    if (s && s.cores && s.cores.destaque) return s.cores;
    const pc = keyPc(s && s.key_short);
    if (pc === null) return null;
    const minor = /m$/.test(s.key_short);
    const hue = FIFTHS.indexOf(pc) * 30;
    const acc = hslRgb(hue, minor ? 0.62 : 0.72, minor ? 0.52 : 0.56);
    return { destaque: rgbHex(acc), fundo: rgbHex(hslRgb(hue, 0.5, 0.17)), tinta: inkFor(acc) };
  }
  function rgbHsl([r, g, b]) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
    if (!d) return [0, 0, l];
    const s = d / (1 - Math.abs(2 * l - 1));
    const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [(h * 60 + 360) % 360, s, l];
  }

  // Como nos players de música: o topo da página da música fica da cor da capa (meio escura, para o
  // texto branco aparecer) e vai escurecendo até o preto; a barra que gruda no topo ao rolar também.
  function applySongColor(s) {
    const c = songColors(s), st = document.documentElement.style;
    S.songHex = c ? c.destaque : null;
    S.songRgb = c ? hexRgb(c.destaque) : null;
    S.songHead = null;
    S.songDeep = null;
    if (!c) {
      for (const v of ['--song', '--song-rgb', '--song-hi', '--song-head', '--song-deep', '--song-ink']) st.removeProperty(v);
    } else {
      const [h, sat] = rgbHsl(S.songRgb);
      S.songHead = rgbHex(hslRgb(h, Math.min(sat, 0.58), 0.3));
      S.songDeep = rgbHex(hslRgb(h, Math.min(sat, 0.5), 0.15));
      st.setProperty('--song', c.destaque);
      st.setProperty('--song-rgb', S.songRgb.join(' '));
      st.setProperty('--song-hi', rgbHex(S.songRgb.map((v) => v + (255 - v) * 0.35))); // mais clara (passar o mouse)
      st.setProperty('--song-head', S.songHead);
      st.setProperty('--song-deep', S.songDeep);
      st.setProperty('--song-ink', c.tinta);
    }
    S.eqDirty = true;
  }

  // a marca respira com a música: enquanto toca, as linhas da pauta viram onda
  const LOGO_STATIC = 'M5 0H14C16 0 17.2 1.1 18.7 1.1S22.6-2.6 25.4-2.6 29.6 3.5 32.5 3.5 35.2 1 36 0';
  function waveLogo(t, amp) {
    let d = 'M5 0H14';
    for (let x = 14.5; x <= 36; x += 0.5) {
      const u = (x - 14) / 22;
      d += `L${x} ${(3.6 * amp * Math.sin((Math.PI / 2) * u) * Math.sin(2 * Math.PI * 1.5 * u - t * 6)).toFixed(2)}`;
    }
    $('#logoWave').setAttribute('d', d);
  }
  function setRange(el, value) {
    el.value = value;
    const min = parseFloat(el.min) || 0, max = parseFloat(el.max) || 1;
    el.style.setProperty('--p', ((value - min) / (max - min)) * 100 + '%');
  }
  function setHue(h) {
    S.hue = h;
    $('#main').style.setProperty('--h', h);
  }

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      ...opts,
      headers: opts.body && typeof opts.body === 'string' ? { 'Content-Type': 'application/json' } : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch (_) { /* sem corpo */ }
    if (!res.ok) throw new Error((data && data.detail) || res.statusText);
    return data;
  }

  let toastTimer = 0;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 3800);
  }

  function showView(name) {
    S.view = name;
    for (const [k, sel] of Object.entries(VIEWS)) $(sel).hidden = k !== name;
    $('#btnHome').classList.toggle('on', name === 'home');
    $('#main').scrollTop = 0;
    $('#mainTop').classList.remove('visible');
    if (name === 'home') setHue(150);
    if (name === 'player' && S.sheetStale) rerenderSheet();
  }

  function greeting() {
    const h = new Date().getHours();
    $('#greeting').textContent = h >= 5 && h < 12 ? 'Bom dia' : h >= 12 && h < 18 ? 'Boa tarde' : 'Boa noite';
  }

  // ------------------------------------------------------------ biblioteca
  async function loadLibrary() {
    clearTimeout(S.libTimer);
    try { S.songs = await api('/api/songs'); } catch (_) { S.libTimer = setTimeout(loadLibrary, 4000); return; }
    renderLibrary();
    if (S.songs.some(isBusy)) S.libTimer = setTimeout(loadLibrary, 2500);
  }

  function visibleSongs() {
    const q = norm(S.query);
    return S.songs.filter((s) =>
      (S.filter === 'all' || (S.filter === 'ready' ? s.status === 'ready' : s.status !== 'ready')) &&
      (!q || norm(s.title).includes(q)));
  }

  function songSub(s) {
    if (s.status === 'ready') return 'Transcrição' + (s.key ? ' • ' + esc(s.key) : '');
    if (s.status === 'error') return '<span class="err">Erro na transcrição</span>';
    if (s.status === 'queued') return 'Na fila';
    return `Transcrevendo • ${Math.round((s.progress || 0) * 100)}%`;
  }

  function renderLibrary() {
    const ul = $('#songList');
    ul.innerHTML = '';
    $('#libEmpty').hidden = S.songs.length > 0;
    const list = visibleSongs();
    for (const s of list) {
      const li = document.createElement('li');
      const playing = s.id === S.playerId && S.playing;
      li.className = 'lib-item' + (s.id === S.id ? ' on' : '') + (playing ? ' playing' : '');
      li.innerHTML = coverHTML(s, 'sm') +
        `<div class="lib-text"><div class="lib-name">${esc(s.title)}</div><div class="lib-sub">${songSub(s)}</div></div>` +
        `<div class="lib-right">${playing ? '<span class="eq"><i></i><i></i><i></i></span>' : (s.duration && !isBusy(s) ? fmtTime(s.duration) : '')}</div>`;
      li.title = s.title;
      li.onclick = () => openSong(s.id);
      ul.appendChild(li);
    }
    if (!list.length && S.songs.length) {
      ul.innerHTML = '<li class="lib-sub" style="padding:12px">Nada encontrado com esse filtro.</li>';
    }
    renderHomeGrid(list);
  }

  function renderHomeGrid(list) {
    const grid = $('#homeGrid');
    $('#shelfRecent').hidden = S.songs.length === 0;
    grid.innerHTML = '';
    if (!list.length) {
      grid.innerHTML = '<p class="shelf-empty" style="padding:0 12px">Nada encontrado.</p>';
      return;
    }
    for (const s of list) {
      const card = document.createElement('div');
      card.className = 'song-card';
      const busy = isBusy(s);
      card.innerHTML = `<div class="card-cover">${coverHTML(s, 'md')}` +
        (s.status === 'ready' ? `<button class="card-play" aria-label="Tocar ${esc(s.title)}"><svg class="i"><use href="#i-play"/></svg></button>` : '') +
        `</div><div class="card-title">${esc(s.title)}</div><div class="card-sub">${songSub(s)}</div>` +
        (busy ? `<div class="card-bar"><i style="width:${Math.round((s.progress || 0) * 100)}%"></i></div>` : '');
      card.onclick = () => openSong(s.id);
      const playBtn = card.querySelector('.card-play');
      if (playBtn) playBtn.onclick = async (e) => { e.stopPropagation(); await openSong(s.id); play(); };
      grid.appendChild(card);
    }
  }

  // ------------------------------------------------------------ navegação
  async function openSong(id) {
    clearTimeout(S.pollTimer);
    S.id = id;
    if (location.hash.slice(1) !== id) history.replaceState(null, '', '#' + id);
    renderLibrary();
    if (id === S.playerId && S.an) {
      setHue(hueOf(id));
      applySongColor(S.playerMeta);
      showView('player');
      return;
    }
    let m;
    try { m = await api('/api/songs/' + id); } catch (_) {
      toast('Música não encontrada.');
      goHome();
      return;
    }
    if (S.id !== id) return;
    S.meta = m;
    if (m.status === 'ready') {
      await setupPlayer(m);
    } else if (m.status === 'error') {
      showError(m);
    } else {
      showProcessing(m);
      S.pollTimer = setTimeout(() => { if (S.id === id) openSong(id); }, 1200);
    }
  }

  function goHome() {
    clearTimeout(S.pollTimer);
    S.id = null;
    history.replaceState(null, '', location.pathname);
    applySongColor(S.playerId ? S.playerMeta : null); // a cor fica a da música que está no player
    renderLibrary();
    showView('home');
  }

  // ------------------------------------------------------------ processando / erro
  function renderStages(m) {
    const box = $('#procStages');
    const idx = m ? S.stages.findIndex((s) => s.key === m.stage) : -1;
    let html = '<div class="tl-head"><span>#</span><span>Etapa</span><svg class="i"><use href="#i-clock"/></svg></div>';
    S.stages.forEach((s, i) => {
      const done = m && (m.status === 'ready' || (idx >= 0 && i < idx));
      const active = m && m.status === 'processing' && i === idx;
      const num = done ? '<svg class="i"><use href="#i-check"/></svg>'
        : active ? '<span class="eq"><i></i><i></i><i></i></span>' : String(i + 1);
      const right = done ? 'pronto' : active ? 'agora' : '';
      html += `<div class="tl-row ${done ? 'done' : active ? 'active' : 'pending'}"><span class="tl-num">${num}</span>` +
        `<span class="tl-title"><b>${esc(s.label)}</b><span>${esc(STAGE_HINTS[s.key] || '')}</span></span>` +
        `<span class="tl-right">${right}</span></div>`;
    });
    box.innerHTML = html;
  }

  function showProcessing(m) {
    if (S.view !== 'processing') showView('processing');
    setHue(hueOf(m.id));
    applySongColor(m);
    $('#procTitle').textContent = m.title;
    const p = m.progress || 0;
    $('#procBar').style.width = (p * 100).toFixed(1) + '%';
    $('#procPct').textContent = Math.round(p * 100) + '%';
    if (m.status === 'queued') {
      $('#procEyebrow').textContent = m.queue_position > 1 ? `Na fila · posição ${m.queue_position}` : 'Na fila';
      $('#procEta').textContent = 'esperando a vez';
    } else {
      $('#procEyebrow').textContent = 'Transcrevendo';
      let eta = 'calculando o tempo';
      if (m.started_at && p > 0.04) {
        const left = ((Date.now() / 1000 - m.started_at) * (1 - p)) / p;
        eta = left < 60 ? 'menos de 1 min restante' : `cerca de ${Math.round(left / 60)} min restantes`;
      }
      $('#procEta').textContent = eta;
    }
    $('#topTitle').textContent = m.title;
    renderStages(m);
  }

  function showError(m) {
    showView('error');
    setHue(hueOf(m.id));
    applySongColor(m);
    paintCover($('#errCover'), m);
    $('#errTitle').textContent = m.title;
    $('#topTitle').textContent = m.title;
    $('#errMsg').textContent = m.error || 'Erro desconhecido.';
  }

  // ------------------------------------------------------------ leitor
  async function setupPlayer(m) {
    teardownPlayer();
    S.playerId = m.id;
    S.meta = m;
    S.playerMeta = m;
    S.an = m.analysis;
    const an = S.an;
    setHue(hueOf(m.id));
    applySongColor(m);
    showView('player');
    paintCover($('#playerCover'), m);
    paintCover($('#nbCover'), m);
    paintCover($('#stageCover'), m);
    $('#songTitle').textContent = m.title;
    $('#topTitle').textContent = m.title;
    $('#stageTitle').textContent = m.title;
    $('#nbTitle').textContent = m.title;
    $('#factKey').textContent = an.key.display;
    const meter = (an.time_signature || [4, 4]).join('/');
    $('#factBpm').textContent = Math.round(an.bpm) + ' BPM';
    $('#factMeter').textContent = meter;
    $('#factDur').textContent = fmtTime(an.duration);
    $('#stageMeta').textContent = `${an.key.display} • ${Math.round(an.bpm)} BPM • ${meter}`;
    $('#lyricCard').hidden = !(an.lyrics && an.lyrics.length);
    $('#lyricSource').textContent = lyricSourceLabel();
    resetLyrics();
    $('#tDur').textContent = fmtTime(an.duration);
    $('#measureTotal').textContent = an.measures;
    $('#dlMid').href = `/files/${m.id}/transcricao.mid`;
    $('#dlMid').download = m.title + '.mid';
    updateDownloadLink();
    $('#paperNote').textContent = an.has_vocals === false
      ? 'Não encontrei voz nesta gravação, então a partitura mostra as cifras e os compassos, sem melodia.'
      : 'Melodia da voz' +
        (an.octave_shift ? ', escrita uma oitava acima do som real (o padrão para voz grave na clave de sol)' : '') +
        (an.lyrics && an.lyrics.length ? ', com a letra embaixo das notas' : '') +
        '. É uma transcrição automática: confira de ouvido, principalmente nos trechos rápidos.';
    $('#app').classList.remove('no-song');
    $('#handCard').hidden = false;
    // os instrumentos só existem nas músicas analisadas com a transcrição nota por nota (e onde o
    // instrumento toca de fato)
    for (const [lv, info] of Object.entries(INSTRUMENT_INFO)) {
      const chip = $(`#levelSeg [data-level="${lv}"]`);
      if (!chip) continue;
      const has = instrumentNotes(lv).length > 0;
      chip.disabled = !has;
      chip.title = has ? info.title : (lv === 'violao' || an.instrumentos
        ? `Não achei ${info.article} nesta gravação`
        : `Refaça a análise (menu ⋯) para ver ${info.article} nota por nota`);
    }
    if (isInstrument(S.level) && !instrumentNotes(S.level).length) {
      S.level = 'simples';
      document.querySelectorAll('#levelSeg .chip').forEach((x) => x.classList.toggle('on', x.dataset.level === 'simples'));
      updateDownloadLink();
    }
    S.vIdx = -2;
    loadMix(m.id);
    useStems(an.stems);
    buildAudio(m.id);
    S.chords = chordsForLevel();
    renderChordline();
    S.chordIdx = -2;
    S.measure = -1;
    S.beat = -2;
    tick();
    renderLibrary();
    await loadSheet();
  }

  function teardownPlayer() {
    closeShow();
    pause();
    stopBuffers();
    for (const a of Object.values(S.audio)) {
      if (a._src) { try { a._src.disconnect(); } catch (_) { /* já solto */ } }
      a.removeAttribute('src');
      a.load();
    }
    S.audio = {};
    S.bufs = null; // libera a memória das partes decodificadas
    S.useBuffers = false;
    S.loadToken = (S.loadToken || 0) + 1; // cancela uma decodificação em andamento
    S.pos = 0;
    S.master = null;
    S.playerId = null;
    S.playerMeta = null;
    S.an = null;
    S.sheet = null;
    applySongColor(null);
    resetLyrics();
    setLoop(0);
    closeStage();
    $('#osmd').innerHTML = '';
    $('#app').classList.add('no-song');
    $('#handCard').hidden = true;
    paintCover($('#nbCover'), null);
    $('#nbTitle').textContent = 'Nada tocando';
    $('#nbSub').textContent = 'Escolha uma música da biblioteca';
    setRange($('#seek'), 0);
    $('#tCur').textContent = '0:00';
  }

  // Partituras de instrumento: o que cada um toca, nota por nota (violão, cavaco e baixo com tablatura).
  const INSTRUMENT_INFO = {
    violao: { title: 'O que o violão toca, nota por nota, com tablatura', article: 'o violão' },
    baixo: { title: 'O que o baixo toca, nota por nota, com tablatura de 4 cordas', article: 'o baixo' },
    cavaco: { title: 'O que o cavaquinho toca, nota por nota, com tablatura (Ré Sol Si Ré)', article: 'o cavaquinho' },
    teclado: { title: 'O que o teclado toca, nas duas mãos', article: 'o teclado' },
  };
  const isInstrument = (lv) => Object.prototype.hasOwnProperty.call(INSTRUMENT_INFO, lv);
  function instrumentNotes(lv) {
    if (!S.an) return [];
    if (lv === 'violao') return S.an.violao || [];
    return (S.an.instrumentos && S.an.instrumentos[lv]) || [];
  }

  // "Simples" junta as trocas rápidas de acorde; "Detalhada" mostra todas.
  function chordsForLevel() {
    if (!S.an) return [];
    return (S.level !== 'simples' && S.an.chords_detalhado) || S.an.chords;
  }

  function updateDownloadLink() {
    if (!S.playerId) return;
    $('#dlXml').href = `/files/${S.playerId}/score_${S.level}.musicxml`;
    $('#dlXml').download = `${(S.meta && S.meta.title) || 'partitura'} (${S.level}).musicxml`;
  }

  // ------------------------------------------------------------ áudio
  // Duas formas de tocar as 6 partes:
  // - velocidade normal: as partes, já decodificadas, tocam no relógio do WebAudio e começam todas na
  //   mesma amostra (sincronia perfeita); o tempo da tela é o que está saindo no fone;
  // - velocidade reduzida: cada parte toca num <audio> com o tom preservado, realinhadas de tempos em tempos.
  // Cada parte entra num canal da mesa de som (equalizador, pan, fader, mudo) e todas somam no master
  // (equalizador gráfico, fader, limitador), que alimenta as animações e o volume do fone.
  // A tela anda um tiquinho à frente do som: a imagem leva 2 a 3 quadros para aparecer e o olho percebe
  // mais devagar que o ouvido. Quem ainda achar o cursor adiantado ou atrasado ajusta em "Sincronia".
  const VISUAL_LEAD = 0.05;
  const SCHEDULE_MARGIN = 0.03; // folga para agendar no relógio de áudio (s)
  const MAX_DECODED_MB = 1100;  // acima disso (música muito longa) fica no <audio>, para não pesar a memória
  const GRAPH_DELAY = 0.006;    // o limitador do master olha 6 ms à frente: o som sai 6 ms depois
  const BUTTERWORTH_DB = -3.0103; // Q dos cortes (no WebAudio, em dB): resposta plana, sem bico
  const LIMIT_DB = -0.5;        // teto do limitador do master

  function ensureCtx() {
    if (!S.actx) {
      try {
        S.actx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive', sampleRate: 44100 });
      } catch (_) {
        try { S.actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (__) { return false; }
      }
      // o sistema suspendeu o áudio no meio da música: pausa de verdade, guardando a posição certa
      S.actx.onstatechange = () => { if (S.actx.state !== 'running' && S.playing) pause(); };
    }
    if (!S.ch) buildGraph();
    return true;
  }

  // a mesa de som em WebAudio: um canal por parte e o master
  function buildGraph() {
    const ctx = S.actx;
    const biquad = (type, f) => {
      const b = ctx.createBiquadFilter();
      b.type = type;
      b.frequency.value = f;
      return b;
    };
    const meter = () => {
      const a = ctx.createAnalyser();
      a.fftSize = 1024; // ~23 ms: cobre o intervalo entre dois quadros (o pico não escapa)
      return a;
    };
    const chain = (nodes) => nodes.reduce((a, b) => { a.connect(b); return b; });

    // master: EQ gráfico de 10 bandas → fader → limitador → (animações, medidores) → volume do fone → saída
    S.busIn = ctx.createGain();
    S.busEq = GEQ_F.map((f, i) => {
      const b = biquad(i === 0 ? 'lowshelf' : i === GEQ_F.length - 1 ? 'highshelf' : 'peaking', f);
      b.Q.value = 1.41; // uma oitava por banda
      b.gain.value = 0;
      return b;
    });
    S.busFader = ctx.createGain();
    S.limiter = ctx.createDynamicsCompressor();
    S.limiter.knee.value = 0;
    S.limiter.attack.value = 0.001;
    S.limiter.release.value = 0.1;
    S.limTrim = ctx.createGain(); // desconta o ganho automático do compressor: abaixo do teto, o volume é o original
    S.monitor = ctx.createGain();
    S.analyser = ctx.createAnalyser();
    S.analyser.fftSize = 2048;
    S.analyser.smoothingTimeConstant = 0.75;
    chain([S.busIn, ...S.busEq, S.busFader, S.limiter, S.limTrim, S.monitor, ctx.destination]);
    S.limTrim.connect(S.analyser);
    S.busSplit = ctx.createChannelSplitter(2);
    S.busMeters = [meter(), meter()];
    S.limTrim.connect(S.busSplit);
    S.busSplit.connect(S.busMeters[0], 0);
    S.busSplit.connect(S.busMeters[1], 1);

    // canais: entrada → corte de grave → grave → médio → agudo → corte de agudo → pan → fader → mudo → master
    S.ch = {};
    for (const key of Object.keys(STEM_INFO)) {
      const c = {
        input: ctx.createGain(),
        hp: biquad('highpass', 0), low: biquad('lowshelf', 120), mid: biquad('peaking', 1000),
        high: biquad('highshelf', 6000), lp: biquad('lowpass', ctx.sampleRate / 2),
        pan: ctx.createStereoPanner(), fader: ctx.createGain(), mute: ctx.createGain(),
        split: ctx.createChannelSplitter(2), meters: [meter(), meter()], spec: null,
      };
      c.hp.Q.value = c.lp.Q.value = BUTTERWORTH_DB;
      chain([c.input, c.hp, c.low, c.mid, c.high, c.lp, c.pan, c.fader, c.mute, S.busIn]);
      c.mute.connect(c.split);
      c.split.connect(c.meters[0], 0);
      c.split.connect(c.meters[1], 1);
      S.ch[key] = c;
    }
    applyMix();
    for (const key of Object.keys(STEM_INFO)) applyEq(key);
    applyBusEq();
  }

  function buildAudio(id) {
    const graph = ensureCtx();
    for (const st of STEMS) {
      const a = new Audio();
      a.preload = 'auto';
      a.preservesPitch = true;
      a.src = `/files/${id}/stems/${st.key}.m4a`;
      S.audio[st.key] = a;
      if (graph) {
        try {
          a._src = S.actx.createMediaElementSource(a);
          a._src.connect(S.ch[st.key].input);
        } catch (_) { /* fica tocando direto */ }
      }
    }
    S.pos = 0;
    S.useBuffers = false;
    S.master = { get currentTime() { return position(); }, get duration() { return duration(); } };
    S.audio.other.addEventListener('loadedmetadata', () => { $('#tDur').textContent = fmtTime(duration()); });
    S.audio.other.addEventListener('ended', () => { if (!S.useBuffers) onEnded(); });
    applyMix();
    applySpeed();
    loadBuffers(id);
  }

  function onEnded() {
    pause();
    seek(0);
    if (S.showOn && S.gameOn) showResults();
    else if (S.showOn) $('#showIntro').hidden = false;
  }

  // decodifica as partes para o modo sincronizado, em segundo plano (até lá toca pelo <audio>)
  async function loadBuffers(id) {
    if (!S.actx) return;
    const token = S.loadToken = (S.loadToken || 0) + 1;
    const mb = ((S.an && S.an.duration) || 0) * 44100 * 2 * 4 * STEMS.length / 1e6;
    if (mb > MAX_DECODED_MB) return;
    try {
      const keys = STEMS.map((s) => s.key);
      const bufs = await Promise.all(keys.map(async (k) => {
        const res = await fetch(`/files/${id}/stems/${k}.m4a`);
        if (!res.ok) throw new Error(res.status);
        return S.actx.decodeAudioData(await res.arrayBuffer());
      }));
      if (token !== S.loadToken || S.playerId !== id) return;
      S.bufs = Object.fromEntries(keys.map((k, i) => [k, bufs[i]]));
      if (wantBuffers() && !S.useBuffers) switchMode(); // passa para o modo sincronizado no mesmo ponto
    } catch (_) {
      S.bufs = null; // segue no <audio>
    }
  }

  const wantBuffers = () => !!(S.bufs && S.actx && S.ch && S.speed === 1);

  // atraso entre o que o WebAudio processa e o que sai no fone (placa de som, Bluetooth...)
  const outLatency = () => (S.actx ? (S.actx.outputLatency || 0) + (S.actx.baseLatency || 0) : 0);

  // o instante do relógio do WebAudio que está saindo no fone agora
  function heardCtxTime() {
    const ctx = S.actx;
    // áudio suspenso (no celular: ligação, outro app, fone Bluetooth desconectando): o relógio parou e
    // o cursor também tem que parar (antes ele seguia andando e depois pulava para trás)
    if (ctx.state !== 'running') return ctx.currentTime - outLatency();
    if (ctx.getOutputTimestamp) {
      const ts = ctx.getOutputTimestamp();
      if (ts && ts.contextTime > 0 && ts.performanceTime > 0) {
        return Math.min(ts.contextTime + (performance.now() - ts.performanceTime) / 1000, ctx.currentTime);
      }
    }
    return ctx.currentTime - outLatency();
  }

  // posição da música (s) no instante `ctxT` do relógio de áudio, no modo sincronizado
  function bufPosAt(ctxT) {
    let p = S.startPos + Math.max(0, ctxT - S.startCtx);
    const L = S.bufLoop;
    if (L && p >= L[1]) p = L[0] + ((p - L[1]) % (L[1] - L[0]));
    return p;
  }

  // posição da música (s) que vai estar saindo no fone daqui a `ahead` segundos
  function musicTime(ahead) {
    if (!S.playing) return S.pos || 0;
    if (S.useBuffers) return S.srcs ? bufPosAt(heardCtxTime() + ahead - GRAPH_DELAY) : (S.pos || 0);
    const a = S.audio.other; // o <audio> diz o que já entrou no WebAudio, não o que já saiu no fone
    return a ? Math.max(0, a.currentTime + (ahead - outLatency() - GRAPH_DELAY) * S.speed) : (S.pos || 0);
  }

  const position = () => musicTime(0);                                // o que se ouve agora
  const viewTime = () => musicTime(VISUAL_LEAD + S.syncMs / 1000);   // o que a tela mostra

  // Começa as partes decodificadas em `t` (s), todas na mesma amostra. As que estavam tocando param
  // nessa mesma amostra: pular, repetir trecho ou ajustar a repetição não deixa buraco no som.
  function startBuffers(t, when) {
    const ctx = S.actx;
    when = Math.max(when || 0, ctx.currentTime + SCHEDULE_MARGIN);
    const old = S.srcs;
    if (old) {
      for (const s of old) { s.onended = null; try { s.stop(when); } catch (_) { /* já parou */ } }
      setTimeout(() => old.forEach((s) => { try { s.disconnect(); } catch (_) { /* já solto */ } }),
        (when - ctx.currentTime) * 1000 + 250);
    }
    // repetindo trecho: antes dele, toca até o fim e volta ao começo; depois dele, já começa nele
    const loop = S.loopN && S.loopEnd > S.loopStart ? [S.loopStart, S.loopEnd] : null;
    if (loop && t >= loop[1]) t = loop[0];
    let longest = null;
    const srcs = Object.entries(S.bufs).map(([k, buf]) => {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      if (loop) {
        src.loop = true;
        src.loopStart = loop[0];
        src.loopEnd = loop[1];
      }
      src.connect(S.ch[k].input);
      src.start(when, Math.max(0, Math.min(t, buf.duration - 0.005)));
      if (!longest || buf.duration > longest.buffer.duration) longest = src;
      return src;
    });
    longest.onended = () => { if (S.srcs === srcs) onEnded(); };
    S.srcs = srcs;
    S.startCtx = when;
    S.startPos = t;
    S.bufLoop = loop;
  }

  function stopBuffers() {
    if (!S.srcs) return;
    for (const s of S.srcs) {
      s.onended = null;
      try { s.stop(); s.disconnect(); } catch (_) { /* já parou */ }
    }
    S.srcs = null;
  }

  // a repetição de trecho mudou: no modo sincronizado, as partes seguem do mesmo ponto já com a nova repetição
  function loopChanged() {
    if (!(S.useBuffers && S.playing && S.srcs)) return;
    cancelClicks();
    const when = S.actx.currentTime + SCHEDULE_MARGIN;
    startBuffers(bufPosAt(when), when);
  }

  // troca entre o modo sincronizado (velocidade normal) e o <audio> (devagar), no mesmo ponto da música
  async function switchMode() {
    const was = S.playing;
    if (was) pause();
    S.useBuffers = wantBuffers();
    for (const a of Object.values(S.audio)) a.currentTime = S.pos || 0;
    if (was) await play();
  }

  // Metrônomo agendado no relógio de áudio: a batida cai junto com a música, sem depender da tela.
  // A cada quadro agenda as batidas dos próximos 120 ms que ainda não foram agendadas.
  function scheduleClicks() {
    const ctx = S.actx;
    if (!ctx || !S.an) return;
    const now = ctx.currentTime;
    let c0 = Math.max(S.clickUntil || 0, now);
    const c1 = now + 0.12;
    const first = !S.clickUntil;
    // batidas no trecho (from, to] da música, que toca a partir de `ctxAt` no relógio de áudio
    const span = (from, to, ctxAt, rate) => {
      if (first) from -= 1e-4; // começando exatamente numa batida: ela também conta
      for (let bi = Math.max(0, Math.floor(beatAt(from))); bi < 100000; bi++) {
        const bt = timeAtBeat(bi);
        if (bt > to) break;
        if (bt > from) playClick(bi % 4 === 0, ctxAt + (bt - from) / rate);
      }
    };
    if (S.useBuffers) {
      if (!S.srcs) return;
      c0 = Math.max(c0, S.startCtx);
      if (c1 <= c0) return;
      const p0 = bufPosAt(c0), len = c1 - c0, L = S.bufLoop;
      if (L && p0 + len >= L[1]) { // a janela atravessa o fim do trecho: o resto vem do começo dele
        span(p0, L[1] - 1e-6, c0, 1);
        span(L[0] - 1e-6, L[0] + len - (L[1] - p0), c0 + (L[1] - p0), 1);
      } else {
        span(p0, p0 + len, c0, 1);
      }
    } else {
      const a = S.audio.other;
      if (!a || c1 <= c0) return;
      const p0 = a.currentTime + (c0 - now) * S.speed;
      span(p0, p0 + (c1 - c0) * S.speed, c0, S.speed);
    }
    S.clickUntil = c1;
  }

  // desagenda as batidas que ainda não tocaram (pausa, pulo, troca de trecho)
  function cancelClicks() {
    for (const o of S.clicks || []) { try { o.stop(); } catch (_) { /* já tocou */ } }
    S.clicks = [];
    S.clickUntil = 0;
  }

  function duration() {
    if (S.bufs && S.bufs.other) return S.bufs.other.duration;
    const m = S.audio.other;
    return (m && isFinite(m.duration) && m.duration) || (S.an && S.an.duration) || 0;
  }

  function setPlayingUI(on) {
    for (const sel of ['#btnPlay', '#bigPlay', '#topPlay', '#stagePlay', '#showPlay']) {
      const el = $(sel);
      el.classList.toggle('playing', on);
      el.setAttribute('aria-label', on ? 'Pausar' : 'Tocar');
    }
    renderLibrary();
  }

  async function play() {
    if (!S.master) return;
    ensureCtx();
    if (S.actx && S.actx.state !== 'running') {
      try { await S.actx.resume(); } catch (_) { /* segue sem */ }
    }
    const t = S.pos || 0;
    S.useBuffers = wantBuffers();
    cancelClicks();
    if (S.useBuffers) {
      startBuffers(t);
    } else {
      for (const a of Object.values(S.audio)) if (Math.abs(a.currentTime - t) > 0.02) a.currentTime = t;
      try {
        await Promise.all(Object.values(S.audio).map((a) => a.play()));
      } catch (e) {
        toast('Não consegui tocar o áudio: ' + e.message);
        return;
      }
    }
    S.playing = true;
    S.lastBeat = Math.floor(beatAt(t));
    setPlayingUI(true);
    cancelAnimationFrame(S.raf);
    const loop = () => { tick(); if (S.playing) S.raf = requestAnimationFrame(loop); };
    loop();
  }

  function pause() {
    const was = S.playing;
    if (was) S.pos = position(); // retoma de onde a pessoa parou de ouvir
    stopBuffers();
    cancelClicks();
    for (const a of Object.values(S.audio)) a.pause();
    S.playing = false;
    cancelAnimationFrame(S.raf);
    if (was) {
      setPlayingUI(false);
      $('#logoWave').setAttribute('d', LOGO_STATIC);
    }
  }

  const togglePlay = () => (S.playing ? pause() : play());

  function seek(t) {
    if (!S.master) return;
    t = Math.min(Math.max(0, t), Math.max(0, duration() - 0.05));
    S.pos = t;
    cancelClicks();
    if (S.useBuffers && S.playing) startBuffers(t);
    for (const a of Object.values(S.audio)) a.currentTime = t; // o <audio> fica pronto para a troca de modo
    S.lastBeat = Math.floor(beatAt(t));
    if (S.showOn) resetMelodyCursor();
    tick(t);
  }

  // só no modo <audio> (devagar): realinha com a parte-guia quem escapou mais de 30 ms
  function syncStems() {
    const ref = S.audio.other;
    if (S.useBuffers || !ref) return;
    const t = ref.currentTime;
    for (const a of Object.values(S.audio)) {
      if (a !== ref && Math.abs(a.currentTime - t) > 0.03) a.currentTime = t;
    }
  }

  function applySpeed() {
    for (const a of Object.values(S.audio)) {
      a.preservesPitch = true;
      a.playbackRate = S.speed;
    }
    $('#btnSpeed').textContent = Math.round(S.speed * 100) + '%';
    $('#btnSpeed').classList.toggle('on', S.speed !== 1);
    document.querySelectorAll('#speedMenu [data-speed]').forEach((b) => b.classList.toggle('on', parseFloat(b.dataset.speed) === S.speed));
    if (S.master && S.useBuffers !== wantBuffers()) switchMode();
  }

  // ajuste fino do cursor (ms, + = adiantado), guardado neste navegador
  function loadSync() {
    try { S.syncMs = Math.max(-300, Math.min(300, parseInt(localStorage.getItem('pv.syncMs'), 10) || 0)); } catch (_) { S.syncMs = 0; }
    showSync();
  }

  function setSync(ms) {
    S.syncMs = Math.max(-300, Math.min(300, Math.round(ms)));
    try { localStorage.setItem('pv.syncMs', String(S.syncMs)); } catch (_) { /* sem memória no navegador */ }
    showSync();
  }

  function showSync() {
    $('#syncVal').textContent = S.syncMs ? `${S.syncMs > 0 ? '+' : '−'}${Math.abs(S.syncMs)} ms` : 'padrão';
    $('#syncReset').hidden = !S.syncMs;
  }

  // batida do metrônomo no instante `at` do relógio de áudio (agora, se não vier); a música passa pelo
  // limitador do master, que atrasa 6 ms: a batida agendada atrasa junto
  function playClick(accent, at) {
    const ctx = S.actx;
    if (!ctx) return;
    const t = Math.max(at ? at + GRAPH_DELAY : 0, ctx.currentTime);
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = accent ? 1650 : 1150;
    g.gain.setValueAtTime(accent ? 0.55 : 0.33, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    o.connect(g).connect(ctx.destination);
    o.start(t);
    o.stop(t + 0.06);
    const list = S.clicks = S.clicks || [];
    list.push(o);
    o.onended = () => {
      const i = list.indexOf(o);
      if (i >= 0) list.splice(i, 1);
      g.disconnect();
    };
  }

  // ------------------------------------------------------------ tempo ↔ compasso
  function beatAt(t) {
    const g = S.an ? S.an.grid : null;
    if (!g || g.length < 2) return 0;
    if (t <= g[0]) return (t - g[0]) / (g[1] - g[0]);
    const n = g.length - 1;
    if (t >= g[n]) return n + (t - g[n]) / (g[n] - g[n - 1]);
    let lo = 0, hi = n;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (g[mid] <= t) lo = mid; else hi = mid; }
    return lo + (t - g[lo]) / (g[lo + 1] - g[lo]);
  }

  function timeAtBeat(b) {
    const g = S.an.grid;
    const i = Math.min(Math.max(0, Math.floor(b)), g.length - 2);
    return g[i] + (b - i) * (g[i + 1] - g[i]);
  }

  function chordAt(t) {
    const c = S.chords;
    let lo = 0, hi = c.length - 1, ans = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (c[mid].start <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
    return ans;
  }

  function vizState() {
    const st = {
      hue: S.hue, color: S.songRgb, bg: S.songHead, playing: S.playing, analyser: S.analyser,
      chordPc: null, sinceBeat: null, downbeat: false,
    };
    if (S.an && S.master) {
      const t = viewTime();
      const b = beatAt(t);
      if (b >= 0) {
        const bi = Math.floor(b);
        st.sinceBeat = (t - timeAtBeat(bi)) / (S.speed || 1);
        st.downbeat = bi % 4 === 0;
      }
      const c = S.chords[S.chordIdx];
      if (c && c.kind !== 'N') st.chordPc = c.root;
    }
    return st;
  }

  // ------------------------------------------------------------ atualização contínua
  function tick(forcedT) {
    if (!S.master || !S.an) return;
    // repetição no modo <audio>: volta quando o fim do trecho entra no WebAudio (no modo sincronizado
    // a própria fonte de áudio repete, sem buraco)
    if (S.loopN && S.playing && !S.useBuffers && S.audio.other && S.audio.other.currentTime >= S.loopEnd - 0.01) {
      seek(S.loopStart);
      return;
    }
    const t = forcedT !== undefined ? forcedT : viewTime();
    if (S.playing && S.click) scheduleClicks();
    if (S.playing && forcedT === undefined && S.showOn && t < (S.prevT || 0) - 0.25) resetMelodyCursor(); // o trecho recomeçou
    S.prevT = t;
    const dur = duration();
    if (!S.dragging) {
      setRange($('#seek'), dur ? Math.round((t / dur) * 1000) : 0);
      $('#tCur').textContent = fmtTime(t);
    }
    if (S.showOn) {
      const sec = Math.floor(t); // tempo e barra só mudam a cada segundo: escrever na tela a cada quadro pesa
      if (sec !== S.showSec) {
        S.showSec = sec;
        $('#showTime').textContent = `${fmtTime(t)} / ${fmtTime(dur)}`;
        $('#showBar').style.width = (dur ? (t / dur) * 100 : 0).toFixed(1) + '%';
      }
      if (S.gameOn && S.playing) S.game.sample();
    }
    const b = beatAt(t);
    if (S.playing && performance.now() - (S.logoAt || 0) > 50) {
      S.logoAt = performance.now();
      waveLogo(S.logoAt / 1000, 1 + 0.35 * Math.exp(-(b - Math.floor(b)) * 4));
    }
    if (S.showOn) {
      updateStrip(b);
      if (S.gameOn && S.playing && S.game.mode === 'melody') {
        trackMelody(b);
        const heard = S.game.lastMidi == null ? '—' : noteName(Math.round(S.game.lastMidi));
        if (heard !== S.heardShown) {
          S.heardShown = heard;
          $('#hudHeardNote').textContent = heard;
        }
      }
    }
    const bi = Math.floor(b);
    const measure = Math.max(0, Math.floor(bi / 4));
    const beatIn = b < 0 ? -1 : ((bi % 4) + 4) % 4;
    let changed = false;
    if (measure !== S.measure) {
      S.measure = measure;
      $('#measureNum').textContent = Math.min(measure + 1, S.an.measures);
      changed = true;
    }
    if (beatIn !== S.beat) {
      S.beat = beatIn;
      document.querySelectorAll('#beats i, #stageBeats i, #hudBeats i').forEach((el, i) => el.classList.toggle('on', i % 4 === beatIn));
    }
    if (bi !== S.lastBeat) {
      if (S.showOn && S.bgMedia && S.playing && beatIn === 0) { // o fundo "pulsa" no 1 do compasso
        const el = S.bgMedia.classList.contains('artist') ? $('#showShade') : S.bgMedia; // a foto já se move devagar
        el.classList.remove('beat');
        void el.offsetWidth;
        el.classList.add('beat');
      }
      // no Modo Show valendo pontos, cada tempo que termina é conferido
      if (S.showOn && S.gameOn && S.game.mode === 'chords' && S.playing && S.lastBeat >= 0 && bi === S.lastBeat + 1) {
        judgeBeat(S.lastBeat);
      }
      S.lastBeat = bi;
    }
    const ci = chordAt(t);
    if (ci !== S.chordIdx) { updateChord(ci); changed = true; }
    if (isInstrument(S.level)) updateViolao(b);
    if (changed) {
      const c = S.chords[S.chordIdx];
      $('#nbSub').textContent = `${c && c.kind !== 'N' ? 'Acorde ' + c.display : 'Sem acorde'} • compasso ${Math.min(S.measure + 1, S.an.measures)}`;
    }
    moveCursor(t, false);
    updateLyrics(t);
    if (S.playing && !S.useBuffers && performance.now() - S.lastSync > 700) {
      syncStems();
      S.lastSync = performance.now();
    }
  }

  // Apaga a letra da tela e obriga a próxima atualização a redesenhar. Tem que rodar sempre que a música
  // ou a letra mudam: a marca "antes da 1ª frase" de uma música é igual à de outra, e sem isso a frase
  // da música anterior ficava na tela até a nova começar a ser cantada.
  function resetLyrics() {
    S.lyricIdx = null;
    for (const sel of ['#lyricNow', '#stageLyric', '#showLyric']) $(sel).innerHTML = '';
    $('#lyricNext').textContent = '';
  }

  // Letra: a frase que está sendo cantada, com as palavras já cantadas acesas, e a próxima frase.
  function updateLyrics(t) {
    const L = S.an.lyrics;
    if (!L || !L.length) {
      if (S.lyricIdx !== 'sem-letra') { resetLyrics(); S.lyricIdx = 'sem-letra'; }
      return;
    }
    let lo = 0, hi = L.length - 1, li = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (L[mid].start <= t + 0.2) { li = mid; lo = mid + 1; } else hi = mid - 1; }
    const active = li >= 0 && t <= L[li].end + 1.5 ? li : -1;
    const key = active >= 0 ? active : -(li + 3);
    if (key !== S.lyricIdx) {
      S.lyricIdx = key;
      const line = active >= 0 ? L[active] : null;
      const html = line
        ? line.words.map((w) => `<span class="w" data-t="${w.start}">${esc(w.text)}</span>`).join(' ')
        : '';
      $('#lyricNow').innerHTML = html;
      $('#stageLyric').innerHTML = html;
      $('#showLyric').innerHTML = html;
      const next = L[(active >= 0 ? active : li) + 1];
      $('#lyricNext').textContent = next ? (line ? 'Depois: ' : 'A seguir: ') + next.text : '';
    }
    if (active >= 0) {
      document.querySelectorAll('#lyricNow .w, #stageLyric .w, #showLyric .w').forEach((el) => {
        el.classList.toggle('on', parseFloat(el.dataset.t) <= t);
      });
    }
  }

  // Diagramas no instrumento da partitura aberta (nos níveis de melodia, o violão).
  const diagramInst = () => (isInstrument(S.level) ? S.level : 'violao');
  const INST_NOW = { violao: 'Violão agora', baixo: 'Baixo agora', cavaco: 'Cavaco agora', teclado: 'Teclado agora' };

  // Níveis de instrumento: o cartão mostra as notas que ele está tocando agora na gravação (e apagadas as
  // próximas): no braço do violão, do cavaco ou do baixo, ou nas teclas do teclado.
  // Violão, cavaco e teclado mudam no máximo uma vez por tempo: a batida em semicolcheias trocava o
  // desenho 6 vezes por segundo, sem dar para ler. O cartão junta as notas daquele tempo (uma por corda).
  // O baixo toca uma nota de cada vez e segue nota a nota.
  const longest = new WeakMap(); // nota mais longa de cada lista (acorde segurado por 2 compassos)
  function beatNotes(V, from, to) {
    if (!longest.has(V)) longest.set(V, V.reduce((m, e) => Math.max(m, e[1]), 0));
    const back = longest.get(V);
    let lo = 0, hi = V.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (V[mid][0] < from - back) lo = mid + 1; else hi = mid; }
    const best = new Map(); // corda (ou tecla, no teclado) -> [nota, quanto soa dentro do tempo]
    for (let j = lo; j < V.length && V[j][0] < to; j++) {
      const over = Math.min(to, V[j][0] + V[j][1]) - Math.max(from, V[j][0]);
      if (over <= 0) continue;
      for (const x of V[j][2]) {
        const k = S.level === 'teclado' ? x[0] : x[1];
        if (!best.has(k) || best.get(k)[1] < over) best.set(k, [x, over]);
      }
    }
    return [...best.values()].map((v) => v[0]);
  }

  function updateViolao(b) {
    const V = instrumentNotes(S.level);
    if (!V || !V.length) return;
    let lo = 0, hi = V.length - 1, i = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (V[mid][0] <= b + 0.02) { i = mid; lo = mid + 1; } else hi = mid - 1; }
    let now, next, key;
    if (S.level === 'baixo') {
      const sounding = i >= 0 && b < V[i][0] + V[i][1] + 0.25 ? i : -1; // um respiro depois do fim, para dar tempo de ver
      now = sounding >= 0 ? V[sounding][2] : [];
      next = V[i + 1] ? V[i + 1][2] : [];
      key = sounding >= 0 ? sounding : null;
    } else {
      const bi = Math.floor(b + 0.02);
      now = beatNotes(V, bi, bi + 1);
      next = now.length ? beatNotes(V, bi + 1, bi + 2) : [];
      key = now.length ? `b${bi}` : null;
    }
    // sem nota soando o cartão mostra o acorde: redesenha também quando o acorde troca
    if (key === null) key = `p${i}:${S.chordIdx}`;
    if (key === S.vIdx) return;
    S.vIdx = key;
    setHandLegend(now.length ? 'live' : S.level);
    if (!now.length) {
      // nada soando (introdução, pausa): a forma do acorde de agora (ou do próximo) no instrumento
      const c = S.chords[S.chordIdx];
      const h = c && c.kind !== 'N' ? c : nextChord(S.chordIdx);
      $('#handLabel').textContent = c && c.kind !== 'N' ? 'Como tocar' : 'Prepare';
      $('#handChord').textContent = h ? h.display : '—';
      $('#handSvg').innerHTML = ChordDiagram.neckFor(h, S.level, noteName);
      return;
    }
    $('#handLabel').textContent = INST_NOW[S.level];
    $('#handSvg').innerHTML = S.level === 'teclado'
      ? ChordDiagram.keysPlay(now, next, noteName)
      : ChordDiagram.play(now, next, noteName, S.level);
  }

  // Legenda do cartão "Como tocar", do jeito de cada instrumento.
  const LEGENDS = {
    violao: '<span><i>1</i>indicador</span><span><i>2</i>médio</span><span><i>3</i>anelar</span><span><i>4</i>mínimo</span><span class="hl-sym">○ corda solta</span><span class="hl-sym">× não toca</span>',
    cavaco: '<span><i>1</i>indicador</span><span><i>2</i>médio</span><span><i>3</i>anelar</span><span><i>4</i>mínimo</span><span class="hl-sym">○ corda solta</span><span class="hl-sym">× não toca</span>',
    baixo: '<span><i class="wide">Dó</i>nota do baixo do acorde (em C7, o Dó; em C/E, o Mi)</span><span class="hl-sym">números embaixo: casa</span>',
    teclado: '<span><b class="lg kb-on-l"></b>mão direita (acorde)</span><span><b class="lg kb-root-l"></b>raiz do acorde</span><span><b class="lg kb-bass-l"></b>mão esquerda (baixo)</span>',
    live: '<span><b class="lg live-l"></b>soando agora (nome da nota)</span><span><b class="lg next-l"></b>vem depois: já prepare</span>',
  };
  function setHandLegend(kind) {
    if (S.handLegend === kind) return;
    S.handLegend = kind;
    const el = document.querySelector('.hand-legend');
    if (el) el.innerHTML = LEGENDS[kind] || LEGENDS.violao;
  }

  function nextChord(ci) {
    const c = S.chords;
    for (let j = ci + 1; j < c.length; j++) if (c[j].kind !== 'N') return c[j];
    return null;
  }

  // faz o próximo tick redesenhar o acorde (nomes e desenhos); antes apaga o destaque do chip aceso, que
  // senão ficava aceso junto com o novo
  function forceChordRedraw() {
    const p = S.chips && S.chips[S.chordIdx];
    if (p) p.classList.remove('on');
    S.chordIdx = -2;
  }

  function updateChord(ci) {
    const prev = S.chips[S.chordIdx];
    if (prev) prev.classList.remove('on');
    S.chordIdx = ci;
    const c = S.chords[ci];
    const real = c && c.kind !== 'N';
    const sub = real ? cap(c.spoken) : (ci < 0 ? 'Aperte o play' : 'Sem acorde aqui');
    const diagram = real ? ChordDiagram.forInstrument(c, diagramInst(), { width: 120, height: 140 }) : '';
    $('#stageChord').textContent = real ? c.display : '—';
    $('#stageSub').textContent = sub;
    $('#stageDiagram').innerHTML = diagram;
    $('#hudChord').textContent = real ? c.display : '—';
    $('#hudDiagram').innerHTML = diagram;
    const n = nextChord(ci);
    // onde pôr os dedos no braço do violão: o acorde de agora ou, enquanto não tem, o que vem
    // (nos níveis de instrumento o cartão mostra as notas da gravação, em updateViolao)
    const h = real ? c : n;
    $('#handChord').textContent = h ? h.display : '—';
    if (!isInstrument(S.level)) {
      setHandLegend('violao');
      $('#handLabel').textContent = real || !h ? 'Como tocar' : 'Prepare';
      // neckFor: com extensões, 5-, baixo com barra e tipos sem forma pronta (E5, 7(2)) também
      $('#handSvg').innerHTML = ChordDiagram.neckFor(h, 'violao', noteName);
    }
    $('#stageNext').textContent = n ? n.display : '—';
    $('#hudNext').textContent = n ? n.display : '—';
    const chip = S.chips[ci];
    if (chip) {
      chip.classList.add('on');
      const cl = $('#chordline');
      const left = chip.offsetLeft;
      if (left < cl.scrollLeft + 40 || left + chip.offsetWidth > cl.scrollLeft + cl.clientWidth * 0.8) {
        cl.scrollLeft = left - cl.clientWidth * 0.25;
      }
    }
  }

  function renderChordline() {
    const cl = $('#chordline');
    cl.innerHTML = '';
    S.chips = S.chords.map((c) => {
      const d = document.createElement('button');
      const beats = c.end_beat - c.start_beat;
      d.className = 'chip-chord' + (c.kind === 'N' ? ' nc' : '');
      d.style.width = Math.max(34, beats * PX_PER_BEAT - 4) + 'px';
      d.textContent = c.kind === 'N' ? '' : c.display;
      if (c.start_beat % 4 === 0) {
        d.classList.add('bar');
        d.dataset.m = c.start_beat / 4 + 1;
      }
      d.title = `${c.kind === 'N' ? 'Sem acorde' : c.display} · compasso ${Math.floor(c.start_beat / 4) + 1}`;
      d.onclick = () => seek(c.start + 0.001);
      cl.appendChild(d);
      return d;
    });
  }

  // ------------------------------------------------------------ partitura
  function brazilianChordLabels(osmd) {
    try {
      const { ChordSymbolEnum: E, AccidentalEnum: Acc } = opensheetmusicdisplay;
      const rules = osmd.EngravingRules;
      rules.ChordSymbolTextHeight = 2.3;
      if (Acc && rules.ChordAccidentalTexts) {
        rules.ChordAccidentalTexts.setValue(Acc.FLAT, '♭');
        rules.ChordAccidentalTexts.setValue(Acc.SHARP, '♯');
      }
      if (E && rules.ChordSymbolLabelTexts) {
        const labels = {
          majorseventh: '7M', halfdiminished: 'm7(♭5)', diminishedseventh: '°', minorsixth: 'm6',
          majorsixth: '6', minormajorseventh: 'm(7M)', augmented: '(♯5)', diminished: 'dim',
          suspendedfourth: '4', suspendedsecond: 'sus2',
          dominantninth: '7(9)', majorninth: '7M(9)', minorninth: 'm7(9)', dominant11th: '7(11)',
          dominant13th: '7(13)',
        };
        for (const [k, v] of Object.entries(labels)) if (E[k] !== undefined) rules.ChordSymbolLabelTexts.setValue(E[k], v);
      }
      extendedChordNames(rules);
    } catch (_) { /* versão sem suporte: fica a cifra padrão */ }
  }

  // Acordes com extensões (D6(9), G7M(♯11), A7(4/9)): a partitura traz o tipo e os graus acrescentados;
  // aqui cada combinação da música ganha o nome brasileiro que a análise já escreveu (mesmo texto da tela).
  // A análise manda, em cada acorde, o tipo MusicXML e os graus (c.xml), os mesmos que vão para a
  // partitura; o OSMD lê o tipo tirando o primeiro hífen e escreve o grau como acidente + número.
  const ACC = { '-1': '♭', 0: '', 1: '♯' };
  function osmdChordKey(c) {
    if (!c.xml) return null;
    const kind = c.xml.kind.replace('-', '');
    const deg = { add: [], alter: [], subtract: [] };
    for (const [value, alter, mod] of c.xml.degrees || []) if (deg[mod]) deg[mod].push((ACC[alter] || '') + value);
    return { kind, adds: deg.add, alts: deg.alter, subs: deg.subtract };
  }
  function extendedChordNames(rules) {
    if (!S.an || typeof rules.addChordName !== 'function') return;
    const seen = new Map();
    for (const c of [...(S.an.chords_detalhado || []), ...(S.an.chords || [])]) {
      // todo acorde com nome escrito pela análise (com extensões, ou do jeito da cifra colada: A7+)
      if (!c || c.kind === 'N' || c.suffix == null) continue;
      const k = osmdChordKey(c);
      if (!k) continue;
      const id = [k.kind, k.adds.join(','), k.alts.join(','), k.subs.join(',')].join('|');
      if (!seen.has(id)) seen.set(id, { name: c.suffix, ...k });
    }
    const before = rules.CustomChords.length;
    // os mais específicos primeiro: o OSMD usa o primeiro nome cujos graus estão todos no acorde
    const size = (v) => v.adds.length + v.alts.length + v.subs.length;
    for (const v of [...seen.values()].sort((a, b) => size(b) - size(a))) {
      rules.addChordName(v.name, v.kind, v.adds, v.alts, v.subs);
    }
    const mine = rules.CustomChords.splice(before);
    rules.CustomChords.unshift(...mine);
  }

  const OSMD_OPTIONS = {
    autoResize: false, backend: 'svg', drawTitle: false, drawSubtitle: false, drawComposer: false,
    drawCredits: false, drawPartNames: false, drawMeasureNumbers: true, followCursor: false,
  };

  // Uma partitura na tela: o desenho (osmd), o tempo de cada posição do cursor e onde ele está.
  // `isCurrent`: a partitura só aparece se ainda for a pedida (trocar de instrumento rápido não deixa
  // a anterior, que terminou de carregar depois, passar por cima da nova).
  async function makeSheet(host, zoom, alpha, isCurrent = () => true) {
    const box = document.createElement('div');
    // cursor na cor da música (no papel branco, um pouco mais forte que o cinza de antes)
    const osmd = new opensheetmusicdisplay.OpenSheetMusicDisplay(box, {
      ...OSMD_OPTIONS,
      cursorsOptions: [{ type: 0, color: S.songHex || '#000000', alpha: S.songHex ? Math.max(alpha, 0.32) : alpha, follow: false }],
    });
    brazilianChordLabels(osmd);
    await osmd.load(`/files/${S.playerId}/score_${S.level}.musicxml`);
    if (!isCurrent()) return null;
    host.innerHTML = '';
    host.appendChild(box);
    osmd.zoom = zoom;
    osmd.render();
    osmd.cursor.show();
    const sheet = { osmd, ts: [], idx: 0 };
    indexSheet(sheet);
    return sheet;
  }

  async function loadSheet() {
    const id = S.playerId;
    const token = (S.sheetToken = (S.sheetToken || 0) + 1);
    $('#paperLoading').hidden = false;
    $('#paperLoading').textContent = 'Carregando partitura…';
    let sheet;
    try {
      sheet = await makeSheet($('#osmd'), S.zoom, 0.16, () => token === S.sheetToken && S.playerId === id);
    } catch (e) {
      if (token === S.sheetToken) $('#paperLoading').textContent = 'Não consegui abrir a partitura: ' + e.message;
      return;
    }
    if (!sheet || S.playerId !== id || token !== S.sheetToken) return;
    S.sheet = sheet;
    S.sheetStale = false;
    $('#paperLoading').hidden = true;
    moveSheet(S.sheet, viewTime(), true);
    // a pista não depende da partitura: só a esteira precisa ser montada de novo
    if (S.showOn && S.showView === 'partitura') loadStrip();
  }

  const currentBeat = () => beatAt(S.master ? viewTime() : 0);

  function indexSheet(sheet) {
    const c = sheet.osmd.cursor;
    c.reset();
    const it = c.Iterator;
    let guard = 0;
    while (!it.EndReached && guard++ < 100000) {
      sheet.ts.push(it.currentTimeStamp.RealValue * 4);
      it.moveToNext();
    }
    c.reset();
    sheet.idx = 0;
    sheet.tt = sheetTimes(sheet.ts);
  }

  // Instante (s) de cada posição do cursor. A partitura arredonda as notas para a grade, mas o cursor
  // pula para a nota quando ela soa de verdade (o canto ou a batida do violão); pausas, ligaduras e
  // compassos sem melodia seguem a grade.
  function sheetTimes(ts) {
    const an = S.an;
    const ql = (an && an.beat_ql) || 1; // semínimas da partitura → tempos da análise (12/8: 1,5)
    const real = new Map();
    const key = (b) => Math.round(b * 24);
    if (isInstrument(S.level)) {
      for (const v of instrumentNotes(S.level)) if (v[3] > 0) real.set(key(v[0]), v[3]);
    } else {
      const notes = (an.melody || {})[S.level] || [];
      const times = (an.melody_times || {})[S.level] || [];
      if (times.length === notes.length) notes.forEach((n, i) => real.set(key(n[0]), times[i]));
    }
    const tt = ts.map((q) => {
      const r = real.get(key(q / ql));
      return r !== undefined ? r : timeAtBeat(q / ql);
    });
    for (let i = tt.length - 2; i >= 0; i--) if (tt[i] > tt[i + 1]) tt[i] = tt[i + 1]; // sempre em ordem
    return tt;
  }

  // Leva o cursor ao instante `t` (s) da música. Devolve true se ele mudou de lugar.
  function moveSheet(sheet, t, force) {
    if (!sheet || !sheet.tt || !sheet.tt.length) return false;
    const tt = sheet.tt;
    let lo = 0, hi = tt.length - 1, i = 0;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (tt[mid] <= t + 1e-4) { i = mid; lo = mid + 1; } else hi = mid - 1; }
    if (i === sheet.idx && !force) return false;
    const c = sheet.osmd.cursor;
    if (i < sheet.idx || force) { c.reset(); sheet.idx = 0; }
    const it = c.Iterator;
    while (sheet.idx < i && !it.EndReached) { it.moveToNext(); sheet.idx++; }
    c.update();
    return true;
  }

  function moveCursor(t, force) {
    if (moveSheet(S.sheet, t, force) && S.playing && S.view === 'player' && !S.stageOn && !S.showOn) followCursor();
  }

  function followCursor() {
    if (performance.now() - S.userScrollAt < 3000) return;
    const el = S.sheet && S.sheet.osmd.cursor.cursorElement;
    if (!el) return;
    const main = $('#main');
    const r = el.getBoundingClientRect();
    const mr = main.getBoundingClientRect();
    // só acompanha depois que a pessoa rolou até a partitura; antes disso, o topo animado fica à vista
    if (document.querySelector('.paper').getBoundingClientRect().top > mr.top + mr.height * 0.6) return;
    if (r.top < mr.top + 190 || r.bottom > mr.bottom - 30) {
      main.scrollTo({ top: main.scrollTop + (r.top - mr.top) - mr.height * 0.4, behavior: 'smooth' });
    }
  }

  function rerenderSheet() {
    if (!S.sheet) return;
    // escondida (outra tela, ou atrás do Modo Show): refaz quando voltar a aparecer; entrar no show em
    // tela cheia redesenhava a partitura inteira invisível e travava o PC fraco na contagem
    if ($('#viewPlayer').hidden || S.showOn) { S.sheetStale = true; return; }
    S.sheet.osmd.zoom = S.zoom;
    S.sheet.osmd.render();
    S.sheetStale = false;
    moveSheet(S.sheet, viewTime(), true);
  }

  // ------------------------------------------------------------ modo show
  // Versão de teste: o "valendo pontos" é do plano Premium; no app pago isso viria da assinatura.
  const PREMIUM_LIBERADO = true;

  const NOTE_FLAT = ['Dó', 'Ré♭', 'Ré', 'Mi♭', 'Mi', 'Fá', 'Sol♭', 'Sol', 'Lá♭', 'Lá', 'Si♭', 'Si'];
  const NOTE_SHARP = ['Dó', 'Dó♯', 'Ré', 'Ré♯', 'Mi', 'Fá', 'Fá♯', 'Sol', 'Sol♯', 'Lá', 'Lá♯', 'Si'];
  // nome da nota pela função dela no tom (como analysis.spell no servidor): em Ré menor o Dó♯ do A7 é
  // Dó♯, não Ré♭; nomes raros (Dó♭, Fá♭, Mi♯, Si♯) voltam ao nome comum da armadura
  const SP_LET = 'CDEFGAB', SP_NAT = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }, SP_DEG = [0, 1, 1, 2, 2, 3, 3, 4, 5, 5, 6, 6];
  const SP_PT = { C: 'Dó', D: 'Ré', E: 'Mi', F: 'Fá', G: 'Sol', A: 'Lá', B: 'Si' };
  const noteName = (midi) => {
    const pc = ((midi % 12) + 12) % 12;
    const k = S.an && S.an.key;
    if (k && k.name && k.tonic != null) {
      const letter = SP_LET[(SP_LET.indexOf(k.name[0]) + SP_DEG[(pc - k.tonic + 12) % 12]) % 7];
      let diff = (pc - SP_NAT[letter] + 12) % 12;
      if (diff > 6) diff -= 12;
      const rare = (letter === 'C' || letter === 'F') ? diff === -1 : (letter === 'E' || letter === 'B') && diff === 1;
      if (Math.abs(diff) <= 1 && !rare) return SP_PT[letter] + (diff === 1 ? '♯' : diff === -1 ? '♭' : '');
    }
    return ((k && k.flats) ? NOTE_FLAT : NOTE_SHARP)[pc];
  };

  // notas, pautas, cifras e letra em branco, direto no desenho (filtro de imagem pesa demais)
  function whiteInk(osmd) {
    const R = osmd.EngravingRules;
    for (const k of ['DefaultColorMusic', 'DefaultColorNotehead', 'DefaultColorRest', 'DefaultColorStem',
      'DefaultColorLabel', 'DefaultColorLyrics', 'DefaultColorTitle', 'LedgerLineColorDefault', 'StaffLineColor']) {
      R[k] = '#ffffff';
    }
  }

  // Esteira do Modo Show, em pedaços desenhados um de cada vez (o atual e os próximos). Antes a música
  // inteira virava UMA linha: passava do tamanho máximo de imagem do navegador (32.767 px), a esteira
  // ficava vazia dali em diante (tela preta; no celular a placa de vídeo nem mostrava) e levava 8-15 s
  // para abrir. Cada pedaço vira uma imagem pronta e o fim de um encosta no começo do outro, sem pulo.
  // Pedaço de até STRIP_BARS compassos e STRIP_NOTES notas: partitura cheia (violão com batida em
  // semicolcheias, ~100 notas por compasso) leva ~0,2 s por compasso para desenhar; com pedaço pequeno
  // a tela não congela enquanto o próximo é preparado.
  const STRIP_BARS = 8, STRIP_NOTES = 160;

  async function loadStrip() {
    const id = S.playerId;
    const token = (S.stripToken = (S.stripToken || 0) + 1);
    const work = $('#osmdShow'); // onde o OSMD desenha (fora da tela); os pedaços prontos vão para a esteira
    work.innerHTML = '';
    $('#stripTrack').querySelectorAll('.strip-chunk').forEach((c) => c.remove());
    $('#stripLoading').hidden = false;
    $('#stripLoading').textContent = 'Preparando a partitura…';
    S.strip = null;
    try {
      // sem juntar compassos de pausa num só ("pausa de 8 compassos"): cada compasso precisa do seu desenho,
      // senão um pedaço que começa no meio da pausa não monta e a esteira tentava de novo sem parar
      const osmd = new opensheetmusicdisplay.OpenSheetMusicDisplay(work, {
        ...OSMD_OPTIONS, renderSingleHorizontalStaffline: true, autoGenerateMultipleRestMeasuresFromRestMeasures: false,
        cursorsOptions: [{ type: 0, color: '#ffffff', alpha: 0, follow: false }],
      });
      brazilianChordLabels(osmd);
      whiteInk(osmd);
      await osmd.load(`/files/${id}/score_${S.level}.musicxml`);
      if (S.playerId !== id || !S.showOn || token !== S.stripToken) return;
      const box = $('#showStrip');
      const ql = (S.an && S.an.beat_ql) || 1;
      const measures = osmd.Sheet.SourceMeasures;
      const starts = measures.map((m) => m.AbsoluteTimestamp.RealValue * 4); // início de cada compasso, em semínimas
      const last = measures[measures.length - 1];
      const end = last ? starts[starts.length - 1] + last.Duration.RealValue * 4 : 0;
      const index = new Map(measures.map((m, i) => [m, i]));
      // onde começa cada pedaço (índice do compasso) e a que pedaço pertence cada compasso
      const cuts = [], chunkOf = [];
      let notes = 0;
      measures.forEach((m, i) => {
        let n = 0;
        for (const c of m.VerticalSourceStaffEntryContainers || []) {
          for (const se of c.StaffEntries || []) if (se) for (const ve of se.VoiceEntries || []) n += ve.Notes.length;
        }
        const len = cuts.length ? i - cuts[cuts.length - 1] : 0;
        if (!cuts.length || len >= STRIP_BARS || notes + n > STRIP_NOTES) { cuts.push(i); notes = 0; }
        notes += n;
        chunkOf.push(cuts.length - 1);
      });
      S.strip = {
        osmd, token, starts, end, index, cuts, chunkOf, bars: measures.length, chunks: new Map(),
        head: box.clientWidth * 0.26, zoom: 1, want: [], failed: new Set(),
      };
      const k = stripChunkOf(currentBeat() * ql);
      // o 1º pedaço mede a altura da linha e acerta o tamanho para caber na faixa
      const first = renderChunk(k, true);
      if (first) {
        const z = Math.max(0.9, Math.min(2.6, (box.clientHeight * 0.92) / (first.h || 200)));
        S.strip.zoom = z;
        // altura da pauta na tela: igual em todos os pedaços, para a linha não pular de um para o outro
        S.strip.staffY = Math.max(0, (box.clientHeight - first.h * z) / 2) + first.sy * z;
        renderChunk(k);
      }
      $('#stripLoading').hidden = true;
      updateStrip(currentBeat());
    } catch (e) {
      if (token === S.stripToken) $('#stripLoading').textContent = 'Não consegui montar a partitura: ' + e.message;
    }
  }

  // em que pedaço cai o momento q (semínimas): procura o compasso pelo início de cada um
  const stripChunkOf = (q) => {
    const s = S.strip.starts;
    let lo = 0, hi = s.length - 1;
    if (hi < 0 || q < s[0]) return 0;
    while (hi > lo) { const mid = (lo + hi + 1) >> 1; if (s[mid] <= q) lo = mid; else hi = mid - 1; }
    return S.strip.chunkOf[lo];
  };

  function dropChunk(k) {
    const ch = S.strip && S.strip.chunks.get(k);
    if (ch) { ch.el.remove(); S.strip.chunks.delete(k); }
  }

  // Desenha o pedaço k e guarda onde cai cada momento dele (x local). `measureOnly`: só mede.
  function renderChunk(k, measureOnly) {
    const st = S.strip;
    if (!st || k < 0 || k >= st.cuts.length) return null;
    if (st.chunks.has(k)) return st.chunks.get(k);
    const from = st.cuts[k] + 1, to = k + 1 < st.cuts.length ? st.cuts[k + 1] : st.bars; // 1-based, inclusive
    const osmd = st.osmd;
    osmd.setOptions({ drawFromMeasureNumber: from, drawUpToMeasureNumber: to });
    // clave, armadura e fórmula só no 1º pedaço; nos outros a pauta começa direto nas notas
    const R = osmd.EngravingRules;
    R.RenderClefsAtBeginningOfStaffline = R.RenderKeySignatures = R.RenderTimeSignatures = k === 0;
    osmd.zoom = st.zoom;
    osmd.render();
    const svg = $('#osmdShow svg');
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    const unit = 10 * st.zoom;
    const t0 = st.starts[from - 1], t1 = to < st.bars ? st.starts[to] : st.end;
    // cada nota (de todas as pautas) vira um ponto (tempo, x); a linha verde anda de nota em nota
    const pts = [];
    const lead = []; // distância da barra de compasso até a 1ª nota, para emendar um pedaço no outro
    let xs = null, xe = null, first = null; // first: x da 1ª nota do pedaço
    for (const list of osmd.GraphicSheet.MeasureList || []) {
      for (const gm of list || []) {
        if (!gm || !gm.PositionAndShape || !gm.parentSourceMeasure) continue;
        const i = st.index.get(gm.parentSourceMeasure);
        if (i === undefined || i < from - 1 || i > to - 1) continue;
        const ps = gm.PositionAndShape;
        const base = st.starts[i];
        const bar = ps.AbsolutePosition.x * unit;
        const x0 = bar + (gm.beginInstructionsWidth || 0) * unit;
        const x1 = bar + (ps.Size ? ps.Size.width : 0) * unit;
        if (xs === null || x0 < xs) xs = x0;
        if (xe === null || x1 > xe) xe = x1;
        let firstX = null;
        for (const se of gm.staffEntries || []) {
          if (!se || !se.relInMeasureTimestamp || !se.PositionAndShape) continue;
          const x = se.PositionAndShape.AbsolutePosition.x * unit;
          pts.push([base + se.relInMeasureTimestamp.RealValue * 4, x]);
          if (se.relInMeasureTimestamp.RealValue === 0 && (firstX === null || x < firstX)) firstX = x;
        }
        if (firstX !== null) {
          lead.push(firstX - x0);
          if (i === from - 1 && (first === null || firstX < first)) first = firstX;
        }
      }
    }
    if (xs === null) { xs = 0; xe = rect.width; }
    lead.sort((a, b) => a - b);
    const d = lead.length ? lead[lead.length >> 1] : 0;
    if (!pts.length) pts.push([t0, xs + d]);
    pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    for (let i = 1; i < pts.length; i++) if (pts[i][1] < pts[i - 1][1]) pts[i][1] = pts[i - 1][1]; // sempre para a direita
    const page = osmd.GraphicSheet.MusicPages && osmd.GraphicSheet.MusicPages[0];
    const line = page && page.MusicSystems[0] && page.MusicSystems[0].StaffLines[0];
    const sy = line ? line.PositionAndShape.AbsolutePosition.y * unit : 0; // topo da 1ª pauta
    // o fim (t1) emenda na 1ª nota do pedaço seguinte (chunkX); `d` é a reserva enquanto ele não existe
    const ch = { k, pts, xs, xe, d, first: first === null ? xs + d : first, sy, w: rect.width, h: rect.height, t0, t1 };
    if (measureOnly) return ch;
    const el = document.createElement('div');
    el.className = 'strip-chunk';
    // o número do 1º compasso fica em cima da clave escondida e apareceria cortado ("5" no lugar de "85")
    if (k > 0) {
      for (const t of svg.querySelectorAll('text')) {
        if (/^\d+$/.test(t.textContent.trim()) && t.getBoundingClientRect().left - rect.left < xs) t.setAttribute('data-cut', '');
      }
    }
    const copy = svg.cloneNode(true);
    copy.querySelectorAll('[data-cut]').forEach((t) => t.remove());
    // na tablatura o número da casa tem um fundo "white" que apaga a linha; com tinta branca o número
    // sumia (branco no branco): o fundo vira preto (as barras de compasso são "#ffffff" e ficam)
    copy.querySelectorAll('rect[fill="white"]').forEach((r) => r.setAttribute('fill', '#000'));
    el.appendChild(copy);
    const marks = document.createElement('div');
    marks.className = 'strip-marks';
    el.appendChild(marks);
    el.style.width = `${ch.w}px`;
    el.style.height = `${ch.h}px`;
    el.style.top = `${(st.staffY !== undefined ? st.staffY - sy : Math.max(0, ($('#showStrip').clientHeight - ch.h) / 2)).toFixed(1)}px`;
    el.style.display = 'none'; // aparece quando a esteira o põe no lugar
    // só o miolo do pedaço aparece: sem a clave do começo (menos no 1º) e sem a margem do fim
    el.style.clipPath = `inset(0 ${Math.max(0, ch.w - xe).toFixed(1)}px 0 ${k === 0 ? 0 : xs.toFixed(1)}px)`;
    $('#stripTrack').appendChild(el);
    Object.assign(ch, { el, marks });
    st.chunks.set(k, ch);
    // memória: guarda só os pedaços perto do atual
    for (const j of [...st.chunks.keys()]) if (Math.abs(j - k) > 6) dropChunk(j);
    return ch;
  }

  // Prepara os pedaços que faltam, um por vez e entre os quadros, o mais urgente primeiro.
  function wantChunks(list) {
    const st = S.strip;
    if (!st) return;
    st.want = list.filter((k) => k >= 0 && k < st.cuts.length && !st.chunks.has(k) && !st.failed.has(k));
    if (!st.want.length || st.pending) return;
    st.pending = true;
    setTimeout(() => {
      st.pending = false;
      if (S.strip !== st || !st.want.length) return;
      const k = st.want.shift();
      let ok = null;
      try { ok = renderChunk(k); } catch (_) { ok = null; }
      // pedaço que não monta não é tentado de novo a cada quadro (travava o PC); fica vazio
      if (!ok) st.failed.add(k);
      updateStrip(currentBeat());
    }, 15);
  }

  // x local (no pedaço) de um momento q, em semínimas; entre dois pontos, interpola. Depois da última nota
  // vai até o fim do pedaço, que fica onde está a 1ª nota do seguinte (`next`), sem pulo na troca
  function chunkX(ch, q, next) {
    const p = ch.pts, n = p.length;
    if (q <= p[0][0]) return p[0][1];
    if (q >= p[n - 1][0]) {
      const lx = p[n - 1][1];
      const ex = Math.max(lx, next ? ch.xe + (next.first - next.xs) : ch.xe + ch.d);
      if (q >= ch.t1) return ex;
      return lx + (ex - lx) * ((q - p[n - 1][0]) / Math.max(1e-6, ch.t1 - p[n - 1][0]));
    }
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (p[mid][0] <= q) lo = mid; else hi = mid; }
    return p[lo][1] + (p[hi][1] - p[lo][1]) * ((q - p[lo][0]) / Math.max(1e-6, p[hi][0] - p[lo][0]));
  }

  function updateStrip(b) {
    const st = S.strip;
    if (!st) return;
    const q = b * ((S.an && S.an.beat_ql) || 1);
    const k = stripChunkOf(q);
    const cur = st.chunks.get(k);
    wantChunks([k, k + 1, k + 2, k - 1, k + 3]);
    if (!cur || !cur.el.isConnected) { // o pedaço ainda está sendo preparado (ex.: pulou para longe)
      for (const ch of st.chunks.values()) ch.el.style.display = 'none';
      return;
    }
    const left = st.head - chunkX(cur, q, st.chunks.get(k + 1));
    const placed = new Set();
    const place = (ch, x) => { placed.add(ch); ch.el.style.display = ''; ch.el.style.transform = `translate3d(${x.toFixed(1)}px,0,0)`; };
    place(cur, left);
    // vizinhos encostados: o fim de um no começo do outro
    let x = left, prev = cur;
    for (let j = k + 1; st.chunks.has(j); j++) { const ch = st.chunks.get(j); x += prev.xe - ch.xs; place(ch, x); prev = ch; }
    x = left; let next = cur;
    for (let j = k - 1; st.chunks.has(j); j--) { const ch = st.chunks.get(j); x -= ch.xe - next.xs; place(ch, x); next = ch; }
    for (const ch of st.chunks.values()) if (!placed.has(ch) && ch.el.style.display !== 'none') ch.el.style.display = 'none';
  }

  // marca colorida na esteira onde você acertou ou errou (b0..b1 em tempos)
  function addMark(b0, b1, cls) {
    const st = S.strip;
    if (!st) return;
    const ql = (S.an && S.an.beat_ql) || 1;
    const k = stripChunkOf(b0 * ql), ch = st.chunks.get(k), next = st.chunks.get(k + 1);
    if (!ch || !ch.marks) return;
    const x0 = chunkX(ch, b0 * ql, next), x1 = chunkX(ch, Math.min(b1 * ql, ch.t1), next);
    const el = document.createElement('div');
    el.className = 'strip-mark ' + cls;
    el.style.left = (x0 - 8) + 'px';
    el.style.width = Math.max(16, x1 - x0) + 'px';
    ch.marks.appendChild(el);
  }

  // ------------------------------------------------------------ pistas (pista.js)
  // Pista deitada no "Tocando agora" (em cima da partitura) e pista estilo Guitar Hero no Modo Show. As duas
  // mostram só a FORMAÇÃO de cada acorde (o desenho do cartão "Como tocar"), do tamanho que ele dura; a
  // opção "Voz" do show mostra a melodia caindo sobre um teclado.
  const voiceCache = new WeakMap();
  function voiceTrack() {
    const m = melodyNotes(); // a mesma melodia do jogo de melodia
    if (!Array.isArray(m)) return [];
    if (!voiceCache.has(m)) voiceCache.set(m, m.map((n) => [n[0], n[1], [[n[2], 0, 0]]]));
    return voiceCache.get(m);
  }
  const hasChords = () => (S.chords || []).some((c) => c.kind !== 'N');
  const INST_LABEL = { violao: 'Violão', cavaco: 'Cavaco', baixo: 'Baixo', teclado: 'Teclado', voz: 'Voz' };
  const TRACK_LABEL = {
    violao: 'Violão · formação de cada acorde', cavaco: 'Cavaco · formação de cada acorde',
    baixo: 'Baixo · a nota de cada acorde', teclado: 'Teclado · as teclas de cada acorde',
  };
  // quantos tempos aparecem pela frente (`sec` segundos de música)
  const aheadBeats = (sec) => Math.max(3, Math.min(12, (sec * ((S.an && S.an.bpm) || 90)) / 60));
  const narrowScreen = () => window.innerWidth <= 700;

  // "Tocando agora": o instrumento do nível aberto; nos níveis de melodia, o violão
  function trackSource() {
    if (!S.an || S.showOn) return null;
    const inst = isInstrument(S.level) ? S.level : 'violao', narrow = narrowScreen();
    if (S.trackShown !== inst + narrow) { // trocou o instrumento ou a largura: título e altura
      S.trackShown = inst + narrow;
      $('#trackLabel').textContent = TRACK_LABEL[inst];
      $('#trackCanvas').style.height = Pista.Highway.flatHeight(narrow) + 'px';
    }
    return { b: beatAt(viewTime()), ahead: aheadBeats(narrow ? 3.6 : 6.5), inst, chords: S.chords, color: S.songRgb, flash: null };
  }

  // Modo Show: pista em pé do instrumento escolhido nos botões em cima dela
  function hwSource() {
    if (!S.an || !S.showOn) return null;
    const voice = S.hwInst === 'voz';
    return {
      b: beatAt(viewTime()), ahead: aheadBeats(voice ? 2.6 : narrowScreen() ? 3.6 : 4.2), inst: S.hwInst,
      notes: voice ? voiceTrack() : null, chords: S.chords, color: S.songRgb, flash: S.hwFlash,
    };
  }
  // a formação sai dos acordes: os 4 instrumentos sempre que a música tem acordes; a voz se tem melodia
  const hwChoices = () => [...(hasChords() ? ['violao', 'cavaco', 'baixo', 'teclado'] : []), ...(voiceTrack().length ? ['voz'] : [])];
  function renderHwInsts() {
    $('#hwInsts').innerHTML = hwChoices()
      .map((k) => `<button data-inst="${k}" class="${k === S.hwInst ? 'on' : ''}">${INST_LABEL[k]}</button>`).join('');
  }
  // No jogo de melodia, a voz. Senão: com `keep`, fica o que a pessoa escolheu (se ainda existe); ao abrir
  // o show, o instrumento do nível aberto, ou o violão (ou o que tiver)
  function hwPickInst(keep) {
    const have = hwChoices();
    if (S.gameOn && S.game.mode === 'melody' && have.includes('voz')) S.hwInst = 'voz';
    else if (!(keep && have.includes(S.hwInst))) {
      S.hwInst = isInstrument(S.level) && have.includes(S.level) ? S.level : have.includes('violao') ? 'violao' : have[0] || 'violao';
    }
    renderHwInsts();
    return have.length > 0;
  }

  function savedShowView() {
    try { return localStorage.getItem('pv.showView') === 'partitura' ? 'partitura' : 'pista'; } catch (_) { return 'pista'; }
  }

  function clearStrip() {
    $('#osmdShow').innerHTML = '';
    $('#stripTrack').querySelectorAll('.strip-chunk').forEach((c) => c.remove()); // levam as marcas junto
    S.strip = null;
    S.stripToken = (S.stripToken || 0) + 1; // cancela uma montagem em andamento
  }

  // Pista (estilo Guitar Hero) ou Partitura (a esteira). A escolha da pessoa fica guardada mesmo quando
  // esta música não tem nada para a pista (aí ela vê a Partitura, mas a próxima abre na Pista).
  // `keep`: troca pelos botões, mantém o instrumento escolhido na pista.
  function setShowView(v, save, keep) {
    if (save) { try { localStorage.setItem('pv.showView', v); } catch (_) { /* sem armazenamento */ } }
    if (v === 'pista' && !hwPickInst(keep)) v = 'partitura'; // sem acordes nem melodia
    S.showView = v;
    $('#viewPista').classList.toggle('on', v === 'pista');
    $('#viewPartitura').classList.toggle('on', v === 'partitura');
    $('#show').classList.toggle('hw', v === 'pista');
    if (S.stage) focusStage(); // a faixa de baixo mudou de altura: a cena de fundo se ajusta
    if (v === 'pista') {
      clearStrip();
      S.hw.start();
    } else {
      S.hw.stop();
      if (!S.strip) loadStrip();
    }
    tick();
  }

  // Fundo do show: a foto do artista (a capa da música, padrão), as luzes de show na cor da música, a mesa
  // de samba ou um vídeo/foto da própria pessoa. A escolha fica guardada; o vídeo/foto vale até fechar o
  // app. Música sem capa cai na mesa de samba.
  // (a chave antiga, pv.scene, era gravada sozinha com "mesa": por isso a escolha mudou de chave; a "roda
  // com músicos" saiu e quem tinha escolhido ela ganha as luzes)
  function savedScene() {
    try {
      const v = localStorage.getItem('pv.fundo');
      return v === 'roda' ? 'luzes' : v === 'mesa' || v === 'luzes' ? v : 'capa';
    } catch (_) { return 'capa'; }
  }

  function markBg() {
    $('#bgCapa').disabled = !coverSrc(S.playerMeta);
    document.querySelectorAll('#bgMenu [data-scene]').forEach((b) => {
      b.classList.toggle('on', !S.bgUrl && b.dataset.scene === S.bgKind);
    });
  }

  // cena desenhada (luzes ou mesa), que fica por trás quando o fundo é uma foto ou vídeo
  function setScene(kind) {
    if (S.stage && S.sceneKind === kind) return;
    if (S.stage) S.stage.destroy();
    S.sceneKind = kind;
    const opts = S.visualHigh ? { scale: 1, fps: 60 } : { scale: 0.6, fps: 30 };
    S.stage = kind === 'luzes' ? new LightsScene($('#showCanvas'), showState, opts) : new MesaScene($('#showCanvas'), showState, opts);
    if (S.showOn) {
      S.stage.resize();
      focusStage();
      S.stage.start();
    }
  }

  // põe o fundo escolhido: a capa da música aberta ou a cena desenhada
  function applyBg() {
    if (S.bgUrl) return; // o vídeo/foto da pessoa manda até fechar o app
    const img = $('#showImage');
    const src = S.bgKind === 'capa' ? coverSrc(S.playerMeta) : null;
    if (src) {
      if (img.getAttribute('src') !== src) img.src = src;
      img.hidden = false;
      img.classList.add('artist');
      $('#showShade').hidden = false;
      $('#showCanvas').style.visibility = 'hidden';
      if (S.stage) S.stage.paused = true;
      S.bgMedia = img;
    } else {
      img.removeAttribute('src');
      img.hidden = true;
      img.classList.remove('artist');
      $('#showShade').hidden = true;
      $('#showCanvas').style.visibility = '';
      S.bgMedia = null;
      setScene(S.bgKind === 'luzes' ? 'luzes' : 'mesa');
      if (S.showOn && S.stage) S.stage.paused = false;
    }
    markBg();
  }

  function useScene(kind) {
    if (S.bgUrl) URL.revokeObjectURL(S.bgUrl);
    S.bgUrl = null;
    const v = $('#showVideo');
    v.pause();
    v.removeAttribute('src');
    v.hidden = true;
    if (kind) {
      S.bgKind = kind;
      try { localStorage.setItem('pv.fundo', kind); } catch (_) { /* sem memória no navegador: tudo bem */ }
    }
    applyBg();
  }

  function useMedia(file) {
    if (!file) return;
    useScene();
    S.bgUrl = URL.createObjectURL(file);
    const video = file.type.startsWith('video/');
    const el = video ? $('#showVideo') : $('#showImage');
    if (!video) {
      $('#showImage').classList.remove('artist');
    } else {
      $('#showImage').hidden = true;
    }
    el.src = S.bgUrl;
    el.hidden = false;
    if (video) el.play().catch(() => {});
    $('#showShade').hidden = false;
    $('#showCanvas').style.visibility = 'hidden';
    S.stage.paused = true;
    S.bgMedia = el;
    markBg();
    toast('Fundo trocado. Ele fica até você fechar o app.');
  }

  // a roda é desenhada na área acima da esteira da partitura
  function focusStage() {
    const show = $('#show').getBoundingClientRect();
    const strip = $('#showStrip').getBoundingClientRect();
    const bar = $('.show-top').getBoundingClientRect();
    if (show.height > 0) S.stage.setFocus((strip.top - show.top) / show.height, (bar.bottom - show.top) / show.height);
  }

  function showState() {
    const st = vizState();
    st.energy = S.gameOn ? S.game.energy : null;
    st.mood = S.mood;
    st.moodAt = S.moodAt;
    st.subdivision = (S.an && S.an.subdivision) || 2;
    if (S.an && S.master) {
      const b = beatAt(viewTime());
      const i = Math.max(0, Math.floor(b));
      st.beatPos = b;
      st.beatPeriod = (timeAtBeat(i + 1) - timeAtBeat(i)) / (S.speed || 1);
    }
    return st;
  }

  const melodyNotes = () => (S.an && S.an.melody && S.an.melody[isInstrument(S.level) ? 'detalhado' : S.level]) || [];

  function resetMelodyCursor() {
    const notes = melodyNotes();
    const b = currentBeat();
    let i = 0;
    while (i < notes.length && notes[i][0] + notes[i][1] <= b) i++;
    S.melIdx = i;
    S.melCur = -1;
    if (S.gameOn) S.game.expect(null);
  }

  // modo melodia: diz ao microfone qual nota deveria estar soando e confere cada nota que termina
  function trackMelody(b) {
    const notes = melodyNotes();
    let i = S.melIdx || 0;
    while (i < notes.length && notes[i][0] + notes[i][1] <= b) {
      if (S.melCur === i) {
        const res = S.game.judgeNote();
        if (res) feedback(res, notes[i][0], notes[i][0] + notes[i][1]);
        S.melCur = -1;
        S.game.expect(null);
      }
      i++;
    }
    S.melIdx = i;
    if (i < notes.length && notes[i][0] <= b && S.melCur !== i) {
      S.game.expect(notes[i][2]);
      S.melCur = i;
    }
  }

  function openShow() {
    if (!S.an) return;
    pause();
    S.showOn = true;
    S.heroViz.paused = true;
    S.stageViz.paused = true;
    S.homeScene.paused = true;
    const el = $('#show');
    el.hidden = false;
    paintCover($('#showCover'), S.meta);
    $('#showTitle').textContent = S.meta.title;
    $('#showMeta').textContent = $('#stageMeta').textContent;
    $('#showIntro').hidden = false;
    $('#showResult').hidden = true;
    $('#showCount').hidden = true;
    $('#showScore').hidden = true;
    applyBg(); // a foto do artista é a da música que está abrindo
    S.stage.resize();
    focusStage();
    S.stage.start();
    if (S.bgMedia) {
      S.stage.paused = true;
      if (S.bgMedia.tagName === 'VIDEO') S.bgMedia.play().catch(() => {});
    }
    if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
    resetLyrics();
    setShowView(savedShowView());
  }

  function closeShow() {
    if (!S.showOn) return;
    S.showOn = false;
    pause();
    endGame();
    S.stage.stop();
    if (S.bgMedia && S.bgMedia.tagName === 'VIDEO') S.bgMedia.pause();
    S.heroViz.paused = false;
    S.stageViz.paused = false;
    S.homeScene.paused = false;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    $('#show').hidden = true;
    S.hw.stop();
    clearStrip();
    // a partitura que ficou para depois é refeita agora (com tela cheia, o resize da saída faz isso)
    if (S.sheetStale && !document.fullscreenElement) rerenderSheet();
  }

  function endGame() {
    if (S.gameOn) {
      S.game.stop();
      S.gameOn = false;
    }
    $('#show').classList.remove('game');
    if (S.mixBeforeShow) {
      for (const k of Object.keys(S.mixBeforeShow)) Object.assign(S.mix[k], S.mixBeforeShow[k]);
      S.mixBeforeShow = null;
      applyMix();
    }
  }

  // mode: null = só o show; 'chords' = pontos tocando acordes; 'melody' = pontos tocando a melodia
  async function startShow(mode) {
    $('#showIntro').hidden = true;
    $('#showResult').hidden = true;
    if (!mode || !PREMIUM_LIBERADO) {
      endGame();
    } else if (!S.gameOn || S.game.mode !== mode) {
      endGame();
      ensureCtx();
      if (S.actx) await S.actx.resume().catch(() => {});
      try {
        await S.game.start(S.actx, mode);
        S.gameOn = true;
      } catch (e) {
        toast('Não consegui usar o microfone (' + e.message + '). O show segue sem pontos.');
      }
    }
    if (S.gameOn && !S.mixBeforeShow) {
      // a parte que você vai tocar sai da gravação
      S.mixBeforeShow = JSON.parse(JSON.stringify(S.mix));
      if (S.game.mode === 'melody') S.mix.vocals.mute = true;
      else if (STEMS.some((s) => s.key === 'guitar')) S.mix.guitar.mute = true; // sai só o violão
      else S.mix.other.mute = true;
      applyMix();
    }
    if (S.gameOn) S.game.reset();
    if (S.showView === 'pista') hwPickInst(true); // jogo de melodia: a pista da voz
    $('#show').classList.toggle('game', !!S.gameOn); // na pista, o quadro de cima só aparece no jogo
    $('#showScore').hidden = !S.gameOn;
    $('#hudHeard').hidden = !(S.gameOn && S.game.mode === 'melody');
    // marcas de acerto/erro da rodada anterior (ficam dentro de cada pedaço da esteira)
    if (S.strip) for (const ch of S.strip.chunks.values()) if (ch.marks) ch.marks.innerHTML = '';
    updateScoreHud();
    setLoop(0);
    seek(0);
    resetMelodyCursor();
    await countdown();
    if (S.showOn) play();
  }

  async function countdown() {
    ensureCtx();
    if (S.actx) await S.actx.resume().catch(() => {});
    const beat = 60 / (S.an.bpm || 90) / (S.speed || 1);
    const el = $('#showCount');
    el.hidden = false;
    for (const n of ['3', '2', '1']) {
      if (!S.showOn) break;
      el.textContent = n;
      playClick(n === '3');
      await new Promise((r) => setTimeout(r, beat * 1000));
    }
    el.hidden = true;
  }

  const chordAtBeat = (b) => S.chords.find((c) => c.start_beat <= b && b < c.end_beat) || null;

  function judgeBeat(b) {
    const res = S.game.judge(chordAtBeat(b));
    if (res) feedback(res, b, b + 1);
  }

  // mostra o resultado: texto no cartão, marca na esteira, reação da roda e placar
  function feedback(res, b0, b1) {
    S.mood = res.result;
    S.moodAt = performance.now();
    const fb = $('#hudFeedback');
    fb.className = 'hud-feedback ' + res.result;
    fb.textContent = {
      perfect: 'Perfeito!', good: 'Boa!',
      miss: S.game.mode === 'melody' ? 'Errou a nota' : 'Errou o acorde', silence: 'Toque!',
    }[res.result];
    void fb.offsetWidth; // reinicia a animação
    fb.classList.add('pop');
    addMark(b0, b1, res.result);
    S.hwFlash = { result: res.result, at: performance.now() }; // a linha da pista pisca
    if (res.combo && res.combo % 8 === 0) S.stage.burst(res.combo >= 16 ? 180 : 110);
    updateScoreHud();
  }

  function updateScoreHud() {
    $('#ssPoints').textContent = S.game.score.toLocaleString('pt-BR');
    $('#ssCombo').textContent = 'x' + S.game.combo;
    $('#ssEnergy').style.width = Math.round(S.game.energy * 100) + '%';
  }

  function showResults() {
    const g = S.game;
    const acc = Math.round(g.accuracy * 100);
    const stars = acc >= 90 ? 5 : acc >= 75 ? 4 : acc >= 60 ? 3 : acc >= 40 ? 2 : 1;
    $('#resStars').textContent = '★'.repeat(stars) + '☆'.repeat(5 - stars);
    $('#resTitle').textContent = stars >= 4 ? 'A plateia foi à loucura!' : stars === 3 ? 'Mandou bem!' : 'Bora treinar mais um pouco';
    $('#resPoints').textContent = g.score.toLocaleString('pt-BR');
    $('#resAcc').textContent = acc + '%';
    $('#resCombo').textContent = g.maxCombo;
    $('#showResult').hidden = false;
    if (stars >= 4) S.stage.burst(220);
  }

  // ------------------------------------------------------------ repetição
  function setLoop(n, measure) {
    S.loopN = n;
    S.chips.forEach((ch) => ch.classList.remove('loop'));
    $('#btnLoop').classList.toggle('on', !!n);
    $('#loopBadge').hidden = !n;
    $('#loopBadge').textContent = n || '';
    $('#btnLoop').title = n ? `Repetindo ${n} compasso${n > 1 ? 's' : ''} (clique para mudar)` : 'Repetir trecho';
    if (n && S.an) {
      S.loopM = measure;
      S.loopStart = timeAtBeat(measure * 4);
      S.loopEnd = timeAtBeat(Math.min((measure + n) * 4, S.an.grid.length - 1));
      S.chords.forEach((c, i) => {
        if (c.end_beat > measure * 4 && c.start_beat < (measure + n) * 4) S.chips[i].classList.add('loop');
      });
      toast(`Repetindo ${n} compasso${n > 1 ? 's' : ''} a partir do compasso ${measure + 1}`);
    }
    loopChanged();
  }

  // ------------------------------------------------------------ modo palco
  function openStage() {
    if (!S.an) return;
    S.stageOn = true;
    $('#stage').hidden = false;
    S.stageViz.resize();
  }

  function closeStage() {
    if (!S.stageOn) return;
    S.stageOn = false;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    $('#stage').hidden = true;
  }

  // ------------------------------------------------------------ mesa de som
  // Fader em decibéis, como numa mesa de verdade: 0 dB é o volume original, dá para subir até +6 dB (o
  // limitador do master segura o pico) e o fundo é mudo. A escala é mais fina perto do 0 dB.
  const FADER_LAW = [[0.015, -90], [0.03, -70], [0.12, -50], [0.26, -36], [0.42, -24], [0.58, -12],
    [0.72, -6], [0.86, 0], [1, 6]];
  const FADER_MARKS = [[6, '+6'], [0, '0'], [-6, '6'], [-12, '12'], [-24, '24'], [-36, '36'], [-50, '50'], [-Infinity, '∞']];
  const MAX_VOL = Math.pow(10, 6 / 20);
  const volToDb = (v) => (v > 1e-5 ? 20 * Math.log10(v) : -Infinity);
  const dbToVol = (d) => (d > -90 ? Math.pow(10, d / 20) : 0);

  function posFromDb(d) {
    if (!(d > -90)) return 0;
    for (let i = 1; i < FADER_LAW.length; i++) {
      const [p0, d0] = FADER_LAW[i - 1], [p1, d1] = FADER_LAW[i];
      if (d <= d1) return p0 + ((d - d0) / (d1 - d0)) * (p1 - p0);
    }
    return 1;
  }

  function dbFromPos(p) {
    if (p < FADER_LAW[0][0]) return -Infinity;
    for (let i = 1; i < FADER_LAW.length; i++) {
      const [p0, d0] = FADER_LAW[i - 1], [p1, d1] = FADER_LAW[i];
      if (p <= p1) return d0 + ((p - p0) / (p1 - p0)) * (d1 - d0);
    }
    return 6;
  }

  // números no jeito brasileiro: vírgula, sinal de menos de verdade
  const num = (x, d = 1) => x.toFixed(d).replace('.', ',');
  const signed = (x, d = 1) => (x >= 0.05 ? '+' : x <= -0.05 ? '−' : '') + num(Math.abs(x), d);
  const fmtGain = (g) => (Math.abs(g) < 0.05 ? '0 dB' : `${signed(g)} dB`);
  const fmtHz = (f) => (f >= 1000 ? `${num(f / 1000, f >= 10000 ? 1 : 2).replace(/,?0+$/, '')} kHz` : `${Math.round(f)} Hz`);
  const fmtQ = (q) => num(q, 2);
  const fmtPan = (p) => (Math.abs(p) < 0.005 ? 'Centro' : `${p < 0 ? 'E' : 'D'} ${Math.round(Math.abs(p) * 100)}`);
  const fmtVol = (v) => { const d = volToDb(v); return d > -89.95 ? signed(d) : '−∞'; };
  const shortHz = (f) => (f >= 1000 ? `${f / 1000}k` : String(f));

  // o que cada botão giratório controla: faixa, padrão, escala (logarítmica para frequência) e como mostrar
  const PARAMS = {
    pan: { label: 'Pan', min: -1, max: 1, def: 0, bipolar: true, fmt: fmtPan },
    'eq.low.g': { label: 'Grave', min: -15, max: 15, def: 0, bipolar: true, fmt: fmtGain },
    'eq.mid.g': { label: 'Médio', min: -15, max: 15, def: 0, bipolar: true, fmt: fmtGain },
    'eq.high.g': { label: 'Agudo', min: -15, max: 15, def: 0, bipolar: true, fmt: fmtGain },
    'eq.hp.f': { label: 'Freq.', min: 20, max: 500, def: 80, log: true, fmt: fmtHz },
    'eq.low.f': { label: 'Freq.', min: 40, max: 500, def: 120, log: true, fmt: fmtHz },
    'eq.mid.f': { label: 'Freq.', min: 150, max: 8000, def: 1000, log: true, fmt: fmtHz },
    'eq.mid.q': { label: 'Q', min: 0.3, max: 8, def: 1, log: true, fmt: fmtQ },
    'eq.high.f': { label: 'Freq.', min: 1500, max: 16000, def: 6000, log: true, fmt: fmtHz },
    'eq.lp.f': { label: 'Freq.', min: 1000, max: 20000, def: 12000, log: true, fmt: fmtHz },
  };
  const GEQ_P = { min: -12, max: 12 };
  // valores redondos (o que aparece na tela é o que fica guardado): 0,1 dB, 1 Hz, centésimos no Q e no pan
  const roundParam = (P, v) => {
    const per = P.fmt === fmtHz ? 1 : P.fmt === fmtGain ? 10 : 100; // divisões por unidade
    return Math.round(v * per) / per;
  };
  // bandas do equalizador de cada canal, na ordem do gráfico
  const BANDS = [
    { id: 'hp', n: 1, name: 'Corte de grave', toggle: true, params: [['f', 'Freq.']] },
    { id: 'low', n: 2, name: 'Grave', params: [['f', 'Freq.'], ['g', 'Ganho']] },
    { id: 'mid', n: 3, name: 'Médio', params: [['f', 'Freq.'], ['g', 'Ganho'], ['q', 'Q']] },
    { id: 'high', n: 4, name: 'Agudo', params: [['f', 'Freq.'], ['g', 'Ganho']] },
    { id: 'lp', n: 5, name: 'Corte de agudo', toggle: true, params: [['f', 'Freq.']] },
  ];
  const EQ_PRESETS = {
    Plano: {},
    'Mais presença': { mid: { f: 2800, g: 5, q: 0.9 } },
    'Menos embolado': { mid: { f: 320, g: -5, q: 1.1 } },
    'Mais grave': { low: { f: 110, g: 6 } },
    'Mais brilho': { high: { f: 7000, g: 6 } },
    'Limpar o grave': { hp: { on: true, f: 120 } },
    'Rádio antigo': { hp: { on: true, f: 450 }, lp: { on: true, f: 3200 }, mid: { f: 1400, g: 4, q: 0.8 } },
  };
  const GEQ_PRESETS = {
    Plano: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    'Grave forte': [6, 5, 3.5, 1.5, 0, 0, 0, 0, 0, 0],
    'Voz clara': [-2, -2, -1, -2, 0, 1, 3, 3, 1, 0],
    Brilho: [0, 0, 0, 0, 0, 0, 1, 2.5, 4, 5],
    Loudness: [5, 4, 2, 0, -1, -1, 0, 1.5, 3.5, 4.5],
    'Fone pequeno': [3, 3, 2, 0, 0, 0, 1, 2, 2, 1],
  };
  // atalhos: mexem só em volume, mudo e solo (o equalizador e o pan ficam)
  const QUICK = [
    { id: 'noguitar', label: 'Sem o violão (toque você)', guitar: true, f: (m) => { m.guitar.mute = true; } },
    { id: 'guitar', label: 'Só o violão', guitar: true, f: (m) => { m.guitar.solo = true; } },
    { id: 'voice', label: 'Só a voz', f: (m) => { m.vocals.solo = true; } },
    { id: 'novoice', label: 'Sem a voz', f: (m) => { m.vocals.mute = true; } },
    { id: 'harm', label: 'Harmonia + baixo', f: (m) => { for (const s of STEMS) if (!['vocals', 'drums'].includes(s.key)) m[s.key].solo = true; } },
  ];

  const getPath = (o, path) => path.split('.').reduce((x, k) => (x == null ? undefined : x[k]), o);
  function setPath(o, path, v) {
    const ks = path.split('.');
    const last = ks.pop();
    ks.reduce((x, k) => x[k], o)[last] = v;
  }
  const target = (k) => (k === '_bus' ? S.bus : S.mix[k]);
  // o desenho de cada parte (canal da mesa e lista do equalizador)
  const STEM_ICON = { vocals: 'i-mic', guitar: 'i-guitar', piano: 'i-keys', other: 'i-cavaco', bass: 'i-bass', drums: 'i-pandeiro', _bus: 'i-sliders' };
  const stemIcon = (k) => `<svg class="i" aria-hidden="true"><use href="#${STEM_ICON[k] || 'i-note'}"/></svg>`;
  // equalizador mexido (alguma banda fora do zero ou algum corte ligado)?
  const eqTouched = (k) => {
    const e = target(k).eq;
    if (!e.on) return false;
    return k === '_bus' ? e.g.some((g) => g !== 0) : !!(e.low.g || e.mid.g || e.high.g || e.hp.on || e.lp.on);
  };
  const chName = (k) => (k === '_bus' ? 'Master' : (STEMS.find((s) => s.key === k) || STEM_INFO[k] || { name: k }).name);
  const clampNum = (v, a, b, d) => (v !== null && v !== '' && Number.isFinite(+v) ? Math.min(b, Math.max(a, +v)) : d);

  // ---------- estado guardado (por música) e mixagens da pessoa (para qualquer música)
  function cleanStrip(s) {
    const d = newStrip();
    if (!s || typeof s !== 'object') return d;
    d.vol = clampNum(s.vol, 0, MAX_VOL, 1);
    d.mute = !!s.mute;
    d.solo = !!s.solo;
    for (const [path, P] of Object.entries(PARAMS)) setPath(d, path, clampNum(getPath(s, path), P.min, P.max, P.def));
    if (s.eq) {
      d.eq.on = s.eq.on !== false;
      d.eq.hp.on = !!(s.eq.hp && s.eq.hp.on);
      d.eq.lp.on = !!(s.eq.lp && s.eq.lp.on);
    }
    return d;
  }

  function cleanBus(b) {
    const d = BUS_DEF();
    if (!b || typeof b !== 'object') return d;
    d.vol = clampNum(b.vol, 0, MAX_VOL, 1);
    d.limiter = b.limiter !== false;
    if (b.eq) {
      d.eq.on = b.eq.on !== false;
      d.eq.g = GEQ_F.map((_, i) => clampNum(Array.isArray(b.eq.g) ? b.eq.g[i] : 0, GEQ_P.min, GEQ_P.max, 0));
    }
    return d;
  }

  function saveMix() {
    if (!S.playerId || S.mixBeforeShow) return;
    try { localStorage.setItem('pv.mix.' + S.playerId, JSON.stringify({ ...S.mix, _bus: S.bus })); } catch (_) { /* sem memória: tudo bem */ }
  }

  function loadMix(id) {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem('pv.mix.' + id) || 'null'); } catch (_) { saved = null; }
    for (const k of Object.keys(S.mix)) S.mix[k] = cleanStrip(saved && saved[k]);
    S.bus = cleanBus(saved && saved._bus);
  }

  const sameAs = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const mixChanged = () => STEMS.some((s) => !sameAs(S.mix[s.key], newStrip())) || !sameAs(S.bus, BUS_DEF());

  // ---------- do estado para o áudio e para a tela
  // rampa curta: mexer no equalizador não estala
  function glide(param, v) {
    const now = S.actx.currentTime;
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);
    param.linearRampToValueAtTime(v, now + 0.03);
  }

  // o compressor do WebAudio sobe o volume por conta própria (ganho de compensação); com este desconto,
  // abaixo do teto o som sai exatamente no volume original
  const limiterTrim = () => Math.pow(Math.pow(10, LIMIT_DB / 20), (1 - 1 / 20) * 0.6);

  function applyMix() {
    const anySolo = STEMS.some((s) => S.mix[s.key].solo);
    const now = S.actx ? S.actx.currentTime : 0;
    for (const st of STEMS) {
      const m = S.mix[st.key];
      const on = !(m.mute || (anySolo && !m.solo));
      const c = S.ch && S.ch[st.key];
      if (c) {
        c.fader.gain.setTargetAtTime(m.vol, now, 0.012); // sem estalo
        c.mute.gain.setTargetAtTime(on ? 1 : 0, now, 0.012);
        c.pan.pan.setTargetAtTime(m.pan, now, 0.012);
      }
      const a = S.audio[st.key];
      if (a) { // o <audio> que passa pela mesa fica no máximo: quem manda é o canal
        a.volume = a._src ? 1 : Math.min(1, m.vol * (S.muted ? 0 : S.volume));
        a.muted = a._src ? false : !on;
      }
      renderStrip(st.key, on);
    }
    if (S.busFader) {
      const lim = S.bus.limiter;
      S.busFader.gain.setTargetAtTime(S.bus.vol, now, 0.012);
      S.limiter.threshold.setValueAtTime(lim ? LIMIT_DB : 0, now);
      S.limiter.ratio.setValueAtTime(lim ? 20 : 1, now);
      S.limTrim.gain.setTargetAtTime(lim ? limiterTrim() : 1, now, 0.012);
      S.monitor.gain.setTargetAtTime(S.muted ? 0 : S.volume, now, 0.012);
    }
    renderStrip('_bus', true);
    $('#btnMixer').classList.toggle('on', mixChanged());
    setRange($('#volume'), S.muted ? 0 : S.volume);
    $('#volIcon').innerHTML = `<use href="#${S.muted || S.volume === 0 ? 'i-mute' : 'i-vol'}"/>`;
  }

  function applyEq(key) {
    const c = S.ch && S.ch[key], e = S.mix[key].eq;
    if (c) {
      glide(c.hp.frequency, e.on && e.hp.on ? e.hp.f : 0); // 0 Hz = corte desligado (passa tudo)
      glide(c.low.frequency, e.low.f);
      glide(c.low.gain, e.on ? e.low.g : 0);
      glide(c.mid.frequency, e.mid.f);
      glide(c.mid.gain, e.on ? e.mid.g : 0);
      glide(c.mid.Q, e.mid.q);
      glide(c.high.frequency, e.high.f);
      glide(c.high.gain, e.on ? e.high.g : 0);
      glide(c.lp.frequency, e.on && e.lp.on ? e.lp.f : S.actx.sampleRate / 2); // na metade da taxa = desligado
    }
    eqUiChanged(key);
  }

  function applyBusEq() {
    if (S.busEq) S.busEq.forEach((b, i) => glide(b.gain, S.bus.eq.on ? S.bus.eq.g[i] : 0));
    eqUiChanged('_bus');
  }

  function applyAll() {
    applyMix();
    for (const k of Object.keys(STEM_INFO)) applyEq(k);
    applyBusEq();
  }

  function paramChanged(key, path) {
    if (path === 'pan') applyMix();
    else if (key === '_bus') applyBusEq();
    else applyEq(key);
  }

  function renderStrip(key, on) {
    const el = document.querySelector(`.cx-ch[data-k="${key}"]`);
    if (!el) return;
    const t = target(key);
    const p = posFromDb(volToDb(t.vol));
    const row = document.querySelector(`.cxp-row[data-k="${key}"]`); // a mesma linha na mesa do celular
    if (row) {
      const vol = row.querySelector('.cxp-vol');
      const v = Math.round(p * 1000);
      if (document.activeElement !== vol) setRange(vol, v); // não briga com o dedo que está arrastando
      else vol.style.setProperty('--p', `${v / 10}%`);
      row.querySelector('.cxp-db').textContent = `${fmtVol(t.vol)} dB`;
      row.classList.toggle('off', !on);
      if (key === '_bus') row.querySelector('.cxp-lim').classList.toggle('on', t.limiter);
      else {
        row.querySelector('.cxp-m').classList.toggle('on', t.mute);
        row.querySelector('.cxp-s').classList.toggle('on', t.solo);
      }
    }
    const f = el.querySelector('.fader');
    f.style.setProperty('--p', p.toFixed(4));
    f.setAttribute('aria-valuenow', Math.round(p * 100));
    f.setAttribute('aria-valuetext', `${fmtVol(t.vol)} dB`);
    el.querySelector('.cx-db').textContent = fmtVol(t.vol);
    if (key === '_bus') {
      const lim = el.querySelector('.cx-lim');
      lim.classList.toggle('on', t.limiter);
      lim.setAttribute('aria-pressed', String(t.limiter));
    } else {
      el.querySelector('.m').classList.toggle('on', t.mute);
      el.querySelector('.s').classList.toggle('on', t.solo);
      el.classList.toggle('off', !on);
    }
    el.querySelectorAll('.knob').forEach((k) => k._render && k._render());
  }

  function eqUiChanged(key) {
    const t = target(key);
    const d = eqMiniPath(key);
    document.querySelectorAll(`.cx-ch[data-k="${key}"] .cx-eqmini`).forEach((el) => {
      el.querySelector('.c').setAttribute('d', d);
      el.classList.toggle('eq-off', !t.eq.on);
    });
    const side = document.querySelector(`.cx-eq-side [data-sel="${key}"]`);
    if (side) side.classList.toggle('eq-set', eqTouched(key));
    document.querySelectorAll(`.cx-ch[data-k="${key}"] .knob`).forEach((k) => k._render && k._render());
    const eqv = $('#cxEq');
    if (S.eqSel === key && eqv && !eqv.hidden) {
      S.eqDirty = true;
      refreshEqPanel();
    }
    $('#btnMixer').classList.toggle('on', mixChanged());
  }

  // ---------- resposta do equalizador (as mesmas fórmulas do WebAudio, para desenhar sem ouvir)
  function biquadDb(type, f0, q, g, f, sr) {
    if ((type === 'highpass' && f0 <= 0) || (type === 'lowpass' && f0 >= sr / 2)) return 0;
    const w0 = (2 * Math.PI * f0) / sr, cw = Math.cos(w0), sw = Math.sin(w0);
    const A = Math.pow(10, g / 40);
    let b0, b1, b2, a0, a1, a2;
    if (type === 'lowpass' || type === 'highpass') {
      const alpha = sw / (2 * Math.pow(10, q / 20)); // nos cortes o Q do WebAudio é em dB
      if (type === 'lowpass') { b0 = (1 - cw) / 2; b1 = 1 - cw; } else { b0 = (1 + cw) / 2; b1 = -(1 + cw); }
      b2 = b0; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
    } else if (type === 'peaking') {
      const alpha = sw / (2 * q);
      b0 = 1 + alpha * A; b1 = -2 * cw; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cw; a2 = 1 - alpha / A;
    } else { // prateleiras, inclinação 1
      const k = 2 * Math.sqrt(A) * (sw / 2) * Math.SQRT2;
      if (type === 'lowshelf') {
        b0 = A * ((A + 1) - (A - 1) * cw + k); b1 = 2 * A * ((A - 1) - (A + 1) * cw); b2 = A * ((A + 1) - (A - 1) * cw - k);
        a0 = (A + 1) + (A - 1) * cw + k; a1 = -2 * ((A - 1) + (A + 1) * cw); a2 = (A + 1) + (A - 1) * cw - k;
      } else {
        b0 = A * ((A + 1) + (A - 1) * cw + k); b1 = -2 * A * ((A - 1) + (A + 1) * cw); b2 = A * ((A + 1) + (A - 1) * cw - k);
        a0 = (A + 1) - (A - 1) * cw + k; a1 = 2 * ((A - 1) - (A + 1) * cw); a2 = (A + 1) - (A - 1) * cw - k;
      }
    }
    const w = (2 * Math.PI * f) / sr, c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
    const nr = b0 + b1 * c1 + b2 * c2, ni = -(b1 * s1 + b2 * s2);
    const dr = a0 + a1 * c1 + a2 * c2, di = -(a1 * s1 + a2 * s2);
    return 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di));
  }

  function eqDb(key, f) {
    const sr = S.actx ? S.actx.sampleRate : 44100;
    if (key === '_bus') {
      const e = S.bus.eq;
      if (!e.on) return 0;
      let s = 0;
      GEQ_F.forEach((f0, i) => {
        if (e.g[i]) s += biquadDb(i === 0 ? 'lowshelf' : i === GEQ_F.length - 1 ? 'highshelf' : 'peaking', f0, 1.41, e.g[i], f, sr);
      });
      return s;
    }
    const e = S.mix[key].eq;
    if (!e.on) return 0;
    let s = 0;
    if (e.hp.on) s += biquadDb('highpass', e.hp.f, BUTTERWORTH_DB, 0, f, sr);
    if (e.low.g) s += biquadDb('lowshelf', e.low.f, 1, e.low.g, f, sr);
    if (e.mid.g) s += biquadDb('peaking', e.mid.f, e.mid.q, e.mid.g, f, sr);
    if (e.high.g) s += biquadDb('highshelf', e.high.f, 1, e.high.g, f, sr);
    if (e.lp.on) s += biquadDb('lowpass', e.lp.f, BUTTERWORTH_DB, 0, f, sr);
    return s;
  }

  function eqMiniPath(key) {
    const n = 42;
    let d = '';
    for (let i = 0; i <= n; i++) {
      const y = 15 - Math.max(-15, Math.min(15, eqDb(key, 20 * Math.pow(1000, i / n)))) * 0.86;
      d += `${i ? 'L' : 'M'}${((i / n) * 84).toFixed(1)} ${y.toFixed(1)}`;
    }
    return d;
  }

  // ---------- controles
  const KNOB_ARC = 135; // o botão gira de −135° a +135°
  function arcD(r, a0, a1) {
    if (Math.abs(a1 - a0) < 0.5) return '';
    const pt = (a) => {
      const t = (a * Math.PI) / 180;
      return `${(20 + r * Math.sin(t)).toFixed(2)} ${(20 - r * Math.cos(t)).toFixed(2)}`;
    };
    const s = Math.min(a0, a1), e = Math.max(a0, a1);
    return `M${pt(s)}A${r} ${r} 0 ${e - s > 180 ? 1 : 0} 1 ${pt(e)}`;
  }

  // Botão giratório: arrastar para cima ou para baixo (Shift = ajuste fino), rodinha do mouse ou setas;
  // duplo clique volta ao padrão. Enquanto mexe, o nome embaixo vira o valor.
  function makeKnob(el) {
    const key = el.dataset.k, path = el.dataset.p, P = PARAMS[path];
    const label = el.dataset.label || P.label;
    el.tabIndex = 0;
    el.setAttribute('role', 'slider');
    el.setAttribute('aria-label', `${label} (${chName(key)})`);
    el.innerHTML = `<svg viewBox="0 0 40 40" aria-hidden="true"><path class="kn-track" d="${arcD(16, -KNOB_ARC, KNOB_ARC)}"/>`
      + '<path class="kn-val"/><circle class="kn-body" cx="20" cy="20" r="11.5"/><path class="kn-ind" d="M20 19.5V11"/></svg>'
      + `<span class="kn-label">${esc(label)}</span>`;
    const val = el.querySelector('.kn-val'), ind = el.querySelector('.kn-ind'), lab = el.querySelector('.kn-label');
    const toU = (v) => Math.max(0, Math.min(1, P.log ? Math.log(v / P.min) / Math.log(P.max / P.min) : (v - P.min) / (P.max - P.min)));
    const fromU = (u) => {
      u = Math.max(0, Math.min(1, u));
      return P.log ? P.min * Math.pow(P.max / P.min, u) : P.min + u * (P.max - P.min);
    };
    const get = () => getPath(target(key), path);
    let busy = false;
    const render = () => {
      const v = get();
      const a = -KNOB_ARC + 2 * KNOB_ARC * toU(v);
      val.setAttribute('d', arcD(16, P.bipolar ? 0 : -KNOB_ARC, a));
      ind.setAttribute('transform', `rotate(${a.toFixed(1)} 20 20)`);
      el.setAttribute('aria-valuetext', P.fmt(v));
      el.title = `${label}: ${P.fmt(v)} (duplo clique volta ao padrão)`;
      lab.textContent = busy ? P.fmt(v) : label;
    };
    const set = (v) => {
      if (P.bipolar && Math.abs(v - P.def) < (P.max - P.min) * 0.012) v = P.def; // trava no centro
      setPath(target(key), path, roundParam(P, v));
      paramChanged(key, path);
    };
    const hold = (on) => { busy = on; el.classList.toggle('busy', on); render(); };
    el._render = render;
    el.onpointerdown = (e) => {
      if (e.pointerType !== 'touch') e.preventDefault();
      el.focus({ preventScroll: true });
      try { el.setPointerCapture(e.pointerId); } catch (_) { /* sem captura, o arrasto segue no elemento */ }
      let y = e.clientY, u = toU(get());
      hold(true);
      el.onpointermove = (ev) => {
        u = Math.max(0, Math.min(1, u + (y - ev.clientY) / (ev.shiftKey ? 900 : ev.pointerType === 'touch' ? 140 : 180)));
        y = ev.clientY;
        set(fromU(u));
      };
      el.onpointerup = el.onpointercancel = () => { el.onpointermove = null; hold(false); saveMix(); };
    };
    el.onwheel = (e) => {
      e.preventDefault();
      set(fromU(toU(get()) - Math.sign(e.deltaY) * (e.shiftKey ? 0.005 : 0.03)));
      hold(true);
      clearTimeout(el._t);
      el._t = setTimeout(() => { hold(false); saveMix(); }, 800);
    };
    el.ondblclick = () => { set(P.def); saveMix(); };
    el.onkeydown = (e) => {
      const st = e.shiftKey ? 0.005 : 0.03;
      const d = { ArrowUp: st, ArrowRight: st, ArrowDown: -st, ArrowLeft: -st, PageUp: 0.15, PageDown: -0.15 }[e.key];
      if (d === undefined) return;
      e.preventDefault();
      set(fromU(toU(get()) + d));
      saveMix();
    };
    render();
  }

  // fader pequeno do equalizador gráfico do master
  function makeVSlider(el) {
    const i = +el.dataset.i;
    const track = el.querySelector('.vs-track'), fill = el.querySelector('.vs-fill');
    const cap = el.querySelector('.vs-cap'), val = el.querySelector('.vs-v');
    const get = () => S.bus.eq.g[i];
    const set = (v) => {
      v = Math.max(GEQ_P.min, Math.min(GEQ_P.max, v));
      if (Math.abs(v) < 0.3) v = 0;
      S.bus.eq.g[i] = Math.round(v * 10) / 10;
      if (!S.bus.eq.on) S.bus.eq.on = true; // mexeu: liga o equalizador
      applyBusEq();
    };
    el._render = () => {
      const v = get(), u = (v - GEQ_P.min) / (GEQ_P.max - GEQ_P.min);
      cap.style.bottom = `${(u * 100).toFixed(2)}%`;
      fill.style.bottom = `${(Math.min(u, 0.5) * 100).toFixed(2)}%`;
      fill.style.height = `${(Math.abs(u - 0.5) * 100).toFixed(2)}%`;
      val.textContent = Math.abs(v) < 0.05 ? '0' : signed(v);
      track.setAttribute('aria-valuetext', fmtGain(v));
    };
    const fromY = (y) => {
      const r = track.getBoundingClientRect();
      set(GEQ_P.min + ((r.bottom - y) / r.height) * (GEQ_P.max - GEQ_P.min));
    };
    track.onpointerdown = (e) => {
      e.preventDefault();
      track.focus();
      track.setPointerCapture(e.pointerId);
      fromY(e.clientY);
      track.onpointermove = (ev) => fromY(ev.clientY);
      track.onpointerup = track.onpointercancel = () => { track.onpointermove = null; saveMix(); };
    };
    track.onwheel = (e) => { e.preventDefault(); set(get() - Math.sign(e.deltaY) * (e.shiftKey ? 0.1 : 0.5)); saveMix(); };
    track.ondblclick = () => { set(0); saveMix(); };
    track.onkeydown = (e) => {
      const d = { ArrowUp: 0.5, ArrowRight: 0.5, ArrowDown: -0.5, ArrowLeft: -0.5 }[e.key];
      if (d === undefined) return;
      e.preventDefault();
      set(get() + (e.shiftKey ? d / 5 : d));
      saveMix();
    };
    el._render();
  }

  // Fader do canal: pegou no botão, ele anda junto com o mouse (Shift = fino); clicou no trilho, ele pula
  // para lá. Rodinha e setas também. Duplo clique volta a 0 dB, e perto do 0 dB ele "trava".
  function bindFader(el, key) {
    const posNow = () => posFromDb(volToDb(target(key).vol));
    const setPos = (p) => {
      let d = dbFromPos(Math.max(0, Math.min(1, p)));
      if (Math.abs(d) < 0.35) d = 0;
      target(key).vol = dbToVol(d);
      applyMix();
    };
    // a coluna inteira do canal (escala, fader e medidor) pega o arrasto: no celular o dedo errava o
    // fader fininho, caía do lado e a tela rolava no lugar dele
    const zone = el.closest('.cx-fa') || el;
    zone.onpointerdown = (e) => {
      if (e.target.closest('.cx-clip')) return;
      const touch = e.pointerType === 'touch';
      if (!touch) e.preventDefault();
      el.focus({ preventScroll: true });
      try { zone.setPointerCapture(e.pointerId); } catch (_) { /* sem captura, o arrasto segue no elemento */ }
      const track = el.querySelector('.fader-track').getBoundingClientRect();
      const cap = el.querySelector('.fader-cap').getBoundingClientRect();
      // mouse: clicar no trilho pula para lá. Dedo: só arrastando (encostar para rolar os canais não
      // pode mudar o volume)
      if (!touch && (e.clientY < cap.top || e.clientY > cap.bottom)) setPos((track.bottom - e.clientY) / track.height);
      let y = e.clientY, p = posNow();
      zone.classList.add('dragging');
      zone.onpointermove = (ev) => {
        p = Math.max(0, Math.min(1, p + (y - ev.clientY) / (track.height * (ev.shiftKey ? 5 : 1))));
        y = ev.clientY;
        setPos(p);
      };
      zone.onpointerup = zone.onpointercancel = () => {
        zone.onpointermove = null;
        zone.classList.remove('dragging');
        saveMix();
      };
    };
    el.onwheel = (e) => { e.preventDefault(); setPos(posNow() - Math.sign(e.deltaY) * (e.shiftKey ? 0.004 : 0.02)); saveMix(); };
    // duplo clique volta a 0 dB: na zona inteira (é ela que captura o ponteiro e recebe o clique)
    zone.ondblclick = (e) => { if (!e.target.closest('.cx-clip')) { target(key).vol = 1; applyMix(); saveMix(); } };
    el.onkeydown = (e) => {
      const steps = { ArrowUp: 0.02, ArrowRight: 0.02, ArrowDown: -0.02, ArrowLeft: -0.02, PageUp: 0.1, PageDown: -0.1 };
      if (e.key in steps) setPos(posNow() + steps[e.key] * (e.shiftKey ? 0.2 : 1));
      else if (e.key === 'Home') setPos(0);
      else if (e.key === 'End') setPos(1);
      else return;
      e.preventDefault();
      saveMix();
    };
  }

  // ---------- a mesa na tela
  const EQ_MINI = '<svg viewBox="0 0 84 30" preserveAspectRatio="none" aria-hidden="true"><path class="z" d="M0 15H84"/><path class="c" d="M0 15H84"/></svg>';

  function faderHTML(name) {
    return `<div class="cx-fa">
        <div class="cx-scale" aria-hidden="true">${FADER_MARKS.map(([d, t]) => `<span style="bottom:${(posFromDb(d) * 100).toFixed(2)}%">${t}</span>`).join('')}</div>
        <div class="fader" role="slider" tabindex="0" aria-label="Volume: ${esc(name)}" aria-valuemin="0" aria-valuemax="100">
          <div class="fader-track"><div class="fader-fill"></div></div><div class="fader-cap"></div>
        </div>
        <div class="cx-meter" aria-hidden="true"><button class="cx-clip" tabindex="-1" title="Passou de 0 dB (clique para apagar)"></button>
          <div class="cx-bars"><div class="cx-bar"><i></i><b></b></div><div class="cx-bar"><i></i><b></b></div></div></div>
      </div>`;
  }

  function buildMixer() {
    const box = $('#mixer');
    const hasGuitar = STEMS.some((s) => s.key === 'guitar');
    if (S.busPeak === undefined) S.busPeak = -Infinity;
    const strips = STEMS.map((s) => `
      <div class="cx-ch" data-k="${s.key}">
        <div class="cx-name" title="${esc(s.desc)}">${stemIcon(s.key)}<span>${esc(s.name)}</span></div>
        <button class="cx-eqmini" title="Equalizador: ${esc(s.name)}" aria-label="Abrir o equalizador: ${esc(s.name)}">${EQ_MINI}<span>EQ</span></button>
        <div class="cx-knobs"><div class="knob" data-k="${s.key}" data-p="eq.low.g"></div><div class="knob" data-k="${s.key}" data-p="eq.mid.g"></div><div class="knob" data-k="${s.key}" data-p="eq.high.g"></div></div>
        <div class="knob pan" data-k="${s.key}" data-p="pan"></div>
        <div class="cx-ms"><button class="ms m" title="Mudo" aria-label="Mudo: ${esc(s.name)}">M</button><button class="ms s" title="Solo (Alt + clique: só este)" aria-label="Solo: ${esc(s.name)}">S</button></div>
        ${faderHTML(s.name)}
        <div class="cx-db">0,0</div>
      </div>`).join('');
    const master = `
      <div class="cx-ch master" data-k="_bus">
        <div class="cx-name">${stemIcon('_bus')}<span>Master</span></div>
        <button class="cx-eqmini" title="Equalizador gráfico do master" aria-label="Abrir o equalizador do master">${EQ_MINI}<span>EQ</span></button>
        <div class="cx-limbox">
          <button class="cx-lim" title="Limitador: segura o pico abaixo de ${num(LIMIT_DB)} dB para o som não distorcer quando você sobe os faders e o equalizador">Limitador</button>
          <div class="cx-gr" title="Quanto o limitador está segurando agora"><i></i></div>
          <span class="cx-grv">segurando 0,0 dB</span>
        </div>
        <button class="cx-peak" title="Maior pico desde o último clique (clique para zerar)">pico <b>−∞</b></button>
        ${faderHTML('Master')}
        <div class="cx-db">0,0</div>
      </div>`;
    box.innerHTML = `
      <div class="cx-head">
        <h3>Mesa de som</h3>
        <div class="seg" role="tablist" aria-label="Visão da mesa"><button role="tab" data-tab="canais">Canais</button><button role="tab" data-tab="eq">Equalizador</button></div>
        <div class="cx-presets" aria-label="Atalhos">${QUICK.filter((q) => hasGuitar || !q.guitar).map((q) => `<button data-q="${q.id}">${esc(q.label)}</button>`).join('')}</div>
        <div class="cx-tools">
          <div class="menu-wrap"><button class="pill-ghost" id="cxMine" aria-haspopup="true">Minhas mixagens</button><div class="menu cx-mine" id="cxMineMenu" hidden></div></div>
          <button class="link-btn" id="cxReset">Zerar tudo</button>
          <button class="icon-round" id="cxClose" title="Fechar (Esc)" aria-label="Fechar a mesa de som"><svg class="i"><use href="#i-x"/></svg></button>
        </div>
      </div>
      <div class="cx-body">
        <div class="cx-strips" id="cxStrips">${strips}${master}</div>
        <div class="cx-phone" id="cxPhone">${[...STEMS.map((s) => ({ k: s.key, name: s.name })), { k: '_bus', name: 'Volume geral' }].map((r) => `
          <div class="cxp-row${r.k === '_bus' ? ' master' : ''}" data-k="${r.k}">
            <div class="cxp-top">${stemIcon(r.k)}<span class="cxp-name">${esc(r.name)}</span><b class="cxp-db">0,0 dB</b></div>
            <div class="cxp-ctl">
              <input type="range" class="cxp-vol" min="0" max="1000" step="1" aria-label="Volume: ${esc(r.name)}">
              ${r.k === '_bus'
                ? '<button class="cxp-btn cxp-lim" aria-label="Limitador">Limitador</button>'
                : `<button class="cxp-btn cxp-m" aria-label="Mudo: ${esc(r.name)}">Mudo</button><button class="cxp-btn cxp-s" aria-label="Solo: ${esc(r.name)}">Solo</button>`}
            </div>
          </div>`).join('')}
        </div>
        <div class="cx-eq" id="cxEq" hidden>
          <div class="cx-eq-side">${['_bus', ...STEMS.map((s) => s.key)].map((k) => `<button data-sel="${k}">${stemIcon(k)}<span>${esc(chName(k))}</span><i class="cx-eqdot" title="Equalizador mexido"></i></button>`).join('')}</div>
          <div class="cx-eq-main">
            <div class="cx-eq-top"><b id="cxEqTitle"></b><button class="cx-toggle" id="cxEqOn"></button><div class="cx-presets" id="cxEqPresets"></div><button class="link-btn" id="cxEqReset">Zerar EQ</button></div>
            <div class="cx-graph"><canvas id="cxCanvas"></canvas><div class="cx-tip" id="cxTip" hidden></div></div>
            <div class="cx-bands" id="cxBands"></div>
          </div>
        </div>
      </div>
      <p class="cx-help">Arraste faders e botões (Shift = ajuste fino), use a rodinha ou as setas; duplo clique volta ao padrão. No gráfico, arraste os pontos; a rodinha muda a largura do médio.</p>`;

    box.onclick = (e) => {
      e.stopPropagation(); // clicar na mesa não fecha os outros menus nem a própria mesa
      if (!e.target.closest('#cxMineMenu, #cxMine')) $('#cxMineMenu').hidden = true;
    };
    box.querySelectorAll('[data-tab]').forEach((b) => { b.onclick = () => setCxTab(b.dataset.tab); });
    box.querySelectorAll('.cx-ch').forEach((ch) => {
      const k = ch.dataset.k;
      bindFader(ch.querySelector('.fader'), k);
      ch.querySelectorAll('.knob').forEach(makeKnob);
      ch.querySelector('.cx-eqmini').onclick = () => { S.eqSel = k; S.eqBand = null; setCxTab('eq'); };
      ch.querySelector('.cx-clip').onclick = (e) => e.currentTarget.classList.remove('on');
      if (k === '_bus') {
        ch.querySelector('.cx-lim').onclick = () => { S.bus.limiter = !S.bus.limiter; applyMix(); saveMix(); };
        ch.querySelector('.cx-peak').onclick = () => { S.busPeak = -Infinity; };
      } else {
        ch.querySelector('.m').onclick = () => { S.mix[k].mute = !S.mix[k].mute; applyMix(); saveMix(); };
        ch.querySelector('.s').onclick = (e) => {
          if (e.altKey || e.ctrlKey || e.metaKey) { // solo exclusivo: só este canal
            const only = !(S.mix[k].solo && STEMS.every((s) => s.key === k || !S.mix[s.key].solo));
            for (const s of STEMS) S.mix[s.key].solo = only && s.key === k;
          } else {
            S.mix[k].solo = !S.mix[k].solo;
          }
          applyMix();
          saveMix();
        };
      }
    });
    // mesa do celular: uma linha por instrumento, volume deitado (o deslizante do próprio celular) e
    // Mudo/Solo grandes; mexe nos mesmos valores dos faders
    box.querySelectorAll('.cxp-row').forEach((row) => {
      const k = row.dataset.k;
      const vol = row.querySelector('.cxp-vol');
      vol.oninput = () => {
        let d = dbFromPos(vol.value / 1000);
        if (Math.abs(d) < 0.5) d = 0; // trava no 0 dB
        target(k).vol = dbToVol(d);
        applyMix();
      };
      vol.onchange = () => saveMix();
      if (k === '_bus') {
        row.querySelector('.cxp-lim').onclick = () => { S.bus.limiter = !S.bus.limiter; applyMix(); saveMix(); };
      } else {
        row.querySelector('.cxp-m').onclick = () => { S.mix[k].mute = !S.mix[k].mute; applyMix(); saveMix(); };
        row.querySelector('.cxp-s').onclick = () => { S.mix[k].solo = !S.mix[k].solo; applyMix(); saveMix(); };
      }
    });
    box.querySelectorAll('[data-q]').forEach((b) => {
      b.onclick = () => {
        for (const s of STEMS) Object.assign(S.mix[s.key], { vol: 1, mute: false, solo: false });
        QUICK.find((q) => q.id === b.dataset.q).f(S.mix);
        applyMix();
        saveMix();
      };
    });
    $('#cxReset').onclick = () => {
      for (const k of Object.keys(S.mix)) S.mix[k] = newStrip();
      S.bus = BUS_DEF();
      S.eqBand = null;
      applyAll();
      saveMix();
      box.querySelectorAll('.cx-clip').forEach((c) => c.classList.remove('on'));
      if (S.cxTab === 'eq') renderEqPanel();
    };
    $('#cxClose').onclick = closeConsole;
    $('#cxMine').onclick = () => {
      const m = $('#cxMineMenu');
      m.hidden = !m.hidden;
      if (!m.hidden) renderMine();
    };
    $('#cxEqOn').onclick = () => {
      const t = target(S.eqSel);
      t.eq.on = !t.eq.on;
      if (S.eqSel === '_bus') applyBusEq(); else applyEq(S.eqSel);
      saveMix();
    };
    $('#cxEqReset').onclick = () => applyEqPreset(S.eqSel, 'Plano');
    $('#cxEqPresets').onclick = (e) => {
      const b = e.target.closest('[data-eqp]');
      if (b) applyEqPreset(S.eqSel, b.dataset.eqp);
    };
    box.querySelectorAll('.cx-eq-side [data-sel]').forEach((b) => {
      b.onclick = () => { S.eqSel = b.dataset.sel; S.eqBand = null; renderEqPanel(); };
    });
    bindEqGraph();
    if (S.eqSel !== '_bus' && !STEMS.some((s) => s.key === S.eqSel)) S.eqSel = '_bus';
    setCxTab(S.cxTab);
    applyAll();
  }

  function setCxTab(tab) {
    S.cxTab = tab;
    $('#mixer').querySelectorAll('[data-tab]').forEach((b) => {
      const on = b.dataset.tab === tab;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', String(on));
    });
    $('#cxStrips').hidden = tab !== 'canais';
    $('#cxPhone').hidden = tab !== 'canais'; // a lista do celular também sai na aba do equalizador
    $('#cxEq').hidden = tab !== 'eq';
    if (tab === 'eq') {
      renderEqPanel();
      if (!$('#mixer').hidden) runEqView();
    }
  }

  function openConsole() {
    closeMenus();
    $('#mixer').hidden = false;
    $('#btnMixer').setAttribute('aria-expanded', 'true');
    runMeters();
    if (S.cxTab === 'eq') { renderEqPanel(); runEqView(); }
  }

  function closeConsole() {
    $('#mixer').hidden = true;
    $('#btnMixer').setAttribute('aria-expanded', 'false');
  }

  // ---------- equalizador: painel e gráfico
  function renderEqPanel() {
    const key = S.eqSel, bus = key === '_bus';
    $('#mixer').querySelectorAll('.cx-eq-side [data-sel]').forEach((b) => b.classList.toggle('on', b.dataset.sel === key));
    $('#cxEqTitle').textContent = bus ? 'Master · gráfico de 10 bandas' : `${chName(key)} · paramétrico`;
    $('#cxEqPresets').innerHTML = Object.keys(bus ? GEQ_PRESETS : EQ_PRESETS)
      .map((n) => `<button data-eqp="${esc(n)}">${esc(n)}</button>`).join('');
    const bands = $('#cxBands');
    if (bus) {
      bands.innerHTML = `<div class="cx-geq">${GEQ_F.map((f, i) => `<div class="vs" data-i="${i}"><span class="vs-v">0</span>`
        + `<div class="vs-track" tabindex="0" role="slider" aria-label="Master ${fmtHz(f)}"><i class="vs-zero"></i><i class="vs-fill"></i><i class="vs-cap"></i></div>`
        + `<span class="vs-f">${shortHz(f)}</span></div>`).join('')}</div>`;
      bands.querySelectorAll('.vs').forEach(makeVSlider);
    } else {
      bands.innerHTML = BANDS.map((b) => `<div class="cx-band" data-band="${b.id}">
          <div class="cx-bh"><i>${b.n}</i><span>${b.name}</span>${b.toggle ? `<button class="cx-toggle sm" data-toggle="eq.${b.id}.on"></button>` : ''}</div>
          <div class="cx-bk">${b.params.map(([p, l]) => `<div class="knob" data-k="${key}" data-p="eq.${b.id}.${p}" data-label="${l}"></div>`).join('')}</div>
        </div>`).join('');
      bands.querySelectorAll('.knob').forEach(makeKnob);
      bands.querySelectorAll('[data-toggle]').forEach((t) => {
        t.onclick = () => {
          const path = t.dataset.toggle;
          setPath(S.mix[key], path, !getPath(S.mix[key], path));
          if (getPath(S.mix[key], path)) S.mix[key].eq.on = true;
          applyEq(key);
          saveMix();
        };
      });
      bands.querySelectorAll('.cx-band').forEach((b) => {
        b.onpointerdown = () => { S.eqBand = b.dataset.band; refreshEqPanel(); };
      });
    }
    S.eqDirty = true;
    refreshEqPanel();
  }

  // estado dos botões do painel, sem refazer o HTML
  function refreshEqPanel() {
    const t = target(S.eqSel);
    const on = $('#cxEqOn');
    on.classList.toggle('on', t.eq.on);
    on.textContent = t.eq.on ? 'EQ ligado' : 'EQ desligado';
    on.setAttribute('aria-pressed', String(t.eq.on));
    const bands = $('#cxBands');
    bands.querySelectorAll('[data-toggle]').forEach((b) => {
      const v = !!getPath(t, b.dataset.toggle);
      b.classList.toggle('on', v);
      b.textContent = v ? 'Ligado' : 'Desligado';
    });
    bands.querySelectorAll('.cx-band').forEach((b) => b.classList.toggle('sel', b.dataset.band === S.eqBand));
    bands.querySelectorAll('.knob, .vs').forEach((k) => k._render && k._render());
  }

  function applyEqPreset(key, name) {
    if (key === '_bus') {
      S.bus.eq = { on: true, g: GEQ_PRESETS[name].slice() };
      applyBusEq();
    } else {
      const e = EQ_DEF();
      for (const [b, v] of Object.entries(EQ_PRESETS[name])) Object.assign(e[b], v);
      S.mix[key].eq = e;
      applyEq(key);
    }
    S.eqBand = null;
    saveMix();
  }

  const F_MIN = 20, F_MAX = 20000, EQ_RANGE = 18;
  const GRID_F = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
  const eqGeom = (w, h) => ({ l: 38, r: w - 14, t: 12, b: h - 24 });
  const xOfF = (g, f) => g.l + (Math.log(f / F_MIN) / Math.log(F_MAX / F_MIN)) * (g.r - g.l);
  const fOfX = (g, x) => F_MIN * Math.pow(F_MAX / F_MIN, (x - g.l) / (g.r - g.l));
  const yOfDb = (g, d) => g.t + ((EQ_RANGE - d) / (2 * EQ_RANGE)) * (g.b - g.t);
  const dbOfY = (g, y) => EQ_RANGE - ((y - g.t) / (g.b - g.t)) * 2 * EQ_RANGE;

  function eqNodes(key) {
    if (key === '_bus') return GEQ_F.map((f, i) => ({ id: String(i), n: i + 1, f, g: S.bus.eq.g[i], on: true }));
    const e = S.mix[key].eq;
    return BANDS.map((b) => {
      const v = e[b.id];
      return { id: b.id, n: b.n, f: v.f, g: 'g' in v ? v.g : null, on: 'on' in v ? v.on : true };
    });
  }

  function nodeXY(g, n) {
    const d = n.g !== null ? n.g : eqDb(S.eqSel, n.f); // os cortes ficam em cima da curva
    return [xOfF(g, n.f), yOfDb(g, Math.max(-EQ_RANGE, Math.min(EQ_RANGE, d)))];
  }

  function nodeText(id) {
    const key = S.eqSel;
    if (key === '_bus') return `${fmtHz(GEQ_F[+id])} · ${fmtGain(S.bus.eq.g[+id])}`;
    const b = S.mix[key].eq[id], band = BANDS.find((x) => x.id === id);
    const parts = [band.name, fmtHz(b.f)];
    if ('g' in b) parts.push(fmtGain(b.g));
    if ('q' in b) parts.push(`Q ${fmtQ(b.q)}`);
    if ('on' in b && !b.on) parts.push('desligado');
    return parts.join(' · ');
  }

  // analisador de espectro do canal (depois do equalizador), criado só quando alguém olha
  function specAnalyser(key) {
    if (!S.actx || !S.ch) return null;
    const make = () => {
      const a = S.actx.createAnalyser();
      a.fftSize = 8192; // ~5 Hz por faixa: dá para ver o grave direito
      a.smoothingTimeConstant = 0.8;
      return a;
    };
    if (key === '_bus') {
      if (!S.busSpec) { S.busSpec = make(); S.busEq[S.busEq.length - 1].connect(S.busSpec); }
      return S.busSpec;
    }
    const c = S.ch[key];
    if (!c) return null;
    if (!c.spec) { c.spec = make(); c.lp.connect(c.spec); }
    return c.spec;
  }

  function drawEq() {
    const cv = $('#cxCanvas');
    const w = cv.clientWidth, h = cv.clientHeight;
    if (!w || !h) return;
    const dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      S.eqDirty = true;
    }
    const c = cv.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    const g = eqGeom(w, h), key = S.eqSel, on = target(key).eq.on;

    // grade: frequências embaixo, decibéis do lado
    c.lineWidth = 1;
    c.font = '700 10px Figtree, system-ui, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'top';
    for (const f of GRID_F) {
      const x = Math.round(xOfF(g, f)) + 0.5;
      c.strokeStyle = '#161616';
      c.beginPath(); c.moveTo(x, g.t); c.lineTo(x, g.b); c.stroke();
      c.fillStyle = '#5a5a5a';
      c.fillText(shortHz(f), Math.min(Math.max(x, g.l + 8), g.r - 8), g.b + 8);
    }
    c.textAlign = 'right';
    c.textBaseline = 'middle';
    for (const d of [12, 6, 0, -6, -12]) {
      const y = Math.round(yOfDb(g, d)) + 0.5;
      c.strokeStyle = d === 0 ? '#2e2e2e' : '#161616';
      c.beginPath(); c.moveTo(g.l, y); c.lineTo(g.r, y); c.stroke();
      c.fillStyle = '#5a5a5a';
      c.fillText(d > 0 ? `+${d}` : d < 0 ? `−${-d}` : '0', g.l - 9, y);
    }

    // espectro: o som do canal agora, inclinado 4,5 dB por oitava (como nos analisadores profissionais)
    const an = specAnalyser(key);
    if (an) {
      const n = an.frequencyBinCount;
      if (!S.specBuf || S.specBuf.length !== n) S.specBuf = new Float32Array(n);
      an.getFloatFrequencyData(S.specBuf);
      const sp = S.specBuf, binHz = S.actx.sampleRate / an.fftSize;
      const at = (i) => Math.max(-140, sp[Math.max(0, Math.min(n - 1, i))]);
      const line = new Path2D();
      for (let x = g.l; x <= g.r; x += 2) {
        const f0 = fOfX(g, x), i0 = f0 / binHz, i1 = fOfX(g, x + 2) / binHz;
        let v;
        if (i1 - i0 < 1) { // grave: menos de uma faixa por ponto, interpola
          const i = Math.floor(i0), fr = i0 - i;
          v = at(i) * (1 - fr) + at(i + 1) * fr;
        } else { // agudo: várias faixas por ponto, fica a mais forte
          v = -140;
          for (let i = Math.floor(i0); i <= Math.ceil(i1); i++) v = Math.max(v, at(i));
        }
        v += 4.5 * Math.log2(f0 / 1000);
        const y = Math.max(g.t, Math.min(g.b, g.t + ((-15 - v) / 90) * (g.b - g.t))); // de −105 a −15 dB
        if (x === g.l) line.moveTo(x, y); else line.lineTo(x, y);
      }
      const area = new Path2D(line);
      area.lineTo(g.r, g.b);
      area.lineTo(g.l, g.b);
      area.closePath();
      c.fillStyle = 'rgba(255, 255, 255, .055)';
      c.fill(area);
      c.strokeStyle = 'rgba(255, 255, 255, .24)';
      c.stroke(line);
    }

    // curva do equalizador (só recalcula quando algo muda)
    if (S.eqDirty || S.eqCurveKey !== `${key}|${w}|${h}`) {
      S.eqCurve = [];
      for (let x = g.l; x <= g.r; x += 2) {
        S.eqCurve.push([x, yOfDb(g, Math.max(-EQ_RANGE - 2, Math.min(EQ_RANGE + 2, eqDb(key, fOfX(g, x)))))]);
      }
      S.eqCurveKey = `${key}|${w}|${h}`;
      S.eqDirty = false;
    }
    const y0 = yOfDb(g, 0);
    const curve = new Path2D();
    S.eqCurve.forEach(([x, y], i) => (i ? curve.lineTo(x, y) : curve.moveTo(x, y)));
    const fill = new Path2D(curve);
    fill.lineTo(g.r, y0);
    fill.lineTo(g.l, y0);
    fill.closePath();
    const tint = S.songRgb ? S.songRgb.join(', ') : '255, 255, 255'; // a curva na cor da música
    c.fillStyle = on ? `rgba(${tint}, .14)` : 'rgba(255, 255, 255, .03)';
    c.fill(fill);
    c.lineWidth = 2;
    c.lineJoin = 'round';
    c.strokeStyle = on ? (S.songHex || '#fff') : '#555';
    c.stroke(curve);

    // pontos que dá para arrastar
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = '800 10px Figtree, system-ui, sans-serif';
    for (const n of eqNodes(key)) {
      const [x, y] = nodeXY(g, n);
      const lit = n.on && on;
      if (n.id === S.eqDrag || n.id === S.eqHover || n.id === S.eqBand) {
        c.fillStyle = 'rgba(255, 255, 255, .16)';
        c.beginPath(); c.arc(x, y, 14, 0, Math.PI * 2); c.fill();
      }
      c.beginPath();
      c.arc(x, y, key === '_bus' ? 6 : 8.5, 0, Math.PI * 2);
      c.fillStyle = lit ? '#fff' : '#000';
      c.fill();
      c.lineWidth = 1.5;
      c.strokeStyle = '#fff';
      c.stroke();
      if (key !== '_bus') {
        c.fillStyle = lit ? '#000' : '#fff';
        c.fillText(String(n.n), x, y + 0.5);
      }
    }
  }

  function runEqView() {
    if (S.eqViewOn) return;
    S.eqViewOn = true;
    let last = 0;
    const frame = (now) => {
      if ($('#mixer').hidden || S.cxTab !== 'eq') { S.eqViewOn = false; return; }
      if (now - last > 30) { last = now; drawEq(); } // ~30 quadros por segundo bastam
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  // Arrastar um ponto: para os lados muda a frequência, para cima e para baixo o ganho (nos cortes, só a
  // frequência). Rodinha: largura do médio ou ganho/frequência das outras. Duplo clique: volta ao padrão.
  function bindEqGraph() {
    const cv = $('#cxCanvas'), tip = $('#cxTip');
    const pick = (ev) => {
      const r = cv.getBoundingClientRect();
      const x = ev.clientX - r.left, y = ev.clientY - r.top, g = eqGeom(r.width, r.height);
      let best = null, bd = 18;
      for (const n of eqNodes(S.eqSel)) {
        const [nx, ny] = nodeXY(g, n);
        const d = Math.hypot(nx - x, ny - y);
        if (d < bd) { bd = d; best = n; }
      }
      return { n: best, x, y, g };
    };
    const showTip = (id, g) => {
      const n = id && eqNodes(S.eqSel).find((m) => m.id === id);
      if (!n) { tip.hidden = true; return; }
      const [x, y] = nodeXY(g, n);
      tip.hidden = false;
      tip.textContent = nodeText(id);
      tip.style.left = `${Math.max(70, Math.min(g.r - 70, x))}px`;
      tip.style.top = `${y}px`;
    };
    const hover = (ev) => {
      const { n, g } = pick(ev);
      S.eqHover = n ? n.id : null;
      cv.style.cursor = n ? 'grab' : 'default';
      showTip(S.eqHover, g);
    };
    cv.onpointermove = hover;
    cv.onpointerleave = () => { S.eqHover = null; if (!S.eqDrag) tip.hidden = true; };
    cv.onpointerdown = (ev) => {
      const { n, x, y, g } = pick(ev);
      if (!n) return;
      ev.preventDefault();
      cv.setPointerCapture(ev.pointerId);
      const [nx, ny] = nodeXY(g, n);
      const dx = nx - x, dy = ny - y; // segura o ponto de onde pegou, sem pulo
      S.eqDrag = n.id;
      S.eqBand = S.eqSel === '_bus' ? null : n.id;
      cv.style.cursor = 'grabbing';
      refreshEqPanel();
      cv.onpointermove = (e2) => {
        const r = cv.getBoundingClientRect();
        dragNode(n.id, e2.clientX - r.left + dx, e2.clientY - r.top + dy, g);
        showTip(n.id, g);
      };
      cv.onpointerup = cv.onpointercancel = () => {
        S.eqDrag = null;
        cv.style.cursor = 'grab';
        cv.onpointermove = hover;
        saveMix();
      };
    };
    cv.onwheel = (ev) => {
      const { n, g } = pick(ev);
      const id = n ? n.id : S.eqBand;
      if (!id) return;
      ev.preventDefault();
      const key = S.eqSel, up = ev.deltaY < 0, fine = ev.shiftKey ? 0.2 : 1;
      if (key === '_bus') {
        const i = +id;
        S.bus.eq.g[i] = Math.round(Math.max(GEQ_P.min, Math.min(GEQ_P.max, S.bus.eq.g[i] + (up ? 0.5 : -0.5) * fine)) * 10) / 10;
        applyBusEq();
      } else {
        const b = S.mix[key].eq[id];
        if (id === 'mid') b.q = Math.round(Math.max(0.3, Math.min(8, b.q * Math.pow(up ? 1.12 : 1 / 1.12, fine))) * 100) / 100;
        else if ('g' in b) b.g = Math.round(Math.max(-15, Math.min(15, b.g + (up ? 0.5 : -0.5) * fine)) * 10) / 10;
        else { const P = PARAMS[`eq.${id}.f`]; b.f = Math.round(Math.max(P.min, Math.min(P.max, b.f * Math.pow(up ? 1.06 : 1 / 1.06, fine)))); }
        applyEq(key);
      }
      showTip(id, g);
      clearTimeout(S.eqWheelT);
      S.eqWheelT = setTimeout(saveMix, 600);
    };
    cv.ondblclick = (ev) => {
      const { n, g } = pick(ev);
      if (!n) return;
      const key = S.eqSel;
      if (key === '_bus') { S.bus.eq.g[+n.id] = 0; applyBusEq(); } else { S.mix[key].eq[n.id] = EQ_DEF()[n.id]; applyEq(key); }
      showTip(n.id, g);
      saveMix();
    };
  }

  function dragNode(id, x, y, g) {
    const key = S.eqSel;
    if (key === '_bus') {
      let v = Math.max(GEQ_P.min, Math.min(GEQ_P.max, dbOfY(g, y)));
      if (Math.abs(v) < 0.3) v = 0;
      S.bus.eq.g[+id] = Math.round(v * 10) / 10;
      S.bus.eq.on = true;
      applyBusEq();
      return;
    }
    const e = S.mix[key].eq, b = e[id], P = PARAMS[`eq.${id}.f`];
    b.f = Math.round(Math.max(P.min, Math.min(P.max, fOfX(g, x))));
    if ('g' in b) {
      let v = Math.max(-15, Math.min(15, dbOfY(g, y)));
      if (Math.abs(v) < 0.3) v = 0;
      b.g = Math.round(v * 10) / 10;
    }
    if ('on' in b) b.on = true; // pegou no corte: liga
    e.on = true;
    applyEq(key);
  }

  // ---------- medidores: pico (sobe na hora, desce devagar), a marca do maior pico recente e a luz
  // de "passou de 0 dB". Só rodam com a mesa aberta.
  function runMeters() {
    if (S.metersOn) return;
    S.metersOn = true;
    const buf = new Float32Array(1024);
    const mem = {};
    let last = performance.now();
    const frame = (now) => {
      if ($('#mixer').hidden) { S.metersOn = false; return; }
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (!$('#cxStrips').hidden) {
        for (const key of [...STEMS.map((s) => s.key), '_bus']) {
          const strip = document.querySelector(`.cx-ch[data-k="${key}"]`);
          if (!strip) continue;
          const ans = key === '_bus' ? S.busMeters : (S.ch && S.ch[key] ? S.ch[key].meters : null);
          const bars = strip.querySelectorAll('.cx-bar');
          for (let ch = 0; ch < 2; ch++) {
            let peak = 0;
            if (ans && S.playing) {
              ans[ch].getFloatTimeDomainData(buf);
              for (let i = 0; i < buf.length; i++) { const x = buf[i] < 0 ? -buf[i] : buf[i]; if (x > peak) peak = x; }
            }
            const db = peak > 1e-6 ? 20 * Math.log10(peak) : -120;
            const m = mem[key + ch] || (mem[key + ch] = { lvl: -120, hold: -120, at: 0 });
            m.lvl = Math.max(db, m.lvl - 26 * dt);
            if (db >= m.hold) { m.hold = db; m.at = now; } else if (now - m.at > 1600) m.hold = Math.max(-120, m.hold - 14 * dt);
            if (peak >= 1) strip.querySelector('.cx-clip').classList.add('on');
            if (key === '_bus' && db > S.busPeak) S.busPeak = db;
            bars[ch].firstElementChild.style.transform = `scaleY(${(1 - posFromDb(m.lvl)).toFixed(4)})`;
            const hb = bars[ch].lastElementChild;
            hb.style.bottom = `${(posFromDb(m.hold) * 100).toFixed(2)}%`;
            hb.style.opacity = m.hold > -85 ? '1' : '0';
          }
        }
        const bus = document.querySelector('.cx-ch[data-k="_bus"]');
        if (bus && S.limiter) {
          const r = S.limiter.reduction;
          const gr = Math.min(0, typeof r === 'number' ? r : (r && r.value) || 0);
          bus.querySelector('.cx-gr i').style.transform = `scaleX(${Math.min(1, -gr / 12).toFixed(3)})`;
          bus.querySelector('.cx-grv').textContent = `segurando ${num(-gr)} dB`;
        }
        if (bus) bus.querySelector('.cx-peak b').textContent = S.busPeak > -90 ? signed(S.busPeak) : '−∞';
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  // ---------- mixagens da pessoa: guardadas neste navegador, valem para qualquer música
  function loadMine() {
    try {
      const l = JSON.parse(localStorage.getItem('pv.mixPresets') || '[]');
      return Array.isArray(l) ? l.filter((p) => p && typeof p.name === 'string' && p.mix) : [];
    } catch (_) { return []; }
  }

  function saveMine(list) {
    try { localStorage.setItem('pv.mixPresets', JSON.stringify(list.slice(0, 30))); } catch (_) { toast('Não consegui guardar neste navegador.'); }
  }

  function renderMine() {
    const list = loadMine();
    const m = $('#cxMineMenu');
    m.innerHTML = '<div class="menu-label">Minhas mixagens</div>'
      + (list.length
        ? list.map((p, i) => `<div class="cx-mine-row"><button data-use="${i}">${esc(p.name)}</button><button class="cx-mine-del" data-del="${i}" title="Apagar" aria-label="Apagar a mixagem ${esc(p.name)}">×</button></div>`).join('')
        : '<p class="cx-mine-empty">Deixe a mesa do seu jeito e guarde aqui para usar em outras músicas.</p>')
      + '<form class="cx-mine-save" id="cxMineSave"><input id="cxMineName" maxlength="40" placeholder="Nome desta mixagem" aria-label="Nome da mixagem" autocomplete="off"><button class="pill-white sm" type="submit">Salvar</button></form>';
    m.querySelectorAll('[data-use]').forEach((b) => {
      b.onclick = () => { useMine(list[+b.dataset.use]); m.hidden = true; };
    });
    m.querySelectorAll('[data-del]').forEach((b) => {
      b.onclick = () => { list.splice(+b.dataset.del, 1); saveMine(list); renderMine(); };
    });
    $('#cxMineSave').onsubmit = (e) => {
      e.preventDefault();
      const name = $('#cxMineName').value.trim();
      if (!name) { $('#cxMineName').focus(); return; }
      const rest = list.filter((p) => p.name !== name);
      rest.unshift({ name, mix: JSON.parse(JSON.stringify({ ...S.mix, _bus: S.bus })) });
      saveMine(rest);
      renderMine();
      toast(`Mixagem "${name}" guardada.`);
    };
  }

  function useMine(p) {
    for (const k of Object.keys(S.mix)) if (p.mix[k]) S.mix[k] = cleanStrip(p.mix[k]);
    S.bus = cleanBus(p.mix._bus);
    applyAll();
    saveMix();
    if (S.cxTab === 'eq') renderEqPanel();
    toast(`Mixagem "${p.name}" aplicada.`);
  }

  // ------------------------------------------------------------ envio
  function uploadFile(file) {
    if (!file) return;
    clearTimeout(S.pollTimer);
    S.id = null;
    renderLibrary();
    showView('processing');
    setHue(hueOf(file.name));
    $('#procTitle').textContent = file.name.replace(/\.[^.]+$/, '');
    $('#topTitle').textContent = $('#procTitle').textContent;
    $('#procEyebrow').textContent = 'Enviando arquivo';
    $('#procEta').textContent = 'subindo para o soundStudy';
    $('#procBar').style.width = '0%';
    renderStages(null);
    const fd = new FormData();
    fd.append('file', file);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/songs');
    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      const p = e.loaded / e.total;
      $('#procBar').style.width = (p * 100).toFixed(1) + '%';
      $('#procPct').textContent = 'Enviando ' + Math.round(p * 100) + '%';
    };
    xhr.onload = () => {
      let r = null;
      try { r = JSON.parse(xhr.responseText); } catch (_) { /* ignora */ }
      if (xhr.status >= 200 && xhr.status < 300 && r) {
        loadLibrary();
        openSong(r.id);
      } else {
        toast((r && r.detail) || 'Falha ao enviar o arquivo.');
        goHome();
      }
    };
    xhr.onerror = () => { toast('Falha ao enviar o arquivo.'); goHome(); };
    xhr.send(fd);
  }

  // ------------------------------------------------------------ ações
  function startRename() {
    const h = $('#songTitle');
    const old = h.textContent;
    h.contentEditable = 'true';
    h.focus();
    document.getSelection().selectAllChildren(h);
    const finish = async (save) => {
      h.contentEditable = 'false';
      h.onblur = h.onkeydown = null;
      const title = h.textContent.trim();
      if (!save || !title || title === old) { h.textContent = old; return; }
      try {
        const m = await api('/api/songs/' + S.playerId, { method: 'PATCH', body: JSON.stringify({ title }) });
        S.meta.title = m.title;
        for (const sel of ['#topTitle', '#stageTitle', '#nbTitle']) $(sel).textContent = m.title;
        updateDownloadLink();
        loadLibrary();
        toast('Nome alterado.');
      } catch (e) { h.textContent = old; toast(e.message); }
    };
    h.onblur = () => finish(true);
    h.onkeydown = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); h.blur(); }
      if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    };
  }

  // ------------------------------------------------------------ corrigir a letra
  // De onde veio a letra, para mostrar no cartão (e dar o crédito da base)
  function lyricSourceLabel() {
    const an = S.an || {};
    if (an.lyrics_source === 'lrclib' && an.lyrics_credit) return `da base LRCLIB (${an.lyrics_credit.artist} — ${an.lyrics_credit.track})`;
    if (an.lyrics_source === 'user') return 'colada por você';
    return 'reconhecida pelo app: pode ter erro, use "Corrigir letra"';
  }

  async function openLyricsEditor() {
    if (!S.playerId) return;
    $('#lyricsText').value = '';
    $('#lyrResults').hidden = true;
    $('#lyrResults').innerHTML = '';
    $('#lyrQuery').value = '';
    try {
      const r = await api(`/api/songs/${S.playerId}/lyrics`);
      $('#lyricsText').value = r.source === 'user' ? r.text : '';
      $('#lyricsAuto').hidden = r.source !== 'user';
    } catch (_) { /* começa vazio */ }
    $('#lyricsModal').hidden = false;
    searchLyrics();
  }

  // Busca a letra na base aberta e lista as versões; o Letras abre no navegador para copiar e colar.
  async function searchLyrics() {
    const id = S.playerId;
    const q = $('#lyrQuery').value.trim();
    const box = $('#lyrResults');
    box.hidden = false;
    box.innerHTML = '<p class="lyr-msg">Buscando…</p>';
    try {
      const r = await api(`/api/songs/${id}/lyrics/search` + (q ? `?q=${encodeURIComponent(q)}` : ''));
      if (S.playerId !== id) return;
      if (!q) $('#lyrQuery').value = r.query;
      const query = q || r.query;
      $('#lyrWeb').href = 'https://www.google.com/search?q=' + encodeURIComponent(`${query} letra site:letras.mus.br`);
      box.innerHTML = r.results.length
        ? r.results.map((it) => `<button class="lyr-item" data-id="${it.id}"><b>${esc(it.track || '')}</b>` +
            `<span>${esc(it.artist || '')}${it.duration ? ' · ' + fmtTime(it.duration) : ''}</span>` +
            `<i>${it.synced ? 'com o tempo de cada linha' : 'só o texto'}</i></button>`).join('')
        : '<p class="lyr-msg">Não achei essa música na base aberta. Use "Abrir no Letras", copie a letra e cole aqui embaixo.</p>';
      box.querySelectorAll('.lyr-item').forEach((b) => { b.onclick = () => useApiLyrics(Number(b.dataset.id)); });
    } catch (e) {
      if (S.playerId !== id) return;
      $('#lyrWeb').href = 'https://www.google.com/search?q=' + encodeURIComponent(`${q || (S.meta && S.meta.title) || ''} letra site:letras.mus.br`);
      box.innerHTML = `<p class="lyr-msg">${esc(e.message)}</p>`;
    }
  }

  async function useApiLyrics(lid) {
    $('#lyrResults').innerHTML = '<p class="lyr-msg">Encaixando a letra no tempo da música…</p>';
    try {
      const m = await api(`/api/songs/${S.playerId}/lyrics/use`, { method: 'POST', body: JSON.stringify({ id: lid }) });
      await applyLyrics(m);
      toast('Letra da base encaixada na música.');
    } catch (e) {
      $('#lyrResults').innerHTML = `<p class="lyr-msg">${esc(e.message)}</p>`;
    }
  }

  async function applyLyrics(m) {
    S.meta = m;
    S.an = m.analysis;
    S.chords = chordsForLevel();
    resetLyrics();
    $('#lyricCard').hidden = !(S.an.lyrics && S.an.lyrics.length);
    $('#lyricSource').textContent = lyricSourceLabel();
    $('#lyricsModal').hidden = true;
    tick();
    await loadSheet();
  }

  async function saveLyrics(text) {
    const btn = $('#lyricsSave');
    btn.disabled = true;
    btn.textContent = 'Encaixando…';
    try {
      const m = await api(`/api/songs/${S.playerId}/lyrics`, { method: 'PUT', body: JSON.stringify({ text }) });
      await applyLyrics(m);
      toast(text.trim() ? 'Letra corrigida e encaixada na música.' : 'A letra colada foi desfeita.');
    } catch (e) {
      toast('Não consegui salvar a letra: ' + e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Salvar e encaixar';
    }
  }

  // ------------------------------------------------------------ acordes da cifra colada
  async function openCifraEditor() {
    $('#moreMenu').hidden = true;
    $('#cifraText').value = '';
    $('#cifraAuto').hidden = true;
    try {
      const r = await api(`/api/songs/${S.playerId}/cifra`);
      $('#cifraText').value = r.text || '';
      $('#cifraAuto').hidden = r.source !== 'cifra';
    } catch (_) { /* abre vazia */ }
    $('#cifraModal').hidden = false;
    $('#cifraText').focus();
  }

  async function saveCifra(text) {
    const btn = $('#cifraSave');
    const id = S.playerId;
    const buttons = ['#cifraSave', '#cifraPaste', '#cifraAuto'];
    if (S.cifraSaving) return; // um encaixe por vez
    S.cifraSaving = true;
    buttons.forEach((b) => { $(b).disabled = true; });
    btn.textContent = 'Encaixando…';
    try {
      const m = await api(`/api/songs/${id}/cifra`, { method: 'PUT', body: JSON.stringify({ text }) });
      if (S.playerId !== id) return; // a pessoa abriu outra música enquanto encaixava
      $('#cifraModal').hidden = true;
      await applyLyrics(m);
      renderChordline();
      S.chordIdx = -2; // os painéis de acorde agora/próximo redesenham com os acordes novos
      tick();
      toast(text.trim() ? 'Acordes da cifra encaixados na música.' : 'Voltei aos acordes que o soundStudy ouviu.');
    } catch (e) {
      toast('Não consegui usar a cifra: ' + e.message);
    } finally {
      S.cifraSaving = false;
      buttons.forEach((b) => { $(b).disabled = false; });
      btn.textContent = 'Encaixar o texto acima';
    }
  }

  async function reprocess(id, separacao) {
    try {
      await api(`/api/songs/${id}/reprocess` + (separacao ? `?separacao=${separacao}` : ''), { method: 'POST' });
      if (id === S.playerId) teardownPlayer();
      loadLibrary();
      openSong(id);
    } catch (e) { toast(e.message); }
  }

  async function removeSong(id, title) {
    if (!confirm(`Excluir "${title}"?\nIsso apaga a transcrição e os áudios separados.`)) return;
    try {
      if (id === S.playerId) teardownPlayer();
      await api('/api/songs/' + id, { method: 'DELETE' });
      goHome();
      loadLibrary();
      toast('Música excluída.');
    } catch (e) { toast(e.message); }
  }

  function closeMenus(except) {
    // a mesa de som não entra aqui: é um painel, fica aberta até a pessoa fechar
    for (const sel of ['#moreMenu', '#speedMenu', '#bgMenu', '#qualityMenu']) if ($(sel) !== except) $(sel).hidden = true;
  }
  function toggleMenu(sel) {
    return (e) => {
      e.stopPropagation();
      const m = $(sel);
      closeMenus(m);
      m.hidden = !m.hidden;
    };
  }

  // ------------------------------------------------------------ eventos
  function bind() {
    const pick = () => $('#fileInput').click();
    for (const sel of ['#btnUpload', '#btnUpload2', '#btnUpload3', '#dropzone']) $(sel).onclick = pick;
    $('#dropzone').onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } };
    $('#fileInput').onchange = (e) => { uploadFile(e.target.files[0]); e.target.value = ''; };
    $('#brandLink').onclick = (e) => { e.preventDefault(); goHome(); };
    $('#btnHome').onclick = goHome;

    $('#search').oninput = (e) => {
      S.query = e.target.value;
      renderLibrary();
      if (S.query && S.view !== 'home') goHome();
    };
    $('#libFilters').onclick = (e) => {
      const b = e.target.closest('[data-f]');
      if (!b) return;
      S.filter = b.dataset.f;
      document.querySelectorAll('#libFilters .chip').forEach((x) => x.classList.toggle('on', x === b));
      renderLibrary();
    };

    let dragDepth = 0;
    const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
    window.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; dragDepth++; $('#dropOverlay').hidden = false; });
    window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('#dropOverlay').hidden = true; });
    window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
    window.addEventListener('drop', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth = 0;
      $('#dropOverlay').hidden = true;
      uploadFile(e.dataTransfer.files[0]);
    });

    for (const sel of ['#btnPlay', '#bigPlay', '#topPlay', '#stagePlay']) $(sel).onclick = togglePlay;
    $('#btnBack').onclick = () => seek((S.master ? S.master.currentTime : 0) - 5);
    $('#btnFwd').onclick = () => seek((S.master ? S.master.currentTime : 0) + 5);
    $('#seek').oninput = (e) => {
      S.dragging = true;
      setRange(e.target, e.target.value);
      $('#tCur').textContent = fmtTime((e.target.value / 1000) * duration());
    };
    $('#seek').onchange = (e) => { S.dragging = false; seek((e.target.value / 1000) * duration()); };

    $('#btnSpeed').onclick = toggleMenu('#speedMenu');
    $('#speedMenu').onclick = (e) => {
      const sync = e.target.closest('[data-sync]');
      if (sync) { // ajuste do cursor: o menu fica aberto para ir acertando com a música tocando
        e.stopPropagation();
        setSync(sync.dataset.sync === '0' ? 0 : S.syncMs + parseInt(sync.dataset.sync, 10));
        return;
      }
      const b = e.target.closest('[data-speed]');
      if (!b) return;
      S.speed = parseFloat(b.dataset.speed);
      applySpeed();
    };
    $('#btnMixer').onclick = (e) => {
      e.stopPropagation();
      if ($('#mixer').hidden) openConsole(); else closeConsole();
    };
    $('#btnMore').onclick = toggleMenu('#moreMenu');
    $('#moreMenu').onclick = () => closeMenus();
    document.addEventListener('click', () => closeMenus());

    $('#volume').oninput = (e) => {
      S.volume = parseFloat(e.target.value);
      S.muted = false;
      applyMix();
    };
    $('#btnMute').onclick = () => {
      if (S.volume === 0) S.volume = 0.8;
      S.muted = !S.muted;
      applyMix();
    };

    $('#btnClick').onclick = () => {
      S.click = !S.click;
      ensureCtx();
      if (S.actx) S.actx.resume();
      if (!S.click) cancelClicks();
      $('#btnClick').classList.toggle('on', S.click);
      toast(S.click ? 'Metrônomo ligado' : 'Metrônomo desligado');
    };
    $('#btnLoop').onclick = () => {
      if (!S.an) return;
      const next = LOOP_STEPS[(LOOP_STEPS.indexOf(S.loopN) + 1) % LOOP_STEPS.length];
      setLoop(next, S.loopN ? S.loopM : Math.max(0, S.measure));
      if (next && S.master && (S.master.currentTime < S.loopStart || S.master.currentTime >= S.loopEnd)) seek(S.loopStart);
    };

    $('#levelSeg').onclick = async (e) => {
      const b = e.target.closest('[data-level]');
      if (!b || b.dataset.level === S.level) return;
      S.level = b.dataset.level;
      document.querySelectorAll('#levelSeg .chip').forEach((x) => x.classList.toggle('on', x === b));
      updateDownloadLink();
      if (!S.playerId) return;
      const loop = S.loopN;
      setLoop(0);
      S.chords = chordsForLevel();
      renderChordline();
      S.chordIdx = -2;
      S.vIdx = -2;
      tick();
      if (loop) setLoop(loop, S.loopM);
      await loadSheet();
    };
    const setZoom = (z) => {
      S.zoom = Math.round(Math.min(1.6, Math.max(0.6, z)) * 10) / 10;
      $('#zoomVal').textContent = Math.round(S.zoom * 100) + '%';
      rerenderSheet();
    };
    $('#zoomVal').textContent = Math.round(S.zoom * 100) + '%';
    $('#zoomIn').onclick = () => setZoom(S.zoom + 0.1);
    $('#zoomOut').onclick = () => setZoom(S.zoom - 0.1);

    $('#btnStage').onclick = openStage;
    $('#btnShow').onclick = openShow;
    $('#btnShowClose').onclick = closeShow;
    $('#btnShowExit').onclick = closeShow;
    S.hw = new Pista.Highway($('#hwCanvas'), hwSource);
    S.track = new Pista.Highway($('#trackCanvas'), trackSource, { orient: 'h' });
    S.track.start();
    $('#viewPista').onclick = () => setShowView('pista', true, true);
    $('#viewPartitura').onclick = () => setShowView('partitura', true, true);
    $('#hwInsts').onclick = (e) => {
      const bt = e.target.closest('button[data-inst]');
      if (!bt) return;
      S.hwInst = bt.dataset.inst;
      renderHwInsts();
    };
    $('#btnShowStart').onclick = () => startShow(null);
    $('#btnShowChords').onclick = () => startShow('chords');
    $('#btnShowMelody').onclick = () => startShow('melody');
    $('#btnShowAgain').onclick = () => startShow(S.gameOn ? S.game.mode : null);
    $('#showPlay').onclick = togglePlay;
    $('#btnShowBg').onclick = toggleMenu('#bgMenu');
    $('#bgMenu').onclick = () => closeMenus();
    document.querySelectorAll('#bgMenu [data-scene]').forEach((b) => { b.onclick = () => useScene(b.dataset.scene); });
    $('#bgFile').onclick = () => $('#bgInput').click();
    $('#bgInput').onchange = (e) => { useMedia(e.target.files[0]); e.target.value = ''; };
    $('#btnShowFull').onclick = () => {
      if (document.fullscreenElement) { document.exitFullscreen().catch(() => {}); return; }
      const el = $('#show');
      if (el.requestFullscreen) el.requestFullscreen().catch(() => toast('Tela cheia não está disponível aqui.'));
    };
    $('#btnStageClose').onclick = closeStage;
    $('#btnFull').onclick = () => {
      if (document.fullscreenElement) { document.exitFullscreen().catch(() => {}); return; }
      const st = $('#stage');
      if (st.requestFullscreen) st.requestFullscreen().catch(() => toast('Tela cheia não está disponível aqui.'));
    };
    document.addEventListener('fullscreenchange', () => S.stageViz && S.stageViz.resize());

    $('#songTitle').onclick = () => { if ($('#songTitle').contentEditable !== 'true') startRename(); };
    $('#btnRename').onclick = startRename;
    $('#btnLyricsEdit').onclick = openLyricsEditor;
    $('#btnLyricsMenu').onclick = openLyricsEditor;
    $('#lyricsCancel').onclick = () => { $('#lyricsModal').hidden = true; };
    $('#lyricsSave').onclick = () => saveLyrics($('#lyricsText').value);
    $('#lyricsAuto').onclick = () => saveLyrics('');
    $('#lyrSearch').onclick = searchLyrics;
    // cola o que a pessoa copiou (do Letras, do Cifra Club, de qualquer lugar) e já encaixa
    $('#lyricsPaste').onclick = async () => {
      let text = '';
      try { text = await navigator.clipboard.readText(); } catch (_) {
        toast('Não consegui ler o que você copiou. Cole no campo acima (Ctrl+V) e toque em "Encaixar o texto acima".');
        $('#lyricsText').focus();
        return;
      }
      if (!text.trim()) { toast('Nada copiado ainda. Abra no Letras, selecione a letra e copie (Ctrl+C).'); return; }
      $('#lyricsText').value = text;
      saveLyrics(text);
    };
    $('#lyricsRecog').onclick = async () => {
      if (!confirm('Ouvir a voz de novo com o modelo grande? Erra bem menos palavra. Com placa de vídeo leva poucos minutos; sem placa, pode levar meia hora. A letra colada ou da base continua tendo prioridade.')) return;
      try {
        await api(`/api/songs/${S.playerId}/lyrics/recognize`, { method: 'POST' });
        $('#lyricsModal').hidden = true;
        const id = S.playerId;
        teardownPlayer();
        loadLibrary();
        openSong(id);
      } catch (e) { toast(e.message); }
    };
    $('#lyrQuery').onkeydown = (e) => { if (e.key === 'Enter') searchLyrics(); if (e.key === 'Escape') $('#lyricsModal').hidden = true; };
    $('#lyricsText').onkeydown = (e) => { if (e.key === 'Escape') $('#lyricsModal').hidden = true; };
    $('#lyricsModal').onclick = (e) => { if (e.target === $('#lyricsModal')) $('#lyricsModal').hidden = true; };
    // celular: o cartão "Como tocar" sai da coluna da biblioteca (escondida) e vai para baixo do "Tocando agora"
    const phoneMq = window.matchMedia('(max-width: 700px)');
    const placeHand = () => {
      const hc = $('#handCard');
      if (phoneMq.matches) $('#trackCard').after(hc);
      else document.querySelector('.sidebar').appendChild(hc);
    };
    if (phoneMq.addEventListener) phoneMq.addEventListener('change', placeHand);
    placeHand();
    // celular: a biblioteca abre como gaveta por cima da tela
    const setLib = (open) => {
      $('#app').classList.toggle('lib-open', open);
      $('#btnLib').setAttribute('aria-expanded', String(open));
    };
    $('#btnLib').onclick = () => setLib(!$('#app').classList.contains('lib-open'));
    $('#songList').addEventListener('click', () => setLib(false));
    $('#btnHome').addEventListener('click', () => setLib(false));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setLib(false); });
    // abrir no celular (só aparece no próprio computador)
    if (!['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) $('#btnPhone').hidden = true;
    $('#btnPhone').onclick = async (e) => {
      e.stopPropagation();
      closeMenus();
      $('#phoneQr').innerHTML = '';
      $('#phoneUrl').textContent = 'Procurando o endereço deste computador…';
      $('#phoneHint').textContent = '';
      $('#phoneModal').hidden = false;
      try {
        const r = await api('/api/celular');
        $('#phoneQr').innerHTML = r.qr_svg || '';
        $('#phoneUrl').textContent = r.url || 'Este computador não está em nenhuma rede Wi-Fi.';
        $('#phoneHint').textContent = !r.url ? 'Conecte o computador ao Wi-Fi e tente de novo.'
          : (r.ouvindo_rede
            ? 'Se não abrir no celular: confira se os dois estão no mesmo Wi-Fi. Na primeira vez, o Windows pode perguntar se o Python pode usar a rede: toque em Permitir.'
            : 'O soundStudy ainda não está aberto para a rede. Feche a janela do soundStudy e abra de novo pelo atalho; depois volte aqui.');
      } catch (err) {
        $('#phoneUrl').textContent = 'Não consegui preparar o acesso: ' + err.message;
      }
    };
    // fora de casa: túnel pela internet (liga e desliga aqui no computador)
    const showTunel = (t) => {
      const on = !!(t && t.ligado);
      $('#tunelBtn').textContent = on ? 'Desligar acesso pela internet' : 'Ligar acesso pela internet';
      $('#tunelQr').innerHTML = (t && t.qr_svg) || '';
      $('#tunelBox').hidden = !(t && t.url);
      $('#tunelUrl').textContent = (t && t.url) || '';
      if (t && t.erro) toast(t.erro);
    };
    const loadTunel = async () => { try { showTunel(await api('/api/tunel')); } catch (_) { /* fora do computador */ } };
    $('#btnPhone').addEventListener('click', loadTunel);
    $('#tunelBtn').onclick = async () => {
      const btn = $('#tunelBtn');
      const on = btn.textContent.startsWith('Desligar');
      btn.disabled = true;
      btn.textContent = on ? 'Desligando…' : 'Abrindo o túnel… (alguns segundos)';
      try {
        showTunel(await api(on ? '/api/tunel/desligar' : '/api/tunel/ligar', { method: 'POST' }));
      } catch (e) {
        toast('Não consegui: ' + e.message);
        await loadTunel();
      } finally {
        btn.disabled = false;
      }
    };
    $('#phoneClose').onclick = () => { $('#phoneModal').hidden = true; };
    $('#phoneModal').onclick = (e) => { if (e.target === $('#phoneModal')) $('#phoneModal').hidden = true; };
    $('#btnCifraMenu').onclick = openCifraEditor;
    $('#cifraCancel').onclick = () => { $('#cifraModal').hidden = true; };
    $('#cifraSave').onclick = () => saveCifra($('#cifraText').value);
    $('#cifraAuto').onclick = () => saveCifra('');
    $('#cifraPaste').onclick = async () => {
      let text = '';
      try { text = await navigator.clipboard.readText(); } catch (_) {
        toast('Não consegui ler o que você copiou. Cole no campo acima (Ctrl+V) e toque em "Encaixar o texto acima".');
        $('#cifraText').focus();
        return;
      }
      if (!text.trim()) { toast('Nada copiado ainda. Abra a cifra, selecione tudo e copie (Ctrl+C).'); return; }
      $('#cifraText').value = text;
      saveCifra(text);
    };
    $('#cifraText').onkeydown = (e) => { if (e.key === 'Escape') $('#cifraModal').hidden = true; };
    $('#cifraModal').onclick = (e) => { if (e.target === $('#cifraModal')) $('#cifraModal').hidden = true; };
    $('#btnReanalyze').onclick = () => reprocess(S.playerId);
    $('#btnReMax').onclick = () => reprocess(S.playerId, 'maxima');
    const openQuality = toggleMenu('#qualityMenu');
    $('#btnQuality').onclick = (e) => { openQuality(e); if (!$('#qualityMenu').hidden) loadQuality(); };
    $('#qualityMenu').onclick = async (e) => {
      e.stopPropagation();
      const b = e.target.closest('[data-q]');
      if (!b) return;
      try {
        const c = await api('/api/config', { method: 'PUT', body: JSON.stringify({ qualidade: b.dataset.q }) });
        showQuality(c);
        toast('Qualidade: ' + b.querySelector('b').textContent + '. Vale para as próximas músicas e para "Refazer análise".');
      } catch (err) { toast(err.message); }
    };
    $('#btnDelete').onclick = () => removeSong(S.playerId, S.meta.title);
    $('#btnRetry').onclick = () => reprocess(S.id);
    $('#btnErrDelete').onclick = () => removeSong(S.id, S.meta ? S.meta.title : '');
    const backToSong = () => { if (S.playerId) openSong(S.playerId); };
    $('#nbCover').onclick = backToSong;
    $('#nbTitle').onclick = backToSong;
    $('#nbTitle').style.cursor = 'pointer';
    $('#nbCover').style.cursor = 'pointer';

    const main = $('#main');
    main.addEventListener('wheel', () => { S.userScrollAt = performance.now(); }, { passive: true });
    // no celular a pessoa rola com o dedo: o acompanhamento da partitura espera 3 s, como na rodinha
    main.addEventListener('touchmove', () => { S.userScrollAt = performance.now(); }, { passive: true });
    main.addEventListener('scroll', () => {
      const show = S.view !== 'home' && main.scrollTop > 250;
      $('#mainTop').classList.toggle('visible', show); // "show" é o nome do Modo Show: não reusar
      $('#topPlay').hidden = S.view !== 'player';
    }, { passive: true });

    let resizeTimer = 0;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        rerenderSheet();
        if (S.showOn) {
          focusStage();
          if (S.strip) loadStrip();
        }
      }, 250);
    });

    document.addEventListener('keydown', (e) => {
      const tag = (e.target.tagName || '').toLowerCase();
      if (['input', 'select', 'textarea'].includes(tag) || e.target.isContentEditable) return;
      if (e.key === 'Escape' && S.showOn && !document.fullscreenElement) { closeShow(); return; }
      if (e.key === 'Escape' && S.stageOn && !document.fullscreenElement) { closeStage(); return; }
      if (e.key === 'Escape' && !$('#mixer').hidden) { closeConsole(); return; }
      if (!S.master) return;
      if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); $('#btnBack').click(); }
      if (e.key === 'ArrowRight') { e.preventDefault(); $('#btnFwd').click(); }
    });
    window.addEventListener('hashchange', () => {
      const h = location.hash.slice(1);
      if (h && h !== S.id) openSong(h);
    });
  }

  // ------------------------------------------------------------ qualidade (modo automático)
  function showQuality(c) {
    document.querySelectorAll('#qualityMenu [data-q]').forEach((b) => b.classList.toggle('on', b.dataset.q === c.qualidade));
    const hw = c.hardware || {};
    const p = c.plano || {};
    const placa = hw.gpu ? `Placa de vídeo: <b>${esc(hw.gpu_name)}</b> (${hw.vram_gb} GB)` : 'Sem placa de vídeo dedicada: a máxima pode levar mais de meia hora por música.';
    $('#qualityInfo').innerHTML = `${placa}<br>Agora: separação <b>${p.separacao === 'maxima' ? 'máxima' : 'rápida'}</b> · letra <b>${esc(p.letra || '')}</b> · ${hw.gpu ? 'tudo na placa de vídeo' : 'tudo no processador'}`;
  }

  async function loadQuality() {
    try { showQuality(await api('/api/config')); } catch (_) { $('#qualityInfo').textContent = 'Não consegui ler a configuração.'; }
  }

  async function init() {
    greeting();
    const config = api('/api/config').catch(() => null); // em paralelo: não segura a tela
    try { S.stages = await api('/api/stages'); } catch (_) { S.stages = []; }
    buildMixer();
    bind();
    applyMix();
    applySpeed();
    loadSync();
    const library = loadLibrary();
    const c = await config;
    S.visualHigh = !!(c && c.plano && c.plano.visual === 'alta'); // máquina forte: animações em resolução cheia, 60 quadros
    const vs = S.visualHigh ? 1 : 0.6;
    // o pé do topo emenda na cor de baixo (o degradê da cor da música, ou o cinza sem música)
    S.heroViz = new Visualizer($('#heroCanvas'), vizState, { scale: vs, bars: 64, fadeTo: () => S.songDeep || '#141414' });
    S.stageViz = new Visualizer($('#stageCanvas'), vizState, { scale: S.visualHigh ? 1 : 0.5, bars: 96 });
    S.heroViz.start();
    S.stageViz.start();
    S.bgKind = savedScene();
    setScene(S.bgKind === 'luzes' ? 'luzes' : 'mesa');
    markBg();
    S.homeScene = new MesaScene($('#homeCanvas'), showState, S.visualHigh ? { scale: 1, fps: 60 } : { scale: 0.6 });
    S.homeScene.start();
    S.game = new ChordGame();
    await library;
    const h = location.hash.slice(1);
    if (h) openSong(h); else showView('home');
  }

  // para medir a sincronia no console: abra com ?debug
  if (new URLSearchParams(location.search).has('debug')) {
    window.pv = { S, position, viewTime, heardCtxTime, outLatency, beatAt, timeAtBeat, seek, play, pause, tick };
  }

  init();
})();
