// Play a level from a move string (N W S E), one tap per move. Usage: node test/route.js FILE LEVEL MOVES
require('../web/js/formats.js'); require('../web/js/engine.js');
const fs = require('fs');
const set = CCFormats.parseLevelset(fs.readFileSync(process.argv[2]));
const lvl = set.levels.find((l) => l.number === +process.argv[3]);
const g = new CCEngine.Game(lvl, { seed: 1 });
const moves = process.argv[4].replace(/\s+/g, '');
let i = 0;
for (const ch of moves) {
  const d = 'NWSE'.indexOf(ch);
  g.keyDown(d); g.keyUp(d);
  for (let t = 0; t < 2; t++) g.tick();
  let guard = 0; while (g.status === 'playing' && g.isSliding && guard++ < 60) g.tick();
  i++;
  if (g.status !== 'playing') break;
}
console.log(lvl.title, 'moves used', i, 'of', moves.length, 'status', g.status, g.deathCause || '', 'chips left', g.chipsLeft, 'at', g.chipX + ',' + g.chipY, 'time left', g.timeLeft);
process.exit(g.status === 'won' ? 0 : 1);
