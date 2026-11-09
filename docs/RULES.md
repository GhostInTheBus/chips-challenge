# MSCC (Chip's Challenge for Windows) game rules, derived from the CHIPS.EXE disassembly

Source tree: the community disassembly at github.com/magical/CHIPS.EXE. Everything below was read out of the asm,
not from Tile World or wikis. Line numbers are approximate (about +/-5) and use these abbreviations:

| abbrev | file |
|---|---|
| mv | movement.asm (DoTick, SlideMovement, EndLevel, MoveBlock, MoveChip, MoveMonster) |
| lg | logic.asm (lists, MonsterLoop, SlipLoop, *CanEnterTile, buttons, traps, clone, teleport) |
| dt | data.asm (TileTable at dt 229-341) |
| s2 | seg2.asm (window procs, timer) |
| s4 | seg4.asm (level loading) |
| s6 | seg6.asm (level complete dialog, scoring) |
| crt | crt.asm (rand) |

"AMBIGUOUS" marks places where the asm reads uninitialized memory or otherwise does not determine the result.

---

## 0. Data model and conventions

### 0.1 Board, directions, tile ids

* 32x32, two layers per cell: `Upper` and `Lower`, index `y*32+x`, y grows downward. Level file layer 1 goes to Upper, layer 2 to Lower (s4 ReadLevelData ~1170-1230).
* Directions are `(dx,dy)`: N=(0,-1) W=(-1,0) S=(0,1) E=(1,0).
* `SetTileDir(t,d)` = `(t & 0xFC) + {N:0,W:1,S:2,E:3}`; if d is (0,0) it returns t unchanged (lg 590-630).
* `GetMonsterDir(t)`: only for 0x40-0x63, returns the facing from `t & 3`; for any other tile it fails and writes nothing (lg 633-682).
* `TurnLeft`: N->W, W->S, S->E, E->N. `TurnRight`: N->E, E->S, S->W, W->N. `TurnAround`: negate. For input (0,0) TurnLeft/TurnRight write nothing (the output variables keep their old value) (lg 114-245).
* Tile names: constants.asm names `0x1E FakeFloor` and `0x1F FakeWall`. In game terms 0x1E is the blue wall that turns into floor, 0x1F the blue wall that is real. `0x05 InvisibleWall` never changes; `0x2C HiddenWall` becomes a visible Wall when Chip bumps it. `0x25 ToggleWall` is the closed state, `0x26 ToggleFloor` the open state.

### 0.2 Layer operations (shared vocabulary for the rest of this file)

* **pushDown(d)**: `Lower[d] = Upper[d]`, then the mover is written to `Upper[d]`.
* **replace(d)**: mover written to `Upper[d]`; `Lower[d]` untouched (whatever was in Upper is destroyed).
* **pop(s)** (mover leaves s): `Upper[s] = Lower[s]; Lower[s] = Floor`.
  * Blocks and monsters skip pop when `Lower[s] == CloneMachine` (mv 1929-1942, mv 3221-3234). That is the whole clone machine mechanism: the original tile stays put, a copy walks out.
  * Chip always pops (mv 2393-2409), and he pops his source *before* the destination's effects run.

Invariant this creates: Lower is non-Floor only under "objects" (Chip, monsters, blocks, items).

### 0.3 Lists (GameState, structs.asm)

All are ordered arrays. Implement them as JS arrays with exactly these operations, because order matters.

| list | entry | built by | notes |
|---|---|---|---|
| Monster list | tile, x, y, xdir, ydir, slipping | InitBoard from level field 10; NewMonster appends | DeleteMonster splices (lg 501-575). FindMonster(x,y) = first index with that position, else -1 (lg 23) |
| Slip list | tile, x, y, xdir, ydir, isMonster | SlideMovement | NewSlipper appends (lg 2171); DeleteSlipperAt(x,y) splices the first match by position and, if it was a monster, clears that monster's `slipping` (lg 2214-2296). The struct field is called `isblock` in structs.asm but it is set to 1 for **monsters** and 0 for blocks (mv 1106-1115, lg 2359) |
| Toggle list | x, y | InitBoard scan | |
| Trap list | fromX, fromY (button), toX, toY (trap), flag | level field 4, 10 byte records copied verbatim incl. flag (s4 775-831) | flag 1 = closed, 0 = open |
| Clone list | fromX, fromY (button), toX, toY (machine) | level field 5, 8 byte records (s4 833-888) | |
| Teleport list | x, y | InitBoard scan, row major order | |
| InitialMonsterList | x (low byte), y (high byte) | level field 10, 2 bytes each (s4 926-956) | |

### 0.4 Tick counter, timer, RNG

* The game timer is `SetTimer(id 1, 110 ms)` (s2 StartTimer ~2468), not 100 ms. Each WM_TIMER does `CurrentTick++` then `DoTick(CurrentTick)` (s2 ~4280-4292).
* `CurrentTick` is a global 16 bit word that is **never reset** (only one write site, s2 4288). Tick parity, `tick%4` and `tick%10` at the start of a level are therefore whatever they happen to be. For a reimplementation you may start at 0 per level, but know the original does not.
* WM_TIMER is ignored while the pause counter `Var22` is nonzero (s2 ~4270). Pause sources: level placard at level start (cleared by the first WM_KEYDOWN or WM_LBUTTONDOWN), any message box, dialogs, the pause menu.
* `rand()` (crt 112): `seed = seed*0x343FD + 0x269EC3 (mod 2^32); return (seed>>16) & 0x7FFF`. `srand(GetCurrentTime())` once at program start (s2 1019), never per level. `RandInt(n) = rand() % n` (lg 930). RNG consumers: walker (when blocked), blob (always), random force floor, end-game animation.

### 0.5 Level load and InitBoard

`FUN_4_0356(level, restarting)` (s4 ~346-600): ResetInventory(all keys and boots to 0), zero the whole GameState (so ChipX=ChipY=0, IsSliding=0, Autopsy=0, ChipHasMoved=0, all lists empty), read the level, `InitBoard`, set `TimeRemaining = time limit`, `ChipsRemainingCount = chip count`, show placard (timer paused). `RestartCount` is kept and incremented when `restarting`.

`InitBoard` (lg 687-926):
1. For each entry of InitialMonsterList in file order: if `Upper[x,y]` is 0x40-0x63, `NewMonster(tile, x, y, dirFromTile, cloning=0)`. Entries whose tile is not a monster are ignored. **Monsters on the map but not in field 10 never move.**
2. `NewMonster` with cloning=0 refuses monsters whose `Lower == CloneMachine` (those are clone templates, not list members) (lg 367-376). It appends the entry (slipping=0), and if `Lower == Trap` calls `EnterTrap(x, y, -1, -1)` (closes that trap unless a button is held, see 6.3). If Lower is a Chip tile, Autopsy=Eaten.
3. Board scan, y outer 0..31, x inner 0..31. Let `t = Upper`, but if Upper is a monster use `Lower`:
   * t in {0x25, 0x26} -> append to toggle list
   * t == 0x29 -> append to teleport list
   * t in 0x6C..0x6F -> ChipX,ChipY = (x,y) (last one wins; Swim tiles 0x3C-0x3F are not recognized; no chip means Chip is at (0,0))
   * Toggle tiles, teleports and Chip under a block, an item or Chip himself are **not** registered (they never toggle / never work as teleports).
