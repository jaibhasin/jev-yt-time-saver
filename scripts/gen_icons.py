#!/usr/bin/env python3
"""
gen_icons.py — Generates the extension's PNG icons (16/48/128).

Draws a simple rounded-square "clock" icon using only the Python standard
library (no PIL). The clock face suggests "your time" and the red hands/dot
evoke the "timeout / stop wasting time" idea from the extension.

Run:  python3 scripts/gen_icons.py
"""

import math
import os
import struct
import zlib

# Icon palette (RGBA).
TILE_BG = (17, 27, 46, 255)     # dark navy tile
TILE_EDGE = (40, 48, 74, 255)   # slightly lighter border
RING = (255, 255, 255, 255)     # white clock face ring
HAND = (255, 59, 48, 255)       # red clock hands / centre dot

OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "icons")


def in_rounded_rect(x, y, size, r):
    """Return True if pixel (x, y) is inside a rounded rectangle of `size`."""
    px = x + 0.5
    py = y + 0.5
    if px < r:
        if py < r:
            return (px - r) ** 2 + (py - r) ** 2 <= r * r
        if py > size - r:
            return (px - r) ** 2 + (py - (size - r)) ** 2 <= r * r
        return True
    if px > size - r:
        if py < r:
            return (px - (size - r)) ** 2 + (py - r) ** 2 <= r * r
        if py > size - r:
            return (px - (size - r)) ** 2 + (py - (size - r)) ** 2 <= r * r
        return True
    return True


def dist_to_segment(px, py, ax, ay, bx, by):
    """Shortest distance from point (px, py) to segment (a -> b)."""
    vx = bx - ax
    vy = by - ay
    wx = px - ax
    wy = py - ay
    c1 = vx * wx + vy * wy
    if c1 <= 0:
        return math.hypot(px - ax, py - ay)
    c2 = vx * vx + vy * vy
    if c2 <= c1:
        return math.hypot(px - bx, py - by)
    t = c1 / c2
    return math.hypot(px - (ax + t * vx), py - (ay + t * vy))


def pixel_color(x, y, size):
    """Return the RGBA color for the pixel at (x, y) for the given icon size."""
    c = (size - 1) / 2.0
    radius = size * 0.34
    ring_w = max(1.0, size * 0.055)
    hand_w = max(1.0, size * 0.07)

    if not in_rounded_rect(x, y, size, size * 0.22):
        return (0, 0, 0, 0)  # transparent outside the rounded tile

    px = x + 0.5
    py = y + 0.5

    # Rounded tile base with a subtle edge.
    edge_w = max(1.0, size * 0.03)
    if not in_rounded_rect(x, y, size, size * 0.22 - edge_w):
        return TILE_EDGE
    color = TILE_BG

    # White clock ring (outline of the face).
    d = math.hypot(px - c, py - c)
    if abs(d - radius) <= ring_w / 2:
        color = RING

    # Red hands: minute pointing up (12 o'clock), hour pointing right (3 o'clock).
    if (
        dist_to_segment(px, py, c, c, c, c - radius * 0.62) <= hand_w / 2
        or dist_to_segment(px, py, c, c, c + radius * 0.42, c) <= hand_w / 2
    ):
        color = HAND

    # Red centre dot.
    if d <= size * 0.06:
        color = HAND

    return color


def write_png(path, size):
    """Write an RGBA PNG of the given size to `path`."""
    rows = []
    for y in range(size):
        row = bytearray([0])  # PNG filter type 0 (None) per scanline
        for x in range(size):
            r, g, b, a = pixel_color(x, y, size)
            row += bytes([r, g, b, a])
        rows.append(bytes(row))
    raw = b"".join(rows)

    def chunk(typ, data):
        c = struct.pack(">I", len(data)) + typ + data
        crc = zlib.crc32(typ + data) & 0xFFFFFFFF
        return c + struct.pack(">I", crc)

    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )
    with open(path, "wb") as f:
        f.write(png)


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    for size in (16, 48, 128):
        path = os.path.join(OUT_DIR, f"icon{size}.png")
        write_png(path, size)
        print(f"wrote {path}")


if __name__ == "__main__":
    main()
