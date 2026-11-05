#!/usr/bin/env python3
"""Draws the launcher's art: src/assets/launcher-bg.png, src/assets/brand-mark.png, build/icon.png and build/icon.svg.

All of it is drawn here (a dusk sky, dunes and a ruined arena's arches): nothing comes from the game.
Usage: python3 build/make-art.py   (needs numpy and Pillow)
"""
import math, os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
rng = np.random.default_rng(1984)


def lerp(a, b, t): return np.asarray(a, float) * (1 - t) + np.asarray(b, float) * t


def gradient(w, h, stops):
    """vertical gradient through (position, colour) stops"""
    y = np.linspace(0, 1, h)
    out = np.zeros((h, 3))
    for (p0, c0), (p1, c1) in zip(stops, stops[1:]):
        m = (y >= p0) & (y <= p1)
        t = ((y[m] - p0) / (p1 - p0))[:, None]
        out[m] = lerp(c0, c1, t)
    return np.repeat(out[:, None, :], w, axis=1)


def dune(w, base, parts):
    x = np.arange(w)
    y = np.full(w, float(base))
    for amp, wave, phase in parts: y += amp * np.sin(x / wave + phase)
    return y


def fill_below(img, line, top, bottom):
    h, w, _ = img.shape
    yy = np.arange(h)[:, None]
    mask = yy >= line[None, :]
    depth = np.clip((yy - line[None, :]) / max(1, h - line.min()), 0, 1)[..., None]
    colour = lerp(top, bottom, depth)
    img[mask] = colour[mask]


def arena(draw, cx, base, width, height, colour, shade):
    """a broken ring of two storeys of arches, seen from the side"""
    arches = 9
    bay = width / arches
    left = cx - width / 2
    for storey in range(2):
        y1 = base - storey * height * 0.5
        y0 = y1 - height * 0.5
        for i in range(arches):
            # the ruin falls away to the right, more on the upper storey
            broken = (i / arches) ** 2 * (0.5 + storey) * height * 0.55
            if storey and i >= arches - 2: continue
            x0 = left + i * bay
            draw.rectangle([x0, y0 + broken, x0 + bay, y1], fill=colour)
            r = bay * 0.3
            ax = x0 + bay / 2
            top = y0 + height * 0.2 + broken * 0.3
            if top + r < y1:
                draw.rectangle([ax - r, top, ax + r, y1 + 1], fill=shade)
                draw.pieslice([ax - r, top - r, ax + r, top + r], 180, 360, fill=shade)
        draw.rectangle([left, y0 - height * 0.03, left + width * (0.82 if storey else 1), y0 + height * 0.015], fill=colour)


def background(w=1920, h=1200):
    img = gradient(w, h, [(0, (22, 18, 58)), (0.32, (74, 36, 96)), (0.52, (188, 78, 86)), (0.66, (246, 150, 84)), (1, (255, 196, 120))])
    # the sun, low behind the ruin
    sx, sy, sr = w * 0.68, h * 0.60, h * 0.13
    yy, xx = np.mgrid[0:h, 0:w]
    d = np.hypot(xx - sx, yy - sy)
    img += (np.clip(1 - d / (sr * 5), 0, 1) ** 2)[..., None] * np.array([70, 42, 16])
    disc = np.clip((sr - d) / 3, 0, 1)[..., None]
    img = img * (1 - disc) + np.array([255, 226, 170]) * disc
    # stars in the upper sky
    for _ in range(420):
        x, y = rng.integers(0, w), rng.integers(0, int(h * 0.36))
        img[y, x] = lerp(img[y, x], (255, 240, 225), rng.uniform(0.25, 0.9) * (1 - y / (h * 0.36)))
    # distant mesa and dunes
    fill_below(img, dune(w, h * 0.70, [(14, 190, 0.4), (6, 61, 1.2)]), (150, 70, 96), (176, 86, 88))
    pil = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8))
    d2 = ImageDraw.Draw(pil)
    arena(d2, w * 0.67, h * 0.745, w * 0.40, h * 0.27, (66, 34, 72), (150, 76, 84))
    img = np.asarray(pil).astype(float)
    fill_below(img, dune(w, h * 0.74, [(16, 260, 2.1), (7, 83, 0.3)]), (120, 56, 78), (150, 72, 72))
    fill_below(img, dune(w, h * 0.83, [(22, 310, 0.9), (8, 97, 2.4)]), (84, 40, 66), (110, 52, 62))
    fill_below(img, dune(w, h * 0.93, [(20, 350, 3.1), (6, 120, 1.1)]), (40, 22, 48), (54, 28, 50))
    # fine grain, so the gradients don't band
    img += rng.normal(0, 1.4, (h, w, 1))
    return Image.fromarray(np.clip(img, 0, 255).astype(np.uint8))


