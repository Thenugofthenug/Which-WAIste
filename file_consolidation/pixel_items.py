"""Original 32-pixel inventory art, shared by the game and CNN examples.

The silhouettes are drawn on the pixel grid, without smoothing or external art.
Each object keeps the same silhouette and palette throughout the game.
"""
from PIL import Image, ImageDraw


CREAM = "#fff0ba"
WHITE = "#edf7f4"
INK = "#354055"
BROWN = "#745039"


def _tones(color):
    """One light source, at the upper left, keeps the small sprites readable."""
    rgb = tuple(int(color[i:i + 2], 16) for i in (1, 3, 5))
    light = tuple(min(255, int(c * 1.14 + 12)) for c in rgb)
    dark = tuple(int(c * 0.69) for c in rgb)
    return color, light, dark


def _bottle(d, rng):
    base, light, dark = _tones("#8dc6d9")
    cap = "#e46c60"
    d.polygon([(12, 8), (19, 8), (19, 11), (22, 14), (22, 26),
               (20, 28), (11, 28), (9, 26), (9, 14), (12, 11)], fill=base)
    d.rectangle((19, 15, 21, 26), fill=dark)
    d.rectangle((11, 14, 12, 25), fill=light)
    d.rectangle((12, 4, 19, 7), fill=cap)
    d.rectangle((13, 4, 14, 5), fill=WHITE)
    d.rectangle((9, 17, 22, 22), fill=cap)
    d.rectangle((13, 18, 18, 20), fill=WHITE)
    d.line((13, 25, 18, 25), fill=dark)


def _can(d, rng):
    base, light, dark = _tones("#dc625c")
    metal, steel = "#d5e0e5", "#8399ab"
    d.polygon([(10, 5), (21, 5), (23, 7), (23, 25), (21, 27),
               (10, 27), (8, 25), (8, 7)], fill=metal)
    d.rectangle((8, 10, 23, 23), fill=base)
    d.rectangle((20, 10, 23, 23), fill=dark)
    d.rectangle((10, 10, 11, 21), fill=light)
    d.polygon([(12, 19), (12, 17), (18, 13), (20, 13), (20, 15), (14, 19)], fill=metal)
    d.line((10, 8, 21, 8), fill=steel)
    d.rectangle((14, 6, 17, 7), fill=steel)
    d.line((10, 25, 20, 25), fill=steel)


def _newspaper(d, rng):
    paper, light, dark = _tones("#cfcdb7")
    d.polygon([(6, 5), (24, 5), (24, 9), (27, 9), (27, 26),
               (25, 28), (7, 28), (5, 26), (5, 7)], fill=paper)
    d.rectangle((7, 6, 23, 25), fill=light)
    d.rectangle((24, 10, 25, 25), fill=dark)
    d.rectangle((8, 8, 21, 10), fill=INK)
    d.rectangle((8, 13, 14, 18), fill="#86a2a0")
    d.polygon([(8, 18), (11, 14), (14, 18)], fill=dark)
    for y in (13, 16, 19, 22):
        d.line((17, y, 21, y), fill=dark)
    for y in (21, 24):
        d.line((8, y, 14, y), fill=dark)


def _cardboard(d, rng):
    base, light, dark = _tones("#bd8955")
    tape = "#f1d7a0"
    d.polygon([(5, 11), (13, 6), (27, 9), (27, 23), (19, 28), (5, 24)], fill=base)
    d.polygon([(5, 11), (13, 6), (27, 9), (19, 14)], fill=light)
    d.polygon([(19, 14), (27, 9), (27, 23), (19, 28)], fill=dark)
    d.polygon([(10, 8), (13, 7), (25, 10), (22, 12)], fill=tape)
    d.polygon([(11, 13), (14, 13), (14, 19), (11, 18)], fill=tape)
    d.rectangle((7, 20, 12, 22), fill=tape)
    d.line((19, 15, 19, 26), fill=BROWN)


def _jar(d, rng):
    base, light, dark = _tones("#91c7bd")
    d.polygon([(10, 9), (21, 9), (24, 12), (24, 25), (22, 27),
               (9, 27), (7, 25), (7, 12)], fill=base)
    d.rectangle((21, 13, 23, 25), fill=dark)
    d.rectangle((9, 13, 10, 23), fill=light)
    d.rectangle((9, 5, 22, 8), fill="#9da9b9")
    d.line((10, 6, 20, 6), fill=WHITE)
    d.rectangle((7, 17, 24, 22), fill=WHITE)
    d.rectangle((12, 18, 18, 20), fill=dark)


