"""Player screen: asks for the player's first and last name before the game.
The name is saved with their results so they can be matched with surveys."""
import tkinter as tk

from analytics import clean_name
from config import ACCENT, BG, FG, MUTED, PANEL, PICO
from widgets import RetroFrame

MAX_NAME_LEN = 40
ALLOWED_PUNCTUATION = set(" -'.")


def name_problem(text, which):
    """Return a message if a name isn't usable, else None."""
    name = clean_name(text)
    if not name:
        return f"PLEASE TYPE YOUR {which} NAME."
    if len(name) > MAX_NAME_LEN:
        return f"YOUR {which} NAME IS TOO LONG (MAX {MAX_NAME_LEN} LETTERS)."
    if not name[0].isalpha() or any(not (ch.isalpha() or ch in ALLOWED_PUNCTUATION) for ch in name):
        return f"YOUR {which} NAME CAN ONLY USE LETTERS, SPACES, HYPHENS AND APOSTROPHES."
    return None


class PlayerScreen(RetroFrame):
    def __init__(self, master, app):
        super().__init__(master, app.fonts)
        self.app = app
        self.label(self, "WHO'S PLAYING?", 30, fg=PICO["green"]).pack(pady=(110, 10))
        self.label(self, "TYPE YOUR FIRST AND LAST NAME, THEN PRESS CONTINUE.", 12, fg=FG).pack()

        outer, form = self.panel(self, "PLAYER")
        outer.pack(pady=30)
        self.first = self._field(form, "FIRST NAME", 0)
        self.last = self._field(form, "LAST NAME", 1)

        self.error_lbl = self.label(self, "", 11, fg=PICO["red"])
        self.error_lbl.pack(pady=(0, 10))
        self.button(self, "CONTINUE >", self.submit, 14, bg=PICO["green"]).pack()
        self.label(self, "YOUR NAME IS SAVED WITH YOUR GAME RESULTS ON THIS COMPUTER SO YOUR TEACHER CAN MATCH "
                         "THEM WITH YOUR SURVEYS.", 9, fg=MUTED, wraplength=900).pack(pady=(30, 0))
        self.first.focus_set()

    def _field(self, form, title, row):
        self.label(form, title, 12, fg=ACCENT).grid(row=row, column=0, sticky="w", padx=(4, 16), pady=10)
        entry = tk.Entry(form, width=24, font=self.fonts(16), bg=BG, fg=FG, insertbackground=FG,
                         relief="solid", bd=3, highlightthickness=2, highlightcolor=ACCENT,
                         highlightbackground=PANEL)
        entry.grid(row=row, column=1, pady=10, padx=(0, 4))
        entry.bind("<Return>", lambda e: self.submit())
        return entry

    def submit(self):
        for entry, which in ((self.first, "FIRST"), (self.last, "LAST")):
            problem = name_problem(entry.get(), which)
            if problem:
                self.error_lbl.config(text=problem)
                entry.focus_set()
                return
        self.app.set_player(clean_name(self.first.get()), clean_name(self.last.get()))
