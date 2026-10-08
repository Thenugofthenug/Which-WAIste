"""
Items
=====
The trash catalog. To add a new kind of trash, write a draw_* function using
the helpers from sprites.py, then add one line to ITEM_TYPES (playable) or
NOVEL_TYPES (only shown after training).
Each draw function takes (draw, rng, center_x, center_y, scale).
"""
import math
import random
from dataclasses import dataclass
from typing import Optional

from PIL import Image

from config import CATEGORIES, NUM_ITEMS
from sprites import B, P, bands, jitter, line_w, render_item, shade

RECYCLING, COMPOST, LANDFILL = (CATEGORIES.index(c) for c in ("Recycling", "Compost", "Landfill"))


# ----------------------------------------------------------------------------
# Playable items
# ----------------------------------------------------------------------------
def draw_plastic_bottle(d, rng, cx, cy, s):
    body = jitter(rng, rng.choice([(175, 215, 240), (200, 235, 215), (228, 234, 245)]), 8)
    cap = jitter(rng, rng.choice([(30, 90, 200), (210, 40, 40), (40, 160, 70), (250, 250, 250)]), 8)
    edge, ow = shade(body, 0.5), line_w(s)
    d.rounded_rectangle(B(cx, cy, s, -17, -12, 17, 46), radius=int(9 * s), fill=body, outline=edge, width=ow)
    d.polygon(P(cx, cy, s, [(-17, -4), (-8, -30), (8, -30), (17, -4)]), fill=body, outline=edge)
    d.rectangle(B(cx, cy, s, -8, -34, 8, -28), fill=shade(body, 0.88), outline=edge, width=ow)
    d.rounded_rectangle(B(cx, cy, s, -9, -46, 9, -34), radius=int(2 * s), fill=cap,
                        outline=shade(cap, 0.5), width=ow)
    for x in (-5, 0, 5):
        d.line(P(cx, cy, s, [(x, -44), (x, -36)]), fill=shade(cap, 0.7), width=max(1, round(s)))
    label = jitter(rng, rng.choice([(230, 60, 60), (250, 200, 50), (60, 160, 230), (80, 190, 90)]), 8)
    d.rectangle(B(cx, cy, s, -17, 6, 17, 24), fill=label)
    d.rectangle(B(cx, cy, s, -10, 12, 10, 17), fill=(250, 250, 250))
    for y in (32, 38):
        d.line(P(cx, cy, s, [(-15, y), (15, y)]), fill=edge, width=max(1, round(s)))
    d.line(P(cx, cy, s, [(-10, -4), (-10, 42)]), fill=shade(body, 1.15), width=round(4 * s))


def draw_can(d, rng, cx, cy, s):
    metal = jitter(rng, (190, 195, 205), 8)
    brand = jitter(rng, rng.choice([(200, 30, 40), (30, 70, 170), (20, 140, 70), (240, 180, 20)]), 8)
    edge, ow = (70, 72, 80), line_w(s)
    d.ellipse(B(cx, cy, s, -20, 32, 20, 44), fill=shade(metal, 0.8), outline=edge, width=ow)
    d.rectangle(B(cx, cy, s, -20, -34, 20, 38), fill=metal)
    bands(d, cx, cy, s, -20, -34, 20, -20, metal)
    d.rectangle(B(cx, cy, s, -20, -20, 20, 24), fill=brand)
    bands(d, cx, cy, s, -20, -20, 20, 24, brand)
    bands(d, cx, cy, s, -20, 24, 20, 38, metal)
    d.line(P(cx, cy, s, [(-20, 12), (20, -8)]), fill=(250, 250, 250), width=round(4 * s))
    d.line(P(cx, cy, s, [(-20, -34), (-20, 38)]), fill=edge, width=ow)
    d.line(P(cx, cy, s, [(20, -34), (20, 38)]), fill=edge, width=ow)
    d.ellipse(B(cx, cy, s, -20, -40, 20, -28), fill=shade(metal, 1.1), outline=edge, width=ow)
    d.ellipse(B(cx, cy, s, -16, -38, 16, -30), outline=shade(metal, 0.75), width=max(1, round(s)))
    d.rounded_rectangle(B(cx, cy, s, -5, -37, 7, -31), radius=int(2 * s), fill=shade(metal, 0.85),
                        outline=edge, width=max(1, round(s)))