def _banana(d, rng):
    # A curved banana with an exposed cream tip and one folded peel strip.
    yellow, light, dark = "#f6cf42", "#ffe477", "#c3912e"
    d.polygon([(22, 7), (25, 7), (26, 10), (26, 16), (24, 21),
               (21, 24), (17, 26), (12, 27), (8, 27), (5, 25),
               (5, 23), (10, 24), (14, 23), (18, 20), (21, 16),
               (22, 12)], fill=yellow)
    d.polygon([(7, 25), (12, 25), (17, 23), (21, 20), (24, 15),
               (24, 21), (21, 24), (17, 26), (12, 27), (8, 27)], fill=dark)
    d.line([(8, 24), (13, 24), (18, 21), (21, 17)], fill=light, width=2)
    d.polygon([(22, 7), (24, 7), (24, 12), (22, 16), (21, 15)], fill=CREAM)
    d.polygon([(24, 12), (26, 13), (28, 17), (27, 20),
               (25, 18), (23, 15)], fill=light)
    d.line([(25, 15), (27, 18), (27, 19)], fill=dark)
    d.rectangle((22, 4, 24, 6), fill=BROWN)
    d.rectangle((5, 23, 7, 25), fill=BROWN)


def _apple(d, rng):
    skin = "#df6260"
    d.polygon([(10, 7), (13, 6), (16, 7), (19, 6), (22, 8),
               (23, 11), (20, 13), (11, 13), (8, 11), (8, 9)], fill=skin)
    d.polygon([(11, 21), (20, 21), (23, 24), (21, 27), (10, 27), (8, 24)], fill=skin)
    d.polygon([(11, 12), (20, 12), (18, 16), (18, 18), (20, 22),
               (11, 22), (13, 18), (13, 16)], fill=CREAM)
    d.rectangle((15, 13, 17, 21), fill="#e2c58f")
    d.rectangle((15, 15, 16, 16), fill=BROWN)
    d.rectangle((16, 19, 17, 20), fill=BROWN)
    d.line([(16, 7), (16, 4), (18, 3)], fill=BROWN, width=2)
    d.rectangle((10, 8, 12, 9), fill=CREAM)


def _leaves(d, rng):
    for dx, dy, color in ((0, 0, "#6caa63"), (10, 7, "#d29a47")):
        base, light, dark = _tones(color)
        points = [(5, 5), (13, 6), (17, 10), (17, 16), (13, 21), (8, 20), (4, 15), (4, 9)]
        d.polygon([(x + dx, y + dy) for x, y in points], fill=base)
        d.line([(6 + dx, 7 + dy), (12 + dx, 15 + dy), (13 + dx, 23 + dy)], fill=dark)
        d.line((7 + dx, 10 + dy, 11 + dx, 11 + dy), fill=light)
        d.line((10 + dx, 15 + dy, 14 + dx, 12 + dy), fill=dark)


def _eggshell(d, rng):
    shell, light, dark = _tones("#e7d5b3")
    d.polygon([(4, 13), (7, 15), (9, 12), (12, 15), (15, 12),
               (16, 20), (14, 24), (10, 26), (6, 24), (4, 21)], fill=shell)
    d.polygon([(4, 13), (7, 15), (9, 12), (12, 15), (15, 12), (14, 18), (7, 18)], fill=dark)
    d.line((6, 20, 6, 22), fill=light, width=2)
    d.polygon([(18, 10), (20, 7), (24, 6), (27, 9), (28, 14),
               (25, 17), (23, 14), (20, 17), (17, 14)], fill=shell)
    d.polygon([(17, 14), (20, 17), (23, 14), (25, 17), (28, 14), (26, 20), (20, 20)], fill=dark)
    d.rectangle((21, 8, 23, 9), fill=light)


def _chip_bag(d, rng):
    base, light, dark = _tones("#a478bc")
    d.polygon([(8, 5), (23, 5), (23, 9), (25, 13), (23, 23),
               (24, 27), (7, 27), (8, 23), (6, 13), (8, 9)], fill=base)
    d.rectangle((8, 5, 23, 7), fill=dark)
    d.rectangle((8, 25, 23, 27), fill=dark)
    d.line([(9, 10), (8, 14), (10, 22)], fill=light, width=2)
    d.polygon([(12, 11), (19, 11), (22, 14), (20, 20), (12, 20), (10, 16)], fill=CREAM)
    d.polygon([(12, 17), (16, 12), (19, 17)], fill="#d9a443")
    d.rectangle((11, 22, 20, 23), fill=CREAM)


def _cup(d, rng):
    d.polygon([(6, 8), (25, 8), (22, 26), (20, 28), (11, 28), (9, 26)], fill="#e5e8df")
    d.polygon([(21, 10), (24, 10), (21, 26), (19, 27)], fill="#b1c1c3")
    d.rectangle((7, 7, 24, 10), fill=WHITE)
    d.rectangle((9, 8, 22, 9), fill="#718696")
    d.line((11, 13, 12, 23), fill=WHITE, width=2)
    for x, y in ((16, 15), (13, 20), (18, 23)):
        d.point((x, y), fill="#b1c1c3")


