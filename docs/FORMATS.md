# File formats

What's inside the files of Chip's Challenge for Windows (the 1992 Microsoft Entertainment Pack version), as read by `web/js/formats.js`. Everything here was checked against a real copy: all 149 levels parse and every password matches the published list.

## The files in the archive.org zip

| file | what it is | used for |
|---|---|---|
| CHIPS.DAT | the level set, 149 levels | levels |
| CHIPS.EXE | 16 bit Windows (NE) executable | tile graphics, side panel, LED digits, ending picture |
| BLIP2, BUMMER, CLICK3, DITTY1, DOOR, OOF3, POP2, STRIKE, TELEPORT, WATER2 .WAV | sound effects | sound |
| CHIP01.MID, CHIP02.MID | background music | music |
| CHIPS.HLP | Windows help file | not used |
| WEP4UTIL.DLL | Entertainment Pack helper (dialog drawing) | not used |

The game also asks for CHIMES.WAV, HIT3.WAV, CLICK1.WAV, BELL.WAV and CANYON.MID. Those shipped with Windows 3.1, not with the game, so they aren't in the zip. Both versions play a short generated sound in their place.

## CHIPS.DAT

Little endian throughout.

```
u32  magic          0x0002AAAC (Windows rules) or 0x0102AAAC (Lynx rules)
u16  level count
per level:
  u16  bytes in this level (not counting these 2)
  u16  level number
  u16  time limit in seconds (0 = untimed)
  u16  chips required
  u16  map detail (always 1)
  u16  length of layer 1, then layer 1 (top layer, RLE)
  u16  length of layer 2, then layer 2 (bottom layer, RLE)
  u16  length of the optional fields, then fields:
       u8 type, u8 length, data
```

Each layer is 32x32 tiles, row by row. RLE: a byte `0xFF` is followed by a count and a tile, meaning that tile repeated; any other byte is a single tile.

Optional fields:

| type | contents |
|---|---|
| 3 | title, zero terminated |
| 4 | trap links, 10 bytes each: button x, y, trap x, y, flag (all u16). Flag 0 means open, 1 closed. Every record in the original file is 0 |
| 5 | clone machine links, 8 bytes each: button x, y, machine x, y (u16) |
| 6 | password, each byte XOR 0x99, zero terminated |
| 7 | hint text, zero terminated |
| 8 | password, plain (rare) |
| 10 | monster list, 2 bytes each (x, y). Only creatures listed here ever move |

## CHIPS.EXE

CHIPS.EXE is a New Executable (NE), the 16 bit Windows 3.x format, behind an MZ stub. The offset at `0x3C` points to the `NE` header, and the word at NE+`0x24` points to the resource table: an alignment shift, then blocks of (type id, count, reserved) each followed by 12 byte entries (offset, length, flags, id, handle, usage). Offsets and lengths are in units of `1 << shift`.

Resources found:

| type | name | contents |
|---|---|---|
| BITMAP | OBJ32_4 | the tile sheet, 416x512, 16 colors, RLE4 compressed |
| BITMAP | OBJ32_4E | same sheet for EGA |
| BITMAP | OBJ32_1 | same sheet in black and white |
| BITMAP | BACKGROUND | 237x196 circuit board pattern behind the board |
| BITMAP | 200 | 17x552 strip of LED digits |
| BITMAP | INFOWND | 154x300 side panel (LEVEL, TIME, CHIPS LEFT) |
| BITMAP | CHIPEND | 288x288 ending picture |
| MENU, DIALOG, ACCEL, STRING | | the Windows UI |

Bitmaps are stored as a DIB with no file header: a 40 byte BITMAPINFOHEADER, the palette, then pixels bottom row first. `formats.js` decodes 1, 4 and 8 bit, uncompressed, RLE8 and RLE4.

### Tile sheet layout

13 columns by 16 rows of 32x32 tiles.

* Columns 0 to 6: tiles `0x00` to `0x6F`, column major. Tile `n` is at column `n >> 4`, row `n & 15`.
* Columns 7 to 9: tiles `0x40` to `0x6F` (creatures, keys, boots, Chip) drawn on white.
* Columns 10 to 12: masks for columns 7 to 9, white where the object is.

The engine draws a creature by drawing the tile underneath it, then the masked sprite on top. `formats.js` turns columns 7 to 12 into three columns with real transparency, so both front ends get a 320x512 RGBA sheet in the same layout as the free tileset.

### LED digits

24 glyphs of 17x23, top to bottom: minus, blank, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0 in yellow, then the same twelve in green. Green is normal; yellow is used for the timer at 15 seconds or less and for CHIPS LEFT at zero.

### Side panel

The three counter windows inside INFOWND sit at x 45 to 99 and y 34, 96 and 186 (29 pixels tall). Three digits fit with 2 pixels to spare.

## Tile ids

| ids | tiles |
|---|---|
| 00 to 05 | floor, wall, computer chip, water, fire, invisible wall |
| 06 to 09, 30 | thin walls N, W, S, E, and SE |
| 0A, 0B, 0C | block, dirt, ice |
| 0D, 12, 13, 14, 32 | force floors S, N, E, W, random |
| 0E to 11 | clone machine block templates facing N, W, S, E |
| 15, 16 to 19 | exit, blue red green yellow doors |
| 1A to 1D | ice corners, walled on NW, NE, SE, SW |
| 1E, 1F | blue walls: 1E turns into floor, 1F is real |
| 21, 22 | thief, chip socket |
| 23, 24, 27, 28 | green, red, brown, blue buttons |
| 25, 26 | toggle wall closed, open |
| 29, 2A, 2B | teleport, bomb, trap |
| 2C, 2D, 2E, 2F | hidden wall, gravel, popup wall, hint |
| 31 | clone machine |
| 33 to 3B | Chip drowned, burned, bombed, in the exit (animation tiles) |
| 3C to 3F | Chip swimming N, W, S, E |
| 40 to 63 | creatures, four facings each: bug, fireball, ball, tank, glider, teeth, walker, blob, paramecium |
| 64 to 67 | keys: blue, red, green, yellow |
| 68 to 6B | flippers, fire boots, ice skates, suction boots |
| 6C to 6F | Chip N, W, S, E |

Direction order inside every group of four is N, W, S, E.

## Sounds

The sound ids the game logic uses map to these files (from `data.asm` in the disassembly):

| id | event | file |
|---|---|---|
| 0 | pick up a key or boots | BLIP2.WAV |
| 1 | open a door | DOOR.WAV |
| 2 | Chip dies | BUMMER.WAV |
| 3 | level complete | DITTY1.WAV |
| 4 | socket opens | CHIMES.WAV (Windows) |
| 5 | bump into something | OOF3.WAV |
| 6 | thief | STRIKE.WAV |
| 8 | pick up a chip | CLICK3.WAV |
| 9 | button | POP2.WAV |
| 10 | splash | WATER2.WAV |
| 11 | bomb | HIT3.WAV (Windows) |
| 12 | teleport | TELEPORT.WAV |
| 13 | clock ticking under 15 seconds | CLICK1.WAV (Windows) |
| 14 | out of time | BELL.WAV (Windows) |

## Music

CHIP01.MID and CHIP02.MID are Windows 3.1 "dual mode" MIDI files: the same music is written twice, once on channels 1 to 3 for extended synths and again on channels 13 to 15 for basic ones. Played on a modern General MIDI synth you hear both copies at once. The web version plays only the first copy on its own small synth; the Mac app rewrites the file without the second copy (`CCMidi.singleMode`) and plays it with macOS's built in MIDI instruments. The game picks the song by level number, cycling through the list.