4. Nothing else touches traps. Trap flags start at the value stored in the file. (Checked: all 181 trap records in CCLP1.dat and all 99 in the original CHIPS.DAT have flag 0.) Flag 0 means open, so a block or Chip that starts on a trap can leave until something enters that trap.

### 0.6 TileTable (dt 229-341)

Six bytes per tile: `[chipEnter, chipAction, blockEnter, blockAction, monsterEnter, monsterAction]`.
Enter: 0 = blocked, 1 = allowed, 2 = special code decides. The action codes mean different things per mover (sections 1, 2, 3).

| id | name | chip | block | monster |
|---|---|---|---|---|
| 00 | Floor | 1,0 | 1,0 | 1,1 |
| 01 | Wall | 0,0 | 0,0 | 0,0 |
| 02 | ICChip | 1,1 | 0,0 | 0,0 |
| 03 | Water | 2,2 | 1,2 | 2,2 |
| 04 | Fire | 2,2 | 1,1 | 2,2 |
| 05 | InvisibleWall | 0,0 | 0,0 | 0,0 |
| 06-09 | Panel N/W/S/E | 2,4 | 2,1 | 2,1 |
| 0A | Block | 2,0 | 0,0 | 0,0 |
| 0B | Dirt | 1,3 | 0,0 | 0,0 |
| 0C | Ice | 2,5 | 1,4 | 1,4 |
| 0D | ForceS | 2,5 | 1,4 | 1,4 |
| 0E-11 | Block N/W/S/E (clone templates) | 0,0 | 0,0 | 0,0 |
| 12-14 | ForceN/E/W | 2,5 | 1,4 | 1,4 |
| 15 | Exit | 1,4 | 1,1 | 0,0 |
| 16-19 | Doors B/R/G/Y | 2,3 | 0,0 | 0,0 |
| 1A-1D | IceWall NW/NE/SE/SW | 2,5 | 2,4 | 2,4 |
| 1E | FakeFloor (blue, fake) | 2,0 | 0,0 | 0,0 |
| 1F | FakeWall (blue, real) | 2,0 | 0,0 | 0,0 |
| 20 | unused | 0,0 | 0,0 | 0,0 |
| 21 | Thief | 2,4 | 0,0 | 0,0 |
| 22 | Socket | 2,3 | 0,0 | 0,0 |
| 23 | ToggleButton | 1,4 | 1,1 | 1,1 |
| 24 | CloneButton | 1,4 | 1,1 | 1,1 |
| 25 | ToggleWall | 0,0 | 0,0 | 0,0 |
| 26 | ToggleFloor | 1,4 | 1,1 | 1,1 |
| 27 | TrapButton | 1,4 | 1,1 | 1,1 |
| 28 | TankButton | 1,4 | 1,1 | 1,1 |
| 29 | Teleport | 1,7 | 1,7 | 1,7 |
| 2A | Bomb | 1,2 | 1,5 | 1,5 |
| 2B | Trap | 1,6 | 1,6 | 1,6 |
| 2C | HiddenWall | 2,0 | 0,0 | 0,0 |
| 2D | Gravel | 1,4 | 1,1 | 0,0 |
| 2E | PopupWall | 2,4 | 0,0 | 0,0 |
| 2F | Hint | 1,4 | 1,1 | 1,1 |
| 30 | PanelSE | 2,4 | 2,1 | 2,1 |
| 31 | CloneMachine | 0,0 | 0,0 | 0,0 |
| 32 | ForceRandom | 2,5 | 1,4 | 0,0 |
| 33-3B | death/exit animation tiles, unused | 0,0 | 0,0 | 0,0 |
| 3C-3F | Swim N/W/S/E | 0,0 | 1,1 | 1,0 |
| 40-63 | monsters | 2,2 | 0,0 | 0,0 |
| 64-67 | Keys B/R/G/Y | 2,1 | 1,1 | 1,1 |
| 68-6B | Flippers, FireBoots, IceSkates, SuctionBoots | 2,1 | 1,1 | 0,0 |
| 6C-6F | Chip N/W/S/E | 0,0 | 1,1 | 1,0 |

---

## 1. Chip entering tiles

### 1.1 MoveChip pipeline (mv 2086-2923)

`MoveChip(dir, voluntary, sound)`. Input handling (first block) is detailed in section 9.

```
dest = chip + dir; canEnter = 0; tile2 = 0xFF
if paused: return 0                                          (mv 2135)
[input gate: ChipHasMoved / buffer, section 9]               (mv 2142-2173)
IdleTickCount = 0
if dest out of 0..31: goto BLOCKED                           (mv 2175-2191)
if IsSliding:                                                (mv 2193-2252)
    tile2 = Lower[chip]
    if voluntary:
        if tile2 in {Ice, IceWallNW, IceWallNE, IceWallSW, IceWallSE, Teleport}: return 0   (no facing change)
        if tile2 in {ForceS, ForceN, ForceW, ForceE, ForceRandom} and dir == Slide: return 0
        (any other direction on a force floor goes through: override)
if Lower[chip] == Trap:                                      (mv 2256-2282)
    t = FindTrap(chip); if t < 0 or trap[t].flag == 1: goto BLOCKED
if Lower[chip] in {PanelN..PanelE, PanelSE} and !CheckPanelWalls(Lower[chip], dir, leaving): goto BLOCKED
deferredButton = none
if Upper[dest] == Block (0x0A only):                         (mv 2307-2373)
    s = FindSlipper(dest)
    if s >= 0 and (s.dir == dir or s.dir == -dir): goto BLOCKED   (can only push a sliding block sideways)
    ok = MoveBlock(dest, dir, blockTile=0xFF, &deferredButton)
    if Autopsy != 0: goto DEATH
    if !ok: goto BLOCKED
canEnter = ChipCanEnterTile(dest, dir, &action, sideEffects=1, useUpper=1)
if !canEnter: goto BLOCKED
pop(chip)                                                    (mv 2393-2422)
switch action:                                               (mv 2425-2650)
  0, 3: (nothing; replace)
  1:  PickUpKeyOrBoot(Upper[dest])            (replace; item gone, Lower untouched)
  2:  DEATH: Bomb -> Bombed; tile > 0x2A (monster) -> Eaten; Water -> Drowned; Fire -> Burned
  4:  pushDown(dest)
  5:  SlideMovement(chip, dest, &dir, flag 0)  (IsSliding=1, Slide=new dir, dir updated)
      if IsBuffered and Upper[dest] != tile2 and Buffered == -dir: ChipHasMoved=1; IsBuffered=0
      pushDown(dest)
  6:  EnterTrap(dest, from=chip); pushDown(dest)
  7:  EnterTeleport(&dest, dir, kind chip); SlideMovement(chip, dest, &dir, flag 0); action=5; pushDown(dest)
ChipX,Y = dest; Upper[dest] = SetTileDir(Lower[dest]==Water ? SwimN : ChipN, dir)
if action == 4: by Lower[chip]: Hint -> show hint; ToggleButton -> PressToggleButton;
                CloneButton -> PressCloneButton(chip pos); TrapButton -> PressTrapButton(chip pos);
                TankButton -> PressTankButton                                  (mv 2704-2765)
if deferredButton: press the button at its position (same four kinds)       (mv 2768-2815)
if IsSliding and action != 5: IsSliding = 0                                  (mv 2825-2832)
StepCount++
if Lower[chip] == Exit: EndLevel(); return 1                                 (mv 2839-2856)
return canEnter (always 1 here)

BLOCKED (mv 2876-2919): Upper[chip] = SetTileDir(Lower[chip]==Water ? SwimN : ChipN, dir)
                        (Chip turns to face the blocked direction; happens for forced moves too)
                        if sound: BlockedMoveSound; return 0
DEATH (mv 2492-2560): ChipX,Y = dest; Lower[dest] = Upper[dest];
                      Upper[dest] = ChipSplash if Water, ChipBurned if Fire, else Chip facing dir;
                      death sound, message box, reload level (restarting=1); return 0
```

