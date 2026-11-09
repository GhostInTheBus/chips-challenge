// Breadth first search over whole game states, one step = one move + 2 ticks.
// Proves a level can be finished under engine.js. Usage: node test/solve.js FILE N [maxStates]
require('../web/js/formats.js'); require('../web/js/engine.js');
const fs = require('fs'); const crypto = require('crypto');
const set = CCFormats.parseLevelset(fs.readFileSync(process.argv[2]));
const nums = process.argv[3].split(',').map(Number);
const MAX = +(process.argv[4] || 200000);
function clone(g) {
  const c = Object.create(Object.getPrototypeOf(g));
  for (const k of Object.keys(g)) {
    const v = g[k];
    if (v instanceof Uint8Array) c[k] = Uint8Array.from(v);
    else if (Array.isArray(v)) c[k] = v.map((e) => (e && typeof e === 'object') ? Object.assign({}, e) : e);
    else c[k] = v;
  }
  c.sounds = [];
  return c;
}
const rawKey = (g) => Buffer.from(g.top).toString('latin1') + Buffer.from(g.bottom).toString('latin1') + g.chipX + ',' + g.chipY + g.keys + g.boots + g.chipsLeft + (g.tickCount & 3) + JSON.stringify(g.monsters.map((m) => [m.x, m.y, m.dir])) + g.isSliding + g.slide + JSON.stringify(g.traps.map((t) => t.flag));
const key = (g) => crypto.createHash('sha1').update(rawKey(g)).digest('base64');
for (const num of nums) {
  const lvl = set.levels.find((l) => l.number === num);
  const g0 = new CCEngine.Game(lvl, { seed: 1 });
  const seen = new Set([key(g0)]);
  let frontier = [{ g: g0, path: '' }], found = null, states = 0;
  const t0 = Date.now();
  outer: while (frontier.length && states < MAX) {
    const next = [];
    for (const { g, path } of frontier) {
      for (let d = 0; d < 4; d++) {
        const c = clone(g);
        c.keyDown(d); c.keyUp(d);
        for (let i = 0; i < 2 && c.status === 'playing'; i++) c.tick();
        // let any slide finish
        let guard = 0; while (c.status === 'playing' && c.isSliding && guard++ < 40) c.tick();
        states++;
        if (c.status === 'won') { found = path + 'NWSE'[d]; break outer; }
        if (c.status !== 'playing') continue;
        const k = key(c); if (seen.has(k)) continue; seen.add(k);
        next.push({ g: c, path: path + 'NWSE'[d] });
      }
    }
    frontier = next;
  }
  console.log('level', num, lvl.title.padEnd(16), found ? 'SOLVED in ' + found.length + ' moves' : 'not solved', '(' + states + ' states, ' + ((Date.now() - t0) / 1000).toFixed(1) + 's)', found ? found : '');
}
