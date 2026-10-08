"""
Sprites
=======
Rendering: the drawing helpers used by the item catalog, the optional PICO-8
palette snap, and the functions that turn a drawing into a game sprite.
"""
import numpy as np
from PIL import Image, ImageDraw

from config import DRAW_SIZE, PALETTE_SPRITES, PICO, PIXEL_RES, RESAMPLE, hex_to_rgb

# Light, neutral backgrounds: they vary only slightly, so the background never
# competes with the item for the network's attention.
BACKGROUNDS = [(236, 232, 222), (226, 230, 236), (232, 236, 226), (238, 230, 230)]
SUPERSAMPLE = 2          # draw at 2x, then shrink, for smooth clean edges


# ----------------------------------------------------------------------------
# Drawing helpers (coordinates are offsets around a center, times a scale)
# ----------------------------------------------------------------------------
def P(cx, cy, s, pts):
    """Scale and translate a list of (x, y) offsets."""
    return [(cx + x * s, cy + y * s) for x, y in pts]


def B(cx, cy, s, x0, y0, x1, y1):
    """Scale and translate a bounding box."""
    return [cx + x0 * s, cy + y0 * s, cx + x1 * s, cy + y1 * s]


def jitter(rng, rgb, amt=20):
    """Randomly vary a color."""
    return tuple(max(0, min(255, c + rng.randint(-amt, amt))) for c in rgb)


def shade(rgb, f):
    """Darken (f < 1) or lighten (f > 1) a color."""
    return tuple(max(0, min(255, int(c * f))) for c in rgb)


def line_w(s, k=1.5):
    """Line width that scales with the drawing (never thinner than 2 px)."""
    return max(2, round(k * s))


def bands(d, cx, cy, s, x0, y0, x1, y1, col):
    """Cylinder-style shading inside a box: a highlight stripe left of center
    and a shadow stripe along the right edge."""
    w = x1 - x0
    d.rectangle(B(cx, cy, s, x0 + 0.18 * w, y0, x0 + 0.32 * w, y1), fill=shade(col, 1.18))
    d.rectangle(B(cx, cy, s, x1 - 0.2 * w, y0, x1, y1), fill=shade(col, 0.82))


# ----------------------------------------------------------------------------
# Pixel-art conversion
# ----------------------------------------------------------------------------
def _palette_image():
    flat = [v for h in PICO.values() for v in hex_to_rgb(h)]
    flat += flat[:3] * (256 - len(PICO))          # pad the 256-entry palette with black
    pal = Image.new("P", (1, 1))
    pal.putpalette(flat)
    return pal


_PALETTE = _palette_image()


def pixelate(img):
    """Reduce a drawing (any size) to PIXEL_RES x PIXEL_RES, kept at DRAW_SIZE. Full color by
    default; set PALETTE_SPRITES in config.py to snap to the PICO-8 palette."""
    small = img.resize((PIXEL_RES, PIXEL_RES), RESAMPLE.BOX)
    if PALETTE_SPRITES:
        small = small.quantize(palette=_PALETTE, dither=0).convert("RGB")
    return small.resize((DRAW_SIZE, DRAW_SIZE), RESAMPLE.NEAREST)


def sprite(img, size):
    """Scale a sprite for display with crisp, even pixels (size: a multiple of PIXEL_RES)."""
    return img.resize((PIXEL_RES, PIXEL_RES), RESAMPLE.NEAREST).resize((size, size), RESAMPLE.NEAREST)


def render_item(draw_fn, rng):
    """Draw one item with a slight random tint, position, size and tilt.
    draw_fn(draw, rng, center_x, center_y, scale) comes from the item catalog;
    items are designed to span about -48..48 units around the center."""
    bg = jitter(rng, rng.choice(BACKGROUNDS), 4)
    size = DRAW_SIZE * SUPERSAMPLE
    img = Image.new("RGB", (size, size), bg)
    d = ImageDraw.Draw(img)
    s = rng.uniform(0.92, 1.08) * SUPERSAMPLE
    cx = (DRAW_SIZE / 2 + rng.uniform(-5, 5)) * SUPERSAMPLE
    cy = (DRAW_SIZE / 2 + rng.uniform(-5, 5)) * SUPERSAMPLE
    d.ellipse(B(cx, cy, s, -34, 42, 34, 52), fill=shade(bg, 0.9))     # soft floor shadow
    draw_fn(d, rng, cx, cy, s)
    img = img.rotate(rng.uniform(-12, 12), resample=RESAMPLE.BICUBIC, fillcolor=bg)
    return pixelate(img)


def cutout(img, tol=10):
    """Remove the plain background around an item so it can sit on the conveyor
    belt; the floor shadow becomes a smooth translucent shadow.

    A pixel counts as floor if it's the background color dimmed by some factor k
    (k = 1 is bare background, k = 0.9 is full shadow, in between are the
    blended edges). Floor pixels become black with alpha that grows as k drops."""
    rgb = np.asarray(img.convert("RGB")).astype(float)
    bg = rgb[0, 0]
    k = rgb.mean(axis=2) / max(bg.mean(), 1.0)                 # brightness relative to background
    is_floor = (np.abs(rgb - bg * k[..., None]).max(axis=2) <= tol) & (k >= 0.84) & (k <= 1.03)
    alpha = np.full(k.shape, 255.0)
    alpha[is_floor] = np.clip((1.0 - k[is_floor]) / 0.1, 0, 1) * 90
    out = np.dstack([rgb, alpha])
    out[is_floor, :3] = 0
    return Image.fromarray(out.astype(np.uint8), "RGBA")
