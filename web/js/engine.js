// engine.js
// Chip's Challenge game rules, following the 1992 Windows version (MSCC).
//
// Reverse engineered from CHIPS.EXE via the community disassembly
// (github.com/magical/CHIPS.EXE): TileTable, DoTick, MoveChip, MoveBlock,
// MoveMonster, MonsterLoop, SlipLoop, SlideMovement, EnterTeleport, the trap
// and clone routines, InitBoard and the score dialog. Method names below
// match the disassembly so each piece can be checked against it.
// docs/RULES.md has the full write up with line references.
//
// No DOM here. The web page and the Mac app both run this same file.
(function (root) {
  'use strict';

  // ------------------------------------------------------------ tiles
  const T = {
    Floor: 0x00, Wall: 0x01, ICChip: 0x02, Water: 0x03, Fire: 0x04, InvisibleWall: 0x05,
    PanelN: 0x06, PanelW: 0x07, PanelS: 0x08, PanelE: 0x09, Block: 0x0A, Dirt: 0x0B, Ice: 0x0C,
    ForceS: 0x0D, BlockN: 0x0E, BlockW: 0x0F, BlockS: 0x10, BlockE: 0x11, ForceN: 0x12, ForceE: 0x13, ForceW: 0x14,
    Exit: 0x15, BlueDoor: 0x16, RedDoor: 0x17, GreenDoor: 0x18, YellowDoor: 0x19,
    IceNW: 0x1A, IceNE: 0x1B, IceSE: 0x1C, IceSW: 0x1D, FakeFloor: 0x1E, FakeWall: 0x1F,
    Thief: 0x21, Socket: 0x22, ToggleButton: 0x23, CloneButton: 0x24, ToggleWall: 0x25, ToggleFloor: 0x26,
    TrapButton: 0x27, TankButton: 0x28, Teleport: 0x29, Bomb: 0x2A, Trap: 0x2B, HiddenWall: 0x2C, Gravel: 0x2D,
    PopupWall: 0x2E, Hint: 0x2F, PanelSE: 0x30, CloneMachine: 0x31, ForceRandom: 0x32,
    ChipSplash: 0x33, ChipBurned: 0x34, ChipBombed: 0x35, ChipExit: 0x39, Exit2: 0x3A, Exit3: 0x3B,
    SwimN: 0x3C, Bug: 0x40, Fireball: 0x44, Ball: 0x48, Tank: 0x4C, Glider: 0x50, Teeth: 0x54, Walker: 0x58,
    Blob: 0x5C, Paramecium: 0x60, BlueKey: 0x64, RedKey: 0x65, GreenKey: 0x66, YellowKey: 0x67,
    Flippers: 0x68, FireBoots: 0x69, IceSkates: 0x6A, SuctionBoots: 0x6B, ChipN: 0x6C,
  };
  // Sound effect ids, in the original's order (blip2, door, bummer, ditty1, chimes, oof3, strike, ...)
  const SND = { Tool: 0, Door: 1, Death: 2, Win: 3, Socket: 4, Oof: 5, Thief: 6, Chip: 8, Button: 9, Splash: 10, Bomb: 11, Teleport: 12, Tick: 13, TimeUp: 14 };

  // Directions: 0 N, 1 W, 2 S, 3 E (the order tile ids use). -1 means no direction, (0,0).
  const DX = [0, -1, 0, 1], DY = [-1, 0, 1, 0];
  const left = (d) => (d < 0 ? d : (d + 1) & 3);
  const right = (d) => (d < 0 ? d : (d + 3) & 3);
  const back = (d) => (d < 0 ? d : (d + 2) & 3);
  const setDir = (t, d) => (d < 0 ? t : (t & 0xFC) | d);

  // TileTable (data.asm). Per tile, for Chip, blocks and monsters: [can, action].
  // can: 0 blocked, 1 yes, 2 depends. Actions: Chip 0 replace, 1 pick up,
  // 2 dies, 3 replace (tile used up), 4 push down, 5 slide, 6 trap, 7 teleport.
  // Blocks and monsters: 0/1 push down, 2 water (dirt / drown), 4 slide,
  // 5 bomb, 6 trap, 7 teleport.
  const TABLE = [
    [1, 0, 1, 0, 1, 1], [0, 0, 0, 0, 0, 0], [1, 1, 0, 0, 0, 0], [2, 2, 1, 2, 2, 2], [2, 2, 1, 1, 2, 2], [0, 0, 0, 0, 0, 0],
    [2, 4, 2, 1, 2, 1], [2, 4, 2, 1, 2, 1], [2, 4, 2, 1, 2, 1], [2, 4, 2, 1, 2, 1], [2, 0, 0, 0, 0, 0], [1, 3, 0, 0, 0, 0],
    [2, 5, 1, 4, 1, 4], [2, 5, 1, 4, 1, 4], [0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0],
    [2, 5, 1, 4, 1, 4], [2, 5, 1, 4, 1, 4], [2, 5, 1, 4, 1, 4], [1, 4, 1, 1, 0, 0], [2, 3, 0, 0, 0, 0], [2, 3, 0, 0, 0, 0],
    [2, 3, 0, 0, 0, 0], [2, 3, 0, 0, 0, 0], [2, 5, 2, 4, 2, 4], [2, 5, 2, 4, 2, 4], [2, 5, 2, 4, 2, 4], [2, 5, 2, 4, 2, 4],
    [2, 0, 0, 0, 0, 0], [2, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0], [2, 4, 0, 0, 0, 0], [2, 3, 0, 0, 0, 0], [1, 4, 1, 1, 1, 1],
    [1, 4, 1, 1, 1, 1], [0, 0, 0, 0, 0, 0], [1, 4, 1, 1, 1, 1], [1, 4, 1, 1, 1, 1], [1, 4, 1, 1, 1, 1], [1, 7, 1, 7, 1, 7],
    [1, 2, 1, 5, 1, 5], [1, 6, 1, 6, 1, 6], [2, 0, 0, 0, 0, 0], [1, 4, 1, 1, 0, 0], [2, 4, 0, 0, 0, 0], [1, 4, 1, 1, 1, 1],
    [2, 4, 2, 1, 2, 1], [0, 0, 0, 0, 0, 0], [2, 5, 1, 4, 0, 0], [0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0],
    [0, 0, 1, 1, 1, 0], [0, 0, 1, 1, 1, 0], [0, 0, 1, 1, 1, 0], [0, 0, 1, 1, 1, 0],
  ];
  for (let i = 0x40; i <= 0x63; i++) TABLE[i] = [2, 2, 0, 0, 0, 0];   // creatures
  for (let i = 0x64; i <= 0x67; i++) TABLE[i] = [2, 1, 1, 1, 1, 1];   // keys
  for (let i = 0x68; i <= 0x6B; i++) TABLE[i] = [2, 1, 1, 1, 0, 0];   // boots
  for (let i = 0x6C; i <= 0x6F; i++) TABLE[i] = [0, 0, 1, 1, 1, 0];   // Chip
  const row = (t) => TABLE[t] || [0, 0, 0, 0, 0, 0];

  const isCreature = (t) => t >= 0x40 && t <= 0x63;
  const isChipTile = (t) => (t >= 0x6C && t <= 0x6F) || (t >= 0x3C && t <= 0x3F);
  const isIceCorner = (t) => t >= T.IceNW && t <= T.IceSW;
  const isIce = (t) => t === T.Ice || isIceCorner(t);
  const isForce = (t) => t === T.ForceN || t === T.ForceS || t === T.ForceE || t === T.ForceW || t === T.ForceRandom;
  const isPanel = (t) => (t >= T.PanelN && t <= T.PanelE) || t === T.PanelSE;
  const isButton = (t) => t === T.ToggleButton || t === T.CloneButton || t === T.TrapButton || t === T.TankButton;
  const kindOf = (t) => (t - 0x40) >> 2;
  const K = { Bug: 0, Fireball: 1, Ball: 2, Tank: 3, Glider: 4, Teeth: 5, Walker: 6, Blob: 7, Paramecium: 8 };

  // CheckPanelWalls. Walled sides as bits (1 << direction).
  function walls(t) {
    switch (t) {
      case T.PanelN: return 1; case T.PanelW: return 2; case T.PanelS: return 4; case T.PanelE: return 8;
      case T.PanelSE: return 4 | 8;
      case T.IceNW: return 1 | 2; case T.IceNE: return 1 | 8; case T.IceSE: return 4 | 8; case T.IceSW: return 4 | 2;
      default: return 0;
    }
  }
  // entering moving d means coming in through side back(d)
  const panelEnter = (t, d) => !(walls(t) & (1 << back(d)));
  // only thin walls are checked on the way out; ice corners never are
  const panelLeave = (t, d) => !isPanel(t) || !(walls(t) & (1 << d));

  // ------------------------------------------------------------ random
  // The C runtime rand() the game links: seed*0x343FD + 0x269EC3, bits 16-30.
  function makeRand(seed) {
    let s = seed >>> 0;
    return (n) => { s = (Math.imul(s, 0x343FD) + 0x269EC3) >>> 0; return ((s >>> 16) & 0x7FFF) % n; };
  }

  // ------------------------------------------------------------ scoring
  // COMPLETEMSGPROC: time bonus 10 per second left; level bonus 500 x level,
  // cut to 4/5 per restart, stopping once it first drops under 500.
  function score(levelNumber, timeLeft, restarts) {
    const time = Math.max(0, timeLeft | 0) * 10;
    let level = 500 * levelNumber;
    for (let i = 0; i < restarts; i++) {
      level = Math.trunc((level * 4) / 5);
      if (level < 500) break;
    }
    const message = restarts === 0 ? 'Yowser! First Try!' : restarts < 3 ? 'Go Bit Buster!' : restarts < 5 ? 'Finished! Good Work!' : 'At last! You did it!';
    return { time, level, total: time + level, message };
  }

  // ------------------------------------------------------------ game
  class Game {
    constructor(level, opts) {
      opts = opts || {};
      this.level = level;
      this.top = Uint8Array.from(level.top);
      this.bottom = Uint8Array.from(level.bottom);
      this.chipsLeft = level.chips;
      this.timeLeft = level.time > 0 ? level.time : null;
      this.keys = [0, 0, 0, 0];
      this.boots = [0, 0, 0, 0];
      this.tickCount = 0;
      this.status = 'playing';
      this.deathCause = null;
      this.sounds = [];
      this.rand = makeRand(opts.seed != null ? opts.seed : (Date.now() & 0x7FFFFFFF));
      this.chipX = 0; this.chipY = 0;
      this.isSliding = false; this.slide = 0;
      this.hasMoved = false; this.buffered = -1; this.held = []; this.idle = 0;
      this.steps = 0;
      this.monsters = [];   // { tile, x, y, dir, slipping }
      this.slips = [];      // { x, y, dir, isMonster }
      this.toggles = []; this.teleports = [];
      this.traps = (level.traps || []).map((t) => ({ bx: t.bx, by: t.by, tx: t.tx, ty: t.ty, flag: t.flag | 0 }));
      this.clones = (level.clones || []).map((t) => ({ bx: t.bx, by: t.by, tx: t.tx, ty: t.ty }));
      this.initBoard();
    }

    // ---------------------------------------------------------- InitBoard
    initBoard() {
      for (const p of this.level.monsters || []) {
        if (p.x > 31 || p.y > 31) continue;
        const t = this.top[p.y * 32 + p.x];
        if (isCreature(t)) this.newMonster(t, p.x, p.y, t & 3, false);
      }
      let chip = -1;
      for (let k = 0; k < 1024; k++) {
        let t = this.top[k];
        if (isCreature(t)) t = this.bottom[k];
        if (t === T.ToggleWall || t === T.ToggleFloor) this.toggles.push(k);
        else if (t === T.Teleport) this.teleports.push(k);
        else if (t >= 0x6C && t <= 0x6F) chip = k;   // the last Chip found wins
      }
      if (chip >= 0) { this.chipX = chip & 31; this.chipY = chip >> 5; }
    }

    newMonster(tile, x, y, dir, cloning) {
      const k = y * 32 + x;
      if (!cloning && this.bottom[k] === T.CloneMachine) return null;   // templates never join the list
      const m = { tile, x, y, dir, slipping: false };
      this.monsters.push(m);
      if (this.bottom[k] === T.Trap) this.enterTrap(x, y, -1, -1);
      if (isChipTile(this.bottom[k])) this.die('eaten');
      return m;
    }

    // ---------------------------------------------------------- outside API
    get hint() {
      if (this.status !== 'playing') return null;
      return this.bottom[this.chipY * 32 + this.chipX] === T.Hint ? (this.level.hint || '') : null;
    }
    keyDown(d) {
      if (this.status !== 'playing') return;
      this.held = this.held.filter((h) => h.d !== d); this.held.push({ d, t: this.tickCount });
      this.moveChip(d, true, true);
    }
    keyUp(d) { this.held = this.held.filter((h) => h.d !== d); }
    // Windows keyboard autorepeat. CHIPS.EXE sets the shortest repeat delay
    // (about 250 ms); each repeat is a fresh keypress handled between ticks.
    // Checked after each tick: every tick while sliding, so a held key tries to
    // step off a force floor at every square, and after even ticks otherwise,
    // which gives the steady one step per two ticks without double steps.
    autorepeat() {
      const h = this.held[this.held.length - 1];
      if (!h || !this.alive || this.tickCount - h.t < 2) return;
      if (!this.isSliding && (this.tickCount & 1)) return;
      this.moveChip(h.d, true, true);
    }
    drainSounds() { const s = this.sounds; this.sounds = []; return s; }
    snd(id) { this.sounds.push(id); }
    viewport() { return { x: Math.max(0, Math.min(23, this.chipX - 4)), y: Math.max(0, Math.min(23, this.chipY - 4)) }; }
    die(cause) { if (this.status === 'playing') { this.status = 'dead'; this.deathCause = cause; this.held = []; this.buffered = -1; } }
    get alive() { return this.status === 'playing'; }

    // ---------------------------------------------------------- layer ops
    pop(k) { this.top[k] = this.bottom[k]; this.bottom[k] = T.Floor; }
    pushDown(k, mover) { this.bottom[k] = this.top[k]; this.top[k] = mover; }
    chipTile(k, d) { return setDir(this.bottom[k] === T.Water ? T.SwimN : T.ChipN, d); }

    // ---------------------------------------------------------- lists
    findMonster(x, y) { return this.monsters.findIndex((m) => m.x === x && m.y === y); }
    findSlip(x, y) { return this.slips.findIndex((s) => s.x === x && s.y === y); }
    deleteSlipAt(x, y) {
      const i = this.findSlip(x, y); if (i < 0) return;
      const s = this.slips.splice(i, 1)[0];
      if (s.isMonster) { const mi = this.findMonster(x, y); if (mi >= 0) this.monsters[mi].slipping = false; }
    }

    // SlideMovement: the slide direction for whatever just moved from (sx,sy)
    // onto (dx,dy), recorded in Chip's slide state or the slip list.
    // who: 'chip' | 'block' | 'monster'. facing: the monster tile, or -1.
    slideMovement(sx, sy, dx, dy, dir, who, facing) {
      const dk = dy * 32 + dx;
      let t = (sx === dx && sy === dy) ? this.bottom[dk] : this.top[dk];
      if (isChipTile(t)) t = this.bottom[dk];
      let out;
      switch (t) {
        case T.Ice: case T.Teleport: case T.Trap: out = dir; break;
        case T.ForceN: out = 0; break; case T.ForceS: out = 2; break; case T.ForceE: out = 3; break; case T.ForceW: out = 1; break;
        case T.ForceRandom: out = [0, 2, 1, 3][this.rand(4)]; break;
        case T.IceNW: out = dir === 1 ? 2 : dir === 0 ? 3 : back(dir); break;
        case T.IceNE: out = dir === 0 ? 1 : dir === 3 ? 2 : back(dir); break;
        case T.IceSE: out = dir === 2 ? 1 : dir === 3 ? 0 : back(dir); break;
        case T.IceSW: out = dir === 1 ? 0 : dir === 2 ? 3 : back(dir); break;
        default: out = who === 'chip' ? this.slide : dir;
      }
      if (who === 'chip') { this.isSliding = true; this.slide = out; return out; }
      let i = this.findSlip(sx, sy);
      if (i < 0) { this.slips.push({ x: sx, y: sy, dir: out, isMonster: false }); i = this.slips.length - 1; }
      const s = this.slips[i];
      s.x = dx; s.y = dy; s.dir = out; s.isMonster = who === 'monster';
      if (who === 'monster') {
        const mi = this.findMonster(sx, sy);
        if (mi >= 0) { if (facing >= 0) this.monsters[mi].tile = facing; this.monsters[mi].slipping = true; }
      }
      return out;
    }

    // ---------------------------------------------------------- traps
    // Trap records: flag 1 closed, 0 open. No record at all = holds forever.
    findTrap(x, y) { return this.traps.findIndex((t) => t.tx === x && t.ty === y); }
    trapSpan(x, y) {
      const out = []; let i = this.findTrap(x, y);
      while (i >= 0 && i < this.traps.length && this.traps[i].tx === x && this.traps[i].ty === y) out.push(i++);
      return out;
    }
    trapHolds(x, y) { const t = this.findTrap(x, y); return t < 0 || this.traps[t].flag === 1; }
    pressTrapButton(bx, by) {
      const c = this.traps.find((t) => t.bx === bx && t.by === by);
      if (!c) return;
      for (const i of this.trapSpan(c.tx, c.ty)) this.traps[i].flag = 0;
    }
    // Something entering a trap closes it, unless a linked button is held down.
    enterTrap(x, y, fx, fy) {
      const span = this.trapSpan(x, y);
      let held = false;
      for (const i of span) {
        const tr = this.traps[i];
        if (this.top[tr.by * 32 + tr.bx] !== T.TrapButton && !(tr.bx === fx && tr.by === fy)) held = true;
      }
      for (const i of span) this.traps[i].flag = held ? 0 : 1;
    }

    // ---------------------------------------------------------- buttons
    pressButton(t, x, y) {
      this.snd(SND.Button);
      if (t === T.ToggleButton) {
        for (const k of this.toggles) {
          if (this.top[k] === T.ToggleWall) this.top[k] = T.ToggleFloor; else if (this.top[k] === T.ToggleFloor) this.top[k] = T.ToggleWall;
          if (this.bottom[k] === T.ToggleWall) this.bottom[k] = T.ToggleFloor; else if (this.bottom[k] === T.ToggleFloor) this.bottom[k] = T.ToggleWall;
        }
      } else if (t === T.TankButton) {
        // PressTankButton turns every tank in the list around, by its tile facing
        for (const m of this.monsters) {
          if (m.tile < T.Tank || m.tile > T.Tank + 3) continue;
          const d = back(m.tile & 3);
          m.dir = d; m.tile = setDir(m.tile, d);
          this.top[m.y * 32 + m.x] = m.tile;
        }
      } else if (t === T.TrapButton) {
        this.pressTrapButton(x, y);
      } else if (t === T.CloneButton) {
        this.pressCloneButton(x, y);
      }
    }

    // PressCloneButton: a creature template is activated in place and walks
    // out on the next MonsterLoop; a block template pushes a new block out now.
    pressCloneButton(bx, by) {
      const c = this.clones.find((e) => e.bx === bx && e.by === by);
      if (!c) return;
      const t = this.top[c.ty * 32 + c.tx];
      if (isCreature(t)) {
        const d = t & 3, fx = c.tx + DX[d], fy = c.ty + DY[d];
        if (fx < 0 || fy < 0 || fx > 31 || fy > 31) return;
        if (!this.monsterCanEnter(t, fx, fy, d).can && this.top[fy * 32 + fx] !== t) return;
        if (this.findMonster(c.tx, c.ty) >= 0) return;   // one waiting clone per machine
        this.newMonster(t, c.tx, c.ty, d, true);
      } else {
        const d = (t >= T.BlockN && t <= T.BlockE) ? t - T.BlockN : -1;
        if (d < 0) return;   // the original reads an undefined direction here
        const fx = c.tx + DX[d], fy = c.ty + DY[d];
        if (fx < 0 || fy < 0 || fx > 31 || fy > 31) return;
        if (!this.blockCanEnter(fx, fy, d).can) return;
        this.moveBlock(c.tx, c.ty, d, T.Block, null);
      }
    }

    // ---------------------------------------------------------- teleports
    // EnterTeleport: walk backwards through the teleport list from the one
    // entered, wrapping, to the first free teleport whose far side the
    // traveller could step onto. Returns the square to land on.
    enterTeleport(k, d, who) {
      const n = this.teleports.length, i = this.teleports.indexOf(k);
      if (i < 0 || n < 2) return k;
      for (let j = (i - 1 + n) % n; j !== i; j = (j - 1 + n) % n) {
        const t = this.teleports[j];
        if (this.top[t] !== T.Teleport) continue;
        const ex = (t & 31) + DX[d], ey = (t >> 5) + DY[d];
        if (ex < 0 || ey < 0 || ex > 31 || ey > 31) continue;
        let ok;
        if (who === 'chip') {
          if (this.top[ey * 32 + ex] === T.Block && !this.moveBlock(ex, ey, d, null, null)) continue;
          ok = this.chipCanEnter(ex, ey, d, false).can;
          if (ok) this.snd(SND.Teleport);
        } else if (who === 'block') ok = this.blockCanEnter(ex, ey, d).can;
        else ok = this.monsterCanEnter(T.Teleport, ex, ey, d).can;   // the original passes the teleport id here
        if (ok) return t;
      }
      return k;
    }

    // ---------------------------------------------------------- Chip
    // ChipCanEnterTile. effects: doors open, blue walls resolve, the thief steals.
    chipCanEnter(x, y, d, effects) {
      const k = y * 32 + x;
      if (this.bottom[k] === T.CloneMachine) return { can: false, action: 0 };
      const t = this.top[k], r = row(t);
      if (r[0] === 1) return { can: true, action: r[1] };
      if (r[0] !== 2) return { can: false, action: 0 };
      if (isCreature(t) || (t >= 0x64 && t <= 0x6F) || t === T.Block) {
        return { can: this.chipCanEnterTile(this.bottom[k], k, d, false).can, action: r[1] };
      }
      return this.chipCanEnterTile(t, k, d, effects);
    }
    chipCanEnterTile(t, k, d, effects) {
      const r = row(t);
      if (r[0] === 1) return { can: true, action: r[1] };
      if (r[0] !== 2) return { can: false, action: 0 };
      const has = (i) => this.boots[i] > 0;
      switch (t) {
        case T.Water: return { can: true, action: has(0) ? 4 : 2 };
        case T.Fire: return { can: true, action: has(1) ? 4 : 2 };
        case T.Ice: return { can: true, action: has(2) ? 4 : 5 };
        case T.ForceN: case T.ForceS: case T.ForceE: case T.ForceW: case T.ForceRandom: return { can: true, action: has(3) ? 4 : 5 };
        case T.PanelN: case T.PanelW: case T.PanelS: case T.PanelE: case T.PanelSE: return { can: panelEnter(t, d), action: 4 };
        case T.IceNW: case T.IceNE: case T.IceSE: case T.IceSW: return { can: panelEnter(t, d), action: has(2) ? 4 : 5 };
        case T.BlueDoor: case T.RedDoor: case T.GreenDoor: case T.YellowDoor: {
          const i = t - T.BlueDoor;
          if (!this.keys[i]) return { can: false, action: 0 };
          if (effects) { if (i !== 2) this.keys[i]--; this.snd(SND.Door); }   // green keys are never used up
          return { can: true, action: 3 };
        }
        case T.FakeFloor:
          if (effects) this.top[k] = T.Floor;
          return { can: true, action: 0 };
        case T.FakeWall: case T.HiddenWall:
          if (effects) this.top[k] = T.Wall;
          return { can: false, action: 0 };
        case T.Thief:
          if (effects) { this.snd(SND.Thief); this.boots = [0, 0, 0, 0]; }   // boots only, keys stay
          return { can: true, action: 4 };
        case T.Socket:
          if (this.chipsLeft > 0) return { can: false, action: 0 };
          if (effects) this.snd(SND.Socket);
          return { can: true, action: 3 };
        case T.PopupWall:
          if (effects) this.top[k] = T.Wall;
          return { can: true, action: 4 };
        default: return { can: false, action: 0 };
      }
    }

    // MoveChip(dir, voluntary, sound). Returns true if Chip moved.
    moveChip(d, voluntary, sound) {
      if (!this.alive) return false;
      if (voluntary) {
        // one voluntary move per turn; the next key waits in a one slot buffer
        if (this.hasMoved) { if (this.buffered < 0) this.buffered = d; return false; }
        this.buffered = -1;
        this.hasMoved = true;
      }
      this.idle = 0;
      const x = this.chipX, y = this.chipY, k = y * 32 + x;
      const nx = x + DX[d], ny = y + DY[d], n = ny * 32 + nx;
      const blocked = () => {
        this.top[k] = this.chipTile(k, d);
        if (sound) this.snd(SND.Oof);
        return false;
      };
      if (nx < 0 || ny < 0 || nx > 31 || ny > 31) return blocked();
      const tile2 = this.bottom[k];
      if (this.isSliding && voluntary) {
        if (isIce(tile2) || tile2 === T.Teleport) return false;   // no steering on ice
        if (isForce(tile2) && d === this.slide) return false;     // any other way off a force floor is fine
      }
      if (tile2 === T.Trap && this.trapHolds(x, y)) return blocked();
      if (!panelLeave(tile2, d)) return blocked();
      const deferred = [];
      if (this.top[n] === T.Block) {
        const s = this.findSlip(nx, ny);
        if (s >= 0 && (this.slips[s].dir === d || this.slips[s].dir === back(d))) return blocked();
        const ok = this.moveBlock(nx, ny, d, null, deferred);
        if (!this.alive) return false;
        if (!ok) return blocked();
      }
      const ce = this.chipCanEnter(nx, ny, d, true);
      if (!ce.can) return blocked();
      this.pop(k);
      let action = ce.action, dir = d, dest = n;
      const target = this.top[n];
      switch (action) {
        case 1:
          if (target === T.ICChip) { if (this.chipsLeft > 0) this.chipsLeft--; this.snd(SND.Chip); }
          else if (target >= 0x64 && target <= 0x67) { this.keys[target - 0x64] = Math.min(255, this.keys[target - 0x64] + 1); this.snd(SND.Tool); }
          else if (target >= 0x68 && target <= 0x6B) { this.boots[target - 0x68] = Math.min(255, this.boots[target - 0x68] + 1); this.snd(SND.Tool); }
          break;
        case 2: return this.chipDies(n, target, d);
        case 5:
          dir = this.slideMovement(x, y, nx, ny, d, 'chip');
          if (this.buffered >= 0 && target !== tile2 && this.buffered === back(dir)) { this.hasMoved = true; this.buffered = -1; }
          break;
        case 6: this.enterTrap(nx, ny, x, y); break;
        case 7:
          dest = this.enterTeleport(n, d, 'chip');
          dir = this.slideMovement(x, y, dest & 31, dest >> 5, d, 'chip');
          action = 5;
          break;
      }
      // replace (0, 1, 3) leaves the lower layer alone; everything else pushes down
      if (action !== 0 && action !== 1 && action !== 3) this.bottom[dest] = this.top[dest];
      this.chipX = dest & 31; this.chipY = dest >> 5;
      this.top[dest] = this.chipTile(dest, dir);
      const under = this.bottom[dest];
      if (action === 4 && isButton(under)) this.pressButton(under, this.chipX, this.chipY);
      for (const b of deferred) this.pressButton(this.bottom[b.y * 32 + b.x], b.x, b.y);
      if (this.isSliding && action !== 5) this.isSliding = false;
      this.steps++;
      if (under === T.Exit) {
        this.top[dest] = T.ChipExit; this.isSliding = false; this.status = 'won';
        this.snd(SND.Win);
      }
      return true;
    }

    chipDies(n, target, d) {
      this.chipX = n & 31; this.chipY = n >> 5;
      this.bottom[n] = target;
      this.top[n] = target === T.Water ? T.ChipSplash : target === T.Fire ? T.ChipBurned : target === T.Bomb ? T.ChipBombed : setDir(T.ChipN, d);
      if (target === T.Water) this.snd(SND.Splash);
      if (target === T.Bomb) { this.snd(SND.Bomb); this.bottom[n] = T.Floor; }
      this.isSliding = false;
      this.die(target === T.Bomb ? 'bombed' : target === T.Water ? 'drowned' : target === T.Fire ? 'burned' : 'eaten');
      return false;
    }

    // ---------------------------------------------------------- blocks
    blockCanEnter(x, y, d) {
      const k = y * 32 + x;
      if (this.bottom[k] === T.CloneMachine) return { can: false, action: 0 };
      const t = this.top[k], r = row(t);
      if (r[2] === 1) return { can: true, action: r[3] };
      if (r[2] === 2) return { can: panelEnter(t, d), action: r[3] };
      return { can: false, action: 0 };
    }

    // MoveBlock(src, dir, blockTile, deferred). blockTile is set for clone
    // spawns. deferred (an array) is given when Chip pushes, so a button the
    // block lands on is pressed after Chip's own move.
    moveBlock(sx, sy, d, blockTile, deferred) {
      const s = sy * 32 + sx;
      const nx = sx + DX[d], ny = sy + DY[d];
      const fail = () => { if (this.slips.length) this.deleteSlipAt(sx, sy); return false; };
      if (nx < 0 || ny < 0 || nx > 31 || ny > 31) return fail();
      const under = this.bottom[s];
      if (under === T.Trap && this.trapHolds(sx, sy)) return fail();
      if (!panelLeave(under, d)) return fail();
      const be = this.blockCanEnter(nx, ny, d);
      if (!be.can) return fail();
      const n = ny * 32 + nx;
      let tile = blockTile != null ? blockTile : this.top[s];
      let action = be.action, dest = n, push = false;
      switch (action) {
        case 1: push = true; break;
        case 2: this.snd(SND.Splash); tile = T.Dirt; break;
        case 4: this.slideMovement(sx, sy, nx, ny, d, 'block', -1); push = true; break;
        case 5: this.snd(SND.Bomb); tile = T.Floor; break;
        case 6:
          if (this.findSlip(sx, sy) >= 0) this.slideMovement(sx, sy, nx, ny, d, 'block', -1);
          this.enterTrap(nx, ny, sx, sy); push = true; break;
        case 7:
          dest = this.enterTeleport(n, d, 'block');
          this.slideMovement(sx, sy, dest & 31, dest >> 5, d, 'block', -1);
          push = true; action = 4; break;
      }
      if (action !== 4 && action !== 6) this.deleteSlipAt(sx, sy);
      if (push) this.pushDown(dest, tile); else this.top[dest] = tile;
      if (under !== T.CloneMachine) this.pop(s);
      const lower = this.bottom[dest];
      if (action === 1 && isButton(lower)) {
        if (deferred) deferred.push({ x: dest & 31, y: dest >> 5 });
        else this.pressButton(lower, dest & 31, dest >> 5);
      }
      if (isChipTile(this.bottom[dest])) this.die('squished');
      return true;
    }

    // ---------------------------------------------------------- creatures
    // MonsterCanEnterTile. tile is the moving creature (or Teleport, see enterTeleport).
    monsterCanEnter(tile, x, y, d) {
      const k = y * 32 + x;
      if (this.bottom[k] === T.CloneMachine) return { can: false, action: 0 };
      let t = this.top[k];
      if (isChipTile(t)) t = this.bottom[k];   // judge Chip's square by what he stands on
      const r = row(t);
      if (r[4] === 1) return { can: true, action: r[5] };
      if (r[4] !== 2) return { can: false, action: 0 };
      const kind = isCreature(tile) ? kindOf(tile) : -1;
      if (t === T.Water) return { can: true, action: kind === K.Glider ? 1 : 2 };
      if (t === T.Fire) {
        if (kind === K.Bug || kind === K.Walker) return { can: false, action: 0 };
        return { can: true, action: kind === K.Fireball ? 1 : 2 };
      }
      if (isPanel(t) || isIceCorner(t)) return { can: panelEnter(t, d), action: r[5] };
      return { can: false, action: 0 };
    }

    // MoveMonster. m is the list entry. Returns 0 blocked, 1 moved, 2 moved
    // and died; m.x, m.y and m.newDir are updated.
    moveMonster(m, d) {
      const sx = m.x, sy = m.y, s = sy * 32 + sx;
      const fail = () => { this.deleteSlipAt(sx, sy); return 0; };
      if (d < 0) return fail();
      const nx = sx + DX[d], ny = sy + DY[d];
      if (nx < 0 || ny < 0 || nx > 31 || ny > 31) return fail();
      const under = this.bottom[s];
      if (under === T.Trap && this.trapHolds(sx, sy)) return fail();
      if (!panelLeave(under, d)) return fail();
      const facing = setDir(m.tile, d);
      const me = this.monsterCanEnter(facing, nx, ny, d);
      if (!me.can) return fail();
      const n = ny * 32 + nx;
      let action = me.action, dest = n, dead = false, dir = d;
      switch (action) {
        case 2: dead = true; if (this.top[n] === T.Water || this.bottom[n] === T.Water) this.snd(SND.Splash); break;
        case 4: dir = this.slideMovement(sx, sy, nx, ny, d, 'monster', facing); break;
        case 5: this.snd(SND.Bomb); dead = true; break;
        case 6: this.enterTrap(nx, ny, sx, sy); break;
        case 7:
          dest = this.enterTeleport(n, d, 'monster');
          dir = this.slideMovement(sx, sy, dest & 31, dest >> 5, d, 'monster', facing);
          action = 4; break;
      }
      if (action !== 4) this.deleteSlipAt(sx, sy);
      if (action === 5) this.top[dest] = T.Floor;
      else if (action !== 2) this.pushDown(dest, facing);
      if (under !== T.CloneMachine) this.pop(s);
      m.x = dest & 31; m.y = dest >> 5; m.newDir = dir;
      const lower = this.bottom[dest];
      if (action === 1 && isButton(lower)) {
        if (lower === T.TankButton) {
          m.dir = dir; m.tile = this.top[dest];
          this.pressButton(lower, m.x, m.y);
          m.newDir = m.dir;
        } else this.pressButton(lower, m.x, m.y);
      }
      if (!dead && isChipTile(lower)) this.die('eaten');
      return dead ? 2 : 1;
    }

    // MonsterLoop: every even tick. Teeth and blobs only when slow (tick % 4 == 0).
    monsterLoop(slow) {
      let len = this.monsters.length;
      for (let i = 0; i < len && i < this.monsters.length; i++) {
        const m = this.monsters[i];
        if (m.slipping) continue;
        const k = m.y * 32 + m.x;
        const lower = this.bottom[k];
        const onTC = lower === T.Trap || lower === T.CloneMachine;   // one try only from here
        const kind = kindOf(m.tile), d = m.dir;
        let r = 0;
        const tryDir = (nd) => { r = this.moveMonster(m, nd); return r !== 0; };
        const order = (dirs) => { if (onTC) { tryDir(dirs[0]); return; } for (const o of dirs) if (tryDir(o)) return; };
        switch (kind) {
          // Bugs, teeth and paramecia leaving a trap or clone machine reuse a
          // leftover direction in the original; straight ahead is used here.
          case K.Bug: onTC ? tryDir(d) : order([left(d), d, right(d), back(d)]); break;
          case K.Paramecium: onTC ? tryDir(d) : order([right(d), d, left(d), back(d)]); break;
          case K.Fireball: order([d, right(d), left(d), back(d)]); break;
          case K.Glider: order([d, left(d), right(d), back(d)]); break;
          case K.Ball: order([d, back(d)]); break;
          case K.Tank:
            if (!tryDir(d) && !(lower === T.Trap && this.trapHolds(m.x, m.y))) m.dir = -1;   // a blocked tank stops for good
            break;
          case K.Teeth: {
            if (!slow) break;
            const dx = this.chipX - m.x, dy = this.chipY - m.y;
            const first = Math.abs(dx) <= Math.abs(dy) ? (dy > 0 ? 2 : 0) : (dx > 0 ? 3 : 1);
            if (tryDir(first) || onTC) break;
            const second = Math.abs(dy) >= Math.abs(dx) ? (dx > 0 ? 3 : dx < 0 ? 1 : -1) : (dy > 0 ? 2 : dy < 0 ? 0 : -1);
            if (second >= 0 && tryDir(second)) break;
            m.tile = setDir(m.tile, first); this.top[k] = m.tile;   // turns to face Chip
            break;
          }
          case K.Walker:
            if (tryDir(d) || onTC) break;
            this.walkerTurns(d, tryDir);
            break;
          case K.Blob: {
            if (!slow) break;
            let bx, by;
            do { bx = this.rand(3) - 1; by = this.rand(3) - 1; } while ((bx === 0) === (by === 0));
            const rd = bx === -1 ? 1 : bx === 1 ? 3 : by === -1 ? 0 : 2;
            if (!tryDir(rd)) this.walkerTurns(rd, tryDir);
            break;
          }
        }
        if (r === 1) { m.tile = this.top[m.y * 32 + m.x]; m.dir = m.newDir; }
        else if (r === 2) { this.monsters.splice(i, 1); i--; len--; }
        if (!this.alive) return;
      }
    }

    // Walker (and blob) after a blocked move: random left/right/back, no repeats.
    walkerTurns(d, tryDir) {
      let tried = 0;
      while (tried !== 7) {
        const r = this.rand(3);
        if (tried & (1 << r)) continue;
        tried |= 1 << r;
        if (tryDir(r === 0 ? left(d) : r === 1 ? right(d) : back(d))) return true;
      }
      return false;
    }

    // SlipLoop: every tick. Literal port: a blocked slider is deleted and
    // re-appended at the end of the list, which skips the next one this tick.
    slipLoop() {
      let i = 0;
      while (i < this.slips.length) {
        if (!this.alive) return;
        const prev = this.slips.length;
        const s = this.slips[i];
        const x = s.x, y = s.y;
        let d = s.dir;
        if (s.isMonster) {
          const mi = this.findMonster(x, y);
          if (mi < 0) { this.slips.splice(i, 1); continue; }
          const m = this.monsters[mi];
          let r = this.moveMonster(m, d);
          if (r === 0) {
            if (isIce(this.bottom[y * 32 + x])) {
              d = this.slideMovement(x, y, x, y, back(d), 'monster', -1);
              r = this.moveMonster(m, d);
              if (r === 0) this.slideMovement(x, y, x, y, back(d), 'monster', -1);
            } else {
              this.slideMovement(x, y, x, y, d, 'monster', -1);   // force floors and teleports: wait
            }
          }
          if (r === 1) { m.dir = m.newDir; m.tile = setDir(this.top[m.y * 32 + m.x], m.newDir); }
          else if (r === 2) { const di = this.monsters.indexOf(m); if (di >= 0) this.monsters.splice(di, 1); }
        } else if (!this.moveBlock(x, y, d, null, null)) {
          let done = false;
          if (isIce(this.bottom[y * 32 + x])) {
            d = this.slideMovement(x, y, x, y, back(d), 'block', -1);
            if (this.moveBlock(x, y, d, null, null)) done = true; else d = back(d);
          }
          if (!done) this.slideMovement(x, y, x, y, d, 'block', -1);
        }
        if (this.slips.length === prev) i++;
      }
    }

    // ---------------------------------------------------------- DoTick
    // 10 ticks a game second. Chip walks on even ticks (or the odd tick after
    // a buffered key), creatures move on even ticks, teeth and blobs every
    // fourth, and anything sliding moves every tick.
    tick() {
      if (!this.alive) return;
      const tick = this.tickCount;
      if ((tick & 1) === 0) {
        if (!this.isSliding) {
          if (this.hasMoved) this.hasMoved = false;
          else if (this.buffered >= 0) { const d = this.buffered; this.buffered = -1; this.moveChip(d, true, true); }
          else if (this.idle++ >= 2) {
            const k = this.chipY * 32 + this.chipX, t = this.top[k];
            if (t !== T.ChipN + 2 && t !== T.SwimN + 2) this.top[k] = this.chipTile(k, 2);   // idle Chip faces you
          }
        }
        if (this.alive && this.monsters.length) this.monsterLoop((tick & 3) === 0);
      } else if (this.buffered >= 0 && !this.isSliding && !this.hasMoved) {
        const d = this.buffered; this.buffered = -1;
        this.moveChip(d, true, true);
      }
      if (this.alive && this.isSliding) {
        this.idle = 0;
        if (!this.moveChip(this.slide, false, true) && this.isSliding && this.alive) {
          // bounce: on ice Chip slides back; on force floors this just re-aims
          this.slide = back(this.slide);
          this.slideMovement(this.chipX, this.chipY, this.chipX, this.chipY, this.slide, 'chip');
          if (!this.moveChip(this.slide, false, true) && this.alive) {
            this.slide = back(this.slide);
            this.slideMovement(this.chipX, this.chipY, this.chipX, this.chipY, this.slide, 'chip');
          }
        }
        // a key of Chip's own right after the forced step (force floor override)
        if (this.hasMoved) this.hasMoved = false;
        else if (this.buffered >= 0) {
          const d = this.buffered; this.buffered = -1;
          if (this.alive && !(this.isSliding && d === this.slide)) this.moveChip(d, true, true);
        }
      }
      if (this.alive) this.slipLoop();
      this.autorepeat();
      return this.endTick();
    }

    endTick() {
      const tick = this.tickCount++;
      if (this.alive && this.timeLeft != null && this.timeLeft > 0 && tick !== 0 && tick % 10 === 0) {
        this.timeLeft--;
        if (this.timeLeft <= 15) this.snd(SND.Tick);
        if (this.timeLeft === 0) this.die('time');
      }
    }
  }

  root.CCEngine = { Game, score, T, SND, DX, DY, TICK_MS: 110 };
})(typeof globalThis !== 'undefined' ? globalThis : this);
