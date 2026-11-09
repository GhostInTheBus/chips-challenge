#!/usr/bin/env python3
"""Draw the original "free" tileset used when no CHIPS.EXE is loaded.

Every pixel here is drawn from code, nothing is copied from the original game.
Output layout matches what the engine expects (320x512 RGBA):
  columns 0-6  opaque tiles 0x00-0x6F, tile n at column n>>4, row n&15
  columns 7-9  tiles 0x40-0x6F with transparent backgrounds
Run: python3 tools/make_free_tileset.py web/assets/tiles-free.png
"""
import math
import sys
from PIL import Image, ImageDraw, ImageFilter

S = 4            # supersample factor
T = 32 * S       # tile size while drawing

# palette
FLOOR = (196, 200, 206)
FLOOR_LINE = (172, 177, 185)
WALL = (66, 74, 92)
WALL_HI = (104, 114, 138)
WALL_LO = (38, 43, 56)
WATER = (36, 112, 204)
WATER_HI = (120, 186, 245)
ICE = (196, 236, 250)
ICE_HI = (255, 255, 255)
FORCE = (46, 160, 92)
FORCE_HI = (150, 230, 160)
DIRT = (134, 96, 58)
GRAVEL = (150, 150, 150)
KEYC = {'blue': (40, 110, 230), 'red': (220, 50, 50), 'green': (40, 170, 70), 'yellow': (240, 200, 30)}


def new(bg=None):
    im = Image.new('RGBA', (T, T), bg if bg else (0, 0, 0, 0))
    return im, ImageDraw.Draw(im)


def r(v):
    return int(round(v * S))


def floor():
    im, d = new(FLOOR + (255,))
    d.rectangle([0, 0, T - 1, T - 1], outline=FLOOR_LINE + (255,), width=S)
    d.line([r(1), r(1), r(30), r(1)], fill=(214, 218, 223, 255), width=S)
    d.line([r(1), r(1), r(1), r(30)], fill=(214, 218, 223, 255), width=S)
    return im


def wall(color=WALL, hi=WALL_HI, lo=WALL_LO):
    im, d = new(color + (255,))
    d.polygon([(0, 0), (T, 0), (T - r(4), r(4)), (r(4), r(4)), (r(4), T - r(4)), (0, T)], fill=hi + (255,))
    d.polygon([(T, T), (0, T), (r(4), T - r(4)), (T - r(4), T - r(4)), (T - r(4), r(4)), (T, 0)], fill=lo + (255,))
    for y in (11, 21):
        d.line([r(4), r(y), r(28), r(y)], fill=lo + (255,), width=S)
    for x, y0, y1 in ((16, 4, 11), (10, 11, 21), (22, 11, 21), (16, 21, 28)):
        d.line([r(x), r(y0), r(x), r(y1)], fill=lo + (255,), width=S)
    return im


def water():
    im, d = new(WATER + (255,))
    for y in range(4, 32, 8):
        pts = [(r(x), r(y + 1.6 * math.sin(x / 3.0 + y))) for x in range(0, 33)]
        d.line(pts, fill=WATER_HI + (255,), width=r(1.2))
    return im


def ice():
    im, d = new(ICE + (255,))
    for k in range(-32, 64, 9):
        d.line([r(k), r(30), r(k + 10), r(20)], fill=ICE_HI + (255,), width=r(1.2))
        d.line([r(k + 4), r(14), r(k + 9), r(9)], fill=ICE_HI + (255,), width=r(1))
    d.rectangle([0, 0, T - 1, T - 1], outline=(160, 210, 230, 255), width=S)
    return im


def dirt():
    im, d = new(DIRT + (255,))
    import random
    rnd = random.Random(7)
    for _ in range(70):
        x, y = rnd.uniform(1, 31), rnd.uniform(1, 31)
        c = rnd.choice([(110, 76, 44), (160, 120, 78), (98, 66, 38)])
        d.ellipse([r(x - 0.9), r(y - 0.9), r(x + 0.9), r(y + 0.9)], fill=c + (255,))
    return im


