# Contributing

Thanks for wanting to help. Bug reports, rule fixes and level testing are all welcome.

## Ground rules

* Never commit original game data: no CHIPS.DAT, CHIPS.EXE, .WAV, .MID or anything extracted from them (tiles, screenshots of extracted sheets as files the code loads, and so on). `.gitignore` blocks the common names.
* Rules changes should point at where the behavior comes from: a routine in the [CHIPS.EXE disassembly](https://github.com/magical/CHIPS.EXE) or a section of `docs/RULES.md`. "Tile World does it this way" is useful context but not enough on its own, since Tile World is a separate engine.
* Keep `web/js/engine.js` free of the DOM. The Mac app runs it in JavaScriptCore.

## Layout

```
web/            the browser version (open index.html through any static server)
  js/formats.js   CHIPS.DAT, NE resources, bitmaps, zip
  js/engine.js    the game rules
  js/midi.js      MIDI reader and small synth
  js/app.js       page: drawing, input, sound, storage, dialogs
mac/            the Mac app (Swift, AppKit, JavaScriptCore)
tools/          scripts that draw the free tileset and the icon
test/           node tests
docs/           TIL, ELI5, file formats, rules
```

## Before a pull request

```sh
node test/mechanics.js
node test/fuzz.js web/levels/CCLP1.dat
```

If you change anything the Mac app touches, also run `bash mac/build.sh`.

The Mac app has test hooks that need no screen recording permission. Point it at a level, feed it moves, and it writes a PNG of its window:

```sh
CC_SET=cclp1 CC_LEVEL=0 CC_MOVES="LLUURR" CC_SNAPSHOT=/tmp/shot.png CC_QUIT=1 \
  "build/Chip's Challenge.app/Contents/MacOS/ChipsChallenge"
```

## Reporting a bug

Use the bug report template. The most useful thing is the level set, the level number and what you did, ideally as a move list (N, W, S, E) that `node test/route.js` can replay.
