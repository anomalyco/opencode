#!/usr/bin/env python3
"""Generate the VeniceCode app icon: a Venetian Gothic ogee window rendered as ASCII
art in phosphor green on black, in the spirit of old-school terminal-art crews.

The arch geometry is rasterised to a character grid and stamped in Menlo Bold, then
bloomed and scanlined for the CRT look. Nothing here is traced from anyone else's
artwork -- the shape is VeniceCode's own mark, drawn with characters instead of fills.

    python3 icons/generate.py          # rewrites icons/{prod,dev,beta}

Requires Pillow and macOS `iconutil`.
"""
from PIL import Image, ImageDraw, ImageFilter, ImageFont
import math, os, sys

S, N, BODY = 4, 1024, 824
C = N * S
MARGIN = (N - BODY) // 2

BLACK = (4, 8, 5)
PHOSPHOR = (72, 255, 110)     # classic terminal green
DIM = (34, 190, 76)
FONT = "/System/Library/Fonts/Menlo.ttc"

# character ramp, light -> heavy
RAMP = [":", "*", "#", "@", "@"]

def px(v): return v * S

def squircle(size, n=5.0):
    m = Image.new("L", (size, size), 0)
    a = size / 2.0
    pts = []
    for i in range(3000):
        t = 2 * math.pi * i / 3000
        ct, st = math.cos(t), math.sin(t)
        pts.append((a + a * math.copysign(abs(ct) ** (2 / n), ct),
                    a + a * math.copysign(abs(st) ** (2 / n), st)))
    ImageDraw.Draw(m).polygon(pts, fill=255)
    return m

def bez(p0, c1, c2, p3, steps=300):
    out = []
    for i in range(steps + 1):
        t = i / steps; u = 1 - t
        out.append((u**3*p0[0] + 3*u*u*t*c1[0] + 3*u*t*t*c2[0] + t**3*p3[0],
                    u**3*p0[1] + 3*u*u*t*c1[1] + 3*u*t*t*c2[1] + t**3*p3[1]))
    return out

def ogee(x0, x1, y_bot, y_spring, y_apex, bulge=10):
    xc = (x0 + x1) / 2.0
    h = y_spring - y_apex
    hw = xc - x0
    ix, iy = x0 + 0.46 * hw, y_spring - 0.50 * h
    d = (0.40, -0.916)
    lower = bez((x0, y_spring), (x0 - bulge, y_spring - 0.30 * h),
                (ix - d[0] * 0.34 * h, iy - d[1] * 0.34 * h), (ix, iy))
    upper = bez((ix, iy), (ix + d[0] * 0.26 * h, iy + d[1] * 0.26 * h),
                (xc, y_apex + 0.40 * h), (xc, y_apex))
    left = lower + upper[1:]
    right = [(2 * xc - x, y) for (x, y) in reversed(left)]
    return [(x0, y_bot)] + left + right + [(x1, y_bot)]

def arch_mask(size, cols, rows):
    """Coverage grid of the ogee window band, sampled per character cell."""
    hi = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(hi)
    k = size / 824.0
    band = 62
    x0, x1, y_bot, y_spring, y_apex = 222, 602, 664, 418, 166
    outer = [(x * k, y * k) for x, y in ogee(x0, x1, y_bot, y_spring, y_apex)]
    inner = [(x * k, y * k) for x, y in
             ogee(x0 + band, x1 - band, y_bot - band, y_spring + 14, y_apex + band * 2.3, bulge=0)]
    d.polygon(outer, fill=255)
    d.polygon(inner, fill=0)
    # sill
    d.rounded_rectangle([(x0 - 34) * k, y_bot * k, (x1 + 34) * k, (y_bot + 46) * k], radius=8 * k, fill=255)
    return hi.resize((cols, rows), Image.BOX)

def build(out, cols=26, rows=30, scanlines=True):
    body = Image.new("RGBA", (px(BODY), px(BODY)), BLACK + (255,))
    grid = arch_mask(px(BODY), cols, rows)

    cell_w = px(BODY) / cols
    cell_h = px(BODY) / rows
    font = ImageFont.truetype(FONT, int(cell_h * 1.06), index=1)  # Menlo Bold

    glyphs = Image.new("RGBA", body.size, (0, 0, 0, 0))
    gd = ImageDraw.Draw(glyphs)
    for row in range(rows):
        for col in range(cols):
            v = grid.getpixel((col, row)) / 255.0
            if v < 0.10:
                continue
            ch = RAMP[min(len(RAMP) - 1, int(v * len(RAMP)))]
            colour = PHOSPHOR if v > 0.45 else DIM
            x = col * cell_w + cell_w / 2
            y = row * cell_h + cell_h / 2
            gd.text((x, y), ch, font=font, fill=colour + (255,), anchor="mm")

    # phosphor bloom
    glow = glyphs.filter(ImageFilter.GaussianBlur(px(6)))
    for _ in range(3):
        body.alpha_composite(Image.blend(Image.new("RGBA", body.size, (0, 0, 0, 0)), glow, 0.8))
    body.alpha_composite(glyphs)

    if scanlines:
        lines = Image.new("RGBA", body.size, (0, 0, 0, 0))
        ld = ImageDraw.Draw(lines)
        step = px(6)
        for y in range(0, px(BODY), step):
            ld.rectangle([0, y, px(BODY), y + step // 2], fill=(0, 0, 0, 60))
        body.alpha_composite(lines)

    body.putalpha(squircle(px(BODY)))

    canvas = Image.new("RGBA", (C, C), (0, 0, 0, 0))
    sh = Image.new("RGBA", (C, C), (0, 0, 0, 0))
    sh.paste((0, 0, 0, 95), (px(MARGIN), px(MARGIN + 11)), squircle(px(BODY)))
    canvas.alpha_composite(sh.filter(ImageFilter.GaussianBlur(px(10))))
    canvas.alpha_composite(body, (px(MARGIN), px(MARGIN)))
    canvas.resize((N, N), Image.LANCZOS).save(out)
    print("wrote", out)


def emit(dest_dirs):
    """Render the master and derive every icon asset macOS/electron-builder needs."""
    import shutil, subprocess, tempfile
    tmp = tempfile.mkdtemp()
    master, iconset, icns = (os.path.join(tmp, n) for n in ("master.png", "icon.iconset", "icon.icns"))
    build(master, cols=17, rows=20)
    im = Image.open(master)
    os.makedirs(iconset)
    for s in (16, 32, 128, 256, 512):
        im.resize((s, s), Image.LANCZOS).save(f"{iconset}/icon_{s}x{s}.png")
        im.resize((s * 2, s * 2), Image.LANCZOS).save(f"{iconset}/icon_{s}x{s}@2x.png")
    subprocess.run(["iconutil", "-c", "icns", iconset, "-o", icns], check=True)
    for d in dest_dirs:
        shutil.copy(master, f"{d}/icon.png")
        shutil.copy(icns, f"{d}/icon.icns")
        im.resize((256, 256), Image.LANCZOS).save(f"{d}/dock.png")
        im.resize((32, 32), Image.LANCZOS).save(f"{d}/32x32.png")
        im.resize((64, 64), Image.LANCZOS).save(f"{d}/64x64.png")
        im.resize((128, 128), Image.LANCZOS).save(f"{d}/128x128.png")
        im.resize((256, 256), Image.LANCZOS).save(f"{d}/128x128@2x.png")
        print("installed ->", d)
    shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    here = os.path.dirname(os.path.abspath(__file__))
    emit([os.path.join(here, c) for c in ("prod", "dev", "beta")])
