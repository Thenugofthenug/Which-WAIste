"""Lab screen: splits the sorted items into train / validation / test and
hosts the TRAIN and TRY NEW ITEMS tabs."""
import random
import tkinter as tk

from config import ACCENT, PICO
from data import build_eval_set, stratified_split
from screens.train_tab import TrainTab
from screens.try_tab import TryTab
from widgets import RetroFrame


class LabScreen(RetroFrame):
    def __init__(self, master, app):
        super().__init__(master, app.fonts)
        self.app = app
        self.items = app.items
        self.trained_model = None

        labels = [it.label for it in self.items]
        self.train_idx, self.val_idx, self.test_idx = stratified_split(labels, random.Random(42))
        eval_rng = random.Random(7)
        self.val_set = build_eval_set(self.items, self.val_idx, eval_rng)
        self.test_set = build_eval_set(self.items, self.test_idx, eval_rng)

        bar = tk.Frame(self, bg=self.cget("bg"))
        bar.pack(fill="x", padx=10, pady=(8, 0))
        self.tab_btns = {
            "train": self.button(bar, "1 - TRAIN", lambda: self.show_tab("train"), 11),
            "try": self.button(bar, "2 - TRY NEW ITEMS", lambda: self.show_tab("try"), 11),
        }
        for btn in self.tab_btns.values():
            btn.pack(side="left", padx=(0, 8))
        self.tab_btns["try"].set_enabled(False)

        self.tabs = {"train": TrainTab(self, self), "try": TryTab(self, self)}
        self.show_tab("train")

    def split_name(self, idx):
        return "TRAIN" if idx in self.train_idx else "VAL" if idx in self.val_idx else "TEST"

    def show_tab(self, name):
        for tab_name, frame in self.tabs.items():
            frame.pack_forget()
            self.tab_btns[tab_name].set_color(ACCENT if tab_name == name else PICO["light_gray"])
        self.tabs[name].pack(fill="both", expand=True, padx=10, pady=8)

    def on_trained(self, model):
        """Called by the train tab when a model is ready."""
        self.trained_model = model
        self.tab_btns["try"].set_enabled(True)
        self.show_tab("train")                  # refreshes the tab colors
        self.tabs["try"].refresh_info()

    def handle_message(self, kind, data):
        """Training-thread messages, forwarded by the App."""
        self.tabs["train"].handle_message(kind, data)