Notes:
* Side effects inside ChipCanEnterTile (doors, blue walls, hidden walls, thief, popup) happen on forced slide moves too (MoveChip always passes sideEffects=1).
* Chip's own button press (action 4) is processed before the button the pushed block landed on.
* Leaving checks exist only for Trap and Panels (Lower of the source). **Ice corners are never checked on exit**, so Chip with ice skates can walk out of an ice corner through its walls.

### 1.2 ChipCanEnterTile (lg 3080-3387)

```
if Lower[dest] == CloneMachine: return 0
t = Upper[dest]; row = TileTable[t]; *action = row.chipAction
if row.chipEnter == 1: return 1
if row.chipEnter != 2: *action = 0; return 0
if t in 0x40..0x6F or t == Block:
    return ChipCanEnterTile(dest, dir, &dummy, sideEffects=0, useLower)   (action stays the Upper tile's)
switch t (jump table lg 3179-3227) ...
```

Per tile result, as executed by MoveChip:

| id | tile | Chip result |
|---|---|---|
| 00 | Floor | enter (replace) |
| 01, 05 | Wall, InvisibleWall | blocked |
| 02 | ICChip | enter; `ChipsRemaining--` if > 0; chip consumed; no Lower check at all |
| 03 | Water | Flippers: enter, pushDown, shown as Swim tile. Else enter and die Drowned |
| 04 | Fire | FireBoots: enter, pushDown. Else enter and die Burned |
| 06-09, 30 | Panels | enter iff CheckPanelWalls(t, dir, entering); pushDown |
| 0A | Block | MoveChip pushes first (1.1). If ChipCanEnterTile ever sees one: checks Lower, action 0. Unreachable in practice |
| 0B | Dirt | enter; dirt erased (action 3) |
| 0C | Ice | IceSkates: pushDown, no slide (action 4). Else slide (action 5) |
| 0D, 12-14 | Force S/N/E/W | SuctionBoots: pushDown (action 4). Else slide |
| 0E-11 | Block N/W/S/E | blocked (not pushable) |
| 15 | Exit | enter, pushDown, then level complete |
| 16-19 | Doors | need count > 0 of the matching key; blue/red/yellow key decremented, **green key not consumed** (lg 2796-2800); OpenDoorSound; door erased (action 3). No key: blocked |
| 1A-1D | IceWall NW/NE/SE/SW | enter iff CheckPanelWalls(entering); then IceSkates: pushDown, else slide with deflection |
| 1E | FakeFloor | Upper := Floor, enter (replace) |
| 1F | FakeWall | Upper := Wall, blocked |
| 20 | unused | blocked |
| 21 | Thief | enter, pushDown, ThiefSound, `ResetInventory(bootsOnly)`: **boots only, keys kept** |
| 22 | Socket | `ChipsRemaining == 0`: enter, socket erased, SocketSound. Else blocked |
| 23, 24, 27, 28 | Toggle/Clone/Trap/Tank buttons | enter, pushDown, press (section 6) |
| 25 | ToggleWall | blocked |
| 26 | ToggleFloor | enter, pushDown |
| 29 | Teleport | teleport (section 7) |
| 2A | Bomb | enter and die Bombed |
| 2B | Trap | enter, pushDown, EnterTrap |
| 2C | HiddenWall | Upper := Wall (now visible), blocked |
| 2D | Gravel | enter, pushDown |
| 2E | PopupWall | Upper := Wall *before* the move, then pushDown, so Chip stands on Lower=Wall; it becomes a wall the moment he leaves (lg 3357-3365) |
| 2F | Hint | enter, pushDown, hint shown (hidden again when he leaves) |
| 31 | CloneMachine | blocked |
| 32 | ForceRandom | SuctionBoots: pushDown. Else slide in a random direction |
| 33-3B | animation tiles | blocked |
| 3C-3F, 6C-6F | Swim, Chip | blocked |
| 40-63 | monster | Lower check (no side effects). If Lower is enterable: enter and die **Eaten**. Else blocked (e.g. monster on a panel wall side, on a clone machine) |
| 64-6B | keys, boots | Lower check (no side effects). If enterable: pick up (count++), replace. The Lower tile's own effect is **not** applied on this step |

The "Lower check with no side effects" uses the same table, but: doors only test the key (not consumed), Thief/PopupWall/FakeFloor return 1 without changing anything, HiddenWall/FakeWall return 0 without revealing, Water/Fire/Ice/Force return 1 regardless of boots. Consequence for items lying on top of things (rare, but faithful): picking up a key or boots on top of Water/Fire/Bomb is safe (Chip swims or stands there), on top of Ice/Force/Teleport causes no slide or teleport, on top of a button causes no press, on top of Thief steals nothing, but on top of Exit the level still ends (the exit check reads Lower after the move).

### 1.3 Boots (HaveBootsForTile, lg 2820-2915)

| boot | tile id | protects against |
|---|---|---|
| Flippers | 0x68 | Water 0x03 (Chip swims) |
| FireBoots | 0x69 | Fire 0x04 |
| IceSkates | 0x6A | Ice 0x0C and ice corners 0x1A-0x1D (no sliding; corner entry walls still enforced, exit walls not) |
| SuctionBoots | 0x6B | ForceS/N/E/W 0x0D, 0x12-0x14 and ForceRandom 0x32 |

Boots and keys are counts. Boots are never consumed. Effect of having boots: action 2 or 5 becomes action 4 (plain pushDown).

### 1.4 CheckPanelWalls (lg 2921-3076)

`CheckPanelWalls(tile, dir, entering)` returns false for these directions of travel:

| tile | blocked when entering moving | blocked when leaving moving |
|---|---|---|
| 06 PanelN | S | N |
| 07 PanelW | E | W |
| 08 PanelS | N | S |
| 09 PanelE | W | E |
| 30 PanelSE | N, W | S, E |
| 1A IceWallNW | E, S | (N, W, never called) |
| 1B IceWallNE | W, S | (N, E, never called) |
| 1C IceWallSE | N, W | (S, E, never called) |
| 1D IceWallSW | E, N | (S, W, never called) |

Every other tile returns true. Leaving checks are only made by MoveChip/MoveBlock/MoveMonster when `Lower[src]` is 06-09 or 30.

---

## 2. Blocks

### 2.1 MoveBlock (mv 1637-2081)

`MoveBlock(src, dir, blockTile, deferPtr)`. `blockTile` is 0xFF except for clone spawns (0x0A). `deferPtr` is non-null only when Chip pushes.

