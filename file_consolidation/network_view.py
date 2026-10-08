"""
Network view
============
The retro "synaptic view": a node-link diagram of the CNN for one image, plus
the shared matplotlib font settings (mpl_size) used by every retro chart.
Columns: RGB input -> the most active filters (firing neurons) of each conv
block -> class probabilities.
  - square glow      = how strongly a neuron fires
  - line color       = weight sign (green excitatory, red inhibitory)
  - line brightness  = signal actually flowing (|weight| x source firing)
"""
import numpy as np
import matplotlib
from matplotlib import font_manager
from matplotlib.backends.backend_tkagg import FigureCanvasTkAgg
from matplotlib.collections import LineCollection
from matplotlib.colors import to_rgba
from matplotlib.figure import Figure
from matplotlib.patches import Rectangle

from config import (CAT_COLORS, CATEGORIES, CHANNELS, EXCITE, INHIBIT, PICO, PIXEL_FONTS,
                    RGB_COLORS, SHOW_PER_BLOCK)
from sprites import sprite


def _pick_font():
    """Use an installed pixel font for matplotlib text, else monospace."""
    installed = {f.name for f in font_manager.fontManager.ttflist}
    for name in PIXEL_FONTS:
        if name in installed:
            return name, 0.72          # pixel fonts run large
    return "monospace", 1.0


MPL_FONT, _FONT_SCALE = _pick_font()
matplotlib.rcParams["font.family"] = MPL_FONT
matplotlib.rcParams["font.weight"] = "bold"


def mpl_size(pt):
    return pt * _FONT_SCALE