def gravel():
    im = floor()
    d = ImageDraw.Draw(im)
    import random
    rnd = random.Random(3)
    for _ in range(60):
        x, y = rnd.uniform(2, 30), rnd.uniform(2, 30)
        c = rnd.choice([(120, 120, 120), (90, 90, 95), (160, 160, 165)])
        rr = rnd.uniform(0.8, 1.6)
        d.ellipse([r(x - rr), r(y - rr), r(x + rr), r(y + rr)], fill=c + (255,))
    return im


def arrow_chevrons(base, color, hi, direction):
    """Force floor: chevrons pointing north, rotated later."""
    im, d = new(base + (255,))
    for y in (4, 14, 24):
        d.polygon([(r(4), r(y + 7)), (r(16), r(y)), (r(28), r(y + 7)), (r(28), r(y + 11)), (r(16), r(y + 4)), (r(4), r(y + 11))], fill=hi + (255,))
    return rot(im, direction)


def rot(im, direction):
    # direction index: 0 N, 1 W, 2 S, 3 E. Images are drawn facing north.
    return im.rotate(90 * direction, resample=Image.BICUBIC) if direction else im


def thin(edges):
    im = floor()
    d = ImageDraw.Draw(im)
    w = r(4)
    for e in edges:
        if e == 'N':
            d.rectangle([0, 0, T, w], fill=(200, 60, 60, 255))
        if e == 'S':
            d.rectangle([0, T - w, T, T], fill=(200, 60, 60, 255))
        if e == 'W':
            d.rectangle([0, 0, w, T], fill=(200, 60, 60, 255))
        if e == 'E':
            d.rectangle([T - w, 0, T, T], fill=(200, 60, 60, 255))
    return im


def ice_corner(edges):
    im = ice()
    d = ImageDraw.Draw(im)
    w = r(5)
    col = (120, 140, 160, 255)
    if 'N' in edges:
        d.rectangle([0, 0, T, w], fill=col)
    if 'S' in edges:
        d.rectangle([0, T - w, T, T], fill=col)
    if 'W' in edges:
        d.rectangle([0, 0, w, T], fill=col)
    if 'E' in edges:
        d.rectangle([T - w, 0, T, T], fill=col)
    # rounded inner corner
    cx = w if 'W' in edges else T - w
    cy = w if 'N' in edges else T - w
    rad = r(10)
    box = [cx - rad, cy - rad, cx + rad, cy + rad]
    d.pieslice(box, 0, 360, fill=col)
    return im


def block(arrow=None):
    im, d = new((0, 0, 0, 0))
    d.rectangle([r(1), r(1), r(31), r(31)], fill=(176, 128, 72, 255))
    d.rectangle([r(1), r(1), r(31), r(31)], outline=(110, 74, 36, 255), width=r(2))
    d.rectangle([r(5), r(5), r(27), r(27)], outline=(140, 98, 52, 255), width=r(1.5))
    d.line([r(5), r(5), r(27), r(27)], fill=(140, 98, 52, 255), width=r(2))
    d.line([r(27), r(5), r(5), r(27)], fill=(140, 98, 52, 255), width=r(2))
    if arrow is not None:
        a, ad = new()
        ad.polygon([(r(16), r(6)), (r(25), r(17)), (r(19), r(17)), (r(19), r(26)), (r(13), r(26)), (r(13), r(17)), (r(7), r(17))], fill=(255, 240, 200, 255), outline=(90, 60, 30, 255))
        im.alpha_composite(rot(a, arrow))
    base = floor()
    base.alpha_composite(im)
    return base


def chip_tile():
    im = floor()
    d = ImageDraw.Draw(im)
    for i in range(4):
        y = r(9 + i * 5)
        d.rectangle([r(4), y, r(28), y + r(2)], fill=(200, 170, 60, 255))
    d.rounded_rectangle([r(8), r(6), r(24), r(26)], radius=r(2), fill=(30, 34, 40, 255))
    d.rectangle([r(12), r(11), r(20), r(21)], fill=(230, 190, 60, 255))
    return im


