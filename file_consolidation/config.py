"""
Configuration
=============
Every tunable setting, the retro (PICO-8) palette and font preferences.
This file imports nothing else from the project, so it's safe to tweak.
"""
from PIL import Image

# ----------------------------------------------------------------------------
# Game & training settings
# ----------------------------------------------------------------------------
CATEGORIES = ["Recycling", "Compost", "Landfill"]
NUM_ITEMS = 30                 # items the player sorts
EPOCHS = 50                    # training epochs
DRAW_SIZE = 128                # items are drawn at this size...
PIXEL_RES = 64                 # ...then reduced to 64x64 (matches IMG_SIZE, so the CNN loses no detail)
PALETTE_SPRITES = False        # True = snap colors to the 16-color PICO-8 palette (more 8-bit, less clear)
IMG_SIZE = 64                  # network input size
BATCH_SIZE = 16
AUG_PER_ITEM = 8               # augmented copies of each training item per epoch
EVAL_VIEWS = 4                 # fixed views per val/test item (1 original + 3 augmented)
DEFAULT_LR = 1e-3
LR_LOG_RANGE = (-4.0, -1.0)    # learning-rate slider range, as powers of ten
CHANNELS = [16, 32, 64, 64]    # filters per conv block
SHOW_PER_BLOCK = 6             # firing neurons drawn per block in the synaptic view

# ----------------------------------------------------------------------------
# Retro palette (PICO-8)
# ----------------------------------------------------------------------------
PICO = {
    "black": "#000000", "dark_blue": "#1d2b53", "dark_purple": "#7e2553", "dark_green": "#008751",
    "brown": "#ab5236", "dark_gray": "#5f574f", "light_gray": "#c2c3c7", "white": "#fff1e8",
    "red": "#ff004d", "orange": "#ffa300", "yellow": "#ffec27", "green": "#00e436",
    "blue": "#29adff", "lavender": "#83769c", "pink": "#ff77a8", "peach": "#ffccaa",
}
CAT_COLORS = [PICO["blue"], PICO["green"], PICO["light_gray"]]   # one per category
POSITIVE = PICO["green"]       # positive weight: boosts the next neuron
NEGATIVE = PICO["red"]         # negative weight: lowers the next neuron
RGB_COLORS = [PICO["red"], PICO["green"], PICO["blue"]]

# Interface colors
BG = PICO["black"]
PANEL = PICO["dark_blue"]
FG = PICO["white"]
ACCENT = PICO["yellow"]
MUTED = PICO["lavender"]

# Pixel fonts are used if installed (e.g. the free "Press Start 2P" from Google
# Fonts); otherwise a bold monospace font stands in.
PIXEL_FONTS = ["Press Start 2P", "Silkscreen", "Pixelify Sans", "VT323"]
MONO_FONTS = ["Courier New", "Courier", "DejaVu Sans Mono", "Menlo", "Consolas"]

# Anonymous usage statistics (see analytics.py). Saved only in a local SQLite file
# next to the game: no names, no network. Set to False to turn tracking off.
ANALYTICS_ENABLED = True
STATS_DB_NAME = "whichwaiste_stats.db"

# Pillow compatibility (constants moved into enums in Pillow 9.1)
RESAMPLE = getattr(Image, "Resampling", Image)
TRANSPOSE = getattr(Image, "Transpose", Image)


def hex_to_rgb(h):
    return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))