def draw_newspaper(d, rng, cx, cy, s):
    paper, ink = jitter(rng, (236, 232, 220), 6), (45, 45, 50)
    ow = line_w(s)
    d.rectangle(B(cx, cy, s, -34, -46, 34, 46), fill=paper, outline=shade(paper, 0.6), width=ow)
    d.rectangle(B(cx, cy, s, 1, -45, 33, 45), fill=shade(paper, 0.94))
    d.line(P(cx, cy, s, [(0, -46), (0, 46)]), fill=shade(paper, 0.75), width=max(1, round(s)))
    d.rectangle(B(cx, cy, s, -29, -40, 29, -30), fill=ink)
    d.rectangle(B(cx, cy, s, -29, -25, -4, -3), fill=(150, 168, 185))
    d.polygon(P(cx, cy, s, [(-29, -3), (-20, -17), (-13, -8), (-8, -13), (-4, -3)]), fill=(90, 115, 90))
    d.line(P(cx, cy, s, [(4, -25), (29, -25)]), fill=ink, width=round(3 * s))
    text = (120, 120, 125)
    for y in range(-18, 42, 5):
        d.line(P(cx, cy, s, [(4, y), (29, y)]), fill=text, width=max(1, round(1.4 * s)))
    for y in range(3, 42, 5):
        d.line(P(cx, cy, s, [(-29, y), (-4, y)]), fill=text, width=max(1, round(1.4 * s)))


def draw_cardboard(d, rng, cx, cy, s):
    base, edge = jitter(rng, (195, 145, 90), 8), (95, 65, 35)
    tape = (218, 198, 158)
    d.polygon(P(cx, cy, s, [(-38, -6), (-22, -28), (38, -28), (22, -6)]), fill=shade(base, 1.14), outline=edge)
    d.polygon(P(cx, cy, s, [(22, -6), (38, -28), (38, 22), (22, 44)]), fill=shade(base, 0.78), outline=edge)
    d.rectangle(B(cx, cy, s, -38, -6, 22, 44), fill=base, outline=edge, width=line_w(s))
    d.polygon(P(cx, cy, s, [(-33, -13), (-27, -21), (33, -21), (27, -13)]), fill=tape)
    d.rectangle(B(cx, cy, s, -11, -6, -3, 14), fill=tape)
    for x in (2, 12):                                            # "this side up" arrows
        d.polygon(P(cx, cy, s, [(x, 22), (x + 4, 16), (x + 8, 22)]), fill=shade(base, 0.5))
        d.rectangle(B(cx, cy, s, x + 3, 22, x + 5, 30), fill=shade(base, 0.5))
    d.rectangle(B(cx, cy, s, -32, 28, -16, 38), fill=(245, 242, 235), outline=shade(base, 0.6))


def draw_glass_jar(d, rng, cx, cy, s):
    glass = jitter(rng, rng.choice([(205, 232, 236), (192, 226, 202), (226, 212, 182)]), 6)
    edge, ow = shade(glass, 0.55), line_w(s)
    d.rounded_rectangle(B(cx, cy, s, -24, -26, 24, 44), radius=int(12 * s), fill=glass, outline=edge, width=ow)
    d.rectangle(B(cx, cy, s, -24, 4, 24, 24), fill=(248, 246, 238))
    d.rectangle(B(cx, cy, s, -24, 4, 24, 9), fill=jitter(rng, rng.choice([(200, 60, 60), (60, 120, 200)]), 10))
    lid = jitter(rng, (172, 172, 180), 8)
    d.rectangle(B(cx, cy, s, -21, -40, 21, -26), fill=lid, outline=shade(lid, 0.5), width=ow)
    for x in range(-17, 20, 4):
        d.line(P(cx, cy, s, [(x, -38), (x, -28)]), fill=shade(lid, 0.75), width=max(1, round(s)))
    d.line(P(cx, cy, s, [(-16, -20), (-16, 0)]), fill=(255, 255, 255), width=round(4 * s))
    d.line(P(cx, cy, s, [(-16, 28), (-16, 38)]), fill=(255, 255, 255), width=round(4 * s))
    d.line(P(cx, cy, s, [(17, -18), (17, -6)]), fill=shade(glass, 1.12), width=round(2 * s))