def fire_tile():
    im = floor()
    d = ImageDraw.Draw(im)
    for cx, h, c in ((10, 20, (230, 70, 30)), (22, 18, (230, 70, 30)), (16, 26, (245, 120, 30)), (16, 14, (255, 220, 80))):
        d.polygon([(r(cx - 7), r(30)), (r(cx), r(30 - h)), (r(cx + 7), r(30))], fill=c + (255,))
    return im


def exit_tile(phase=0):
    im, d = new((20, 30, 70, 255))
    cols = [(60, 120, 255), (140, 200, 255), (255, 255, 255)]
    for i in range(6):
        k = 2 + i * 2.5
        c = cols[(i + phase) % 3]
        d.rectangle([r(k), r(k), r(32 - k), r(32 - k)], outline=c + (255,), width=r(1.2))
    return im


def teleport_tile():
    im, d = new((10, 40, 60, 255))
    for i in range(5):
        k = 2 + i * 3
        d.ellipse([r(k), r(k), r(32 - k), r(32 - k)], outline=((0, 220, 220) if i % 2 else (180, 255, 255)) + (255,), width=r(1.4))
    return im


def door(color):
    im = floor()
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([r(2), r(2), r(30), r(30)], radius=r(3), fill=color + (255,), outline=tuple(int(c * 0.6) for c in color) + (255,), width=r(2))
    d.ellipse([r(13), r(9), r(19), r(15)], fill=(20, 20, 20, 255))
    d.polygon([(r(14), r(13)), (r(18), r(13)), (r(19), r(22)), (r(13), r(22))], fill=(20, 20, 20, 255))
    return im


def blue_wall():
    return wall((50, 90, 200), (110, 150, 240), (30, 50, 130))


def button(color):
    im = floor()
    d = ImageDraw.Draw(im)
    d.ellipse([r(7), r(8), r(25), r(26)], fill=(80, 80, 80, 255))
    d.ellipse([r(7), r(6), r(25), r(24)], fill=color + (255,), outline=tuple(int(c * 0.6) for c in color) + (255,), width=r(1.5))
    d.ellipse([r(11), r(9), r(17), r(14)], fill=(255, 255, 255, 110))
    return im


def toggle(closed):
    if closed:
        im = wall((40, 120, 60), (90, 180, 110), (20, 70, 30))
    else:
        im = floor()
        d = ImageDraw.Draw(im)
        for i in range(0, 32, 4):
            d.line([r(i), r(1), r(i + 2), r(1)], fill=(40, 150, 60, 255), width=r(1.5))
            d.line([r(i), r(31), r(i + 2), r(31)], fill=(40, 150, 60, 255), width=r(1.5))
            d.line([r(1), r(i), r(1), r(i + 2)], fill=(40, 150, 60, 255), width=r(1.5))
            d.line([r(31), r(i), r(31), r(i + 2)], fill=(40, 150, 60, 255), width=r(1.5))
    return im


def socket():
    im = floor()
    d = ImageDraw.Draw(im)
    d.rectangle([r(2), r(2), r(30), r(30)], fill=(90, 90, 110, 255), outline=(50, 50, 60, 255), width=r(2))
    for x in (8, 13, 19, 24):
        d.rectangle([r(x - 1), r(4), r(x + 1), r(28)], fill=(60, 60, 75, 255))
    d.rounded_rectangle([r(10), r(10), r(22), r(22)], radius=r(2), fill=(30, 34, 40, 255))
    d.rectangle([r(13), r(13), r(19), r(19)], fill=(230, 190, 60, 255))
    return im