def mark(size):
    """the emblem: an arch against the sun, on a rounded dusk tile"""
    s = 4
    n = size * s
    tile = gradient(n, n, [(0, (44, 24, 84)), (0.55, (178, 70, 88)), (1, (244, 150, 84))])
    pil = Image.fromarray(tile.astype(np.uint8))
    d = ImageDraw.Draw(pil)
    r = n * 0.25
    d.ellipse([n / 2 - r, n * 0.42 - r, n / 2 + r, n * 0.42 + r], fill=(255, 226, 170))
    col = (40, 22, 56)
    d.rectangle([n * 0.16, n * 0.40, n * 0.84, n], fill=col)
    d.rectangle([n * 0.11, n * 0.34, n * 0.89, n * 0.42], fill=col)
    a = n * 0.17
    d.rectangle([n / 2 - a, n * 0.62, n / 2 + a, n], fill=(246, 168, 96))
    d.pieslice([n / 2 - a, n * 0.62 - a, n / 2 + a, n * 0.62 + a], 180, 360, fill=(246, 168, 96))
    for x in (0.25, 0.75):
        b = n * 0.045
        d.rectangle([n * x - b, n * 0.60, n * x + b, n], fill=(92, 44, 78))
        d.pieslice([n * x - b, n * 0.60 - b, n * x + b, n * 0.60 + b], 180, 360, fill=(92, 44, 78))
    mask = Image.new('L', (n, n), 0)
    m = int(n * 0.06)
    ImageDraw.Draw(mask).rounded_rectangle([m, m, n - m, n - m], radius=n * 0.2, fill=255)
    pil.putalpha(mask)
    return pil.resize((size, size), Image.LANCZOS)


SVG = '''<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="dusk" x2="0" y2="1"><stop stop-color="#2c1854"/><stop offset=".55" stop-color="#b24658"/><stop offset="1" stop-color="#f49654"/></linearGradient>
    <clipPath id="round"><rect x="62" y="62" width="900" height="900" rx="205"/></clipPath>
  </defs>
  <rect x="62" y="62" width="900" height="900" rx="205" fill="url(#dusk)"/>
  <g clip-path="url(#round)">
    <circle cx="512" cy="430" r="256" fill="#ffe2aa"/>
    <path d="M113 348h798v82h-51v594H164V430h-51z" fill="#281638"/>
    <path d="M338 1024V635a174 174 0 0 1 348 0v389z" fill="#f6a860"/>
    <path d="M210 1024V614a46 46 0 0 1 92 0v410zM722 1024V614a46 46 0 0 1 92 0v410z" fill="#5c2c4e"/>
  </g>
</svg>
'''

background().save(os.path.join(ROOT, 'src/assets/launcher-bg.png'), optimize=True)
mark(256).save(os.path.join(ROOT, 'src/assets/brand-mark.png'), optimize=True)
mark(1024).save(os.path.join(ROOT, 'build/icon.png'), optimize=True)
open(os.path.join(ROOT, 'build/icon.svg'), 'w').write(SVG)
