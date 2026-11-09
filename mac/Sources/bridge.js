// bridge.js
// Glue between the Swift app and the shared engine. Keeps the Swift side to
// plain numbers, strings and Uint8Arrays.
var Bridge = {
  sets: {},
  game: null,
  gfx: null,

  loadSet: function (id, bytes) {
    this.sets[id] = CCFormats.parseLevelset(bytes).levels;
    return this.sets[id].length;
  },
  levelInfo: function (id) {
    return this.sets[id].map(function (l) { return [l.number, l.title, l.password]; });
  },
  start: function (id, index) {
    this.game = new CCEngine.Game(this.sets[id][index]);
    return true;
  },
  keyDown: function (d) { if (this.game) this.game.keyDown(d); },
  keyUp: function (d) { if (this.game) this.game.keyUp(d); },
  tick: function () { if (this.game) this.game.tick(); },
  sounds: function () { return this.game ? this.game.drainSounds() : []; },
  hint: function () { return (this.game && this.game.hint) || ''; },
  death: function () { return (this.game && this.game.deathCause) || ''; },
  // [vx, vy, chipsLeft, timeLeft(-1 untimed), levelNumber, status(0 play, 1 won, 2 dead),
  //  keys x4, boots x4, then 81 top tiles, then 81 bottom tiles]
  snapshot: function () {
    var g = this.game, v = g.viewport();
    var out = [v.x, v.y, g.chipsLeft, g.timeLeft == null ? -1 : g.timeLeft, g.level.number,
      g.status === 'won' ? 1 : g.status === 'dead' ? 2 : 0];
    for (var i = 0; i < 4; i++) out.push(g.keys[i]);
    for (i = 0; i < 4; i++) out.push(g.boots[i]);
    var j, k;
    for (j = 0; j < 9; j++) for (i = 0; i < 9; i++) { k = (v.y + j) * 32 + v.x + i; out.push(g.top[k]); }
    for (j = 0; j < 9; j++) for (i = 0; i < 9; i++) { k = (v.y + j) * 32 + v.x + i; out.push(g.bottom[k]); }
    return out;
  },
  debug: function () { var g = this.game; return [g.chipX, g.chipY, g.tickCount, g.hasMoved ? 1 : 0, g.buffered, g.chipsLeft].join(','); },
  score: function (num, t, attempts) { var s = CCEngine.score(num, t, attempts); return [s.time, s.level, s.total]; },

  // CHIPS.EXE graphics: call loadGraphics, then fetch each part.
  loadGraphics: function (bytes) {
    try { this.gfx = CCFormats.extractExeGraphics(bytes); return true; } catch (e) { this.gfx = null; return String(e); }
  },
  gfxSize: function (name) { var p = this.gfx && this.gfx[name]; return p ? [p.width, p.height] : [0, 0]; },
  gfxPixels: function (name) { return this.gfx[name].rgba; },

  // Zip support for the archive.org download (stored entries only here;
  // the app uses the system unzip for deflated ones).
  midiForMac: function (bytes) { return CCMidi.singleMode(bytes); },
};