def bomb_sprite():
    im, d = new()
    d.ellipse([r(7), r(9), r(25), r(27)], fill=(30, 30, 35, 255))
    d.ellipse([r(11), r(12), r(15), r(16)], fill=(120, 120, 130, 255))
    d.line([r(20), r(10), r(24), r(5)], fill=(150, 110, 60, 255), width=r(1.5))
    d.ellipse([r(22), r(2), r(27), r(7)], fill=(255, 200, 40, 255))
    return im


def trap_tile():
    im = floor()
    d = ImageDraw.Draw(im)
    d.rectangle([r(3), r(3), r(29), r(29)], fill=(60, 40, 30, 255), outline=(120, 90, 60, 255), width=r(2))
    for x in range(6, 28, 5):
        d.polygon([(r(x), r(27)), (r(x + 2), r(19)), (r(x + 4), r(27))], fill=(170, 170, 180, 255))
    return im


def popup_tile():
    im = floor()
    d = ImageDraw.Draw(im)
    d.rectangle([r(5), r(5), r(27), r(27)], outline=(120, 125, 135, 255), width=r(2))
    d.line([r(5), r(27), r(27), r(27)], fill=(235, 238, 242, 255), width=r(2))
    d.line([r(27), r(5), r(27), r(27)], fill=(235, 238, 242, 255), width=r(2))
    return im


def hint_tile():
    im = floor()
    d = ImageDraw.Draw(im)
    d.ellipse([r(6), r(6), r(26), r(26)], fill=(250, 220, 60, 255), outline=(160, 120, 20, 255), width=r(1.5))
    d.arc([r(12), r(10), r(20), r(18)], 180, 30, fill=(60, 40, 0, 255), width=r(2))
    d.line([r(16), r(17), r(16), r(20)], fill=(60, 40, 0, 255), width=r(2))
    d.ellipse([r(15), r(21.5), r(17), r(23.5)], fill=(60, 40, 0, 255))
    return im


def clone_machine():
    im = floor()
    d = ImageDraw.Draw(im)
    d.rectangle([r(2), r(2), r(30), r(30)], fill=(150, 150, 165, 255), outline=(80, 80, 95, 255), width=r(2))
    d.rectangle([r(7), r(7), r(25), r(25)], fill=(210, 210, 220, 255), outline=(100, 100, 115, 255), width=r(1.5))
    for x, y in ((4, 4), (28, 4), (4, 28), (28, 28)):
        d.ellipse([r(x - 1), r(y - 1), r(x + 1), r(y + 1)], fill=(60, 60, 70, 255))
    return im


def random_force():
    im, d = new(FORCE + (255,))
    for i in range(4):
        a = i * math.pi / 2
        pts = []
        for k in range(12):
            t = k / 11.0
            ang = a + t * 2.4
            rad = 3 + t * 11
            pts.append((r(16 + rad * math.cos(ang)), r(16 + rad * math.sin(ang))))
        d.line(pts, fill=FORCE_HI + (255,), width=r(2.2))
    return im


def thief_sprite():
    im, d = new()
    d.ellipse([r(10), r(4), r(22), r(16)], fill=(240, 200, 160, 255))
    d.rectangle([r(7), r(4), r(25), r(7)], fill=(40, 40, 40, 255))
    d.rectangle([r(11), r(0), r(21), r(5)], fill=(40, 40, 40, 255))
    d.rectangle([r(10), r(9), r(22), r(11)], fill=(20, 20, 20, 255))
    d.polygon([(r(8), r(30)), (r(10), r(16)), (r(22), r(16)), (r(24), r(30))], fill=(70, 70, 90, 255))
    return im


# ---------------------------------------------------------------- sprites
# All sprites face north and are rotated to make W, S, E.

