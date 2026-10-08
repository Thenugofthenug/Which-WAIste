"""Title screen: logo, a parade of item sprites and a blinking PRESS START."""
import random
import tkinter as tk

from PIL import ImageTk

from config import ACCENT, BG, PICO
from items import ITEM_TYPES
from sprites import render_item, sprite
from widgets import RetroFrame


class TitleScreen(RetroFrame):
    def __init__(self, master, app):
        super().__init__(master, app.fonts)
        logo = tk.Canvas(self, width=1000, height=150, bg=BG, highlightthickness=0)
        logo.pack(pady=(70, 0))
        for offset, col in ((6, PICO["dark_green"]), (0, PICO["green"])):     # drop shadow
            logo.create_text(500 + offset, 75 + offset, text="TRASH SORTER", fill=col, font=self.fonts(48))
        self.label(self, "SORT 30 ITEMS  *  TEACH A NEURAL NETWORK", 13, fg=PICO["peach"]).pack()

        parade = tk.Frame(self, bg=BG)
        parade.pack(pady=40)
        rng = random.Random()
        self._photos = []                   # keep references so Tk doesn't drop the images
        for _, draw_fn, _ in rng.sample(ITEM_TYPES, 6):
            photo = ImageTk.PhotoImage(sprite(render_item(draw_fn, rng), 128))
            self._photos.append(photo)
            tk.Label(parade, image=photo, bg=PICO["white"], bd=0, padx=3, pady=3).pack(side="left", padx=10)

        self.blink_lbl = self.label(self, "PRESS START", 18, fg=ACCENT)
        self.blink_lbl.pack(pady=(0, 16))
        self.button(self, "START", app.new_game, 16, bg=PICO["green"]).pack()
        self._blink_job = None
        self._blink(True)

    def _blink(self, on):
        self.blink_lbl.config(fg=ACCENT if on else BG)
        self._blink_job = self.after(500, self._blink, not on)

    def destroy(self):
        if self._blink_job:
            self.after_cancel(self._blink_job)
        super().destroy()