def draw_banana_peel(d, rng, cx, cy, s):
    yellow, inner = jitter(rng, (245, 210, 55), 8), (250, 240, 195)
    brown = (110, 75, 30)
    for k in (-1, 0, 1):
        pts = [(k * 30 * t + k * 12 * math.sin(math.pi * t), -10 + 50 * t)
               for t in (i / 13 for i in range(14))]
        d.line(P(cx, cy, s, pts), fill=yellow, width=round(13 * s), joint="curve")
        d.line(P(cx, cy, s, pts[2:-1]), fill=inner, width=round(4 * s), joint="curve")
        ex, ey = pts[-1]
        d.ellipse(B(cx, cy, s, ex - 5, ey - 4, ex + 5, ey + 4), fill=brown)
    d.ellipse(B(cx, cy, s, -13, -22, 13, 4), fill=yellow, outline=shade(yellow, 0.7))
    d.rectangle(B(cx, cy, s, -4, -38, 4, -20), fill=(140, 110, 45))
    d.rectangle(B(cx, cy, s, -4, -40, 4, -35), fill=brown)


def draw_apple_core(d, rng, cx, cy, s):
    skin = jitter(rng, rng.choice([(205, 35, 45), (130, 190, 55), (225, 185, 45)]), 8)
    flesh = jitter(rng, (248, 238, 200), 5)
    d.ellipse(B(cx, cy, s, -24, -40, 24, -16), fill=skin, outline=shade(skin, 0.6))
    d.ellipse(B(cx, cy, s, -24, 16, 24, 42), fill=skin, outline=shade(skin, 0.6))
    d.ellipse(B(cx, cy, s, -14, -36, -6, -30), fill=shade(skin, 1.25))
    d.polygon(P(cx, cy, s, [(-20, -26), (20, -26), (10, -6), (10, 6), (20, 26), (-20, 26), (-10, 6), (-10, -6)]),
              fill=flesh, outline=shade(flesh, 0.75))
    d.ellipse(B(cx, cy, s, -6, -12, 6, 12), fill=shade(flesh, 0.86))
    d.ellipse(B(cx, cy, s, -4, -9, 1, -2), fill=(90, 50, 20))
    d.ellipse(B(cx, cy, s, -1, 2, 4, 9), fill=(90, 50, 20))
    d.line(P(cx, cy, s, [(0, -40), (3, -50)]), fill=(100, 65, 30), width=round(3 * s))
    d.polygon(P(cx, cy, s, [(3, -47), (14, -52), (9, -43)]), fill=(70, 150, 55))


def draw_leaves(d, rng, cx, cy, s):
    shape = [(0, -36), (12, -25), (19, -6), (16, 13), (0, 32), (-16, 13), (-19, -6), (-12, -25)]
    for dx, dy, col in [(-12, -6, (70, 150, 55)), (13, 9, (205, 120, 35))]:
        col = jitter(rng, col, 15)
        vein = shade(col, 0.55)
        lx, ly = cx + dx * s, cy + dy * s
        d.polygon(P(lx, ly, s, shape), fill=col, outline=vein)
        d.line(P(lx, ly, s, [(0, -32), (0, 40)]), fill=vein, width=line_w(s, 1.2))
        for y in (-20, -8, 4, 16):
            for side in (-1, 1):
                d.line(P(lx, ly, s, [(0, y), (side * 12, y - 7)]), fill=vein, width=max(1, round(s)))


def draw_eggshell(d, rng, cx, cy, s):
    shell = jitter(rng, rng.choice([(248, 244, 235), (215, 165, 115)]), 6)
    for ox, flip in [(-23, 1), (23, -1)]:
        outer = [(ox + 22 * math.cos(math.radians(a)), 4 + 30 * math.sin(math.radians(a)) * flip)
                 for a in range(0, 181, 12)]
        zig = [(ox + x, 4 + (-6 if j % 2 else 2) * flip) for j, x in enumerate(range(-22, 23, 4))]
        d.polygon(P(cx, cy, s, outer + zig), fill=shell, outline=shade(shell, 0.6))
        y0, y1 = (4, 13) if flip == 1 else (-5, 4)
        d.ellipse(B(cx, cy, s, ox - 18, y0 - 4, ox + 18, y1 + 4), fill=shade(shell, 0.84))
        if shell[0] < 230:
            for _ in range(6):
                x, y = ox + rng.uniform(-15, 15), 4 + flip * rng.uniform(12, 25)
                d.ellipse(B(cx, cy, s, x - 1, y - 1, x + 1, y + 1), fill=shade(shell, 0.7))


