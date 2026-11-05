#!/usr/bin/env python3
"""Draws the launcher's emblem: src/assets/brand-mark.png, build/icon.png and build/icon.svg.

All of it is drawn here (an arch against a dusk sun): nothing comes from the game.
src/assets/launcher-bg.png is a supplied painting, not drawn here.
Usage: python3 build/make-art.py   (needs numpy and Pillow)
"""
import os
import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


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

mark(256).save(os.path.join(ROOT, 'src/assets/brand-mark.png'), optimize=True)
mark(1024).save(os.path.join(ROOT, 'build/icon.png'), optimize=True)
open(os.path.join(ROOT, 'build/icon.svg'), 'w').write(SVG)
