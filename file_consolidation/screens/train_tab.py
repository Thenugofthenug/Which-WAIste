"""TRAIN tab: learning-rate slider, start/stop, accuracy chart, dataset
summary, the synaptic view of a probe item, and the training log."""
import math
import threading
import traceback
import tkinter as tk

import numpy as np
from matplotlib.backends.backend_tkagg import FigureCanvasTkAgg
from matplotlib.figure import Figure

from config import (ACCENT, BG, CATEGORIES, EPOCHS, FG, LR_LOG_RANGE, MUTED, PANEL, PICO,
                    SHOW_PER_BLOCK)
from model import probe_model, train_model
from analytics import stats_for
from learning_help import add_tooltip
from network_view import NetworkView, mpl_size
from widgets import PixelProgress, RetroFrame

LR_SETTLE_MS = 700      # slider must rest this long to count as one adjustment


class TrainTab(RetroFrame):
    def __init__(self, master, lab):
        super().__init__(master, lab.fonts)
        self.lab, self.app = lab, lab.app
        self.items = lab.items
        self.training = False
        self.stats = stats_for(lab.app)
        self._lr_job = None                       # pending 'slider settled' record
        self.run_id = None
        self.probe_idx = lab.val_idx[0]
        self.history = {"epoch": [], "train_acc": [], "val_acc": []}

        self._build_action_bar()             # reserved first, so a short window can't cut it off
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

    def _build_action_bar(self):
        """TRY NEW ITEMS and PLAY AGAIN, at the bottom right."""
        bar = tk.Frame(self, bg=self.cget("bg"))
        bar.pack(side="bottom", fill="x", pady=(8, 0))
        self.try_btn = self.button(bar, "TRY NEW ITEMS >", lambda: self.lab.show_tab("try"), 13, bg=PICO["green"])
        self.try_btn.pack(side="right")
        self.try_btn.set_enabled(False)      # nothing to test until the robot has trained
        self.again_btn = self.button(bar, "PLAY AGAIN", self.app.new_game, 13, bg=PICO["light_gray"])
        self.again_btn.pack(side="right", padx=8)
        self.bar_hint = self.label(bar, "TRAIN THE ROBOT FIRST, THEN TRY IT ON NEW ITEMS.", 10, fg=MUTED)
        self.bar_hint.pack(side="left")

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
                        "ARE SHOWN; GLOW = HOW STRONGLY IT RESPONDS. LINES ARE THE REAL WEIGHTS: GREEN = POSITIVE "
                        "(BOOSTS THE NEXT NEURON), RED = NEGATIVE (LOWERS IT), BRIGHTER = MORE SIGNAL. CHANGE = HOW "
                        "MUCH EACH BLOCK'S WEIGHTS MOVED LAST EPOCH.", 8, fg=MUTED, wraplength=1240,
                   justify="left").pack(anchor="w", pady=(0, 4))
        # PREV / NEXT browse the sorted items; placed above the diagram so a short window can't hide them
        row = tk.Frame(net, bg=PANEL)
        row.pack(fill="x", pady=(0, 6))
        self.button(row, "< PREV", lambda: self.change_probe(-1), 9, bg=PICO["light_gray"]).pack(side="left")
        self.button(row, "NEXT >", lambda: self.change_probe(1), 9, bg=PICO["light_gray"]).pack(side="left", padx=6)
        self.probe_lbl = self.label(row, "", 10)
        self.probe_lbl.pack(side="left", padx=8)
        self.view = NetworkView(net)
        self.view.widget.pack(fill="x")

    def _build_log(self):
        outer, body = self.panel(self, "ROBOT LOG - WHAT THE NEURAL NETWORK IS DOING")
        outer.pack(fill="both", expand=True)
        self.label(body, "A LIVE DIARY OF TRAINING. EPOCH = ONE TRIP THROUGH ALL THE PRACTICE PICTURES. "
                         "LOSS = HOW WRONG THE GUESSES ARE (LOWER IS BETTER). ACC = HOW OFTEN IT MATCHES YOUR "
                         "LABELS. PRACTICE = PICTURES IT LEARNS FROM. QUIZ = PICTURES IT NEVER LEARNS FROM, USED "
                         "TO CHECK ITS PROGRESS. YELLOW LINES EXPLAIN WHAT JUST HAPPENED.",
                   8, fg=MUTED, wraplength=1240, justify="left").pack(anchor="w", pady=(0, 4))
        box = tk.Frame(body, bg=BG)
        box.pack(fill="both", expand=True)
        self.log_txt = tk.Text(box, height=6, bg=BG, fg=PICO["green"], font=self.fonts.mono(10),
                               relief="flat", highlightthickness=0, wrap="word")
        self.log_txt.tag_configure("note", foreground=ACCENT)
        sb = tk.Scrollbar(box, command=self.log_txt.yview)
        self.log_txt.config(yscrollcommand=sb.set)
        sb.pack(side="right", fill="y")
        self.log_txt.pack(side="left", fill="both", expand=True)
        self.log("> PRESS START TRAINING TO TEACH THE NETWORK YOUR SORTING RULES.", note=True)
        add_tooltip(self.lr_lbl, "Learning rate controls the size of weight updates. Too large can be unstable; too small may learn slowly.", self.fonts)
        add_tooltip(self.epoch_lbl, "An epoch is one pass through the training examples. Validation examples do not update weights.", self.fonts)
        add_tooltip(self.status_lbl, "Test accuracy measures matches to your labels, not your game points or guaranteed correct recycling rules.", self.fonts)
        add_tooltip(self.probe_lbl, "A probe is the item shown in the network diagram. Browse items to see how their responses differ.", self.fonts)

    # ---------------------------------------------------------------- display
    def log(self, msg, note=False):
        """Add a line to the robot log. note=True marks a plain-language explanation (yellow)."""
        self.log_txt.insert("end", msg + "\n", ("note",) if note else ())
        self.log_txt.see("end")

    def on_lr_change(self, val):
        self.app.current_lr = 10 ** float(val)
        self.lr_lbl.config(text=f"{self.app.current_lr:.1e}")
        # Tk reports every step of a drag; record one adjustment once the slider settles
        if self._lr_job is not None:
            self.after_cancel(self._lr_job)
        self._lr_job = self.after(LR_SETTLE_MS, self._record_lr)

    def _record_lr(self):
        self._lr_job = None
        self.stats.lr_settled(self.app.current_lr)

    def _flush_lr(self):
        """Record a pending slider adjustment right away (before training or leaving)."""
        if self._lr_job is not None:
            self.after_cancel(self._lr_job)
            self._record_lr()

    def destroy(self):
        self._flush_lr()
        super().destroy()

    def redraw_plot(self):
        ax, h = self.ax_acc, self.history
        ax.clear()
        ax.set_facecolor(BG)
        ax.plot(h["epoch"], h["train_acc"], drawstyle="steps-post", color=PICO["blue"], lw=2.5, label="PRACTICE (TRAIN)")
        ax.plot(h["epoch"], h["val_acc"], drawstyle="steps-post", color=PICO["red"], lw=2.5, label="QUIZ (VAL)")
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
        self.probe_idx = (self.probe_idx + step) % len(self.items)
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
        self.best_val_loss = float("inf")
        self.warned = set()                       # one-time hints already shown this run
        self._flush_lr()
        self.run_id = self.stats.training_started(self.app.current_lr, len(self.lab.train_idx),
                                                  len(self.lab.val_idx), len(self.lab.test_idx))
        self.log(f"\n=== NEW ROBOT BRAIN - {EPOCHS} EPOCHS - LEARNING RATE {self.app.current_lr:.1e} ===")
        self.log("THE ROBOT STARTS WITH RANDOM WEIGHTS, SO ITS FIRST GUESSES ARE BASICALLY RANDOM. EACH EPOCH "
                 "IT LOOKS AT EVERY PRACTICE PICTURE, COMPARES ITS GUESS WITH YOUR LABEL, AND NUDGES ITS "
                 "WEIGHTS TO BE A LITTLE LESS WRONG.", note=True)
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
            self.log(data, note=True)
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
        self.log(f"EPOCH {d['epoch']:>2}/{EPOCHS}   PRACTICE: LOSS {d['train_loss']:.2f}  ACC {d['train_acc']:>4.0%}"
                 f"   |   QUIZ: LOSS {d['val_loss']:.2f}  ACC {d['val_acc']:>4.0%}")
        self.narrate_epoch(d)
        self.redraw_plot()
        self.probe_lbl.config(text=self.probe_note())
        self.view.show(self.items[d["probe_idx"]].image, d["viz"], d["probs"], dw=d["dw"],
                       note=self.probe_note(f"EPOCH {d['epoch']} - "))

    def on_done(self, d):
        if d["best_epoch"]:
            self.log(f"\nRESTORED BEST MODEL FROM EPOCH {d['best_epoch']} (LOWEST VALIDATION LOSS).")
            self.log(f"TRAINING IS OVER. THE ROBOT GOES BACK TO ITS BEST VERSION (EPOCH {d['best_epoch']}, WHEN IT "
                     f"DID BEST ON THE QUIZ) AND TAKES A FINAL TEST ON PICTURES IT HAS NEVER SEEN.", note=True)
        else:
            self.log("\nNO FULL EPOCH COMPLETED - TESTING THE UNTRAINED MODEL.")
            self.log("TRAINING STOPPED BEFORE THE FIRST EPOCH FINISHED, SO THE ROBOT IS STILL GUESSING WITH "
                     "RANDOM WEIGHTS.", note=True)
        self.log(f"TEST LOSS {d['test_loss']:.3f}   ACCURACY OVER ALL VIEWS {d['test_acc']:.0%}")
        delta = (d['test_acc'] - d['before_test_acc']) * 100
        self.log(f"DID OUR ROBOT IMPROVE? BEFORE {d['before_test_acc']:.0%} -> AFTER {d['test_acc']:.0%} "
                 f"({delta:+.1f} PERCENTAGE POINTS), ON THE SAME HELD-OUT VIEWS.")
        self.log("THESE SCORES MEASURE MATCHES TO YOUR LABELS. IMPROVEMENT IS NOT GUARANTEED.")
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
        self.log("EACH TEST LINE ABOVE SHOWS YOUR LABEL, THE ROBOT'S ANSWER, AND HOW SURE IT WAS. "
                 "OK = IT MATCHED YOUR LABEL, X = IT DIDN'T.", note=True)
        self.log("> OPEN '2 - TRY NEW ITEMS' TO FEED THE NETWORK NEW PICTURES.")
        self.finish_training(f"{'STOPPED EARLY' if d['stopped'] else 'DONE!'} TEST VIEWS: "
                             f"{d['before_test_acc']:.0%} -> {d['test_acc']:.0%} ({delta:+.1f} pp)")
        self.stats.training_finished(self.run_id, self.app.current_lr, len(self.history["epoch"]),
                                     d["stopped"], d["before_test_acc"], d["test_acc"])
        self.lab.on_trained(d["model"])
        self.try_btn.set_enabled(True)
        self.bar_hint.config(text="DONE TRAINING? TRY THE ROBOT ON NEW ITEMS, OR PLAY AGAIN.")
        self.change_probe(0)

    def narrate_epoch(self, d):
        """Plain-language notes about what just happened inside the network."""
        e = d["epoch"]
        if e == 1:
            self.log("FIRST EPOCH DONE: THE ROBOT HAS SEEN EVERY PRACTICE PICTURE ONCE AND ADJUSTED ITS "
                     "WEIGHTS AFTER EACH SMALL GROUP OF PICTURES.", note=True)
        if d["val_loss"] < self.best_val_loss:
            self.best_val_loss = d["val_loss"]
            if e > 1:
                self.log("  ^ NEW BEST QUIZ RESULT - THE ROBOT SAVES THIS VERSION OF ITSELF.", note=True)
        if e >= 8 and d["train_acc"] - d["val_acc"] >= 0.3 and "overfit" not in self.warned:
            self.warned.add("overfit")
            self.log("HEADS UP: THE PRACTICE SCORE IS MUCH HIGHER THAN THE QUIZ SCORE. THE ROBOT MAY BE "
                     "MEMORIZING ITS PRACTICE PICTURES INSTEAD OF LEARNING GENERAL PATTERNS (OVERFITTING).",
                     note=True)
        if e == 10 and d["train_acc"] < 0.5 and "stuck" not in self.warned:
            self.warned.add("stuck")
            self.log("THE ROBOT IS STRUGGLING TO LEARN. TRY TRAINING AGAIN WITH THE LEARNING-RATE SLIDER "
                     "MOVED A LITTLE.", note=True)
        if e == EPOCHS // 2:
            self.log("HALFWAY THERE! WATCH WHETHER THE QUIZ SCORE KEEPS CLIMBING OR LEVELS OFF.", note=True)

    def finish_training(self, status):
        self.training = False
        self.status_lbl.config(text=status)
        self.start_btn.config(text="TRAIN AGAIN")
        self.start_btn.set_enabled(True)
        self.stop_btn.set_enabled(False)
        self.again_btn.set_enabled(True)
