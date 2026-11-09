// Random input on every level of a set; catches exceptions and broken invariants.
require('../web/js/formats.js'); require('../web/js/engine.js');
const fs = require('fs');
const file = process.argv[2];
const set = CCFormats.parseLevelset(fs.readFileSync(file));
let errors = 0, won = 0, dead = 0;
for (const lvl of set.levels) {
  for (let run = 0; run < 3; run++) {
    const g = new CCEngine.Game(lvl, { seed: run + 1 });
    let r = 12345 + run * 77 + lvl.number;
    const rand = (n) => { r = (r * 1103515245 + 12345) & 0x7fffffff; return r % n; };
    try {
      for (let t = 0; t < 3000 && g.status === 'playing'; t++) {
        if (t % 3 === 0) g.keyDown(rand(4));
        if (t % 3 === 2) for (let d = 0; d < 4; d++) g.keyUp(d);
        g.tick();
        // invariants: chip tile where chip is (unless dead/won)
        const k = g.chipY * 32 + g.chipX, top = g.top[k];
        if (g.status === 'playing' && !((top >= 0x6C && top <= 0x6F) || (top >= 0x3C && top <= 0x3F))) {
          throw new Error('chip tile missing at ' + g.chipX + ',' + g.chipY + ' top=0x' + top.toString(16) + ' bottom=0x' + g.bottom[k].toString(16) + ' tick ' + t);
        }
        for (const m of g.monsters) { const mt = g.top[m.y * 32 + m.x]; if (!(mt >= 0x40 && mt <= 0x63) && g.status === 'playing') throw new Error('monster entry without creature 0x' + mt.toString(16) + ' at ' + m.x + ',' + m.y); }
      }
    } catch (e) { errors++; if (errors < 15) console.log('level', lvl.number, lvl.title, '->', e.message); }
    if (g.status === 'won') won++; if (g.status === 'dead') dead++;
  }
}
console.log(file.split('/').pop(), 'levels', set.levels.length, 'errors', errors, 'won', won, 'dead', dead);