def bug():
    im, d = new()
    for y in (12, 17, 22):
        d.line([r(7), r(y - 3), r(25), r(y + 3)], fill=(60, 30, 10, 255), width=r(1.5))
        d.line([r(25), r(y - 3), r(7), r(y + 3)], fill=(60, 30, 10, 255), width=r(1.5))
    d.ellipse([r(10), r(9), r(22), r(28)], fill=(200, 60, 40, 255), outline=(90, 20, 10, 255), width=r(1))
    d.line([r(16), r(11), r(16), r(28)], fill=(90, 20, 10, 255), width=r(1))
    d.ellipse([r(12), r(4), r(20), r(12)], fill=(40, 20, 10, 255))
    d.line([r(13), r(5), r(10), r(1)], fill=(40, 20, 10, 255), width=r(1))
    d.line([r(19), r(5), r(22), r(1)], fill=(40, 20, 10, 255), width=r(1))
    return im


def fireball():
    im, d = new()
    d.polygon([(r(16), r(1)), (r(25), r(14)), (r(26), r(24)), (r(16), r(31)), (r(6), r(24)), (r(7), r(14))], fill=(235, 70, 20, 255))
    d.polygon([(r(16), r(7)), (r(22), r(17)), (r(21), r(25)), (r(16), r(28)), (r(11), r(25)), (r(10), r(17))], fill=(255, 170, 30, 255))
    d.ellipse([r(12), r(16), r(20), r(26)], fill=(255, 240, 150, 255))
    return im


def ball():
    im, d = new()
    d.ellipse([r(5), r(5), r(27), r(27)], fill=(230, 80, 170, 255), outline=(140, 30, 100, 255), width=r(1))
    d.ellipse([r(10), r(9), r(17), r(15)], fill=(255, 200, 235, 255))
    return im


def tank():
    im, d = new()
    d.rectangle([r(5), r(10), r(9), r(29)], fill=(40, 40, 50, 255))
    d.rectangle([r(23), r(10), r(27), r(29)], fill=(40, 40, 50, 255))
    d.rectangle([r(9), r(12), r(23), r(28)], fill=(60, 90, 170, 255), outline=(30, 45, 100, 255), width=r(1))
    d.ellipse([r(11), r(14), r(21), r(24)], fill=(90, 130, 220, 255))
    d.rectangle([r(15), r(2), r(17), r(16)], fill=(30, 45, 100, 255))
    return im


def glider():
    im, d = new()
    d.polygon([(r(16), r(2)), (r(29), r(28)), (r(16), r(21)), (r(3), r(28))], fill=(80, 170, 110, 255), outline=(30, 90, 50, 255))
    d.line([r(16), r(4), r(16), r(20)], fill=(200, 255, 210, 255), width=r(1.5))
    return im


def teeth():
    im, d = new()
    d.ellipse([r(4), r(4), r(28), r(28)], fill=(70, 160, 60, 255), outline=(30, 80, 20, 255), width=r(1))
    d.pieslice([r(7), r(2), r(25), r(20)], 200, 340, fill=(40, 10, 10, 255))
    for x in (11, 15, 19):
        d.polygon([(r(x), r(6)), (r(x + 3), r(6)), (r(x + 1.5), r(10))], fill=(255, 255, 255, 255))
    d.ellipse([r(9), r(14), r(14), r(19)], fill=(255, 255, 255, 255))
    d.ellipse([r(18), r(14), r(23), r(19)], fill=(255, 255, 255, 255))
    d.ellipse([r(11), r(15), r(13), r(17)], fill=(0, 0, 0, 255))
    d.ellipse([r(20), r(15), r(22), r(17)], fill=(0, 0, 0, 255))
    return im


def walker():
    im, d = new()
    d.rectangle([r(14), r(8), r(18), r(24)], fill=(110, 60, 150, 255))
    d.ellipse([r(8), r(2), r(24), r(14)], fill=(160, 100, 210, 255), outline=(80, 40, 110, 255), width=r(1))
    d.ellipse([r(8), r(18), r(24), r(30)], fill=(160, 100, 210, 255), outline=(80, 40, 110, 255), width=r(1))
    return im