```
dest = src + dir; if out of bounds: goto BLOCKED
if Lower[src] == Trap: t = FindTrap(src); if t < 0 or flag == 1: goto BLOCKED
if Lower[src] is a panel and !CheckPanelWalls(Lower[src], dir, leaving): goto BLOCKED
if !BlockCanEnterTile(dest, dir, &action): goto BLOCKED
switch action:
  0, 3: nothing (replace)
  1: pushDown
  2: SplashSound; blockTile = Dirt        (Upper[dest] becomes Dirt; block and water gone)
  4: SlideMovement(src, dest, &dir, flag 1, &blockTile); pushDown
  5: BombSound; blockTile = Floor         (Upper[dest] becomes Floor; block and bomb gone)
  6: if a slipper exists at src: SlideMovement(src, dest, flag 1); EnterTrap(dest, from=src); pushDown
  7: EnterTeleport(&dest, dir, kind block); SlideMovement(src, dest, flag 1); pushDown; action = 4
if action not in {4, 6}: DeleteSlipperAt(src)          (block stops sliding)
Upper[dest] = (blockTile != 0xFF) ? blockTile : Upper[src]
pop(src) unless Lower[src] == CloneMachine
if action == 1 and Lower[dest] is a button:
    if deferPtr: record (x,y) for MoveChip to press after Chip's move
    else press now (Toggle / Clone / Trap / Tank)
if Lower[dest] is a Chip or Swim tile: Autopsy = Squished
return 1
BLOCKED: DeleteSlipperAt(src) (if the slip list is non empty); return 0
```

### 2.2 BlockCanEnterTile (lg 3391-3476)

No Chip substitution (unlike monsters): Upper[dest] is used as is. `Lower[dest] == CloneMachine` blocks. Enter 2 means CheckPanelWalls(entering) for panels and ice corners.

| tile | pushed block result |
|---|---|
| Floor | moves (replace) |
| Wall, InvisibleWall, ICChip, Dirt, Block, BlockN-E, doors, blue walls, HiddenWall, PopupWall, Thief, Socket, ToggleWall, CloneMachine, unused/animation tiles | blocked |
| Water | becomes Dirt, block gone |
| Fire | block sits on the fire (Lower=Fire) |
| Panels | CheckPanelWalls; pushDown |
| Ice, Force S/N/E/W, ForceRandom | joins/updates slip list (section 5) |
| Ice corners | CheckPanelWalls; slides with deflection |
| Exit | allowed, sits on the exit |
| Buttons (23, 24, 27, 28) | pressed |
| ToggleFloor, Gravel, Hint | allowed |
| Teleport | teleports (section 7) |
| Bomb | both destroyed, Floor left |
| Trap | enters trap (EnterTrap) |
| monsters 40-63 | blocked |
| keys, boots 64-6B | allowed: block covers the item (item moves to Lower, the old Lower is overwritten) |
| Chip 6C-6F, Swim 3C-3F | allowed: **Chip is Squished** |

* A block cannot push another block (Block row is 0).
* Pushing a block onto a monster: blocked. Onto Chip: kills him. Only sliding blocks, clone-spawned blocks and teleport exits can actually reach Chip.
* A plain Block 0x0A standing on a clone machine is pushable and the original stays (pop skipped), so each push spawns a copy and Chip does not move (his destination still has Lower=CloneMachine).

---

## 3. Monsters entering tiles

### 3.1 MoveMonster (mv 2933-3404)

Returns 0 blocked, 1 moved and alive, 2 moved and dead (the header comment is right, the inline comment at mv 3370 is backwards).

```
dest = pos + dir; if out of bounds: goto BLOCKED
if Lower[pos] == Trap: t = FindTrap(pos); if t < 0 or flag == 1: goto BLOCKED
if Lower[pos] is a panel and !CheckPanelWalls(Lower[pos], dir, leaving): goto BLOCKED
if !MonsterCanEnterTile(Upper[pos], dest, dir, &action): goto BLOCKED
dead = 0
switch action:
  0, 1: pushDown
  2: dead = 1                      (dest untouched: the water/fire stays, monster vanishes)
  4: SlideMovement(pos, dest, dirPtr, flag 2, &facing); pushDown
  5: BombSound; facing = Floor; dead = 1   (Upper[dest] becomes Floor)
  6: EnterTrap(dest, from=pos); pushDown
  7: EnterTeleport(&dest, dir, kind monster); SlideMovement(pos, dest, dirPtr, flag 2, &facing); pushDown; action = 4
if action != 4: DeleteSlipperAt(pos)
if action != 2: Upper[dest] = facing
pop(pos) unless Lower[pos] == CloneMachine
if action == 1 and Lower[dest] is a button: press it (Toggle / Clone / Trap / Tank)
    TankButton special case: the mover's list entry is first updated to dest and its dir,
    PressTankButton runs, then the (possibly reversed) dir is read back into *dirPtr (mv 3283-3343)
if !dead and Lower[dest] is a Chip or Swim tile: Autopsy = Eaten
*pos = dest; return dead ? 2 : 1
BLOCKED: DeleteSlipperAt(pos); return 0
```

`facing` is the monster tile already turned to the attempted direction (`SetTileDir(monster.tile, newdir)`). A blocked monster does not visibly turn (exceptions: teeth, section 4).

### 3.2 MonsterCanEnterTile (lg 3480-3641)

```
if Lower[dest] == CloneMachine: blocked
t = Upper[dest]; if t is Chip (6C-6F) or Swim (3C-3F): t = Lower[dest]
row = TileTable[t] ...
```

| tile (after Chip substitution) | monster result |
|---|---|
| Floor, ToggleFloor, Hint | enter |
| Buttons 23, 24, 27, 28 | enter and press |
| Water | Glider: enter (survives). All others: enter and drown |
| Fire | Fireball: enter (survives). **Bug and Walker: blocked.** Ball, Tank, Glider, Teeth, Blob, Paramecium: enter and burn |
| Panels | CheckPanelWalls(entering), enter |
| Ice, Force S/N/E/W | slide |
| Ice corners | CheckPanelWalls(entering), slide |
| ForceRandom | **blocked** |
| Teleport | teleport |
| Bomb | monster and bomb destroyed, Floor left |
| Trap | enter trap |
| Keys | enter; the key is kept underneath (pushDown) |
| Boots, ICChip | blocked |
| Gravel, Dirt, Exit, doors, Thief, Socket, blue walls, HiddenWall, PopupWall, ToggleWall, Wall, InvisibleWall, Block (any), CloneMachine, other monsters | blocked |

What kills a monster: water (non-glider), fire (non-fireball, excluding bug/walker who are blocked), bomb. Nothing else (blocks cannot reach monsters, Chip cannot kill them).

### 3.3 Monster moving onto Chip, and Chip onto a monster

* Monster onto Chip: the check uses the tile under Chip. If allowed with action 0/1/4/6, the Chip tile is pushed to Lower, then `Autopsy = Eaten`. Death is processed at the end of MonsterLoop (or SlipLoop), after every monster has moved.
  * Chip is safe from monsters while standing on Gravel, Thief, ForceRandom, a popup wall (Lower=Wall), Exit (level already over), or any tile the monster cannot enter.
  * Chip swimming (Lower=Water): a non-glider moving onto him **drowns and Chip survives**. A glider eats him.
  * Chip on fire with fire boots: bug/walker blocked, fireball eats him, other monsters burn and Chip survives.
  * Chip standing on a teleport: the monster enters as a teleport move. If another teleport qualifies it is sent there and Chip survives; if none does, it lands on Chip's square and eats him.
* Chip onto a monster: immediate death (Eaten) inside MoveChip, provided the tile under the monster passes Chip's no side effect check (1.2). Otherwise it is just a blocked move.

