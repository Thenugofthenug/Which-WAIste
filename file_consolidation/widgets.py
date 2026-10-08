"""
Widgets
=======
Reusable retro tkinter widgets, plus RetroFrame: the base class every screen
builds on, giving it shared label() / button() / panel() helpers.
"""
import tkinter as tk
import tkinter.font as tkfont

from config import BG, FG, MONO_FONTS, PANEL, PICO, PIXEL_FONTS


class RetroFonts:
    """Picks an installed pixel font (falls back to bold monospace).
    fonts(size) -> UI font, fonts.mono(size) -> monospace font for tables/logs."""

    def __init__(self, root):
        families = set(tkfont.families(root))
        self.pixel = next((f for f in PIXEL_FONTS if f in families), None)
        self.mono_family = next((f for f in MONO_FONTS if f in families), "Courier")

    def __call__(self, size):
        if self.pixel:
            return (self.pixel, max(6, round(size * 0.72)))   # pixel fonts run large
        return (self.mono_family, size, "bold")

    def mono(self, size):
        return (self.mono_family, size, "bold")


class PixelButton(tk.Label):
    """Chunky 8-bit button. Built on a Label so its colors work on every platform."""

    def __init__(self, master, text, command, font, bg=PICO["blue"], fg=PICO["black"], width=None):
        super().__init__(master, text=text, font=font, bg=bg, fg=fg, relief="raised", bd=4,
                         padx=14, pady=7, cursor="hand2")
        if width:
            self.config(width=width)
        self._bg, self._fg, self._command, self._enabled = bg, fg, command, True
        self.bind("<Enter>", self._hover)
        self.bind("<Leave>", self._unhover)
        self.bind("<ButtonPress-1>", self._press)
        self.bind("<ButtonRelease-1>", self._release)

    def _hover(self, _):
        if self._enabled:
            self.config(bg=PICO["yellow"])

    def _unhover(self, _):
        if self._enabled:
            self.config(bg=self._bg, relief="raised")

    def _press(self, _):
        if self._enabled:
            self.config(relief="sunken")

    def _release(self, event):
        if not self._enabled:
            return
        self.config(relief="raised")
        if 0 <= event.x <= self.winfo_width() and 0 <= event.y <= self.winfo_height():
            self._command()          # may destroy this widget, so nothing after this

    def set_enabled(self, enabled):
        self._enabled = enabled
        self.config(bg=self._bg if enabled else PICO["dark_gray"],
                    fg=self._fg if enabled else PICO["light_gray"],
                    cursor="hand2" if enabled else "arrow", relief="raised")

    def set_color(self, bg):
        self._bg = bg
        if self._enabled:
            self.config(bg=bg)


class PixelProgress(tk.Canvas):
    """Segmented, arcade-style progress bar."""

    def __init__(self, master, segments=25, seg_w=8, seg_h=14, gap=2):
        super().__init__(master, width=segments * (seg_w + gap) + gap + 4, height=seg_h + 8,
                         bg=BG, highlightthickness=2, highlightbackground=FG)
        self.cells = [self.create_rectangle(4 + i * (seg_w + gap), 5, 4 + i * (seg_w + gap) + seg_w,
                                            5 + seg_h, fill=PICO["dark_gray"], width=0)
                      for i in range(segments)]

    def set(self, frac):
        filled, total = round(frac * len(self.cells)), len(self.cells)
        for i, cell in enumerate(self.cells):
            if i >= filled:
                col = PICO["dark_gray"]
            elif i < total * 0.6:
                col = PICO["green"]
            elif i < total * 0.85:
                col = PICO["yellow"]
            else:
                col = PICO["orange"]
            self.itemconfig(cell, fill=col)


class RetroFrame(tk.Frame):
    """Base for screens and tabs: a frame that knows the retro fonts."""

    def __init__(self, master, fonts, bg=BG, **kw):
        super().__init__(master, bg=bg, **kw)
        self.fonts = fonts

    def label(self, parent, text="", size=11, fg=FG, bg=None, mono=False, **kw):
        """Retro label; the background defaults to the parent's."""
        font = self.fonts.mono(size) if mono else self.fonts(size)
        return tk.Label(parent, text=text, font=font, fg=fg, bg=bg or parent.cget("bg"), **kw)

    def button(self, parent, text, command, size=11, **kw):
        return PixelButton(parent, text, command, self.fonts(size), **kw)

    def panel(self, parent, title):
        """A bordered retro window. Returns (outer frame to pack, inner body frame)."""
        outer = tk.Frame(parent, bg=FG, padx=3, pady=3)
        if title:
            tk.Label(outer, text=f" {title} ", bg=FG, fg=BG, font=self.fonts(10), anchor="w").pack(fill="x")
        body = tk.Frame(outer, bg=PANEL, padx=8, pady=6)
        body.pack(fill="both", expand=True)
        return outer, body