class NetworkView:
    COL_X = [1.85, 3.6, 5.3, 7.0, 8.7, 10.35]
    TITLE_H = 0.42

    def __init__(self, master, height=3.3):
        self.W, self.H = 12.4, height
        self.fig = Figure(figsize=(self.W, self.H), dpi=100, facecolor=PICO["black"])
        self.ax = self.fig.add_axes([0, 0, 1, 1])
        self.canvas = FigureCanvasTkAgg(self.fig, master=master)
        self.widget = self.canvas.get_tk_widget()
        self.widget.configure(highlightthickness=0, bd=0)
        self.show(None, None, None)

    # ------------------------------------------------------------- layout
    def _ys(self, n, spread=1.0):
        top, bottom = self.H - 1.25, 0.32
        step = (top - bottom) / (SHOW_PER_BLOCK - 1) * spread
        mid = (top + bottom) / 2
        return [mid + ((n - 1) / 2 - i) * step for i in range(n)]

    @staticmethod
    def _placeholder_layers():
        return ([{"labels": ["R", "G", "B"], "level": np.zeros(3)}]
                + [{"labels": ["--"] * min(SHOW_PER_BLOCK, c), "level": np.zeros(SHOW_PER_BLOCK)}
                   for c in CHANNELS]
                + [{"labels": list(CATEGORIES), "level": np.zeros(len(CATEGORIES))}])

    # ------------------------------------------------------------- drawing
    def _square(self, x, y, half, **kw):
        self.ax.add_patch(Rectangle((x - half, y - half), 2 * half, 2 * half, **kw))

    def _frame(self, note):
        ax, W, H = self.ax, self.W, self.H
        ax.add_patch(Rectangle((0.08, 0.06), W - 0.16, H - 0.12, fc=PICO["black"],
                               ec=PICO["white"], lw=3, zorder=0))
        ax.add_patch(Rectangle((0.08, H - 0.06 - self.TITLE_H), W - 0.16, self.TITLE_H,
                               fc=PICO["dark_blue"], ec=PICO["white"], lw=3, zorder=0))
        ty = H - 0.06 - self.TITLE_H / 2
        ax.text(0.3, ty, (note or "SYNAPTIC VIEW").upper(), color=PICO["white"],
                fontsize=mpl_size(9.5), va="center")
        for x0, col, lab in [(W - 3.6, EXCITE, "EXCITATORY +"), (W - 1.85, INHIBIT, "INHIBITORY -")]:
            self._square(x0, ty, 0.07, fc=col, ec="none")
            ax.text(x0 + 0.16, ty, lab, color=PICO["light_gray"], fontsize=mpl_size(8), va="center")

    def _headers(self, n_cols, dw):
        heads = ["INPUT"] + [f"BLOCK {i + 1}" for i in range(len(CHANNELS))] + ["SOFTMAX"]
        subs = (["RGB"] + [f"TOP {min(SHOW_PER_BLOCK, c)}/{c}" for c in CHANNELS]
                + [f"{len(CATEGORIES)} CLASSES"])
        if dw is not None:
            subs = [subs[0]] + [f"{t}  DW {d:.0e}" for t, d in zip(subs[1:-1], dw)] + [subs[-1]]
        for c in range(n_cols):
            self.ax.text(self.COL_X[c], self.H - 0.72, heads[c], color=PICO["yellow"],
                         fontsize=mpl_size(9.5), ha="center", va="center")
            self.ax.text(self.COL_X[c], self.H - 0.93, subs[c], color=PICO["lavender"],
                         fontsize=mpl_size(7), ha="center", va="center")

    def _synapses(self, layers, pos, viz):
        for k in range(len(layers) - 1):
            xs, xd = self.COL_X[k], self.COL_X[k + 1]
            segs, cols, widths = [], [], []
            if viz is None:
                for ys in pos[k]:
                    for yd in pos[k + 1]:
                        segs.append([(xs, ys), (xd, yd)])
                        cols.append(to_rgba(PICO["dark_gray"], 0.25))
                        widths.append(0.6)
            else:
                w = viz["edges"][k]
                signal = np.abs(w) * np.asarray(layers[k]["raw"])[:, None]
                strength = signal / max(float(signal.max()), 1e-9)
                for flat in np.argsort(strength, axis=None):          # strongest on top
                    i, j = np.unravel_index(flat, strength.shape)
                    st = float(strength[i, j])
                    segs.append([(xs, pos[k][i]), (xd, pos[k + 1][j])])
                    cols.append(to_rgba(EXCITE if w[i, j] >= 0 else INHIBIT, 0.07 + 0.85 * st))
                    widths.append(0.5 + 2.5 * st)
            self.ax.add_collection(LineCollection(segs, colors=cols, linewidths=widths,
                                                  capstyle="butt", zorder=1))

    def _neurons(self, layers, pos, probs):
        pred = int(np.argmax(probs)) if probs is not None else -1
        last = len(layers) - 1
        for c, layer in enumerate(layers):
            x = self.COL_X[c]
            is_in, is_out = c == 0, c == last
            half = 0.19 if is_in else 0.24 if is_out else 0.15
            for n, y in enumerate(pos[c]):
                lvl = float(np.clip(layer["level"][n], 0, 1))
                if is_in:
                    ring = glow = RGB_COLORS[n]
                elif is_out:
                    ring = glow = CAT_COLORS[n]
                else:
                    ring, glow = PICO["lavender"], PICO["green"]

                if is_out and n == pred:
                    self._square(x, y, half * 1.32, fc="none", ec=PICO["yellow"], lw=3, zorder=2)
                elif not is_out and lvl > 0.45:
                    self._square(x, y, half * 1.55, fc=to_rgba(glow, 0.22 * lvl), ec="none", zorder=2)
                self._square(x, y, half, fc=PICO["black"], ec=ring, lw=2.5 if lvl > 0.45 else 1.5, zorder=3)

                if is_out:
                    self._square(x, y, half * 0.86, fc=to_rgba(glow, 0.6 * lvl), ec="none", zorder=4)
                    self.ax.text(x, y, f"{lvl:.0%}", color=PICO["white"], fontsize=mpl_size(8.5),
                                 ha="center", va="center", zorder=5)
                    self.ax.text(x + half + 0.15, y, layer["labels"][n].upper(), color=ring,
                                 fontsize=mpl_size(10.5), va="center", zorder=5)
                else:
                    if lvl > 0:
                        self._square(x, y, half * (0.2 + 0.68 * lvl), fc=to_rgba(glow, 0.35 + 0.65 * lvl),
                                     ec="none", zorder=4)
                    self.ax.text(x, y, layer["labels"][n], color=PICO["white"],
                                 fontsize=mpl_size(8 if is_in else 6.5), ha="center", va="center", zorder=5)

    def show(self, img, viz, probs, dw=None, note=""):
        """img: probe sprite; viz/probs: output of model.probe_model (None = untrained)."""
        ax = self.ax
        ax.clear()
        ax.set_facecolor(PICO["black"])
        self._frame(note)

        layers = viz["layers"] if viz is not None else self._placeholder_layers()
        spreads = [1.5] + [1.0] * (len(layers) - 2) + [1.9]
        pos = [self._ys(len(layer["labels"]), spreads[c]) for c, layer in enumerate(layers)]
        self._headers(len(layers), dw)

        if img is not None:                                   # probe sprite feeding the inputs
            yc = float(np.mean(pos[0]))
            ax.imshow(np.asarray(sprite(img, 128)), extent=(0.3, 1.2, yc - 0.45, yc + 0.45),
                      interpolation="nearest", zorder=2)
            ax.add_patch(Rectangle((0.3, yc - 0.45), 0.9, 0.9, fill=False, ec=PICO["white"], lw=2, zorder=3))
            ax.add_collection(LineCollection([[(1.2, yc), (self.COL_X[0], y)] for y in pos[0]],
                                             colors=[to_rgba(PICO["light_gray"], 0.5)],
                                             linewidths=1, zorder=1))

        self._synapses(layers, pos, viz)
        self._neurons(layers, pos, probs)

        ax.set_xlim(0, self.W)
        ax.set_ylim(0, self.H)
        ax.set_aspect("equal")
        ax.axis("off")
        self.canvas.draw_idle()