def _wrapper(d, rng):
    base, light, dark = _tones("#5da9bb")
    d.polygon([(4, 10), (10, 13), (22, 13), (28, 10), (27, 15),
               (28, 21), (22, 18), (10, 18), (4, 21), (5, 16)], fill=base)
    d.rectangle((9, 11, 22, 20), fill=base)
    d.rectangle((10, 19, 21, 20), fill=dark)
    d.line((6, 14, 8, 15), fill=dark)
    d.line((24, 15, 26, 14), fill=dark)
    d.line((11, 12, 20, 12), fill=light)
    for x in (12, 17):
        d.polygon([(x, 12), (x + 2, 12), (x + 1, 18), (x - 1, 18)], fill=WHITE)


def _tshirt(d, rng):
    base, light, dark = _tones("#6a9ac9")
    d.polygon([(10, 6), (13, 6), (15, 9), (17, 9), (19, 6), (22, 6),
               (28, 11), (25, 16), (22, 14), (22, 27), (9, 27),
               (9, 14), (6, 16), (3, 11)], fill=base)
    d.line([(12, 6), (14, 10), (18, 10), (20, 6)], fill=dark, width=2)
    d.rectangle((20, 15, 22, 26), fill=dark)
    d.line((11, 13, 11, 23), fill=light, width=2)
    d.line((10, 25, 19, 25), fill=dark)


def _tire(d, rng):
    d.polygon([(11, 4), (20, 4), (25, 8), (28, 13), (28, 20),
               (24, 25), (20, 28), (11, 28), (6, 24), (3, 19), (3, 12), (7, 7)], fill="#424b62")
    d.polygon([(10, 7), (20, 6), (25, 11), (26, 19), (21, 25),
               (12, 26), (6, 20), (6, 12)], fill="#64738b")
    d.polygon([(12, 10), (19, 10), (22, 13), (22, 20), (19, 23),
               (12, 23), (9, 20), (9, 13)], fill="#a6b8c4")
    d.rectangle((13, 14, 18, 19), fill=INK)
    for box in ((7, 8, 9, 10), (23, 10, 25, 12), (24, 21, 26, 23), (8, 23, 10, 25)):
        d.rectangle(box, fill=INK)
    d.line((12, 11, 18, 11), fill=WHITE)


def _pills(d, rng):
    base, light, dark = _tones("#d49a43")
    d.rectangle((9, 11, 22, 25), fill=base)
    d.rectangle((20, 11, 22, 25), fill=dark)
    d.rectangle((10, 12, 11, 22), fill=light)
    d.rectangle((8, 6, 23, 10), fill=WHITE)
    d.line((10, 9, 21, 9), fill="#9dabb7")
    d.rectangle((9, 15, 22, 21), fill=WHITE)
    d.line((12, 17, 18, 17), fill="#9dabb7")
    d.rectangle((24, 26, 27, 28), fill=WHITE)
    d.rectangle((24, 26, 25, 28), fill=base)
    d.rectangle((5, 26, 8, 28), fill=WHITE)
    d.rectangle((5, 26, 6, 28), fill=base)


def _bag(d, rng):
    base, light, dark = _tones("#c7d5db")
    d.rectangle((9, 5, 12, 13), fill=base)
    d.rectangle((19, 5, 22, 13), fill=base)
    d.polygon([(9, 11), (22, 11), (25, 25), (22, 28), (16, 26),
               (9, 28), (6, 25)], fill=base)
    d.line([(10, 13), (9, 24), (12, 25)], fill=light, width=2)
    d.line([(21, 13), (22, 25), (19, 26)], fill=dark, width=2)
    d.rectangle((14, 17, 18, 21), fill=dark)


def _mug(d, rng):
    base, light, dark = _tones("#b994bc")
    d.rectangle((22, 11, 27, 21), fill=base)
    d.rectangle((23, 14, 25, 18), fill=(0, 0, 0, 0))
    d.polygon([(6, 8), (21, 8), (23, 10), (23, 25), (20, 27),
               (8, 27), (6, 25)], fill=base)
    d.rectangle((20, 12, 22, 25), fill=dark)
    d.rectangle((8, 12, 9, 24), fill=light)
    d.rectangle((8, 9, 20, 11), fill=dark)
    d.line([(15, 12), (13, 16), (17, 20), (15, 24)], fill=INK)
    d.line((16, 19, 19, 17), fill=INK)


_DRAWERS = dict(zip(
    ("plastic_bottle", "can", "newspaper", "cardboard", "glass_jar", "banana_peel",
     "apple_core", "leaves", "eggshell", "chip_bag", "foam_cup", "wrapper",
     "tshirt", "tire", "pill_bottle", "plastic_bag", "mug"),
    (_bottle, _can, _newspaper, _cardboard, _jar, _banana, _apple, _leaves,
     _eggshell, _chip_bag, _cup, _wrapper, _tshirt, _tire, _pills, _bag, _mug),
))


def draw_pixel_item(draw_name, rng):
    """Return a transparent inventory sprite, or None for an unknown drawing."""
    drawer = _DRAWERS.get(draw_name.removeprefix("draw_"))
    if drawer is None:
        return None
    image = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
    drawer(ImageDraw.Draw(image), rng)
    return image