def draw_chip_bag(d, rng, cx, cy, s):
    col = jitter(rng, rng.choice([(220, 40, 40), (40, 90, 210), (250, 160, 20), (130, 40, 170)]), 10)
    edge = (40, 40, 40)
    body = [(-30, -36), (30, -36), (33, -18), (31, 0), (33, 18), (30, 36), (-30, 36), (-33, 18), (-31, 0), (-33, -18)]
    d.polygon(P(cx, cy, s, body), fill=col, outline=edge)
    for y0 in (-44, 36):                                         # crimped seals
        d.rectangle(B(cx, cy, s, -30, y0, 30, y0 + 8), fill=shade(col, 0.8), outline=edge)
        for x in range(-27, 30, 4):
            d.line(P(cx, cy, s, [(x, y0 + 1), (x, y0 + 7)]), fill=shade(col, 0.6), width=max(1, round(s)))
    d.line(P(cx, cy, s, [(-22, -32), (-14, 30)]), fill=shade(col, 1.45), width=round(3 * s))
    d.line(P(cx, cy, s, [(20, -32), (24, 30)]), fill=shade(col, 1.25), width=round(2 * s))
    d.ellipse(B(cx, cy, s, -17, -22, 17, 8), fill=(250, 250, 242), outline=shade(col, 0.6))
    d.polygon(P(cx, cy, s, [(-10, -6), (-2, -16), (10, -10), (8, 2), (-4, 3)]), fill=(225, 180, 60),
              outline=(180, 135, 40))
    d.rectangle(B(cx, cy, s, -30, 16, 30, 26), fill=(250, 215, 60))


def draw_foam_cup(d, rng, cx, cy, s):
    white = jitter(rng, (246, 246, 242), 4)
    edge = (165, 165, 168)
    d.polygon(P(cx, cy, s, [(-25, -34), (25, -34), (16, 42), (-16, 42)]), fill=white, outline=edge)
    d.polygon(P(cx, cy, s, [(12, -34), (25, -34), (16, 42), (8, 42)]), fill=shade(white, 0.92))
    for row, y in enumerate(range(-24, 40, 8)):                  # foam texture
        half = 23 - (y + 34) * 9 / 76
        for x in range(int(-half) + 3 + (row % 2) * 3, int(half) - 2, 6):
            d.ellipse(B(cx, cy, s, x - 0.8, y - 0.8, x + 0.8, y + 0.8), fill=(222, 222, 220))
    d.ellipse(B(cx, cy, s, -27, -40, 27, -28), fill=shade(white, 0.97), outline=edge, width=line_w(s))
    d.ellipse(B(cx, cy, s, -22, -37, 22, -31), fill=(212, 212, 208))


def draw_wrapper(d, rng, cx, cy, s):
    col = jitter(rng, rng.choice([(230, 50, 120), (40, 180, 200), (250, 200, 40), (120, 200, 60)]), 10)
    stripe, edge = (250, 250, 250), (50, 50, 50)
    for side in (-1, 1):
        end = [(side * 20, -6), (side * 44, -20), (side * 40, 0), (side * 44, 20), (side * 20, 6)]
        d.polygon(P(cx, cy, s, end), fill=col, outline=edge)
        for t in (-12, 0, 12):
            d.line(P(cx, cy, s, [(side * 22, t / 4), (side * 40, t)]), fill=shade(col, 0.7), width=max(1, round(s)))
    d.rounded_rectangle(B(cx, cy, s, -22, -15, 22, 15), radius=int(7 * s), fill=col, outline=edge, width=line_w(s))
    for x in (-12, 0, 12):
        d.line(P(cx, cy, s, [(x - 4, 13), (x + 4, -13)]), fill=stripe, width=round(3 * s))
    d.line(P(cx, cy, s, [(-16, -9), (16, -9)]), fill=shade(col, 1.3), width=round(2 * s))


