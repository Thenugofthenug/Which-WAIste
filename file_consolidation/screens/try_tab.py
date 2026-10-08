"""TRY NEW ITEMS tab: feed the trained network fresh pictures, including
never-seen types that belong in bins the model has no label for."""
import random
import tkinter as tk

import numpy as np

from config import ACCENT, CATEGORIES, MUTED, PICO
from items import ITEM_TYPES, NOVEL_TYPES
from model import probe_model
from network_view import NetworkView
from sprites import render_item
from widgets import RetroFrame


class TryTab(RetroFrame):
    def __init__(self, master, lab):
        super().__init__(master, lab.fonts)
        self.lab = lab
        self.rng = random.Random()
        self.tally = {"familiar": [0, 0], "novel_label": [0, 0], "forced": 0, "forced_conf": []}

        outer, body = self.panel(self, "TRY NEW ITEMS")
        outer.pack(fill="both", expand=True)
        self.label(body, "THE NETWORK MAPS ANY PICTURE TO ONE OF ITS LABELS. IT HAS NO \"I DON'T KNOW\" "
                         "OPTION: SOFTMAX ALWAYS SPLITS 100% ACROSS THE BINS IT WAS TRAINED ON. TRY FAMILIAR "
                         "ITEMS AND NEVER-SEEN ITEMS - SOME BELONG IN BINS THE MODEL HAS NO LABEL FOR.",
                   10, wraplength=1240, justify="left").pack(anchor="w")
        self.info_lbl = self.label(body, "", 9, fg=MUTED, justify="left")
        self.info_lbl.pack(anchor="w", pady=(6, 8))

        row = tk.Frame(body, bg=body.cget("bg"))
        row.pack(anchor="w")
        self.button(row, "FAMILIAR ITEM", lambda: self.try_item(novel=False), 12,
                    bg=PICO["blue"]).pack(side="left", padx=(0, 10))
        self.button(row, "NEVER-SEEN ITEM", lambda: self.try_item(novel=True), 12,
                    bg=PICO["pink"]).pack(side="left")

        self.view = NetworkView(body, height=3.5)
        self.view.widget.pack(fill="x", pady=10)
        self.result_lbl = self.label(body, "", 15, justify="left")
        self.result_lbl.pack(anchor="w")
        self.explain_lbl = self.label(body, "", 10, wraplength=1240, justify="left")
        self.explain_lbl.pack(anchor="w", pady=6)
        self.tally_lbl = self.label(body, "", 11, fg=ACCENT, mono=True, justify="left")
        self.tally_lbl.pack(anchor="w", pady=8)
        self.update_tally()

    def refresh_info(self):
        used = sorted({self.lab.items[i].label for i in self.lab.train_idx})
        unused = [CATEGORIES[c].upper() for c in range(len(CATEGORIES)) if c not in used]
        text = "LABELS THE NETWORK KNOWS: " + ", ".join(CATEGORIES[c].upper() for c in used)
        if unused:
            text += f"\nYOU NEVER USED {', '.join(unused)} IN TRAINING, SO THE NETWORK HAS NO EXAMPLES OF IT."
        self.info_lbl.config(text=text)

    def player_label_for(self, name):
        """The label the player most often gave this item type (what the model learned)."""
        labs = [it.label for it in self.lab.items if it.name == name]
        return max(set(labs), key=labs.count) if labs else None

    def try_item(self, novel):
        model = self.lab.trained_model
        if model is None:
            return
        if novel:
            name, draw_fn, destination, true_idx = self.rng.choice(NOVEL_TYPES)
        else:
            name, draw_fn, guideline = self.rng.choice(ITEM_TYPES)
        img = render_item(draw_fn, self.rng)
        viz, probs = probe_model(model, img)
        pred = int(np.argmax(probs))
        conf = probs[pred]

        if not novel:
            target = self.player_label_for(name)
            target = guideline if target is None else target
            ok = pred == target
            self.tally["familiar"][0] += ok
            self.tally["familiar"][1] += 1
            msg = (f"YOU LABELED {name.upper()} AS {CATEGORIES[target].upper()}. THIS TYPE WAS IN THE TRAINING "
                   f"DATA, SO MISTAKES HERE COME FROM HAVING ONLY ~20 TRAINING IMAGES.")
            if target != guideline:
                msg += f" (MOST GUIDELINES SAY {CATEGORIES[guideline].upper()} - THE NETWORK LEARNED YOUR RULE.)"
            note = f"FAMILIAR TYPE: {name}"
        elif true_idx is None:
            ok = False
            self.tally["forced"] += 1
            self.tally["forced_conf"].append(conf)
            msg = (f"A {name.upper()} REALLY GOES TO: {destination.upper()}. THAT ISN'T ONE OF THE NETWORK'S "
                   f"LABELS, SO IT COULD NEVER ANSWER CORRECTLY - IT PICKED THE KNOWN BIN THAT LOOKS MOST "
                   f"SIMILAR. THE {conf:.0%} ISN'T REAL CERTAINTY, ONLY RELATIVE TO ITS {len(CATEGORIES)} OPTIONS.")
            note = f"NEVER SEEN: {name} - NEEDS A LABEL THE MODEL DOESN'T HAVE"
        else:
            ok = pred == true_idx
            self.tally["novel_label"][0] += ok
            self.tally["novel_label"][1] += 1
            msg = (f"THE NETWORK NEVER SAW A {name.upper()}, BUT ITS CORRECT BIN "
                   f"({CATEGORIES[true_idx].upper()}) EXISTS. A RIGHT ANSWER COMES FROM LOOKING SIMILAR TO "
                   f"TRAINING ITEMS, NOT FROM UNDERSTANDING WHAT IT IS.")
            note = f"NEVER SEEN: {name} - CORRECT LABEL EXISTS"

        self.result_lbl.config(fg=PICO["green"] if ok else PICO["red"],
                               text=f"{'OK' if ok else 'X'}  {name.upper()} - MODEL SAYS: "
                                    f"{CATEGORIES[pred].upper()} ({conf:.0%})")
        self.explain_lbl.config(text=msg)
        self.view.show(img, viz, probs, note=note)
        self.update_tally()

    def update_tally(self):
        t = self.tally
        avg = f"AVG CONFIDENCE {np.mean(t['forced_conf']):.0%}" if t["forced_conf"] else "-"
        self.tally_lbl.config(text=(
            f"FAMILIAR ITEMS CORRECT ............... {t['familiar'][0]} / {t['familiar'][1]}\n"
            f"NEVER-SEEN, VALID LABEL, CORRECT ..... {t['novel_label'][0]} / {t['novel_label'][1]}\n"
            f"NEVER-SEEN, NO VALID LABEL ........... {t['forced']} FORCED INTO A WRONG BIN ({avg})"))