def blob():
    im, d = new()
    d.polygon([(r(6), r(26)), (r(4), r(14)), (r(10), r(5)), (r(18), r(4)), (r(27), r(10)), (r(28), r(22)), (r(22), r(29)), (r(12), r(29))], fill=(110, 200, 60, 255), outline=(50, 110, 20, 255))
    d.ellipse([r(10), r(10), r(15), r(15)], fill=(255, 255, 255, 255))
    d.ellipse([r(18), r(10), r(23), r(15)], fill=(255, 255, 255, 255))
    d.ellipse([r(12), r(12), r(14), r(14)], fill=(0, 0, 0, 255))
    d.ellipse([r(20), r(12), r(22), r(14)], fill=(0, 0, 0, 255))
    return im


def paramecium():
    im, d = new()
    for i, y in enumerate((5, 11, 17, 23)):
        c = (220, 180, 60) if i == 0 else (200, 150, 50)
        d.ellipse([r(9), r(y), r(23), r(y + 8)], fill=c + (255,), outline=(120, 80, 20, 255), width=r(1))
        d.line([r(7), r(y + 4), r(4), r(y + 2)], fill=(120, 80, 20, 255), width=r(1))
        d.line([r(25), r(y + 4), r(28), r(y + 2)], fill=(120, 80, 20, 255), width=r(1))
    return im


def key(color):
    im, d = new()
    c = KEYC[color]
    dark = tuple(int(v * 0.55) for v in c)
    d.ellipse([r(5), r(4), r(17), r(16)], fill=c + (255,), outline=dark + (255,), width=r(1.2))
    d.ellipse([r(9), r(8), r(13), r(12)], fill=(0, 0, 0, 0))
    d.polygon([(r(14), r(13)), (r(17), r(11)), (r(28), r(25)), (r(25), r(28))], fill=c + (255,), outline=dark + (255,))
    d.polygon([(r(22), r(22)), (r(25), r(19)), (r(28), r(22)), (r(25), r(25))], fill=dark + (255,))
    return im


def boot(kind):
    im, d = new()
    if kind == 'flippers':
        for x in (6, 17):
            d.polygon([(r(x + 2), r(6)), (r(x + 7), r(6)), (r(x + 9), r(28)), (r(x), r(28))], fill=(40, 120, 220, 255), outline=(20, 60, 130, 255))
    else:
        col = {'fire': (220, 60, 30), 'skates': (160, 200, 230), 'suction': (60, 160, 70)}[kind]
        d.polygon([(r(10), r(4)), (r(18), r(4)), (r(18), r(18)), (r(27), r(21)), (r(27), r(26)), (r(8), r(26))], fill=col + (255,), outline=tuple(int(v * 0.5) for v in col) + (255,))
        if kind == 'skates':
            d.line([r(6), r(29), r(28), r(29)], fill=(90, 90, 100, 255), width=r(2))
        if kind == 'suction':
            for x in (11, 17, 23):
                d.ellipse([r(x - 2), r(25), r(x + 2), r(30)], fill=(30, 90, 30, 255))
        if kind == 'fire':
            d.polygon([(r(12), r(16)), (r(14), r(10)), (r(16), r(16))], fill=(255, 210, 60, 255))
    return im


def chip_sprite():
    im, d = new()
    d.polygon([(r(9), r(30)), (r(10), r(17)), (r(22), r(17)), (r(23), r(30))], fill=(60, 110, 200, 255))
    d.rectangle([r(12), r(15), r(20), r(18)], fill=(230, 230, 240, 255))
    d.ellipse([r(9), r(3), r(23), r(17)], fill=(250, 210, 170, 255), outline=(150, 100, 70, 255), width=r(1))
    d.chord([r(8), r(1), r(24), r(14)], 180, 360, fill=(90, 60, 30, 255))
    d.ellipse([r(11.5), r(2), r(15.5), r(6)], fill=(40, 40, 40, 255))
    d.ellipse([r(16.5), r(2), r(20.5), r(6)], fill=(40, 40, 40, 255))
    return im