# ----------------------------------------------------------------------------
# Never-seen items (only appear after training)
# ----------------------------------------------------------------------------
def draw_tshirt(d, rng, cx, cy, s):
    col = jitter(rng, rng.choice([(200, 60, 60), (60, 110, 200), (90, 170, 90), (245, 245, 245)]), 10)
    edge = shade(col, 0.55)
    pts = [(-16, -38), (-34, -32), (-48, -12), (-35, -3), (-27, -14), (-27, 42), (27, 42),
           (27, -14), (35, -3), (48, -12), (34, -32), (16, -38), (7, -31), (-7, -31)]
    d.polygon(P(cx, cy, s, pts), fill=col, outline=edge)
    d.arc(B(cx, cy, s, -10, -46, 10, -26), start=0, end=180, fill=edge, width=line_w(s))
    d.line(P(cx, cy, s, [(-44, -8), (-31, 1)]), fill=edge, width=max(1, round(s)))
    d.line(P(cx, cy, s, [(44, -8), (31, 1)]), fill=edge, width=max(1, round(s)))
    d.line(P(cx, cy, s, [(-27, 37), (27, 37)]), fill=edge, width=max(1, round(s)))
    d.line(P(cx, cy, s, [(-12, -10), (-6, 30)]), fill=shade(col, 0.85), width=round(2 * s))
    if rng.random() < 0.5:
        d.rectangle(B(cx, cy, s, -27, -2, 27, 6), fill=shade(col, 0.7))


def draw_tire(d, rng, cx, cy, s):
    rubber = (38, 38, 42)
    d.ellipse(B(cx, cy, s, -46, -46, 46, 46), fill=rubber)
    for a in range(0, 360, 15):
        r = math.radians(a)
        d.line(P(cx, cy, s, [(38 * math.cos(r), 38 * math.sin(r)), (46 * math.cos(r), 46 * math.sin(r))]),
               fill=(70, 70, 76), width=round(3 * s))
    d.ellipse(B(cx, cy, s, -36, -36, 36, 36), fill=(55, 55, 60))
    rim = jitter(rng, (185, 185, 195), 8)
    d.ellipse(B(cx, cy, s, -24, -24, 24, 24), fill=rim, outline=shade(rim, 0.5), width=line_w(s))
    for a in range(0, 360, 72):
        r = math.radians(a + 18)
        x, y = 14 * math.cos(r), 14 * math.sin(r)
        d.ellipse(B(cx, cy, s, x - 3, y - 3, x + 3, y + 3), fill=shade(rim, 0.6))
    d.ellipse(B(cx, cy, s, -7, -7, 7, 7), fill=shade(rim, 0.75), outline=shade(rim, 0.5))


def draw_pill_bottle(d, rng, cx, cy, s):
    amber = jitter(rng, (210, 115, 30), 8)
    d.rectangle(B(cx, cy, s, -18, -24, 18, 32), fill=amber, outline=shade(amber, 0.55), width=line_w(s))
    bands(d, cx, cy, s, -18, -24, 18, 32, amber)
    d.rectangle(B(cx, cy, s, -21, -38, 21, -24), fill=(245, 245, 245), outline=(150, 150, 150), width=line_w(s))
    for x in range(-17, 20, 4):
        d.line(P(cx, cy, s, [(x, -36), (x, -26)]), fill=(205, 205, 205), width=max(1, round(s)))
    d.rectangle(B(cx, cy, s, -18, -10, 18, 16), fill=(250, 250, 250))
    d.rectangle(B(cx, cy, s, -18, -10, 18, -5), fill=(60, 120, 200))
    for y in (0, 5, 10):
        d.line(P(cx, cy, s, [(-13, y), (13, y)]), fill=(150, 150, 150), width=max(1, round(s)))
    for x, y in [(-30, 40), (24, 38), (32, 44), (-20, 46)]:       # spilled capsules
        d.pieslice(B(cx, cy, s, x - 6, y - 3, x + 6, y + 3), 90, 270, fill=(220, 50, 50))
        d.pieslice(B(cx, cy, s, x - 6, y - 3, x + 6, y + 3), 270, 90, fill=(250, 250, 250))


