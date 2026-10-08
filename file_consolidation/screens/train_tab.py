"""TRAIN tab: learning-rate slider, start/stop, accuracy chart, dataset
summary, the synaptic view of a probe item, and the training log."""
import math
import threading
import traceback
import tkinter as tk

import numpy as np
from matplotlib.backends.backend_tkagg import FigureCanvasTkAgg
from matplotlib.figure import Figure

from config import (ACCENT, BG, CATEGORIES, EPOCHS, FG, LR_LOG_RANGE, MUTED, NUM_ITEMS, PANEL, PICO,
                    SHOW_PER_BLOCK)
from model import probe_model, train_model
from network_view import NetworkView, mpl_size
from widgets import PixelProgress, RetroFrame


class TrainTab(RetroFrame):
    def __init__(self, master, lab):
        super().__init__(master, lab.fonts)
        self.lab, self.app = lab, lab.app
        self.items = lab.items
        self.training = False
        self.probe_idx = lab.val_idx[0]
        self.history = {"epoch": [], "train_acc": [], "val_acc": []}

        top = tk.Frame(self, bg=self.cget("bg"))
        top.pack(fill="x")
        self._build_controls(top)
        self._build_accuracy(top)
        self._build_dataset(top)
        self._build_network()
        self._build_log()
        self.redraw_plot()
        self.change_probe(0)

    # ---------------------------------------------------------------- layout
    def _build_controls(self, parent):
        outer, ctrl = self.panel(parent, "CONTROLS")
        outer.pack(side="left", fill="y")
        self.label(ctrl, "LEARNING RATE", 10, fg=ACCENT).pack(anchor="w")
        self.lr_exp = tk.DoubleVar(value=math.log10(self.app.current_lr))
        tk.Scale(ctrl, from_=LR_LOG_RANGE[0], to=LR_LOG_RANGE[1], resolution=0.1, orient="horizontal",
                 length=256, showvalue=False, variable=self.lr_exp, command=self.on_lr_change,
                 bg=PICO["light_gray"], troughcolor=BG, activebackground=ACCENT, highlightthickness=0,
                 bd=2, sliderrelief="raised", sliderlength=22, width=16).pack(anchor="w", pady=4)
        self.lr_lbl = self.label(ctrl, f"{self.app.current_lr:.1e}", 12)
        self.lr_lbl.pack(anchor="w")
        self.label(ctrl, "LOG SCALE - WORKS MID-TRAINING", 8, fg=MUTED).pack(anchor="w", pady=(0, 8))
        self.start_btn = self.button(ctrl, "START TRAINING", self.start_training, 11, bg=PICO["green"])
        self.start_btn.pack(fill="x", pady=3)
        self.stop_btn = self.button(ctrl, "STOP", self.stop_training, 11, bg=PICO["red"])
        self.stop_btn.pack(fill="x", pady=3)
        self.stop_btn.set_enabled(False)
        self.pbar = PixelProgress(ctrl)
        self.pbar.pack(pady=(10, 2))
        self.epoch_lbl = self.label(ctrl, f"EPOCH 00/{EPOCHS}", 10)
        self.epoch_lbl.pack()
        self.status_lbl = self.label(ctrl, "READY.", 10, fg=ACCENT, wraplength=256, justify="left")
        self.status_lbl.pack(anchor="w", pady=6)
        self.again_btn = self.button(ctrl, "PLAY AGAIN", self.app.new_game, 10, bg=MUTED)
        self.again_btn.pack(fill="x", pady=3)

    def _build_accuracy(self, parent):
        outer, body = self.panel(parent, "ACCURACY")
        outer.pack(side="left", fill="both", expand=True, padx=8)
        self.fig = Figure(figsize=(6.2, 2.7), dpi=100, facecolor=PANEL)
        self.ax_acc = self.fig.add_subplot(1, 1, 1)
        self.plot_canvas = FigureCanvasTkAgg(self.fig, master=body)
        self.plot_canvas.get_tk_widget().configure(highlightthickness=0, bd=0)
        self.plot_canvas.get_tk_widget().pack(fill="both", expand=True)

    def _build_dataset(self, parent):
        outer, body = self.panel(parent, "DATASET")
        outer.pack(side="left", fill="y")
        lab = self.lab
        labels = [it.label for it in self.items]
        lines = [f"TRAIN {len(lab.train_idx):>2}  VAL {len(lab.val_idx)}  TEST {len(lab.test_idx)}", "",
                 "BIN        TR  VA  TE"]
        for c, cat in enumerate(CATEGORIES):
            cnt = [sum(labels[i] == c for i in split) for split in (lab.train_idx, lab.val_idx, lab.test_idx)]
            lines.append(f"{cat.upper():<10} {cnt[0]:>2}  {cnt[1]:>2}  {cnt[2]:>2}")
        self.label(body, "\n".join(lines), 11, mono=True, justify="left").pack(anchor="nw")

    def _build_network(self):
        outer, net = self.panel(self, "INSIDE THE NETWORK")
        outer.pack(fill="x", pady=8)
        self.label(net, f"EACH SQUARE IS A NEURON (ONE FILTER). ONLY THE {SHOW_PER_BLOCK} MOST ACTIVE PER BLOCK "
                        "ARE SHOWN; GLOW = HOW HARD IT FIRES. LINES ARE THE REAL WEIGHTS: GREEN = EXCITATORY, "
                        "RED = INHIBITORY, BRIGHTER = MORE SIGNAL FLOWING. DW = HOW MUCH EACH BLOCK'S WEIGHTS "
                        "MOVED LAST EPOCH.", 8, fg=MUTED, wraplength=1240, justify="left").pack(anchor="w", pady=(0, 4))
        self.view = NetworkView(net)
        self.view.widget.pack(fill="x")
        row = tk.Frame(net, bg=PANEL)
        row.pack(fill="x", pady=(6, 0))
        self.button(row, "< PREV", lambda: self.change_probe(-1), 9, bg=MUTED).pack(side="left")
        self.button(row, "NEXT >", lambda: self.change_probe(1), 9, bg=MUTED).pack(side="left", padx=6)
        self.probe_lbl = self.label(row, "", 10)
        self.probe_lbl.pack(side="left", padx=8)

    def _build_log(self):
        outer, body = self.panel(self, "LOG")
        outer.pack(fill="both", expand=True)
        self.log_txt = tk.Text(body, height=6, bg=BG, fg=PICO["green"], font=self.fonts.mono(10),
                               relief="flat", highlightthickness=0, wrap="none")
        sb = tk.Scrollbar(body, command=self.log_txt.yview)
        self.log_txt.config(yscrollcommand=sb.set)
        sb.pack(side="right", fill="y")
        self.log_txt.pack(side="left", fill="both", expand=True)
        self.log("> PRESS START TRAINING TO TEACH THE NETWORK YOUR SORTING RULES.")

    # ---------------------------------------------------------------- display
    def log(self, msg):
        self.log_txt.insert("end", msg + "\n")
        self.log_txt.see("end")

    def on_lr_change(self, val):
        self.app.current_lr = 10 ** float(val)
        self.lr_lbl.config(text=f"{self.app.current_lr:.1e}")

    def redraw_plot(self):
        ax, h = self.ax_acc, self.history
        ax.clear()
        ax.set_facecolor(BG)
        ax.plot(h["epoch"], h["train_acc"], drawstyle="steps-post", color=PICO["blue"], lw=2.5, label="TRAIN")
        ax.plot(h["epoch"], h["val_acc"], drawstyle="steps-post", color=PICO["red"], lw=2.5, label="VAL")
        ax.set_xlim(0, EPOCHS)
        ax.set_ylim(0, 1.05)
        ax.grid(color=PICO["dark_gray"], linestyle=":", lw=1)
        for spine in ax.spines.values():
            spine.set_color(FG)
            spine.set_linewidth(2)
        ax.tick_params(colors=FG, labelsize=mpl_size(8))
        ax.set_xlabel("EPOCH", color=FG, fontsize=mpl_size(8))
        legend = ax.legend(loc="lower right", facecolor=BG, edgecolor=FG, fontsize=mpl_size(8))
        for text in legend.get_texts():
            text.set_color(FG)
        self.fig.tight_layout()
        self.plot_canvas.draw_idle()

    def probe_note(self, prefix=""):
        it = self.items[self.probe_idx]
        return (f"{prefix}PROBE: {it.name} ({self.lab.split_name(self.probe_idx)}, "
                f"YOUR LABEL: {CATEGORIES[it.label]})").upper()

    def probe_snapshot(self):
        """(index, image) of the current probe item; called from the training thread."""
        idx = self.probe_idx
        return idx, self.items[idx].image

    def change_probe(self, step):
        self.probe_idx = (self.probe_idx + step) % NUM_ITEMS
        img = self.items[self.probe_idx].image
        if self.training:
            self.probe_lbl.config(text=self.probe_note() + " - UPDATES NEXT EPOCH")
            return
        self.probe_lbl.config(text=self.probe_note())
        if self.lab.trained_model is not None:
            viz, probs = probe_model(self.lab.trained_model, img)
            self.view.show(img, viz, probs, note=self.probe_note("TRAINED - "))
        else:
            self.view.show(img, None, None, note=self.probe_note("NOT TRAINED - "))

    # --------------------------------------------------------------- training
    def start_training(self):
        if self.training:
            return
        self.training = True
        self.app.stop_event.clear()
        self.history = {"epoch": [], "train_acc": [], "val_acc": []}
        self.redraw_plot()
        self.pbar.set(0)
        self.start_btn.set_enabled(False)
        self.stop_btn.set_enabled(True)
        self.again_btn.set_enabled(False)
        self.status_lbl.config(text="TRAINING...")
        self.log(f"\n=== NEW CNN - {EPOCHS} EPOCHS - LR {self.app.current_lr:.1e} ===")
        imgs = [self.items[i].image for i in self.lab.train_idx]
        labels = [self.items[i].label for i in self.lab.train_idx]
        threading.Thread(target=self._train_thread, args=(imgs, labels), daemon=True).start()

    def _train_thread(self, imgs, labels):
        """Runs in the background; reports only through the App's queue."""
        def emit(kind, data):
            self.app.q.put((kind, data))
        try:
            train_model(imgs, labels, self.lab.val_set, self.lab.test_set,
                        get_lr=lambda: self.app.current_lr, get_probe=self.probe_snapshot,
                        stop_event=self.app.stop_event, emit=emit)
        except Exception:
            emit("error", traceback.format_exc())

    def stop_training(self):
        self.app.stop_event.set()
        self.stop_btn.set_enabled(False)
        self.status_lbl.config(text="STOPPING...")

    def handle_message(self, kind, data):
        if kind == "log":
            self.log(data)
        elif kind == "probe":
            self.view.show(self.items[data["probe_idx"]].image, data["viz"], data["probs"],
                           note=self.probe_note("EPOCH 0 (RANDOM) - "))
        elif kind == "epoch":
            self.on_epoch(data)
        elif kind == "done":
            self.on_done(data)
        elif kind == "error":
            self.log("ERROR:\n" + data)
            self.finish_training("TRAINING FAILED - SEE LOG.")

    def on_epoch(self, d):
        for key in self.history:
            self.history[key].append(d[key])
        self.pbar.set(d["epoch"] / EPOCHS)
        self.epoch_lbl.config(text=f"EPOCH {d['epoch']:02d}/{EPOCHS}")
        self.log(f"EPOCH {d['epoch']:>2}/{EPOCHS}  LR {d['lr']:.1e}  "
                 f"TRAIN LOSS {d['train_loss']:.3f} ACC {d['train_acc']:.2f}  |  "
                 f"VAL LOSS {d['val_loss']:.3f} ACC {d['val_acc']:.2f}")
        self.redraw_plot()
        self.probe_lbl.config(text=self.probe_note())
        self.view.show(self.items[d["probe_idx"]].image, d["viz"], d["probs"], dw=d["dw"],
                       note=self.probe_note(f"EPOCH {d['epoch']} - "))

    def on_done(self, d):
        if d["best_epoch"]:
            self.log(f"\nRESTORED BEST MODEL FROM EPOCH {d['best_epoch']} (LOWEST VALIDATION LOSS).")
        else:
            self.log("\nNO FULL EPOCH COMPLETED - TESTING THE UNTRAINED MODEL.")
        self.log(f"TEST LOSS {d['test_loss']:.3f}   ACCURACY OVER ALL VIEWS {d['test_acc']:.0%}")
        correct = 0
        for i in self.lab.test_idx:
            p = d["item_probs"][i]
            pred = int(np.argmax(p))
            ok = pred == self.items[i].label
            correct += ok
            self.log(f"  {'OK' if ok else 'X':<3} {self.items[i].name.upper():<15} YOURS: "
                     f"{CATEGORIES[self.items[i].label].upper():<10} MODEL: {CATEGORIES[pred].upper():<10} "
                     f"({p[pred]:.0%})")
        acc = correct / len(self.lab.test_idx)
        self.log(f"TEST ITEMS CORRECT: {correct}/{len(self.lab.test_idx)} = {acc:.0%}")
        self.log("> OPEN '2 - TRY NEW ITEMS' TO FEED THE NETWORK NEW PICTURES.")
        self.finish_training(f"{'STOPPED EARLY' if d['stopped'] else 'DONE!'} TEST ACCURACY: {acc:.0%}")
        self.lab.on_trained(d["model"])
        self.change_probe(0)

    def finish_training(self, status):
        self.training = False
        self.status_lbl.config(text=status)
        self.start_btn.config(text="TRAIN AGAIN")
        self.start_btn.set_enabled(True)
        self.stop_btn.set_enabled(False)
        self.again_btn.set_enabled(True)
