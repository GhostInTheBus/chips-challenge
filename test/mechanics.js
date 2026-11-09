// Small hand built levels, one mechanic each. Run: node test/mechanics.js
require('../web/js/formats.js'); require('../web/js/engine.js');
const { Game, T } = CCEngine;
const N = 0, W = 1, S = 2, E = 3;

// Legend: chars map to [top, bottom]. Map is placed at the top left; the rest is wall.
const L = {
  '.': [T.Floor], '#': [T.Wall], c: [T.ICChip], '~': [T.Water], F: [T.Fire], B: [T.Block], d: [T.Dirt], i: [T.Ice],
  v: [T.ForceS], '^': [T.ForceN], '>': [T.ForceE], '<': [T.ForceW], X: [T.Exit], s: [T.Socket],
  R: [T.RedDoor], G: [T.GreenDoor], r: [T.RedKey], g: [T.GreenKey], f: [T.Flippers], o: [T.FireBoots], k: [T.IceSkates], u: [T.SuctionBoots],
  t: [T.Teleport], p: [T.Trap], P: [T.TrapButton], O: [T.CloneButton], M: [T.CloneMachine], Q: [T.ToggleButton], q: [T.TankButton],
  '=': [T.ToggleWall], '_': [T.ToggleFloor], h: [T.Thief], '*': [T.Bomb], w: [T.PopupWall], H: [T.HiddenWall], '1': [T.FakeFloor], '2': [T.FakeWall],
  '@': [T.ChipN + S], a: [T.IceNW], b: [T.IceNE], e: [T.IceSE], z: [T.IceSW], n: [T.PanelE],
};
function level(rows, opts = {}) {
  const top = new Uint8Array(1024).fill(T.Wall), bottom = new Uint8Array(1024);
  const monsters = [];
  rows.forEach((row, y) => [...row].forEach((ch, x) => {
    const k = y * 32 + x;
    if (opts.extra && opts.extra[ch]) { const [tt, bb] = opts.extra[ch]; top[k] = tt; bottom[k] = bb || 0; if (tt >= 0x40 && tt <= 0x63) monsters.push({ x, y }); return; }
    const v = L[ch]; if (!v) throw new Error('legend ' + ch);
    top[k] = v[0]; bottom[k] = v[1] || 0;
  }));
  return { number: 1, title: 'test', password: 'TEST', hint: 'a hint', time: opts.time || 0, chips: opts.chips || 0, top, bottom,
    traps: opts.traps || [], clones: opts.clones || [], monsters: opts.monsters || monsters };
}
// press a direction for one move and let it settle
function step(g, d, ticks = 2) { g.keyDown(d); g.keyUp(d); for (let i = 0; i < ticks; i++) g.tick(); }
function hold(g, d, ticks) { g.keyDown(d); for (let i = 0; i < ticks; i++) g.tick(); g.keyUp(d); }
function run(g, ticks) { for (let i = 0; i < ticks; i++) g.tick(); }
const at = (g) => g.chipX + ',' + g.chipY;

let pass = 0, fail = 0;
function check(name, cond, info) { if (cond) pass++; else { fail++; console.log('FAIL', name, info === undefined ? '' : info); } }

// 1. walking speed: one tile per two ticks while held
{ const g = new Game(level(['@.......#']));
  hold(g, E, 10); check('walk 10 ticks ~5 tiles', g.chipX >= 5 && g.chipX <= 6, at(g)); }

// 2. chips, socket, exit
{ const g = new Game(level(['@cc.sX'], { chips: 2 }));
  hold(g, E, 20); check('socket opens after chips, exit wins', g.status === 'won', g.status + ' ' + at(g) + ' left ' + g.chipsLeft); }
{ const g = new Game(level(['@c.sX'], { chips: 2 }));
  hold(g, E, 20); check('socket stays shut without all chips', g.status === 'playing' && g.chipX === 2, at(g)); }

// 3. keys and doors: red consumed, green kept
{ const g = new Game(level(['@rRR.']));
  hold(g, E, 12); check('one red key opens one red door', g.chipX === 2 && g.keys[1] === 0, at(g) + ' keys ' + g.keys); }
{ const g = new Game(level(['@gGG.']));
  hold(g, E, 12); check('green key opens every green door', g.chipX === 4 && g.keys[2] === 1, at(g) + ' keys ' + g.keys); }

