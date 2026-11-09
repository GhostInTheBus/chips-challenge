# ELI5

Chip's Challenge is a puzzle game from 1989 that a lot of people played on Windows in the 90s. You're a kid named Chip. Every level is a maze. You pick up computer chips, find keys for colored doors, and get to the exit before the clock runs out. Water drowns you unless you have flippers, fire burns you unless you have fire boots, ice makes you slide, and bugs and other creatures wander around trying to bump into you.

The Windows version is an old program for Windows 3.1. Modern computers can't run it anymore without an emulator.

This project rebuilds the game so it runs today:

* In a web browser, as a normal web page.
* On a Mac, as a real Mac app.

How it works, simply:

1. The game's levels live in a file called CHIPS.DAT. I worked out how that file is laid out, so the new game can read the original levels.
2. The pictures (Chip, the walls, the bugs) are hidden inside the game's program file, CHIPS.EXE. The new game digs them out of there.
3. The tricky part is the rules: exactly how fast things move, which way bugs turn, what happens when a block lands on a button. People who love this game already translated the whole original program back into readable form. I read those rules and rewrote them as new code that behaves the same way.
4. Both the web page and the Mac app use that same rules code, so they play the same.

What you need to play:

* Nothing. It comes with 149 free levels the Chip's Challenge fans made (called CCLP1) and new pictures I drew from scratch.
* If you own the original game, load its files and you get the original 149 levels, the original pictures, sounds and music. Those files stay on your computer; nothing is uploaded and none of them are in this repo.
