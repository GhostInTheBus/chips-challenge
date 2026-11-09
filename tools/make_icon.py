#!/usr/bin/env python3
"""Draw the app icon (1024x1024 PNG) from the free tileset drawing code."""
import sys
from PIL import Image, ImageDraw, ImageFilter
import make_free_tileset as ft

ft.S = 26
ft.T = 32 * ft.S
SIZE = 1024


def main(out):
    icon = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    m = 100
    bg = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    d = ImageDraw.Draw(bg)
    d.rounded_rectangle([m, m, SIZE - m, SIZE - m], radius=180, fill=(14, 70, 38, 255))
    for y, x0, x1 in ((300, 140, 520), (720, 500, 890), (520, 140, 300)):
        d.line([x0, y, x1, y], fill=(47, 174, 90, 255), width=14)
        d.ellipse([x1 - 18, y - 18, x1 + 18, y + 18], fill=(80, 220, 120, 255))
    d.line([760, 140, 760, 330], fill=(47, 174, 90, 255), width=14)
    shadow = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle([m, m + 18, SIZE - m, SIZE - m + 18], radius=180, fill=(0, 0, 0, 120))
    icon.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(20)))
    icon.alpha_composite(bg)
    chip = ft.chip_front().resize((700, 700), Image.LANCZOS)
    icon.alpha_composite(chip, (162, 190))
    icon.save(out)
    print('wrote', out)


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'icon.png')