def chip_front():
    im, d = new()
    d.polygon([(r(9), r(30)), (r(10), r(17)), (r(22), r(17)), (r(23), r(30))], fill=(60, 110, 200, 255))
    d.ellipse([r(9), r(3), r(23), r(17)], fill=(250, 210, 170, 255), outline=(150, 100, 70, 255), width=r(1))
    d.chord([r(8), r(1), r(24), r(12)], 180, 360, fill=(90, 60, 30, 255))
    d.ellipse([r(11), r(9), r(15), r(13)], fill=(255, 255, 255, 255), outline=(40, 40, 40, 255), width=r(0.8))
    d.ellipse([r(17), r(9), r(21), r(13)], fill=(255, 255, 255, 255), outline=(40, 40, 40, 255), width=r(0.8))
    d.ellipse([r(12.5), r(10.5), r(13.8), r(11.8)], fill=(0, 0, 0, 255))
    d.ellipse([r(18.5), r(10.5), r(19.8), r(11.8)], fill=(0, 0, 0, 255))
    d.arc([r(13), r(11), r(19), r(15.5)], 20, 160, fill=(120, 40, 40, 255), width=r(1))
    return im


def chip_side():
    """Chip facing east, mirrored for west."""
    im, d = new()
    d.polygon([(r(10), r(30)), (r(11), r(17)), (r(21), r(17)), (r(22), r(30))], fill=(60, 110, 200, 255))
    d.ellipse([r(9), r(3), r(23), r(17)], fill=(250, 210, 170, 255), outline=(150, 100, 70, 255), width=r(1))
    d.chord([r(8), r(1), r(24), r(13)], 150, 330, fill=(90, 60, 30, 255))
    d.pieslice([r(6), r(1), r(20), r(17)], 90, 270, fill=(90, 60, 30, 255))
    d.ellipse([r(17), r(8), r(21), r(12)], fill=(255, 255, 255, 255), outline=(40, 40, 40, 255), width=r(0.8))
    d.ellipse([r(19), r(9.5), r(20.5), r(11)], fill=(0, 0, 0, 255))
    d.polygon([(r(22.5), r(10)), (r(25), r(12.5)), (r(22.5), r(13))], fill=(240, 190, 150, 255))
    return im


def over(base, sprite):
    b = base.copy()
    b.alpha_composite(sprite)
    return b