---

## 4. MonsterLoop (lg 941-2167)

Called on even ticks only, if the monster list is non empty, with `slow = (tick % 4 == 0)` (mv 330-343).

```
len = MonsterListLen (cached; monsters appended during the loop do not move this tick)
for i in 0..len-1:
    m = monster[i]
    if m.slipping: continue                       (SlipLoop moves it)
    x, y, dir = m.x, m.y, (m.xdir, m.ydir)
    run the per type routine below; each "try d" is:
        newdir = d; r = MoveMonster(&x, &y, &newdir, facing = SetTileDir(m.tile, d))
        (MoveMonster may rewrite newdir through SlideMovement or a tank button)
    r == 1: m.tile = Upper[x,y]; m.x,m.y = x,y; m.dir = newdir
    r == 2: DeleteMonster(i); i--; len--
    r == 0 on every try: nothing (entry unchanged)
after the loop: if Autopsy != 0: death sound, message, reload level
```

`newdir` (locals `xnewdir/ynewdir`, lg 956-957) is a **single variable shared by all monsters in one MonsterLoop call** and is never initialized. Some routines read it without setting it first (marked STALE below).

`onTC` means `Lower[x,y]` is Trap or CloneMachine, read at the start of the routine.

| monster | slow only | directions tried, in order | when onTC |
|---|---|---|---|
| Bug 40-43 | no | left, straight, right, back | one try with STALE newdir, then stop |
| Fireball 44-47 | no | straight, right, left, back | one try straight, then stop |
| Ball 48-4B | no | straight, back | one try straight, then stop |
| Tank 4C-4F | no | straight only; if blocked see below | same |
| Glider 50-53 | no | straight, left, right, back | one try straight, then stop |
| Teeth 54-57 | yes | toward Chip, see below | one try with STALE newdir, then stop |
| Walker 58-5B | no | straight; if blocked, random among {left, right, back} until one works or all 3 tried | one try straight, then stop |
| Blob 5C-5F | yes | random direction, then random among {left, right, back} of that direction | no special case (random as usual) |
| Paramecium 60-63 | no | right, straight, left, back | one try with STALE newdir, then stop |

Left/right/back are relative to the monster's stored direction `m.dir` (lg 1038-1218, 1303-1398, 1941-2096).

**Tank** (lg 1220-1300): try straight. If blocked: if `Lower` is a Trap whose connection is missing or closed, keep the direction; otherwise set `m.xdir = m.ydir = 0`. A stopped tank keeps trying (0,0) moves, which always fail, until a tank button gives it a direction again. Its tile keeps facing the old way.

**Teeth** (lg 1401-1636), only when `slow`:
```
dx = ChipX - x; dy = ChipY - y
first:  if |dx| <= |dy|: (0, dy > 0 ? 1 : -1)  else: (dx > 0 ? 1 : -1, 0)     (tie goes vertical)
try first; success -> done
if onTC: stop
second: if |dy| >= |dx|: dx > 0 -> E, dx < 0 -> W, dx == 0 -> no second try
        else:            dy > 0 -> S, dy < 0 -> N, dy == 0 -> no second try
try second; success -> done
both failed: Upper[x,y] = m.tile = SetTileDir(m.tile, first)   (turn to face Chip; m.dir NOT changed)
```
Uses Chip's position at the moment the teeth moves (after Chip's move this tick).

**Walker** (lg 1639-1786): after a blocked straight move, `tried = 0`; loop: if `tried == 7` give up; `r = RandInt(3)`: 0 left, 1 right, 2 back; if that bit is already in `tried`, roll again (each roll consumes one rand call); else mark it and try it.

**Blob** (lg 1789-1938), only when `slow`: loop `dx = RandInt(3)-1; dy = RandInt(3)-1` until exactly one is nonzero (two rand calls per roll). Try it. If blocked, the walker procedure relative to that random direction (up to three more tries, re-rolling repeats).

**Monsters on traps and clone machines**:
* Clone machine templates are not in the list and never move. A clone button press adds a list entry *at the machine's position* (6.4). That entry moves out normally on its next MonsterLoop (same tick if Chip pressed the button during this tick's input phase). The template tile stays because pop is skipped.
* A monster in a closed trap: MoveMonster fails at the trap check, so it never changes direction or turns; a tank keeps its direction.
* In an open trap or on a clone machine, only the single try in the table above is made. A tank that fails there stops (dir 0,0) and jams that clone machine (FindMonster finds it, so further presses do nothing).
* STALE, AMBIGUOUS: for Bug, Teeth and Paramecium the single try uses whatever `newdir` the previous monster processed in this same MonsterLoop call left behind (its final direction, or its last attempted direction if it failed, or the post SlideMovement direction if it slid). For the first monster in the loop it is uninitialized stack memory. Recommendation: keep one `lastNewDir` variable across iterations of a MonsterLoop call and start it at (0,0) per call; (0,0) gives a failed no-op move, so the monster just waits.

**Monsters on the slip list**: skipped here (`slipping` set). They are moved every tick by SlipLoop instead (section 5.4). When MonsterLoop moves a monster onto ice/force/teleport, SlipLoop moves it again later in the same tick.

---

## 5. Sliding

### 5.1 SlideMovement (mv 729-1149)

`SlideMovement(src, dest, dirPtr, flag, facingPtr)`; flag 0 = Chip, 1 = block, 2 = monster.

```
d = *dirPtr
if flag == 0: IsSliding = 1; target = (SlideX, SlideY)
else: target = slip entry found at src by position, or a NEW entry appended to the slip list
tile = (src == dest) ? Lower[dest] : Upper[dest]
if tile is a Chip or Swim tile: tile = Lower[dest]
switch tile:
  Ice, Teleport, Trap:  target = d
  ForceN: (0,-1)  ForceS: (0,1)  ForceE: (1,0)  ForceW: (-1,0)
  ForceRandom: RandInt(4): 0 N, 1 S, 2 W, 3 E
  IceWallNW: W->S, N->E, else reverse
  IceWallNE: N->W, E->S, else reverse
  IceWallSE: S->W, E->N, else reverse
  IceWallSW: W->N, S->E, else reverse
  anything else: target unchanged (Chip: old SlideX/Y; a new slip entry: uninitialized)
*dirPtr = target
if flag != 0:
  if flag == 2 and *facing != 0xFF: *facing = SetTileDir(*facing, d)   (d = the ORIGINAL direction)
  entry.tile = (*facing != 0xFF) ? *facing : Upper[src]; entry.x,y = dest; entry.isMonster = (flag == 2)
  if flag == 2: m = FindMonster(src); if *facing != 0xFF: m.tile = *facing; m.slipping = 1
```
`DummyVarForSlideMovement` (dt 410) is 0xFF, so calls passing it never change tiles.

### 5.2 Chip slide phase in DoTick (mv 377-450), every tick

```
if IsSliding:
    IdleTickCount = 0
    if MoveChip(Slide, voluntary=0, sound=1) == 0 and IsSliding:
        Slide = -Slide; SlideMovement(chip, chip, &Slide, 0)       (re-aim using Lower[chip])
        if MoveChip(Slide, 0, 1) == 0:
            Slide = -Slide; SlideMovement(chip, chip, &Slide, 0)
    [after-slide input, 9.3]
```
Bounce results by tile under Chip:
* Ice: reverse and move back if possible; if both blocked, he stays facing the original way and retries next tick.
* Ice corner: the reversed direction goes through the corner deflection, so he retraces his path.
* Teleport: reverse (he leaves the teleport backwards).
* Force N/S/E/W: re-aiming resets the direction to the floor's own direction, so the second try is the same blocked direction again: he just stays.
* ForceRandom: each re-aim draws a new random direction (up to two extra rand calls per blocked tick).

