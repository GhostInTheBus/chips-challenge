// app.js
// Browser front end: files, storage, drawing, input, sound, dialogs.
// Game rules live in engine.js; file formats in formats.js.
(function () {
  'use strict';
  const E = window.CCEngine, F = window.CCFormats;
  const $ = (id) => document.getElementById(id);
  const canvas = $('screen'), ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  // ------------------------------------------------------------ layout (px)
  const BOARD_X = 24, BOARD_Y = 18, PANEL_X = 338, PANEL_Y = 18;
  const INV_X = PANEL_X + 13, INV_Y = PANEL_Y + 222;
  const COUNTERS = [34, 96, 186];              // y of LEVEL, TIME, CHIPS LEFT windows
  const TICK_MS = E.TICK_MS || 110;            // the original's timer fires every 110 ms

  // ------------------------------------------------------------- app state
  const S = {
    files: {},                 // UPPERCASE name -> Uint8Array
    sets: {},                  // id -> { id, name, levels }
    setId: localStorage.getItem('cc.set') || 'cclp1',
    skin: null,                // { atlas, panel, digits, background, ending, original }
    game: null, levelIndex: 0,
    mode: 'loading',           // loading, ready, play, paused, dialog
    attempts: 0,
    acc: 0, last: 0,
    sound: localStorage.getItem('cc.sound') !== '0',
    music: localStorage.getItem('cc.music') !== '0',
    dpad: localStorage.getItem('cc.dpad') === '1' || (matchMedia('(pointer: coarse)').matches && localStorage.getItem('cc.dpad') !== '0'),
    held: [],
  };

  window.CCApp = { state: S };   // handy from the console

  // ------------------------------------------------------------- storage
  const DB_NAME = 'chips-challenge', STORE = 'files';
  function db() {
    return new Promise((res, rej) => {
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
  }
  async function dbAll() {
    try {
      const d = await db();
      return await new Promise((res) => {
        const out = {}; const tx = d.transaction(STORE, 'readonly'); const st = tx.objectStore(STORE);
        const c = st.openCursor();
        c.onsuccess = () => { const cur = c.result; if (cur) { out[cur.key] = new Uint8Array(cur.value); cur.continue(); } else res(out); };
        c.onerror = () => res(out);
      });
    } catch (e) { return {}; }
  }
  async function dbPut(name, bytes) {
    try { const d = await db(); const tx = d.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), name); } catch (e) { /* private mode */ }
  }
  async function dbClear() {
    try { const d = await db(); d.transaction(STORE, 'readwrite').objectStore(STORE).clear(); } catch (e) { /* ignore */ }
  }
  const progKey = () => 'cc.progress.' + S.setId;
  function progress() {
    try { return JSON.parse(localStorage.getItem(progKey())) || {}; } catch (e) { return {}; }
  }
  function saveProgress(p) { localStorage.setItem(progKey(), JSON.stringify(p)); }

  // ------------------------------------------------------------- files in
  const WANTED = /\.(DAT|CCL|EXE|WAV|MID)$/;
  async function inflateRaw(data) {
    const ds = new DecompressionStream('deflate-raw');
    const buf = await new Response(new Blob([data]).stream().pipeThrough(ds)).arrayBuffer();
    return new Uint8Array(buf);
  }
  async function takeFiles(list) {
    let n = 0;
    for (const file of list) {
      const name = file.name.toUpperCase().split(/[\\/]/).pop();
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (name.endsWith('.ZIP')) {
        for (const e of F.zipEntries(bytes)) {
          const en = e.name.toUpperCase().split(/[\\/]/).pop();
          if (!WANTED.test(en)) continue;
          const data = e.method === 0 ? e.data : e.method === 8 ? await inflateRaw(e.data) : null;
          if (data) { S.files[en] = data; await dbPut(en, data); n++; }
        }
      } else if (WANTED.test(name)) {
        const key = /\.(DAT|CCL)$/.test(name) && name !== 'CHIPS.DAT' && !S.files['CHIPS.DAT'] && looksLikeLevels(bytes) ? 'CHIPS.DAT' : name;
        S.files[key] = bytes; await dbPut(key, bytes); n++;
      }
    }
    return n;
  }
  function looksLikeLevels(b) { return b.length > 6 && b[0] === 0xAC && b[1] === 0xAA; }

  // ------------------------------------------------------------- skins
  function rgbaCanvas(img) {
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const x = c.getContext('2d'); const id = x.createImageData(img.width, img.height);
    id.data.set(img.rgba); x.putImageData(id, 0, 0); return c;
  }
  function loadImage(src) {
    return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
  }
  function freePanel() {
    const c = document.createElement('canvas'); c.width = 154; c.height = 300;
    const x = c.getContext('2d');
    x.fillStyle = '#c0c0c0'; x.fillRect(0, 0, 154, 300);
    x.fillStyle = '#fff'; x.fillRect(0, 0, 154, 2); x.fillRect(0, 0, 2, 300);
    x.fillStyle = '#808080'; x.fillRect(0, 298, 154, 2); x.fillRect(152, 0, 2, 300);
    x.font = 'bold 15px Arial, Helvetica, sans-serif'; x.textAlign = 'center';
    const label = (t, y) => { x.fillStyle = '#000'; x.fillText(t, 78, y + 1); x.fillStyle = '#e00000'; x.fillText(t, 77, y); };
    label('LEVEL', 26); label('TIME', 88); label('CHIPS', 160); label('LEFT', 178);
    for (const y of COUNTERS) {
      x.fillStyle = '#808080'; x.fillRect(43, y - 6, 61, 35);
      x.fillStyle = '#fff'; x.fillRect(45, y - 4, 59, 33);
      x.fillStyle = '#000'; x.fillRect(45, y, 55, 29);
    }
    return c;
  }
  function freeBackground() {
    const c = document.createElement('canvas'); c.width = 64; c.height = 64;
    const x = c.getContext('2d');
    x.fillStyle = '#0b3d1e'; x.fillRect(0, 0, 64, 64);
    x.strokeStyle = '#1f7a3f'; x.lineWidth = 2;
    x.beginPath(); x.moveTo(0, 16); x.lineTo(24, 16); x.lineTo(40, 32); x.lineTo(64, 32);
    x.moveTo(16, 0); x.lineTo(16, 10); x.moveTo(48, 64); x.lineTo(48, 44); x.lineTo(56, 36); x.stroke();
    x.fillStyle = '#2fae5a'; x.fillRect(14, 8, 4, 4); x.fillRect(46, 42, 4, 4);
    return c;
  }
  async function buildSkin() {
    const exe = S.files['CHIPS.EXE'];
    if (exe) {
      try {
        const g = F.extractExeGraphics(exe);
        return {
          original: true, atlas: rgbaCanvas(g.tiles), panel: rgbaCanvas(g.panel), digits: rgbaCanvas(g.digits),
          background: g.background ? rgbaCanvas(g.background) : freeBackground(), ending: g.ending ? rgbaCanvas(g.ending) : null,
        };
      } catch (e) { console.warn('CHIPS.EXE graphics', e); status('Could not read graphics from CHIPS.EXE, using the free tiles.'); }
    }
    return { original: false, atlas: await loadImage('assets/tiles-free.png'), panel: freePanel(), digits: null, background: freeBackground(), ending: null };
  }

  // ------------------------------------------------------------- sound
  let actx = null, master = null, midi = null;
  const sfx = {};      // sound id -> AudioBuffer
  const songs = [];
  const SFX_FILES = ['BLIP2.WAV', 'DOOR.WAV', 'BUMMER.WAV', 'DITTY1.WAV', 'CHIMES.WAV', 'OOF3.WAV', 'STRIKE.WAV', 'CHIMES.WAV', 'CLICK3.WAV', 'POP2.WAV', 'WATER2.WAV', 'HIT3.WAV', 'TELEPORT.WAV', 'CLICK1.WAV', 'BELL.WAV'];
  function audio() {
    if (!actx) {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
      actx = new AC(); master = actx.createGain(); master.gain.value = 0.8; master.connect(actx.destination);
      midi = new CCMidi.MidiPlayer(actx, master);
    }
    if (actx.state === 'suspended') actx.resume();
    return actx;
  }
  async function loadSounds() {
    if (!audio()) return;
    for (const k of Object.keys(sfx)) delete sfx[k];
    songs.length = 0;
    for (let i = 0; i < SFX_FILES.length; i++) {
      const b = S.files[SFX_FILES[i]];
      if (b) { try { sfx[i] = await actx.decodeAudioData(b.slice().buffer); } catch (e) { /* bad wav */ } }
    }
    for (const name of Object.keys(S.files).sort()) {
      if (name.endsWith('.MID')) { try { songs.push(CCMidi.parseMidi(S.files[name])); } catch (e) { /* skip */ } }
    }
  }
  // Fallback blips for sounds that were Windows system files (or free mode).
  const SYNTH = {
    0: [[880, 0.05], [1320, 0.06]], 1: [[220, 0.08], [330, 0.08]], 2: [[300, 0.15], [200, 0.15], [120, 0.3]],
    3: [[523, 0.1], [659, 0.1], [784, 0.1], [1046, 0.25]], 4: [[784, 0.08], [1046, 0.08], [1318, 0.15]], 5: [[110, 0.07]],
    6: [[400, 0.06], [300, 0.06], [200, 0.12]], 7: [[1046, 0.1]], 8: [[1568, 0.04]], 9: [[660, 0.04], [440, 0.04]],
    10: ['noise', 0.25], 11: ['noise', 0.4], 12: [[300, 0.05], [600, 0.05], [1200, 0.08]], 13: [[2000, 0.02]], 14: [[880, 0.3], [660, 0.5]],
  };
  function play(id) {
    if (!S.sound || !audio()) return;
    if (sfx[id]) { const s = actx.createBufferSource(); s.buffer = sfx[id]; s.connect(master); s.start(); return; }
    const spec = SYNTH[id]; if (!spec) return;
    let t = actx.currentTime;
    if (spec[0] === 'noise') {
      const len = Math.floor(actx.sampleRate * spec[1]); const buf = actx.createBuffer(1, len, actx.sampleRate);
      const d = buf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const s = actx.createBufferSource(); s.buffer = buf; const g = actx.createGain(); g.gain.value = 0.25; s.connect(g); g.connect(master); s.start(); return;
    }
    for (const [f, d] of spec) {
      const o = actx.createOscillator(), g = actx.createGain(); o.type = 'square'; o.frequency.value = f;
      g.gain.setValueAtTime(0.06, t); g.gain.exponentialRampToValueAtTime(0.001, t + d);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + d + 0.02); t += d * 0.9;
    }
  }
  function startMusic() {
    if (!midi) return;
    midi.stop();
    if (!S.music || !songs.length || !S.game) return;
    midi.play(songs[(S.game.level.number - 1) % songs.length]);
  }

  // ------------------------------------------------------------- level sets
  async function loadSets() {
    S.sets = {};
    try {
      const r = await fetch('levels/CCLP1.dat'); const b = new Uint8Array(await r.arrayBuffer());
      S.sets.cclp1 = { id: 'cclp1', name: 'CCLP1', levels: F.parseLevelset(b).levels };
    } catch (e) { console.warn('CCLP1', e); }
    if (S.files['CHIPS.DAT']) {
      try { S.sets.original = { id: 'original', name: 'Original', levels: F.parseLevelset(S.files['CHIPS.DAT']).levels }; }
      catch (e) { status('That CHIPS.DAT did not read as a level file.'); }
    }
    if (!S.sets[S.setId]) S.setId = S.sets.original ? 'original' : 'cclp1';
    syncMenus();
  }
  const currentSet = () => S.sets[S.setId];

  // ------------------------------------------------------------- game flow
  function startLevel(index, opts) {
    const set = currentSet(); if (!set) return;
    index = Math.max(0, Math.min(set.levels.length - 1, index));
    if (!opts || !opts.retry) S.attempts = 0;
    S.levelIndex = index;
    S.game = new E.Game(set.levels[index]);
    S.mode = 'ready'; S.acc = 0;
    const p = progress();
    p.current = index; p.visited = p.visited || {}; p.visited[index] = 1;
    p.highest = Math.max(p.highest || 0, index);
    saveProgress(p);
    $('wintitle').textContent = "Chip's Challenge - Level " + set.levels[index].number;
    status(set.name + ' level ' + set.levels[index].number + ': ' + set.levels[index].title + '  (password ' + (set.levels[index].password || 'none') + ')');
    closeDialog();
    startMusic();
  }
  function levelScore(num, timeLeft, attempts) {
    // EndLevel: time bonus is 10 per second left; level bonus is 500 per level
    // number, cut by 20% for each retry after the first try, floor 1/... see engine.
    return E.score(num, timeLeft, attempts);
  }
  function won() {
    const g = S.game, set = currentSet(), lvl = g.level;
    play(3);
    const sc = levelScore(lvl.number, g.timeLeft || 0, S.attempts);
    const p = progress(); p.scores = p.scores || {}; p.best = p.best || {};
    const prev = p.scores[S.levelIndex] || 0;
    if (sc.total > prev) p.scores[S.levelIndex] = sc.total;
    if (g.timeLeft != null && (p.best[S.levelIndex] == null || g.timeLeft > p.best[S.levelIndex])) p.best[S.levelIndex] = g.timeLeft;
    p.highest = Math.max(p.highest || 0, S.levelIndex + 1);
    saveProgress(p);
    const total = Object.values(p.scores).reduce((a, c) => a + c, 0);
    const msg = [
      '<p><b>' + esc(sc.message) + '</b></p><p>' + esc(lvl.title) + ' complete.</p>',
      '<p>Time bonus: ' + sc.time + '<br>Level bonus: ' + sc.level + '<br>Level score: ' + sc.total + (prev && sc.total <= prev ? ' (best ' + prev + ')' : '') + '<br>Total score: ' + total + '</p>',
    ];
    const next = S.levelIndex + 1;
    if (next < set.levels.length) msg.push('<p class="small">Next: level ' + set.levels[next].number + ', password ' + esc(set.levels[next].password) + '</p>');
    const isEnd = S.setId === 'original' && lvl.number === 144;
    dialog(isEnd ? 'Congratulations!' : 'Level Complete', msg.join(''), [
      { label: next < set.levels.length ? 'Onward' : 'Done', def: true, fn: () => { if (isEnd && S.skin.ending) showEnding(); else if (next < set.levels.length) startLevel(next); else closeDialog(); } },
    ]);
  }
  function showEnding() {
    const c = S.skin.ending;
    dialog('The End', '<p>You made it through all the levels. The bonus levels after this one are a little extra.</p>', [{ label: 'Continue', def: true, fn: () => startLevel(S.levelIndex + 1) }]);
    const img = document.createElement('canvas'); img.width = c.width; img.height = c.height; img.getContext('2d').drawImage(c, 0, 0);
    img.style.cssText = 'display:block;margin:0 auto 8px;max-width:100%;image-rendering:pixelated';
    $('dialog').querySelector('.body').prepend(img);
  }
  const DEATH = {
    burned: 'Oops! Fire hurts without fire boots.',
    drowned: "Oops! Chip can't swim without flippers.",
    bombed: 'Oops! Bombs are bad news.',
    squished: 'Oops! Look out for moving blocks.',
    eaten: 'Oops! Watch out for creatures.',
    time: 'Oops! Out of time.',
  };
  function died() {
    play(S.game.deathCause === 'time' ? 14 : 2);
    S.attempts++;
    dialog("Chip's Challenge", '<p>' + (DEATH[S.game.deathCause] || 'Oops!') + '</p>', [{ label: 'OK', def: true, fn: () => startLevel(S.levelIndex, { retry: true }) }]);
  }

  // ------------------------------------------------------------- main loop
  function frame(t) {
    const dt = Math.min(500, t - (S.last || t)); S.last = t;
    if (S.mode === 'play' && S.game) {
      S.acc += dt;
      while (S.acc >= TICK_MS && S.mode === 'play') {
        S.acc -= TICK_MS;
        S.game.tick();
        for (const s of S.game.drainSounds()) play(s);
        if (S.game.status === 'won') { S.mode = 'dialog'; won(); }
        else if (S.game.status === 'dead') { S.mode = 'dialog'; died(); }
      }
    }
    draw();
    requestAnimationFrame(frame);
  }

  // ------------------------------------------------------------- drawing
  function tileAt(n, dx, dy) {
    ctx.drawImage(S.skin.atlas, (n >> 4) * 32, (n & 15) * 32, 32, 32, dx, dy, 32, 32);
  }
  function overlayAt(n, dx, dy) {
    ctx.drawImage(S.skin.atlas, (7 + ((n - 0x40) >> 4)) * 32, (n & 15) * 32, 32, 32, dx, dy, 32, 32);
  }
  function cell(top, bottom, dx, dy) {
    if (top >= 0x40 && top <= 0x6F) { tileAt(bottom, dx, dy); overlayAt(top, dx, dy); }
    else tileAt(top, dx, dy);
  }
  function bevel(x, y, w, h, inset) {
    ctx.fillStyle = inset ? '#808080' : '#ffffff'; ctx.fillRect(x, y, w, 2); ctx.fillRect(x, y, 2, h);
    ctx.fillStyle = inset ? '#ffffff' : '#808080'; ctx.fillRect(x, y + h - 2, w, 2); ctx.fillRect(x + w - 2, y, 2, h);
  }
  function digits(x, y, value, warn) {
    const d = S.skin.digits;
    const str = value == null ? '---' : String(Math.max(0, Math.min(999, value))).padStart(3, ' ');
    for (let i = 0; i < 3; i++) {
      const ch = str[i];
      if (d) {
        let g = ch === '-' ? 0 : ch === ' ' ? 1 : 11 - (+ch);
        if (!warn) g += 12;
        ctx.drawImage(d, 0, g * 23, 17, 23, x + i * 17, y, 17, 23);
      } else {
        ctx.fillStyle = warn ? '#ffff00' : '#00ff00';
        ctx.font = 'bold 22px "Courier New", monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.fillText(ch === ' ' ? '' : ch, x + i * 17 + 8.5, y + 1);
      }
    }
  }
  function wrap(text, maxw) {
    const words = text.split(/\s+/), lines = []; let line = '';
    for (const w of words) { const t = line ? line + ' ' + w : w; if (ctx.measureText(t).width > maxw && line) { lines.push(line); line = w; } else line = t; }
    if (line) lines.push(line); return lines;
  }
  function draw() {
    if (!S.skin) return;
    const pat = ctx.createPattern(S.skin.background, 'repeat');
    ctx.fillStyle = pat; ctx.fillRect(0, 0, canvas.width, canvas.height);
    const g = S.game;
    // board
    bevel(BOARD_X - 4, BOARD_Y - 4, 296, 296, true);
    if (g) {
      const v = g.viewport();
      for (let j = 0; j < 9; j++) for (let i = 0; i < 9; i++) {
        const k = (v.y + j) * 32 + v.x + i;
        cell(g.top[k], g.bottom[k], BOARD_X + i * 32, BOARD_Y + j * 32);
      }
      if (S.mode === 'ready') {
        ctx.fillStyle = 'rgba(0,0,0,.72)'; ctx.fillRect(BOARD_X, BOARD_Y + 288 - 62, 288, 62);
        ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillStyle = '#ffff00'; ctx.font = 'bold 15px Arial, sans-serif';
        ctx.fillText(g.level.title || ('Level ' + g.level.number), BOARD_X + 144, BOARD_Y + 288 - 56);
        ctx.fillStyle = '#ffffff'; ctx.font = '12px Arial, sans-serif';
        ctx.fillText('Password: ' + (g.level.password || '----'), BOARD_X + 144, BOARD_Y + 288 - 36);
        ctx.fillStyle = '#c0c0c0'; ctx.fillText('Move to start', BOARD_X + 144, BOARD_Y + 288 - 20);
      }
      if (S.mode === 'paused') {
        ctx.fillStyle = '#000'; ctx.fillRect(BOARD_X, BOARD_Y, 288, 288);
        ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.font = 'bold 18px Arial, sans-serif'; ctx.fillText('PAUSED', BOARD_X + 144, BOARD_Y + 134);
      }
    }
    // panel
    ctx.drawImage(S.skin.panel, PANEL_X, PANEL_Y);
    if (g) {
      digits(PANEL_X + 47, PANEL_Y + COUNTERS[0] + 3, g.level.number, false);
      digits(PANEL_X + 47, PANEL_Y + COUNTERS[1] + 3, g.timeLeft, g.timeLeft != null && g.timeLeft <= 15);
      digits(PANEL_X + 47, PANEL_Y + COUNTERS[2] + 3, g.chipsLeft, g.chipsLeft === 0);
      // inventory: keys on top, boots below
      for (let i = 0; i < 4; i++) {
        tileAt(g.keys[i] ? 0x64 + i : 0, INV_X + i * 32, INV_Y);
        tileAt(g.boots[i] ? 0x68 + i : 0, INV_X + i * 32, INV_Y + 32);
      }
      if (g.hint) {
        ctx.fillStyle = '#000'; ctx.fillRect(PANEL_X + 8, PANEL_Y + 74, 138, 146);
        ctx.strokeStyle = '#00ffff'; ctx.lineWidth = 1; ctx.strokeRect(PANEL_X + 10.5, PANEL_Y + 76.5, 133, 141);
        ctx.fillStyle = '#00ffff'; ctx.font = 'italic 11px Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        const lines = wrap('Hint: ' + g.hint, 124);
        const y0 = PANEL_Y + 147 - lines.length * 7;
        lines.forEach((l, i) => ctx.fillText(l, PANEL_X + 77, y0 + i * 14));
      }
    }
  }

  // ------------------------------------------------------------- input
  const KEYMAP = { ArrowUp: 0, ArrowLeft: 1, ArrowDown: 2, ArrowRight: 3, KeyW: 0, KeyA: 1, KeyS: 2, KeyD: 3, Numpad8: 0, Numpad4: 1, Numpad2: 2, Numpad6: 3 };
  function press(dir) {
    if (!S.game) return;
    audio();
    if (S.mode === 'ready') { S.mode = 'play'; S.acc = TICK_MS; }
    if (S.mode !== 'play') return;
    S.game.keyDown(dir);
  }
  function release(dir) { if (S.game) S.game.keyUp(dir); }
  document.addEventListener('keydown', (e) => {
    const dlgOpen = !$('overlay').classList.contains('hidden');
    if (dlgOpen) {
      if (e.key === 'Enter') { const b = $('dialog').querySelector('.btn.default'); if (b && document.activeElement.tagName !== 'INPUT') { b.click(); e.preventDefault(); } }
      if (e.key === 'Escape') { const b = $('dialog').querySelector('[data-cancel]'); if (b) b.click(); }
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    if (mod && (e.code === 'KeyR' || e.code === 'KeyN' || e.code === 'KeyP' || e.code === 'KeyG')) {
      e.preventDefault(); act({ KeyR: 'restart', KeyN: 'next', KeyP: 'prev', KeyG: 'goto' }[e.code]); return;
    }
    if (mod) return;
    if (e.code in KEYMAP) { e.preventDefault(); if (!e.repeat) press(KEYMAP[e.code]); return; }
    if (e.code === 'KeyP' || e.code === 'Pause') { act('pause'); return; }
    if (e.code === 'KeyR') { act('restart'); return; }
    if (e.code === 'BracketRight') { act('next'); return; }
    if (e.code === 'BracketLeft') { act('prev'); return; }
  });
  document.addEventListener('keyup', (e) => { if (e.code in KEYMAP) release(KEYMAP[e.code]); });
  window.addEventListener('blur', () => { for (let d = 0; d < 4; d++) release(d); if (S.mode === 'play') act('pause'); });
  // on screen arrows
  $('dpad').querySelectorAll('button').forEach((b) => {
    const d = +b.dataset.dir;
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); b.setPointerCapture(e.pointerId); b.classList.add('down-now'); press(d); });
    const up = () => { b.classList.remove('down-now'); release(d); };
    b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up);
  });
  // swipe on the board
  let touch0 = null;
  canvas.addEventListener('touchstart', (e) => { const t = e.touches[0]; touch0 = { x: t.clientX, y: t.clientY }; }, { passive: true });
  canvas.addEventListener('touchend', (e) => {
    if (!touch0) return; const t = e.changedTouches[0]; const dx = t.clientX - touch0.x, dy = t.clientY - touch0.y; touch0 = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
    const d = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 3 : 1) : (dy > 0 ? 2 : 0);
    press(d); setTimeout(() => release(d), 60);
  });
  canvas.addEventListener('click', () => { if (S.mode === 'paused') act('pause'); });

  // ------------------------------------------------------------- menus
  document.querySelectorAll('.mtop').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation(); const m = b.parentElement; const open = m.classList.contains('open');
    document.querySelectorAll('.menu').forEach((x) => x.classList.remove('open'));
    if (!open) m.classList.add('open');
  }));
  document.addEventListener('click', () => document.querySelectorAll('.menu').forEach((x) => x.classList.remove('open')));
  document.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => act(b.dataset.act)));
  function syncMenus() {
    $('chk-music').classList.toggle('on', S.music);
    $('chk-sound').classList.toggle('on', S.sound);
    $('chk-dpad').classList.toggle('on', S.dpad);
    $('chk-original').classList.toggle('on', S.setId === 'original');
    $('chk-cclp1').classList.toggle('on', S.setId === 'cclp1');
    $('opt-original').disabled = !S.sets.original;
    $('dpad').classList.toggle('hidden', !S.dpad);
  }
  function act(a) {
    const set = currentSet();
    switch (a) {
      case 'newgame':
        dialog('New Game', '<p>Start over at level 1 and forget your scores and saved passwords for this level set?</p>', [
          { label: 'Yes', def: true, fn: () => { localStorage.removeItem(progKey()); startLevel(0); } }, { label: 'No', cancel: true, fn: closeDialog }]);
        break;
      case 'pause':
        if (S.mode === 'play') { S.mode = 'paused'; midi && midi.stop(); }
        else if (S.mode === 'paused') { S.mode = 'play'; startMusic(); }
        break;
      case 'restart': if (S.game) startLevel(S.levelIndex, { retry: S.mode !== 'ready' }); break;
      case 'next': if (set && canVisit(S.levelIndex + 1)) startLevel(S.levelIndex + 1); else askPassword(S.levelIndex + 1); break;
      case 'prev': if (S.levelIndex > 0) startLevel(S.levelIndex - 1); break;
      case 'goto': askPassword(null); break;
      case 'besttimes': bestTimes(); break;
      case 'music': S.music = !S.music; localStorage.setItem('cc.music', S.music ? '1' : '0'); syncMenus(); audio(); S.music ? startMusic() : midi && midi.stop(); break;
      case 'sound': S.sound = !S.sound; localStorage.setItem('cc.sound', S.sound ? '1' : '0'); syncMenus(); break;
      case 'dpad': S.dpad = !S.dpad; localStorage.setItem('cc.dpad', S.dpad ? '1' : '0'); syncMenus(); break;
      case 'set-original': if (S.sets.original) switchSet('original'); break;
      case 'set-cclp1': switchSet('cclp1'); break;
      case 'files': filesDialog(); break;
      case 'forget':
        dialog('Forget Saved Files', '<p>Remove the game files this browser saved? Your progress stays.</p>', [
          { label: 'Forget', def: true, fn: async () => { await dbClear(); S.files = {}; await reloadAll(); closeDialog(); } }, { label: 'Cancel', cancel: true, fn: closeDialog }]);
        break;
      case 'howto': howTo(); break;
      case 'about': about(); break;
    }
  }
  function canVisit(i) {
    const set = currentSet(); if (!set || i < 0 || i >= set.levels.length) return false;
    const p = progress(); return !!(p.visited && p.visited[i]) || i <= (p.highest || 0);
  }
  function switchSet(id) {
    S.setId = id; localStorage.setItem('cc.set', id); syncMenus();
    const p = progress(); startLevel(p.current || 0);
  }

  // ------------------------------------------------------------- dialogs
  function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function dialog(title, html, buttons) {
    if (S.mode === 'play' || S.mode === 'ready' || S.mode === 'paused') S.prevMode = S.mode;
    if (S.mode !== 'loading') S.mode = 'dialog';
    for (let d = 0; d < 4; d++) release(d);
    const box = $('dialog');
    box.innerHTML = '<h2>' + esc(title) + '</h2><div class="body">' + html + '</div><div class="buttons"></div>';
    const bar = box.querySelector('.buttons');
    for (const b of buttons || []) {
      const el = document.createElement('button'); el.className = 'btn' + (b.def ? ' default' : ''); el.textContent = b.label;
      if (b.cancel) el.dataset.cancel = '1';
      el.addEventListener('click', b.fn); bar.appendChild(el);
    }
    $('overlay').classList.remove('hidden');
    const first = box.querySelector('input') || box.querySelector('.btn.default'); if (first) setTimeout(() => first.focus(), 0);
  }
  function closeDialog() {
    $('overlay').classList.add('hidden');
    if (S.mode === 'dialog') S.mode = S.game ? (S.prevMode === 'play' ? 'paused' : (S.prevMode || 'ready')) : 'ready';
    S.prevMode = null;
  }
  function askPassword(index) {
    const set = currentSet(); if (!set) return;
    dialog('Go To Level', '<div class="field"><label for="f-lvl">Level number</label><input id="f-lvl" inputmode="numeric" value="' + (index != null ? set.levels[Math.min(index, set.levels.length - 1)].number : '') + '"><label for="f-pw">Password</label><input id="f-pw" maxlength="10" autocomplete="off"></div><p class="err" id="f-err"></p><p class="small">Levels you have already reached need no password.</p>', [
      { label: 'OK', def: true, fn: () => {
        const num = parseInt($('f-lvl').value, 10); const pw = $('f-pw').value.trim().toUpperCase();
        let i = set.levels.findIndex((l) => l.number === num);
        if (i < 0 && pw) i = set.levels.findIndex((l) => l.password === pw);
        if (i < 0) { $('f-err').textContent = 'No such level.'; return; }
        if (!canVisit(i) && set.levels[i].password !== pw) { $('f-err').textContent = 'That is not the right password.'; return; }
        startLevel(i);
      } },
      { label: 'Cancel', cancel: true, fn: closeDialog },
    ]);
    $('f-pw').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('dialog').querySelector('.btn.default').click(); });
    $('f-lvl').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('f-pw').focus(); });
  }
  function bestTimes() {
    const set = currentSet(); const p = progress(); const rows = [];
    let total = 0;
    set.levels.forEach((l, i) => {
      const sc = p.scores && p.scores[i]; if (sc) total += sc;
      if (sc || (p.best && p.best[i] != null)) rows.push('<tr><td>' + l.number + '</td><td>' + esc(l.title) + '</td><td>' + (p.best && p.best[i] != null ? p.best[i] + 's' : '-') + '</td><td>' + (sc || '') + '</td></tr>');
    });
    dialog('Best Times', rows.length ? '<div class="scroll"><table class="times"><tr><th>#</th><th>Level</th><th>Time left</th><th>Score</th></tr>' + rows.join('') + '</table></div><p>Total score: ' + total + '</p>' : '<p>No levels finished yet in this set.</p>', [{ label: 'OK', def: true, cancel: true, fn: closeDialog }]);
  }
  function filesDialog() {
    const have = Object.keys(S.files).sort();
    dialog('Load Your Game Files', '<p>Pick your own copy of Chip\'s Challenge for Windows: the whole zip, or CHIPS.DAT and CHIPS.EXE (plus the .WAV and .MID files for sound and music). You can also drop them on this page.</p><p class="small">Files stay in this browser. Nothing is uploaded.</p>' + (have.length ? '<p class="small">Saved here now: ' + esc(have.join(', ')) + '</p>' : ''), [
      { label: 'Choose Files', def: true, fn: () => $('filepick').click() }, { label: 'Close', cancel: true, fn: closeDialog }]);
  }
  function howTo() {
    dialog('How To Play', '<p>Get Chip to the exit. Pick up enough computer chips to open the chip socket first. Keys open doors of their color. Boots let Chip walk on water (flippers), fire, ice and force floors. Push blocks into water to make dirt.</p><p>Arrow keys, WASD or the number pad move Chip. On a phone, swipe on the board or turn on On Screen Arrows.</p><p>P pause, R restart, [ previous level, ] next level, Ctrl+G go to a level by password.</p>', [{ label: 'OK', def: true, cancel: true, fn: closeDialog }]);
  }
  function about() {
    dialog('About', '<p>A clean rebuild of the 1992 Windows version of Chip\'s Challenge, written from the game\'s file formats and the community disassembly of CHIPS.EXE.</p><p>The built in levels are CCLP1 by the Chip\'s Challenge community. The original levels, graphics, sounds and music only show up if you load your own copy.</p><p class="small">Chip\'s Challenge was created by Chuck Sommerville. Not affiliated with its rights holders.</p><p class="small"><a href="https://github.com/GhostInTheBus/chips-challenge" target="_blank" rel="noopener">Source on GitHub</a></p>', [{ label: 'OK', def: true, cancel: true, fn: closeDialog }]);
  }
  function status(t) { $('statusbar').textContent = t; }

  // ------------------------------------------------------------- file input
  $('filepick').addEventListener('change', async (e) => {
    const n = await takeFiles(e.target.files); e.target.value = '';
    await afterNewFiles(n);
  });
  let dragDepth = 0;
  document.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; $('dropzone').classList.remove('hidden'); });
  document.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('dropzone').classList.add('hidden'); } });
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', async (e) => {
    e.preventDefault(); dragDepth = 0; $('dropzone').classList.add('hidden');
    const n = await takeFiles(e.dataTransfer.files); await afterNewFiles(n);
  });
  async function afterNewFiles(n) {
    if (!n) { status('No Chip\'s Challenge files found in that.'); return; }
    const hadOriginal = !!S.sets.original;
    await reloadAll();
    if (S.sets.original && !hadOriginal) switchSet('original');
    status('Loaded ' + n + ' file' + (n === 1 ? '' : 's') + '. ' + (S.skin.original ? 'Original graphics on.' : ''));
  }
  async function reloadAll() {
    S.skin = await buildSkin();
    await loadSets();
    await loadSounds();
    if (!S.game || !currentSet()) startLevel(progress().current || 0);
    else if (S.mode === 'loading') startLevel(progress().current || 0);
  }

  // ------------------------------------------------------------- boot
  (async function boot() {
    S.files = await dbAll();
    S.skin = await buildSkin();
    await loadSets();
    try { await loadSounds(); } catch (e) { /* audio waits for a click */ }
    S.mode = 'ready';
    startLevel(progress().current || 0);
    syncMenus();
    if (!S.sets.original) status('Playing the free CCLP1 levels. Game > Load Your Game Files to play the original 149 levels.');
    requestAnimationFrame(frame);
    // first click or key unlocks audio, then sounds can decode
    const unlock = async () => {
      window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock);
      const fresh = !actx; audio(); if (fresh) await loadSounds(); startMusic();
    };
    window.addEventListener('pointerdown', unlock); window.addEventListener('keydown', unlock);
  })();
})();