// 4. water and fire
{ const g = new Game(level(['@~.']));
  step(g, E); check('water drowns without flippers', g.status === 'dead' && g.deathCause === 'drowned', g.status); }
{ const g = new Game(level(['@f~.']));
  hold(g, E, 8); check('flippers let Chip swim', g.status === 'playing' && g.chipX === 3, at(g) + ' ' + g.status); }
{ const g = new Game(level(['@F.']));
  step(g, E); check('fire burns without boots', g.deathCause === 'burned'); }
{ const g = new Game(level(['@oF.']));
  hold(g, E, 8); check('fire boots', g.status === 'playing' && g.chipX === 3, at(g)); }

// 5. block into water makes dirt, dirt becomes floor
{ const g = new Game(level(['@B~..']));
  step(g, E); check('block into water -> dirt', g.top[2] === T.Dirt, '0x' + g.top[2].toString(16));
  hold(g, E, 6); check('Chip clears dirt', g.chipX >= 2 && g.bottom[g.chipX] !== T.Dirt, at(g)); }
{ const g = new Game(level(['@BB.']));
  step(g, E); check('cannot push two blocks', g.chipX === 0, at(g)); }

// 6. ice: slides, bounces off a wall back onto the floor
{ const g = new Game(level(['@.iii#']));
  step(g, E, 1); step(g, E, 1); run(g, 12);
  check('ice slide bounces back to floor', g.chipX === 1 && !g.sliding, at(g) + ' sliding ' + g.sliding); }
{ const g = new Game(level(['@kiii.']));
  hold(g, E, 12); check('skates walk on ice', g.chipX === 5, at(g)); }
// ice corner turns the slide
{ const g = new Game(level(['@ib', '##.', '##.']));
  // moving east into IceNE (walls N,E) turns south
  step(g, E, 1); run(g, 6);
  check('ice corner NE turns east movement south', g.chipX === 2 && g.chipY === 1, at(g)); }

// 7. force floors push, Chip can step off sideways
{ const g = new Game(level(['@>>>.']));
  step(g, E, 1); run(g, 6); check('force floor carries Chip', g.chipX === 4, at(g)); }
{ const g = new Game(level(['@>>>>>.', '###.###']));
  step(g, E, 1); let n = 0; while (g.chipX < 3 && n++ < 10) g.tick(); step(g, S, 2);
  check('override off a force floor', g.chipY === 1 && g.chipX === 3, at(g)); }
{ const g = new Game(level(['@>>>>>.', '#####.#']));
  step(g, E, 1); g.keyDown(S); run(g, 10); g.keyUp(S);
  check('held key keeps trying to leave a force floor', g.chipY === 1 && g.chipX === 5, at(g)); }
{ const g = new Game(level(['@.......#']));
  g.keyDown(E); g.tick(); g.keyUp(E); run(g, 6);
  check('a short tap is one step', g.chipX === 1, at(g)); }
{ const g = new Game(level(['@u>>>.']));
  hold(g, E, 4); g.keyUp(E); run(g, 4); check('suction boots stop the push', g.chipX <= 3, at(g)); }

// 8. teleport: east into the later teleport comes out of the earlier one
{ const g = new Game(level(['.t..', '####', '@.t.']));
  step(g, E, 2); step(g, E, 1); run(g, 6);
  check('teleport sends Chip to the previous teleport', g.chipY === 0 && g.chipX === 2, at(g)); }

// 9. trap held open by a block on its button
{ const g = new Game(level(['@p..', '####', 'P...'], { traps: [{ bx: 0, by: 2, tx: 1, ty: 0 }] }));
  hold(g, E, 10); check('trap holds Chip', g.chipX === 1, at(g)); }
{ const g = new Game(level(['@p..', '####', 'P...'], { traps: [{ bx: 0, by: 2, tx: 1, ty: 0 }], extra: { P: [T.Block, T.TrapButton] } }));
  hold(g, E, 10); check('trap opens while its button is held', g.chipX === 3, at(g)); }

// 10. creatures: bug follows the left wall, tank turns on blue button
{ const g = new Game(level(['@#####', '#....#', '#.b..#', '#....#', '######'], { extra: { b: [T.Bug + N, T.Floor] } }));
  const k0 = 2 * 32 + 2; run(g, 2);
  check('bug moves', g.top[k0] !== T.Bug + N, 'still there'); }
{ const g = new Game(level(['@q.', '###', 'm..', '###'], { extra: { m: [T.Tank + E, T.Floor] } }));
  run(g, 4); const before = g.monsters[0].x;
  step(g, E, 1); run(g, 1);
  check('tank turned around by blue button', (g.top[g.monsters[0].y * 32 + g.monsters[0].x] & 3) === W, 'x ' + before + '->' + g.monsters[0].x); }