Chip slides one tile per tick (both parities). Walking is at most one tile per two ticks.

### 5.3 When Chip may act while sliding

* Voluntary moves (keyboard, buffered, mouse) while `IsSliding`:
  * on Ice, any ice corner, or Teleport: ignored (return 0, ChipHasMoved still gets set, the key is used up).
  * on any force floor including ForceRandom: allowed in every direction except the current slide direction, **including straight back against the force**. The normal move rules then apply; if it lands on a non sliding tile, IsSliding is cleared.
  * It still needs ChipHasMoved == 0 (section 9).
* Boots: entering a slide tile with the right boots gives action 4, and any successful move with action != 5 clears IsSliding. So moving (or being slid) onto a tile you have boots for, onto a plain tile, onto a trap, picking up an item, or entering a thief stops the slide. Getting boots does not stop a slide already in progress until the next move lands.
* Chip starting a level on ice or a force floor does not slide (IsSliding starts 0) until he enters a slide tile.

### 5.4 SlipLoop (lg 2330-2659), every tick, after Chip's slide phase

```
i = 0
while i < slip.length:
    prevLen = slip.length
    s = slip[i]; x, y, d = s.x, s.y, s.dir
    if s.isMonster:
        mi = FindMonster(x, y)
        r = MoveMonster(&x, &y, &d, facing = SetTileDir(Upper[x,y], d))
        if r == 0:
            if Lower[x,y] in {Ice, 1A..1D}:
                d = -d; SlideMovement((x,y), (x,y), &d, 2, dummy)
                r = MoveMonster(&x, &y, &d, SetTileDir(Upper[x,y], d))
                if r == 0: d = -d; SlideMovement((x,y), (x,y), &d, 2, dummy)
            else:
                SlideMovement((x,y), (x,y), &d, 2, dummy)
        if r == 1: monster[mi].{x, y, dir} = x, y, d; monster[mi].tile = SetTileDir(Upper[x,y], d)
        if r == 2: DeleteMonster(mi)
    else:
        if !MoveBlock((x,y), d, 0xFF, null):
            if Lower[x,y] in {Ice, 1A..1D}:
                d = -d; SlideMovement((x,y), (x,y), &d, 1, dummy)
                if MoveBlock((x,y), d, 0xFF, null): goto next
                d = -d
            SlideMovement((x,y), (x,y), &d, 1, dummy)
    next: if slip.length == prevLen: i++
if Autopsy != 0: death sound, message, reload level
```

Consequences you must reproduce:
* Monsters and blocks bounce back only on Ice and ice corners. On force floors and teleports a blocked slider waits (same direction, re-aimed; a block on ForceRandom draws a new random direction each blocked tick). Monsters never enter ForceRandom.
* A blocked MoveBlock/MoveMonster deletes the entry, and the following SlideMovement appends a new one at the **end** of the list. With the length unchanged, `i++` then skips the entry that slid into slot i (it does not move this tick) and the moved entry is processed a second time when the loop reaches the end (it can move twice this tick). Implementing SlipLoop literally with array splice/push gives this for free.
* A slider that lands on a non sliding tile is removed (length shrinks, `i` not advanced) and its monster's `slipping` is cleared; MonsterLoop takes over on the next even tick.
* Yes, a monster on ice slides via the slip list, one tile per tick, and MonsterLoop ignores it meanwhile.
* A sliding **block** that enters a trap stays on the slip list (MoveBlock action 6 does not delete it) and keeps its direction; it resumes sliding by itself when the trap opens. A sliding **monster** that enters a trap leaves the slip list.

---

## 6. Buttons

All four buttons are pressed when something *enters* them: Chip (action 4, `soundflag` 1), a block (action 1; deferred until after Chip's move when Chip pushed it, immediate otherwise), a monster (action 1). Nothing happens when the button is left.

### 6.1 Green, toggle (PressToggleButton, lg 3776-3860)

For every position in the toggle list: Upper 25<->26 swapped, Lower 25<->26 swapped. Anything standing on a toggle floor is now on top of a toggle wall in Lower; the wall appears when it leaves. Toggle tiles not registered at InitBoard (covered by a block, item or Chip at start) never change.

### 6.2 Blue, tank (PressTankButton, lg 3645-3772)

For every monster list entry whose `tile` is 4C-4F (tanks anywhere in the list, including trapped and sliding ones; clone templates are not in the list):
```
d = GetMonsterDir(entry.tile)            (from the tile facing, not entry.xdir/ydir)
entry.dir = -d; entry.tile = SetTileDir(tile, -d); Upper[entry pos] = entry.tile
```
Because it uses the tile facing, a stopped tank (dir 0,0) starts moving again, opposite to the way it faces. For a sliding tank the change is overwritten by SlipLoop (it writes the slip direction back on its next slide), so in practice sliding tanks are unaffected. Pressed during MonsterLoop: tanks earlier in the list already moved this tick, later ones move in the new direction.

### 6.3 Brown, trap (PressTrapButton lg 3952-4006, EnterTrap lg 4010-4101, FindTrapSpan lg 3866-3948)

Trap list semantics: `flag 1 = closed`, `flag 0 = open`.

* `FindTrap(pos)`: first trap list index whose `to == pos`, else -1. Used by every leave check (MoveChip/MoveBlock/MoveMonster and the tank logic): **no connection means the trap is permanent**; flag 1 blocks leaving.
* `FindTrapSpan(pos)`: the first run of *consecutive* entries whose `to == pos`.
* **Press** (`PressTrapButton(button)`): `c = first entry with from == button`; set `flag = 0` on every entry of `FindTrapSpan(c.to)`.
* **Enter** (`EnterTrap(trap, from)`, called by Chip/block/monster entering a Trap tile, and by NewMonster with from = (-1,-1)): for each entry in the span: the button counts as held if `Upper[button] != TrapButton` (something is on it) **and** the button is not `from`. If any is held, `flag = 0` for the span, else `flag = 1`.
* There is no release event. After a press the trap stays open until the next thing enters it. A trapped object gets out on its next move attempt if the flag is 0 at that moment, even if the button was already released.
* A button held by a block or monster keeps the trap open for anything that enters later, because EnterTrap sees it held.
* A button connected to several traps only works on its first connection; several buttons for one trap only all count if their records are adjacent in the file.
* InitBoard: only monsters from field 10 standing on traps call EnterTrap (closing them unless a button is covered). All other traps keep the file flag (0 = open in every record I checked).

### 6.4 Red, clone (PressCloneButton, lg 4294-4512)

```
c = first clone entry with from == button; if none: return
machine = c.to; t = Upper[machine]
if t is a monster (40-63):
    d = facing of t; front = machine + d; if out of bounds: return
    if !MonsterCanEnterTile(t, front, d) and Upper[front] != t: return
    if FindMonster(machine) >= 0: return          (one pending clone per machine)
    NewMonster(t, machine, d, cloning=1)          (list entry AT the machine; it walks out in MonsterLoop)
else:                                             (block clone)
    t in 0E..11 gives d = N/W/S/E; anything else: d uninitialized (AMBIGUOUS)
    front = machine + d; bounds; if !BlockCanEnterTile(front, d): return
    MoveBlock(machine, d, blockTile = Block 0x0A, null)   (moves immediately, presses buttons immediately)
```
* What is cloned: whatever tile sits in Upper at the machine. Monsters keep their facing; block templates are BlockN/W/S/E and spawn a plain Block 0x0A moving that way. A plain Block 0x0A on a machine has no defined direction.
* Blocked clone: nothing happens, except that a monster template is still activated when the tile in front holds an identical monster tile (same type and facing); that entry then waits on the machine.
* The template never leaves. Changes to the template tile (teeth turning to face Chip while waiting, tank buttons reversing a waiting tank) also change what the next clone looks like.
* Activated Bug/Teeth/Paramecium leave in the STALE direction (section 4), not their facing.

---

## 7. Teleports (EnterTeleport lg 4655-4829)

```
k = FindTeleport(entered pos)            (index in the row major teleport list)
if k < 0: stay                           (teleport covered at load, not in the list)
j = k - 1, wrapping to n-1; if j == k: stay   (only one teleport)
loop:
    t = tele[j]
    if Upper[t] == Teleport (unoccupied):
        e = t + dir (same direction of travel); if e in bounds:
          chip:    if Upper[e] == Block and !MoveBlock(e, dir, 0xFF, null): skip
                   if ChipCanEnterTile(e, dir, sideEffects=0): TeleportSound; go to t
          block:   if BlockCanEnterTile(e, dir): go to t
          monster: if MonsterCanEnterTile(0x29, e, dir): go to t
    j = j - 1 (wrap); if j == k: stay
```
* Search order: reverse reading order starting with the teleport just before the entered one, wrapping around. Occupied teleports are skipped. Out of bounds exits are skipped.
* Chip's search **pushes a block sitting on the exit tile** as part of the check, even if the check then fails and the search moves on.
* The exit check has no side effects: hidden/blue walls are not revealed, doors not opened.
* For monsters the check passes the Teleport tile id instead of the monster id, so water and fire always count as enterable (even for bugs/walkers into fire). The real monster tile is used when it actually steps off.
* If nothing qualifies the object stays on the teleport it entered.
* The object is placed **on** the destination teleport (pushDown), with sliding state set: Chip `IsSliding=1, Slide=dir`; blocks and monsters get a slip entry with dir. It steps off in the **same direction** on the next slide phase / SlipLoop pass that reaches it. That is later in the same tick when the teleport happened in DoTick's input phase or in MonsterLoop (a newly appended slip entry, or Chip's slide phase); a slider that was already on the slip list keeps its slot and steps off next tick.
* Chip blocked when stepping off: the bounce code (5.2) tries the opposite direction off the same teleport, then gives up for this tick. Monster/block blocked: waits on the teleport, retrying the same direction each tick (no bounce, since the SlipLoop bounce only applies on ice). Voluntary moves are ignored while Chip is on a teleport.
* Blocks and monsters both teleport (table action 7 for all three movers).