def main(out):
    tiles = {}
    F = floor()
    tiles[0x00] = F
    tiles[0x01] = wall()
    tiles[0x02] = chip_tile()
    tiles[0x03] = water()
    tiles[0x04] = fire_tile()
    tiles[0x05] = F
    tiles[0x06] = thin('N'); tiles[0x07] = thin('W'); tiles[0x08] = thin('S'); tiles[0x09] = thin('E')
    tiles[0x0A] = block()
    tiles[0x0B] = dirt()
    tiles[0x0C] = ice()
    tiles[0x0D] = arrow_chevrons(FORCE, None, FORCE_HI, 2)
    tiles[0x0E] = block(0); tiles[0x0F] = block(1); tiles[0x10] = block(2); tiles[0x11] = block(3)
    tiles[0x12] = arrow_chevrons(FORCE, None, FORCE_HI, 0)
    tiles[0x13] = arrow_chevrons(FORCE, None, FORCE_HI, 3)
    tiles[0x14] = arrow_chevrons(FORCE, None, FORCE_HI, 1)
    tiles[0x15] = exit_tile(0)
    tiles[0x16] = door(KEYC['blue']); tiles[0x17] = door(KEYC['red']); tiles[0x18] = door(KEYC['green']); tiles[0x19] = door(KEYC['yellow'])
    tiles[0x1A] = ice_corner('NW'); tiles[0x1B] = ice_corner('NE'); tiles[0x1C] = ice_corner('SE'); tiles[0x1D] = ice_corner('SW')
    tiles[0x1E] = blue_wall(); tiles[0x1F] = blue_wall()
    tiles[0x20] = F
    tiles[0x21] = over(F, thief_sprite())
    tiles[0x22] = socket()
    tiles[0x23] = button((60, 190, 80)); tiles[0x24] = button((220, 60, 60))
    tiles[0x25] = toggle(True); tiles[0x26] = toggle(False)
    tiles[0x27] = button((150, 100, 50)); tiles[0x28] = button((60, 110, 230))
    tiles[0x29] = teleport_tile()
    tiles[0x2A] = over(F, bomb_sprite())
    tiles[0x2B] = trap_tile()
    tiles[0x2C] = F
    tiles[0x2D] = gravel()
    tiles[0x2E] = popup_tile()
    tiles[0x2F] = hint_tile()
    tiles[0x30] = thin('SE')
    tiles[0x31] = clone_machine()
    tiles[0x32] = random_force()
    W = water()
    splash = W.copy(); sd = ImageDraw.Draw(splash)
    for a in range(0, 360, 45):
        x, y = 16 + 9 * math.cos(math.radians(a)), 16 + 9 * math.sin(math.radians(a))
        sd.ellipse([r(x - 2), r(y - 2), r(x + 2), r(y + 2)], fill=(230, 245, 255, 255))
    tiles[0x33] = splash
    burned = over(fire_tile(), chip_front()); bd = ImageDraw.Draw(burned)
    tiles[0x34] = Image.blend(burned, Image.new('RGBA', burned.size, (40, 20, 10, 255)), 0.45)
    bombed = F.copy(); bd = ImageDraw.Draw(bombed)
    for a in range(0, 360, 30):
        bd.line([r(16), r(16), r(16 + 14 * math.cos(math.radians(a))), r(16 + 14 * math.sin(math.radians(a)))], fill=(255, 150, 30, 255), width=r(2))
    bd.ellipse([r(9), r(9), r(23), r(23)], fill=(255, 230, 120, 255))
    tiles[0x35] = bombed
    tiles[0x36] = F; tiles[0x37] = F; tiles[0x38] = F
    tiles[0x39] = over(exit_tile(0), chip_front())
    tiles[0x3A] = exit_tile(1); tiles[0x3B] = exit_tile(2)
    side = chip_side()
    for dr, src in enumerate((chip_sprite(), side.transpose(Image.FLIP_LEFT_RIGHT), chip_front(), side)):
        head = src.crop((0, 0, T, r(18)))
        canvas = Image.new('RGBA', (T, T)); canvas.paste(head, (0, r(8)))
        tiles[0x3C + dr] = over(W, canvas)

    sprites = {}
    for base, fn in ((0x40, bug), (0x44, fireball), (0x48, ball), (0x4C, tank), (0x50, glider), (0x54, teeth), (0x58, walker), (0x5C, blob), (0x60, paramecium)):
        im = fn()
        for dr in range(4):
            sprites[base + dr] = rot(im, dr)
    for i, c in enumerate(('blue', 'red', 'green', 'yellow')):
        sprites[0x64 + i] = key(c)
    for i, k in enumerate(('flippers', 'fire', 'skates', 'suction')):
        sprites[0x68 + i] = boot(k)
    cs = chip_sprite()
    sprites[0x6C] = cs
    sprites[0x6D] = chip_side().transpose(Image.FLIP_LEFT_RIGHT)
    sprites[0x6E] = chip_front()
    sprites[0x6F] = chip_side()
    for n, sp in sprites.items():
        tiles[n] = over(F, sp)

    sheet = Image.new('RGBA', (320 * S, 512 * S), (0, 0, 0, 0))
    for n, im in tiles.items():
        sheet.paste(im, ((n >> 4) * T, (n & 15) * T))
    for n, sp in sprites.items():
        sheet.paste(sp, ((7 + ((n - 0x40) >> 4)) * T, (n & 15) * T))
    sheet = sheet.resize((320, 512), Image.LANCZOS)
    sheet.save(out)
    print('wrote', out)


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'tiles-free.png')