// fire: bugs blocked, fireballs cross, balls burn
{ const g = new Game(level(['@#####', 'bF....', '######'], { extra: { b: [T.Bug + E, T.Floor] } }));
  run(g, 8); check('bug will not enter fire', g.monsters.length === 1 && g.monsters[0].x === 0, JSON.stringify(g.monsters)); }
{ const g = new Game(level(['@#####', 'mF...#', '######'], { extra: { m: [T.Fireball + E, T.Floor] } }));
  run(g, 8); check('fireball crosses fire', g.monsters.length === 1 && g.monsters[0].x >= 2, JSON.stringify(g.monsters)); }
{ const g = new Game(level(['@#####', 'mF...#', '######'], { extra: { m: [T.Ball + E, T.Floor] } }));
  run(g, 8); check('ball burns in fire', g.monsters.length === 0, JSON.stringify(g.monsters)); }
{ const g = new Game(level(['@#####', 'm~...#', '######'], { extra: { m: [T.Glider + E, T.Floor] } }));
  run(g, 8); check('glider crosses water', g.monsters.length === 1 && g.monsters[0].x >= 2, JSON.stringify(g.monsters)); }

// 11. clone machine: red button clones the fireball sitting on it
{ const g = new Game(level(['@O..', '####', 'M...'], { clones: [{ bx: 1, by: 0, tx: 0, ty: 2 }], extra: { M: [T.Fireball + E, T.CloneMachine] }, monsters: [] }));
  step(g, E, 1); run(g, 1);
  check('red button clones a creature', g.monsters.length === 1 && g.top[2 * 32] === T.Fireball + E, g.monsters.length + ' top 0x' + g.top[64].toString(16)); }

// 12. toggle walls
{ const g = new Game(level(['@Q=_.']));
  step(g, E); check('green button toggles walls', g.top[2] === T.ToggleFloor && g.top[3] === T.ToggleWall); }

// 13. thief takes boots, keeps keys
{ const g = new Game(level(['@frh.']));
  hold(g, E, 8); check('thief takes boots not keys', g.boots[0] === 0 && g.keys[1] === 1, g.boots + ' ' + g.keys); }

// 14. popup wall, hidden wall, fake walls
{ const g = new Game(level(['@w.']));
  hold(g, E, 6); check('popup wall closes behind', g.chipX === 2 && g.top[1] === T.Wall, at(g)); }
{ const g = new Game(level(['@H.']));
  step(g, E); check('hidden wall appears and blocks', g.chipX === 0 && g.top[1] === T.Wall); }
{ const g = new Game(level(['@1.']));
  step(g, E); check('0x1E blue wall gives way', g.chipX === 1); }
{ const g = new Game(level(['@2.']));
  step(g, E); check('0x1F blue wall is real', g.chipX === 0 && g.top[1] === T.Wall); }

// 15. bombs
{ const g = new Game(level(['@B*.']));
  step(g, E); check('block on a bomb clears both', g.top[2] === T.Floor && g.chipX === 1, '0x' + g.top[2].toString(16)); }
{ const g = new Game(level(['@*.']));
  step(g, E); check('bomb kills Chip', g.deathCause === 'bombed'); }

// 16. a creature walking into Chip
{ const g = new Game(level(['@.m'], { extra: { m: [T.Ball + W, T.Floor] } }));
  run(g, 6); check('creature kills Chip', g.status === 'dead' && g.deathCause === 'eaten', g.status); }

// 17. timer
{ const g = new Game(level(['@....'], { time: 2 }));
  step(g, E); run(g, 25); check('out of time', g.deathCause === 'time' && g.timeLeft === 0, g.timeLeft + ' ' + g.deathCause); }

// 18. thin wall
{ const g = new Game(level(['@n.']));
  hold(g, E, 6); check('thin east wall blocks leaving east', g.chipX === 1, at(g)); }

// 19. hint shows on the hint square
{ const g = new Game(level(['@h.'], { extra: { h: [T.Hint, 0] } }));
  step(g, E); check('hint text shows', g.hint === 'a hint', g.hint); }

// 20. score
{ const s = CCEngine.score(10, 50, 0), s2 = CCEngine.score(1, 0, 3), s3 = CCEngine.score(10, 0, 2);
  check('score first try', s.total === 500 + 5000, JSON.stringify(s));
  check('score floor stops under 500', s2.level === 400, JSON.stringify(s2));
  check('score two restarts', s3.level === 3200, JSON.stringify(s3)); }

console.log('pass', pass, 'fail', fail);
process.exit(fail ? 1 : 0);