---

## 8. Other tiles, deaths, level end

| item | rule |
|---|---|
| IC chip | `ChipsRemaining--` (never below 0), PickUpChipSound. Only Chip can enter |
| Socket | opens (erased) only if `ChipsRemaining == 0`, for Chip only |
| Keys | blue, red, yellow consumed per door; **green never consumed**. Counts, any number |
| Thief | takes boots only, keeps keys; Chip stays on it (pushDown) |
| Bomb | Chip: Bombed. Block: block and bomb both vanish, Floor. Monster: monster and bomb vanish, Floor |
| Fire | Chip: Burned unless fire boots. Block: rests on it. Monster: see 3.2 |
| Water | Chip: Drowned unless flippers. Block: turns into Dirt. Monster: dies unless glider |
| Hint | shown while Chip stands on it (Chip only effect) |
| Exit | Chip enters with pushDown; at the end of that MoveChip `Lower[chip] == Exit` triggers EndLevel. Chips remaining are not checked. Blocks may sit on exits; monsters cannot enter |
| Dirt | Chip clears it; blocks and monsters blocked |
| Gravel | Chip and blocks pass; monsters blocked |
| Popup wall | Chip passes once, wall forms behind him |
| Blue walls | 0x1E becomes Floor and Chip walks in; 0x1F becomes Wall, blocked. Blocks/monsters: both are walls |
| Hidden wall 0x2C | becomes Wall on Chip's bump, blocked |

Death causes (`Autopsy`, constants.asm): Burned 1, Drowned 2, Bombed 3, Squished 4 (block landed on Chip, MoveBlock mv 2037-2059), Eaten 5 (Chip into monster, monster into Chip, or a monster spawned onto Chip), OutOfTime 6.