def draw_plastic_bag(d, rng, cx, cy, s):
    col = jitter(rng, rng.choice([(245, 245, 240), (238, 228, 175), (205, 222, 242)]), 6)
    edge = shade(col, 0.68)
    for x0 in (-28, 8):
        d.arc(B(cx, cy, s, x0, -50, x0 + 20, -20), start=180, end=360, fill=edge, width=round(5 * s))
    d.polygon(P(cx, cy, s, [(-30, -35), (30, -35), (36, 34), (22, 44), (0, 36), (-22, 44), (-36, 34)]),
              fill=col, outline=edge)
    for x in (-18, -4, 10, 22):
        d.line(P(cx, cy, s, [(x, -28), (x + rng.uniform(-7, 7), 32)]), fill=shade(col, 0.85),
               width=max(1, round(s)))
    d.ellipse(B(cx, cy, s, -12, -8, 12, 12), fill=(210, 50, 50))
    d.arc(B(cx, cy, s, -7, -4, 7, 8), start=20, end=160, fill=(250, 250, 250), width=round(2 * s))


def draw_mug(d, rng, cx, cy, s):
    col = jitter(rng, rng.choice([(245, 245, 240), (60, 120, 190), (200, 80, 60), (250, 210, 80)]), 8)
    edge = shade(col, 0.55)
    d.ellipse(B(cx, cy, s, 14, -18, 42, 18), outline=edge, width=round(8 * s))
    d.ellipse(B(cx, cy, s, 15, -17, 41, 17), outline=col, width=round(6 * s))
    d.rectangle(B(cx, cy, s, -26, -30, 22, 36), fill=col, outline=edge, width=line_w(s))
    bands(d, cx, cy, s, -26, -24, 22, 36, col)
    d.ellipse(B(cx, cy, s, -26, -36, 22, -24), fill=shade(col, 0.72), outline=edge, width=line_w(s))
    d.line(P(cx, cy, s, [(-10, -30), (-4, -12), (-12, 2), (-6, 22)]), fill=(40, 40, 40), width=line_w(s))
    d.line(P(cx, cy, s, [(-4, -12), (6, -4)]), fill=(40, 40, 40), width=max(1, round(s)))


# ----------------------------------------------------------------------------
# Catalog
# ----------------------------------------------------------------------------
# (display name, draw function, bin most recycling programs would use)
ITEM_TYPES = [
    ("Plastic bottle", draw_plastic_bottle, RECYCLING),
    ("Aluminum can", draw_can, RECYCLING),
    ("Newspaper", draw_newspaper, RECYCLING),
    ("Cardboard box", draw_cardboard, RECYCLING),
    ("Glass jar", draw_glass_jar, RECYCLING),
    ("Banana peel", draw_banana_peel, COMPOST),
    ("Apple core", draw_apple_core, COMPOST),
    ("Fallen leaves", draw_leaves, COMPOST),
    ("Eggshells", draw_eggshell, COMPOST),
    ("Chip bag", draw_chip_bag, LANDFILL),
    ("Foam cup", draw_foam_cup, LANDFILL),
    ("Candy wrapper", draw_wrapper, LANDFILL),
]

# (display name, draw function, where it really goes, matching bin or None)
NOVEL_TYPES = [
    ("Old T-shirt", draw_tshirt, "Textile donation", None),
    ("Car tire", draw_tire, "Tire drop-off", None),
    ("Pill bottle", draw_pill_bottle, "Pharmacy take-back", None),
    ("Plastic grocery bag", draw_plastic_bag, "Store bag drop-off", None),
    ("Broken mug", draw_mug, "Landfill", LANDFILL),
]


@dataclass
class TrashItem:
    name: str
    image: Image.Image             # 128x128 pixel-art sprite
    expected: int                  # bin most recycling programs would use
    label: Optional[int] = None    # the player's choice (the training label)


def make_game_items(n=NUM_ITEMS, rng=None):
    """n items, cycling through every type in shuffled rounds so all types appear."""
    rng = rng or random.Random()
    order = []
    while len(order) < n:
        rnd = list(range(len(ITEM_TYPES)))
        rng.shuffle(rnd)
        order += rnd
    items = []
    for k in order[:n]:
        name, fn, expected = ITEM_TYPES[k]
        items.append(TrashItem(name, render_item(fn, rng), expected))
    return items
