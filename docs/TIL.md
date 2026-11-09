# TIL

Things I learned rebuilding Chip's Challenge for Windows.

## The executable

* CHIPS.EXE is a 16 bit Windows 3.x executable (NE format), not the PE format later Windows uses. Most modern tools, including the reverse engineering toolkit I started with, won't open NE files, so `formats.js` reads the resource table itself. It's small: about 60 lines.
* All the art is in the EXE as bitmap resources, not in separate files. The main tile sheet is RLE4 compressed, a run length format for 16 color bitmaps that almost nothing uses anymore.
* The tile sheet stores every creature twice: once on its normal background and once on white with a separate black and white mask. Windows 3.1 had no alpha channel, so the game drew the mask and then the sprite to fake transparency.
* Someone already disassembled this exact EXE, byte for byte: [magical/CHIPS.EXE](https://github.com/magical/CHIPS.EXE). My copy's SHA-256 matches theirs (`8e26acd6...`), so their commented assembly describes exactly the game I had. That made it possible to port the rules instead of guessing them.

## The rules

* The whole "who can walk where" question is one 6 byte row per tile in a table inside the EXE: can Chip, a block and a monster enter, and what happens when they do. The engine carries that table over as is.
* The game clock ticks every 110 ms, not 100. Ten ticks make one game second, so a game second is 1.1 real seconds.
* Chip walks at most once every two ticks. Anything sliding on ice or a force floor moves every tick, so sliding is twice as fast as walking. Teeth and blobs move every fourth tick.
* Holding an arrow key works through Windows keyboard autorepeat. The game sets the shortest repeat delay while it runs, about a quarter second, which is why Chip pauses for a moment after the first step when you hold a key.
* Brown traps don't let go when you step off the button. Pressing the button opens the trap until the next thing walks in.
* A tank that hits a wall stops for good, until a blue button turns it around.
* A monster walking into Chip while he's swimming drowns, and Chip lives.
* Chip can't steer on ice, but on a force floor he can step off in any direction except the way it's pushing, even straight back against it.
* Bugs and walkers treat fire as a wall. Fireballs walk through it. Everything else burns.
* Only creatures named in the level's monster list ever move. A creature drawn on the map but missing from the list just sits there.
* The 1E and 1F blue walls look identical. 1E dissolves into floor when Chip walks into it; 1F turns into a real wall.
* Level bonus is 500 points times the level number, cut by a fifth every time you restart, and it can end below 500.

## The music

* The MIDI files are Windows 3.1 "dual mode": the music is written twice on different channels, one copy for fancy synths and one for basic ones. A modern synth plays both at once, which sounds doubled. Keeping only the first copy fixes it.
* Browsers can't play MIDI at all, so the web version has a tiny synth: oscillators for the instruments and filtered noise for the drums. It sounds like an early sound card, which is about right.

## Building

* The Mac app needs no Xcode project. `swiftc` builds it straight from one Swift file for Apple Silicon and Intel, `lipo` joins them, and a shell script assembles the `.app`.
* The Mac app runs the same `engine.js` the web page uses, through JavaScriptCore, which ships with macOS. Drawing, menus, keyboard, sound and music are native. One rules engine means the two versions can't drift apart.
* Breadth first search over whole game states is a good engine test: if the solver can finish a real level using only the engine's rules, the rules are probably right. It finishes Lessons 3, 5 and 7 of the original set on its own.