Where deaths are processed (death sound, ShowDeathMessage, reload with restarting=1):
* Chip's own move: immediately inside MoveChip.
* Monsters: end of MonsterLoop. Slip list and anything else (e.g. a squish from a clone spawned by Chip's button press): end of SlipLoop, which always runs.
* Time: end of DoTick.

Quirk: when a death or level exit happens *inside* DoTick (buffered move, slide, MonsterLoop), the level is reloaded on the spot and the rest of that DoTick (MonsterLoop, slide phase, SlipLoop, timer step) runs on the freshly loaded level. Monsters can therefore make one move, and the clock can lose one second, before the player sees the new level. Not so when the fatal/exit move came from WM_KEYDOWN directly.

Level complete (EndLevel mv 1547-1632): pause, show the score dialog (section 10). Levels 144 and 149 start the ending (EndingTick=1, slip and monster lists emptied). Otherwise at levels 50, 60 ... 140 a decade message, then load level+1.

Time (mv 684-719): `if TimeRemaining > 0 and tick != 0 and tick % 10 == 0: TimeRemaining--`; tick sound at <= 15; reaching 0 kills Chip (OutOfTime). Time limit 0 means untimed.

---

## 9. Input: MoveChip return value, ChipHasMoved, buffered keystroke

### 9.1 Where moves come from

* WM_KEYDOWN arrows, including Windows autorepeat, call `MoveChip(dir, voluntary=1, sound=1)` immediately (s2 ~3999-4101). Messages are handled between ticks, never in the middle of one. On Win 3.1 the game sets the keyboard autorepeat delay to 0 (the shortest, about 250 ms) while it is active (s2 ~3934-3960). The first key after the level placard unpauses the timer and also moves Chip.
* WM_LBUTTONDOWN sets a mouse target tile and **clears the buffered key** (s2 4293-4322).
* DoTick: buffered key, mouse steps, forced slides.

### 9.2 MoveChip input gate and return value (mv 2142-2173)

```
if voluntary:
    if ChipHasMoved:
        if !IsBuffered: IsBuffered = 1; Buffered = dir      (one slot; extra keys are dropped)
        return 0
    IsBuffered = 0                                          (an immediate move discards a pending buffer)
    ChipHasMoved = 1                                        (set even if the move then fails)
IdleTickCount = 0
```
Return value: **1** if Chip moved (including onto the exit; by then the next level is already loaded). **0** for: paused, buffered or dropped, ignored while sliding (5.3), blocked (facing still changes), death (level already reloaded).

### 9.3 DoTick (mv 23-723), complete order

```
DoTick(tick):
  if tick even:                                           (mv 45-325)
    if !IsSliding:
      if ChipHasMoved: ChipHasMoved = 0
      elif IsBuffered:
          if Autopsy == 0: MoveChip(Buffered, 1, 1)
          IsBuffered = 0; HaveMouseTarget = 0
      elif HaveMouseTarget: mouseStep()                   (9.4)
      else:
          if IdleTickCount++ >= 2 and Upper[chip] not in {ChipS, SwimS}:
              Upper[chip] = (Lower[chip] == Water) ? SwimS : ChipS
    if MonsterListLen != 0: MonsterLoop(slow = tick % 4 == 0)
  else:                                                   (mv 346-372)
    if IsBuffered and !IsSliding and !ChipHasMoved:
        if Autopsy == 0: MoveChip(Buffered, 1, 1)
        IsBuffered = 0; HaveMouseTarget = 0
  if IsSliding:                                           (mv 377-666)
      forced slide + bounce (5.2)
      if ChipHasMoved: ChipHasMoved = 0
      elif IsBuffered:
          if Autopsy == 0 and !(IsSliding and Buffered == Slide): MoveChip(Buffered, 1, 1)
          IsBuffered = 0; HaveMouseTarget = 0
      elif HaveMouseTarget: mouseStepAfterSlide()         (9.4)
  SlipLoop()
  timer step (section 8)
```

What this means for keyboard play:
* `ChipHasMoved` is set by every voluntary MoveChip that gets past the gate (even a blocked one) and cleared by the next even tick (if not sliding) or by the next slide phase (if sliding). So between two clears Chip gets one voluntary move; the next key goes into the one slot buffer, further keys are dropped.
* A buffered key is never used on the even tick that clears ChipHasMoved. It runs on the next odd tick (if not sliding), or right after the next forced slide step, or it is thrown away when an immediate keyboard move happens first.
* Holding a key: autorepeat calls MoveChip many times per tick; the gate turns that into one move per two ticks.
* Idle facing south: IdleTickCount counts idle even ticks and is reset by every MoveChip past the gate and by every slide step; Chip turns south on the third consecutive idle even tick.
* While sliding, the even tick input branch is skipped entirely.
* After the forced step on a force floor, a buffered key may give an immediate override in the same tick (any direction but the slide direction, 5.3). Special case in MoveChip action 5: when Chip enters a new slide tile type (or starts sliding) and the buffered key is exactly opposite the new slide direction, that key is discarded and ChipHasMoved is set (mv 2578-2602).

For JS: deliver keydown events (with your own autorepeat if you want MSCC feel) to `moveChip(dir, true, true)` between ticks, in arrival order, and run `doTick` on a 110 ms (or 100 ms) clock.

### 9.4 Mouse steps (only if you implement click to move)

Even tick (mv 83-293): `dx, dy = target - chip`. If both 0: clear target. First direction: `|dy| >= |dx|` ? `(0, dy>0 ? 1 : -1)` : `(dx>0 ? 1 : -1, 0)`; `MoveChip(dir, 1, sound = dx==0 or dy==0)`. If that returned 0 and the target is still set: second direction is the other axis toward the target (none if that axis distance is 0); `ChipHasMoved = 0`; if a direction exists `MoveChip(dir2, 1, 1)`; if it fails, clear the target. Finally clear the target if Chip died or reached it, and **always set ChipHasMoved = 0** (mouse steps never throttle the keyboard).
After slide (mv 489-666): the same, but each attempt is skipped when it equals the current slide direction while sliding, ChipHasMoved is not cleared, so the second attempt just lands in the buffer.

---

## 10. Scoring (COMPLETEMSGPROC, s6 ~479-760)

```
timeBonus  = TimeRemaining * 10
levelBonus = 500 * LevelNumber
repeat RestartCount times:            (RestartCount = restarts of this level since it was loaded fresh)
    levelBonus = levelBonus * 4 / 5   (32 bit signed, truncating)
    if levelBonus < 500: stop         (so it can end below 500, e.g. level 1 with a restart = 400)
levelScore = timeBonus + levelBonus
```
Message by RestartCount: 0 "Yowser! First Try!", 1-2 "Go Bit Buster!", 3-4 "Finished! Good Work!", 5+ "At last! You did it!".

Saving: if the level is above the INI HighestLevel or has no valid saved record: save (time = TimeRemaining, score = levelScore), `TotalScore += levelScore`, message "You have established a time record for this level!". Otherwise with saved (bestTime, bestScore): save (max(bestTime, TimeRemaining), max(bestScore, levelScore)), `TotalScore += max(0, levelScore - bestScore)`; message "You beat the previous time record by N second(s)!" if TimeRemaining > bestTime, else "You increased your score on this level by N point(s)!" if levelScore > bestScore, else none.

---

## 11. Ambiguities and undefined reads

1. STALE `newdir` for Bug/Teeth/Paramecium on traps and clone machines (section 4). Defined within a MonsterLoop call (previous monster's value), undefined for the first monster of the call.
2. Block clone with a template other than 0E-11 (including plain Block 0x0A): direction is uninitialized stack (lg 4436-4466).
3. A new slip entry created by SlideMovement on a tile outside its switch keeps uninitialized direction fields. I found no path that does this in normal play.
4. FindMonster returning -1 (slip entry with no matching monster) leads to writes to monster[-1] in SlipLoop and DeleteSlipperAt. Should not happen.
5. Duplicate coordinates in level field 10 create two list entries for one tile.
6. CurrentTick phase at level start is not defined by the level (0.4).

---

## 12. Things that differ from the commonly described rules

* Clock is 110 ms per tick; the tick counter is global and never reset, so timing phase at level start is arbitrary and the first game second can be short.
* The rest of a tick runs on the reloaded level after a death or exit that happened inside DoTick.
* Brown traps have no release event: one press opens until the next entry; blocks or Chip that start in a trap are free (file flag 0) until something enters it; a trap with no connection holds forever.
* Sliding blocks that end in a trap keep sliding when it opens; monsters do not.
* Slip list reordering: blocked or bounced sliders jump to the end of the list, so the next slider skips a move and the bounced one can move twice in one tick.
* Monsters and blocks only bounce on ice and ice corners; they wait on force floors and teleports. Chip's bounce code runs on every slide tile: a real reversal on ice, ice corners and teleports, a no-op re-aim on directional force floors, and a re-roll on a random force floor.
* Force floor override works in any direction except the current slide direction, including straight back.
* Ice corner walls are never checked on exit (skates let Chip walk out through them).
* Bugs, teeth and paramecia leaving traps or clone machines use another monster's leftover direction.
* Tanks stop for good when blocked; the blue button reverses the tile facing, which restarts stopped tanks.
* Monsters cannot enter random force floors, gravel or boots, but can walk over keys (keys survive). Bugs and walkers are stopped by fire rather than killed.
* A non-glider walking into swimming Chip drowns and Chip lives. Chip is untouchable on gravel, thief, random force floor and the popup wall square.
* Items on top of hazards neutralize the hazard for that step.
* Thief takes boots only. Green keys are never used up. Popup walls turn to wall in Lower as soon as Chip steps on.
* Teleport search skips occupied teleports, Chip's search shoves blocks off exits, the monster exit check ignores water and fire, and teleports covered at level start are dead.
* Clone machines activate the template in place; only one pending clone per machine; a waiting tank clone can jam its machine.
* Level bonus decays 20% per restart and can end below 500.
* `Slipper.isblock` is really "is monster"; MoveMonster returns 2 for dead.
