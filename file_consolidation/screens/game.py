"""
Conveyor-belt sorting game (top-down view)
==========================================
Trash rides down the belt; drag each item into the Recycling, Compost or
Landfill bin. The bin you choose becomes that item's training label. If an
item reaches the end unsorted, it is missed and has no training label.
"""
import tkinter as tk
from dataclasses import dataclass

from PIL import ImageTk

from analytics import stats_for
from config import ACCENT, CAT_COLORS, CATEGORIES, FG, MUTED, PANEL, PICO, hex_to_rgb
from learning_help import LearningGuide, add_tooltip
from sprites import cutout, sprite
from widgets import RetroFrame

# ---- layout (canvas pixels) -------------------------------------------------
CANVAS_W, CANVAS_H = 1280, 770
BELT_X0, BELT_X1 = 530, 750            # belt surface
BELT_MID = (BELT_X0 + BELT_X1) / 2
BELT_END = 470                         # the stopper bar
ITEM_PX = 128                          # on-screen item size (a multiple of the 64 px sprite)
STOP_Y = BELT_END + 16               # where an unsorted item falls into lava
SPACING = 180                          # gap between items as they enter the belt
ROLLER_GAP = 30
BIN_W, BIN_H, BIN_TOP = 300, 200, 548
BIN_CENTERS = [280, 640, 1000]

# ---- timing -----------------------------------------------------------------
FRAME_MS = 30                          # ~33 frames per second
SPEED = 3.6                            # faster default, pixels per frame
SPEEDS = {"SLOW": 2.2, "NORMAL": SPEED, "FAST": 5.0}
SLOWER = {"FAST": "NORMAL", "NORMAL": "SLOW"}  # one step slower (SLOW is the slowest)


def tint(hex_col, f):
    """Darken (f < 1) or lighten (f > 1) a hex color."""
    return "#%02x%02x%02x" % tuple(max(0, min(255, int(v * f))) for v in hex_to_rgb(hex_col))


@dataclass
class BeltItem:
    index: int                 # position in app.items
    y: float                   # slot on the belt (keeps moving even while dragged)
    image_id: int
    text_id: int
    photo: object              # keeps the Tk image alive
    dragging: bool = False


class GameScreen(RetroFrame):
    def __init__(self, master, app):
        super().__init__(master, app.fonts)
        self.app = app
        self.items = app.items
        self.belt = []                 # BeltItems on the belt (including one being dragged)
        self.next_spawn = 0
        self.sorted = 0
        self.correct = 0
        self.missed = 0
        self.score = 0
        self.streak = 0
        self.best_streak = 0
        self.drag = None               # (BeltItem, grab offset x, grab offset y)
        self.roll = 0.0
        self.frame = 0
        self.done = False
        self._jobs = []                # one-off timers (animations, end of game)
        self._tick_job = None
        self._pause_reasons = set()    # the belt stops while any reason is active ("guide", "missed")
        self.guide = None
        self.miss_box = None           # the missed-item message, while it's open
        self._key_seqs = []
        self.speed = tk.StringVar(value="NORMAL")
        self.stats = stats_for(app)
        self.stats.start_game()

        hud = tk.Frame(self, bg=PANEL, highlightthickness=3, highlightbackground=FG)
        hud.pack(fill="x", padx=12, pady=(12, 6))
        self.count_lbl = self.label(hud, "", 11, padx=16, pady=8)
        self.count_lbl.pack(side="left")
        self.label(hud, "TRASH SORTER", 14, fg=PICO["green"], padx=16).pack(side="right")
        player = getattr(app, "player", None)
        if player:                                   # shows who the results are saved for
            self.label(hud, f"PLAYER: {player[0]} {player[1]}".upper(), 11, fg=ACCENT, padx=8).pack(side="right")
        self.label(self, "DRAG ITEMS INTO A BIN, OR PRESS 1 = RECYCLING  2 = COMPOST  3 = LANDFILL FOR THE ITEM IN THE "
                         "YELLOW BOX. +10 FOR A CORRECT BIN. YOUR LABELS TEACH THE ROBOT.",
                   11, fg=MUTED).pack(pady=(0, 6))
        controls = tk.Frame(self, bg=self.cget('bg'))
        controls.pack(fill='x', padx=16, pady=(0, 6))
        self.label(controls, "BELT SPEED", 10, fg=ACCENT).pack(side='left', padx=(0, 10))
        self.speed_btns = {}
        for name in SPEEDS:                      # one button per speed; the chosen one lights up
            btn = self.button(controls, name, lambda n=name: self.speed.set(n), 10, bg=PICO["light_gray"])
            btn.pack(side='left', padx=(0, 6))
            add_tooltip(btn, "Normal is faster than before. Choose Slow for more time or Fast for a challenge.",
                        self.fonts)
            self.speed_btns[name] = btn
        self.speed.trace_add("write", lambda *_: self._show_speed())
        self._show_speed()
        help_btn = self.button(controls, "? LEARNING TIPS", self.open_guide, 10, bg=PICO['blue'])
        help_btn.pack(side='right')
        add_tooltip(help_btn, "Explore labels, pixels, filters, weights and fair testing. The belt pauses while the guide is open.", self.fonts)

        self.c = tk.Canvas(self, width=CANVAS_W, height=CANVAS_H, bg=PICO["dark_blue"], highlightthickness=0)
        self.c.pack()
        self._draw_floor()
        self._draw_belt()
        self._draw_bins()
        self._draw_text()
        self._bind_mouse()
        self._bind_keys()
        self._update_counts()
        self._tick_job = self.after(FRAME_MS, self._tick)

    # ------------------------------------------------------------- scenery
    def _draw_floor(self):
        for x in range(0, CANVAS_W, 40):
            self.c.create_line(x, 0, x, CANVAS_H, fill="#23346a")
        for y in range(0, CANVAS_H, 40):
            self.c.create_line(0, y, CANVAS_W, y, fill="#23346a")

    def _draw_belt(self):
        c = self.c
        rail = PICO["light_gray"]
        for x0, x1 in ((BELT_X0 - 16, BELT_X0), (BELT_X1, BELT_X1 + 16)):
            c.create_rectangle(x0, 0, x1, BELT_END, fill=rail, outline=PICO["dark_gray"], width=2)
            for y in range(20, BELT_END, 60):
                c.create_oval(x0 + 5, y - 3, x1 - 5, y + 3, fill=PICO["dark_gray"], outline="")
        c.create_rectangle(BELT_X0, 0, BELT_X1, BELT_END, fill="#2b2b31", outline="")
        n = BELT_END // ROLLER_GAP + 1
        self.rollers = [c.create_line(BELT_X0 + 4, 0, BELT_X1 - 4, 0, fill="#46464f", width=3) for _ in range(n)]
        self._move_rollers()
        # hazard-striped edge and a blocky lava pool below the rail
        c.create_rectangle(BELT_X0 - 16, BELT_END, BELT_X1 + 16, BELT_END + 18, fill=PICO["black"], outline="")
        for x in range(BELT_X0 - 16, BELT_X1 + 16, 24):
            c.create_polygon(x, BELT_END + 18, x + 12, BELT_END, x + 24, BELT_END, x + 12, BELT_END + 18,
                             fill=PICO["yellow"], outline="")
        c.create_text(BELT_X1 + 30, BELT_END, text="< LAVA PIT!\n  SAVE THE EXAMPLES!", anchor="w",
                      fill=PICO["yellow"], font=self.fonts(10))
        c.create_rectangle(BELT_X0 - 20, BELT_END + 18, BELT_X1 + 20, 542,
                           fill=PICO['dark_gray'], outline=PICO['light_gray'], width=4)
        self.lava_tiles = []
        for row in range(3):
            for col in range(12):
                x, y = BELT_X0 - 10 + col * 20, BELT_END + 22 + row * 12
                self.lava_tiles.append(c.create_rectangle(x, y, x + 20, y + 12,
                                                         fill=PICO['orange'], outline='', tags='lava'))
        self._animate_lava()

    def _draw_bins(self):
        c = self.c
        self.bin_rims = []
        for i, (cx, col) in enumerate(zip(BIN_CENTERS, CAT_COLORS)):
            x0, x1, y0, y1 = cx - BIN_W / 2, cx + BIN_W / 2, BIN_TOP, BIN_TOP + BIN_H
            c.create_rectangle(x0 + 8, y0 + 8, x1 + 8, y1 + 8, fill=PICO["black"], outline="")   # shadow
            self.bin_rims.append(c.create_rectangle(x0, y0, x1, y1, fill=col, outline=FG, width=4))
            c.create_rectangle(x0 + 18, y0 + 16, x1 - 18, y1 - 58, fill=tint(col, 0.32),
                               outline=tint(col, 0.6), width=4)                       # opening
            c.create_line(x0 + 18, y0 + 26, x1 - 18, y0 + 26, fill=tint(col, 0.45), width=2)
            c.create_text(cx, y1 - 29, text=f"{i + 1}  {CATEGORIES[i].upper()}", fill=PICO["black"],
                          font=self.fonts(15))

    def _draw_text(self):
        self.fb_text = self.c.create_text(265, 170, text="", fill=FG, font=self.fonts(22), width=440)
        self.fb_sub = self.c.create_text(265, 250, text="", fill=MUTED, font=self.fonts(10), width=440)
        self.truck_text = self.c.create_text(1015, 170, text="", fill=FG, font=self.fonts(12), width=420)
        # yellow box around the item that keys 1 / 2 / 3 will sort
        self.target_box = self.c.create_rectangle(0, 0, 0, 0, outline=ACCENT, width=3, state="hidden")
        self.target_tag = self.c.create_text(0, 0, text="PRESS 1 / 2 / 3", fill=ACCENT, font=self.fonts(9),
                                             state="hidden")

    # -------------------------------------------------------------- helpers
    @property
    def paused(self):
        """True while the belt is stopped (guide or missed-item message open)."""
        return bool(self._pause_reasons)

    def _cancel_drag(self):
        """Drop whatever is being dragged back onto its spot on the belt."""
        if self.drag is not None:
            b = self.drag[0]
            b.dragging = False
            self._place(b)
            self.drag = None
            self.c.config(cursor='')
            self._highlight_bin(None)

    def open_guide(self):
        if self.guide is not None and self.guide.winfo_exists():
            self.guide.lift()
            return
        self._pause_reasons.add("guide")
        self._cancel_drag()
        self.guide = LearningGuide(self, self._close_guide)

    def _show_speed(self):
        """Light up the button for the current belt speed."""
        for name, btn in self.speed_btns.items():
            if btn.winfo_exists():
                btn.set_color(ACCENT if name == self.speed.get() else PICO["light_gray"])

    def _close_guide(self):
        self.guide = None
        self._pause_reasons.discard("guide")

    def _animate_lava(self):
        colors = [PICO['orange'], PICO['yellow'], PICO['red'], PICO['orange']]
        for i, tile in enumerate(self.lava_tiles):
            self.c.itemconfig(tile, fill=colors[(i * 7 + i // 12 + self.frame // 6) % len(colors)])

    def _later(self, ms, fn):
        self._jobs.append(self.after(ms, fn))

    def _update_counts(self):
        total = len(self.items) - self.missed           # items lost in the lava leave the dataset
        self.count_lbl.config(text=f"SORTED {self.sorted:02d}/{total}  SCORE {self.score}  RIGHT {self.correct}  "
                                  f"LOST {self.missed}  STREAK {self.streak}")
        left = len(self.items) - self.next_spawn
        self.c.itemconfig(self.truck_text, text=f"STILL ON THE TRUCK:\n{left} ITEM{'S' if left != 1 else ''}"
                          if left else "LAST ITEMS ON THE BELT!")

    def _move_rollers(self):
        for i, line in enumerate(self.rollers):
            y = i * ROLLER_GAP + self.roll - ROLLER_GAP
            self.c.coords(line, BELT_X0 + 4, y, BELT_X1 - 4, y)

    def _place(self, b, x=BELT_MID, y=None):
        y = b.y if y is None else y
        self.c.coords(b.image_id, x, y)
        self.c.coords(b.text_id, x, y + ITEM_PX / 2 + 2)

    def _bin_at(self, x, y):
        for i, cx in enumerate(BIN_CENTERS):
            if abs(x - cx) <= BIN_W / 2 + 10 and BIN_TOP - 25 <= y <= BIN_TOP + BIN_H + 10:
                return i
        return None

    def _highlight_bin(self, which):
        for i, rim in enumerate(self.bin_rims):
            self.c.itemconfig(rim, outline=ACCENT if i == which else FG, width=8 if i == which else 4)

    # ------------------------------------------------------------ belt loop
    def _spawn(self):
        idx = self.next_spawn
        self.next_spawn += 1
        item = self.items[idx]
        photo = ImageTk.PhotoImage(cutout(sprite(item.image, ITEM_PX)))
        y = -ITEM_PX / 2
        image_id = self.c.create_image(BELT_MID, y, image=photo, tags=("trash",))
        text_id = self.c.create_text(BELT_MID, y + ITEM_PX / 2 + 2, text=item.name.upper(), fill=FG,
                                     font=self.fonts(9), tags=("trash",))
        self.belt.append(BeltItem(idx, y, image_id, text_id, photo))
        self._update_counts()

    def _tick(self):
        if self.done:
            return
        if self.paused:
            self._tick_job = self.after(FRAME_MS, self._tick)
            return
        self.frame += 1
        speed = SPEEDS[self.speed.get()]
        self.roll = (self.roll + speed) % ROLLER_GAP
        self._move_rollers()
        if self.frame % 6 == 0:
            self._animate_lava()
        for b in self.belt[:]:
            b.y += speed
            if b.y >= STOP_Y:
                self._miss(b)
            elif not b.dragging:
                self._place(b)
        if self.done:
            return
        if self.next_spawn < len(self.items):
            top = min((b.y for b in self.belt), default=None)
            if top is None or top >= -ITEM_PX / 2 + SPACING:
                self._spawn()
        self._update_target()
        self._tick_job = self.after(FRAME_MS, self._tick)

    # ------------------------------------------------------------- keyboard
    def _bind_keys(self):
        """Keys 1 / 2 / 3 (top row or number pad) sort the item in the yellow box,
        for players who find dragging on a trackpad hard."""
        top = self.winfo_toplevel()
        for i in range(len(CATEGORIES)):
            for seq in (f"<KeyPress-{i + 1}>", f"<KeyPress-KP_{i + 1}>"):
                try:
                    top.bind(seq, lambda e, cat=i: self._key_sort(cat))
                    self._key_seqs.append(seq)
                except tk.TclError:          # a key this platform doesn't know
                    pass

    def _front_item(self):
        """The item the keys act on: the one being dragged, else the one closest to the lava."""
        if self.drag is not None:
            return self.drag[0]
        return max(self.belt, key=lambda b: b.y, default=None)

    def _key_sort(self, cat):
        if self.done or self.paused:
            return
        b = self._front_item()
        if b is None:
            return
        if self.drag is not None:            # a key press finishes a drag in progress
            self.drag = None
            b.dragging = False
            self.c.config(cursor="")
            self._highlight_bin(None)
        self._sort(b, cat)

    def _update_target(self):
        """Move the yellow box (and its PRESS 1 / 2 / 3 tag) onto the next item."""
        b = None if self.done else self._front_item()
        if b is None:
            self.c.itemconfig(self.target_box, state="hidden")
            self.c.itemconfig(self.target_tag, state="hidden")
            return
        x, y = self.c.coords(b.image_id)
        half = ITEM_PX / 2 + 4
        self.c.coords(self.target_box, x - half, y - half, x + half, y + half + 14)
        self.c.coords(self.target_tag, x, y - half - 10)
        for item in (self.target_box, self.target_tag):
            self.c.itemconfig(item, state="normal")
            self.c.tag_raise(item)

    # ---------------------------------------------------- missed-item help
    def _show_miss_help(self):
        """Pause the belt, explain what happened, and offer to slow the belt down."""
        self._pause_reasons.add("missed")
        self._cancel_drag()
        if self.miss_box is None or not self.miss_box.winfo_exists():
            outer, body = self.panel(self, "ITEM LOST IN THE LAVA")
            self.miss_box = outer
            self.miss_text = self.label(body, "", 11, justify="left", wraplength=640)
            self.miss_text.pack(anchor="w", pady=(0, 12))
            self.miss_btns = tk.Frame(body, bg=PANEL)
            self.miss_btns.pack(anchor="w")
            outer.place(relx=0.5, rely=0.5, anchor="center")
        self._fill_miss_help()
        self.miss_box.lift()

    def _fill_miss_help(self):
        total = len(self.items) - self.missed
        slower = SLOWER.get(self.speed.get())
        lines = ["THAT ITEM REACHED THE END OF THE BELT AND FELL INTO THE LAVA.",
                 f"IT WAS REMOVED FROM YOUR DATASET: THE ROBOT NOW HAS {total} ITEMS TO LEARN FROM.",
                 "",
                 "HOW TO SAVE THE NEXT ONE:",
                 "  - THE ITEM IN THE YELLOW BOX IS NEXT IN LINE.",
                 "  - DRAG IT INTO A BIN, OR PRESS 1 = RECYCLING, 2 = COMPOST, 3 = LANDFILL.",
                 "  - YOU CAN GRAB ANY ITEM ON THE BELT, NOT JUST THE FIRST ONE."]
        if slower is None:
            lines += ["", "THE BELT IS ALREADY ON THE SLOWEST SPEED."]
        self.miss_text.config(text="\n".join(lines))
        for widget in self.miss_btns.winfo_children():
            widget.destroy()
        if slower:
            first = self.button(self.miss_btns, f"SLOW DOWN TO {slower} & CONTINUE",
                                lambda: self._close_miss_help(slower), 11, bg=PICO["green"])
            first.pack(side="left", padx=(0, 10))
            self.button(self.miss_btns, "KEEP SPEED & CONTINUE", self._close_miss_help, 11,
                        bg=PICO["light_gray"]).pack(side="left")
        else:
            first = self.button(self.miss_btns, "CONTINUE", self._close_miss_help, 11, bg=PICO["green"])
            first.pack(side="left")
        first.focus_set()                    # Enter or Space continues

    def _close_miss_help(self, new_speed=None):
        if new_speed:
            self.speed.set(new_speed)
        if self.miss_box is not None and self.miss_box.winfo_exists():
            self.miss_box.destroy()
        self.miss_box = None
        self._pause_reasons.discard("missed")

    # ------------------------------------------------------------- dragging
    def _bind_mouse(self):
        c = self.c
        c.tag_bind("trash", "<ButtonPress-1>", self._on_press)
        c.bind("<B1-Motion>", self._on_drag)
        c.bind("<ButtonRelease-1>", self._on_release)
        c.tag_bind("trash", "<Enter>", lambda e: c.config(cursor="hand2"))
        c.tag_bind("trash", "<Leave>", lambda e: c.config(cursor="") if self.drag is None else None)

    def _item_at(self, x, y):
        hits = self.c.find_overlapping(x - 2, y - 2, x + 2, y + 2)
        for cid in reversed(hits):                     # topmost first
            for b in self.belt:
                if cid in (b.image_id, b.text_id):
                    return b
        return None

    def _on_press(self, e):
        if self.done or self.paused or self.drag is not None:
            return
        b = self._item_at(e.x, e.y)
        if b is None:
            return
        b.dragging = True
        x, y = self.c.coords(b.image_id)
        self.drag = (b, x - e.x, y - e.y)
        self.c.tag_raise(b.image_id)
        self.c.tag_raise(b.text_id)

    def _on_drag(self, e):
        if self.drag is None or self.paused:
            return
        b, dx, dy = self.drag
        self._place(b, e.x + dx, e.y + dy)
        self._highlight_bin(self._bin_at(e.x, e.y))
        self._update_target()

    def _on_release(self, e):
        if self.drag is None or self.paused:
            return
        b, _, _ = self.drag
        self.drag = None
        self.c.config(cursor="")
        self._highlight_bin(None)
        b.dragging = False
        target = self._bin_at(e.x, e.y)
        if target is None:
            self._place(b)                             # back to its spot on the belt
        else:
            self._sort(b, target)

    # -------------------------------------------------------------- sorting
    def _sort(self, b, cat):
        self.belt.remove(b)
        item = self.items[b.index]
        item.label = cat
        self.sorted += 1
        self.stats.item_sorted(item.name, item.expected, cat)
        if cat == item.expected:
            self.correct += 1
            self.score += 10
            self.streak += 1
            self.best_streak = max(self.best_streak, self.streak)
            self.c.itemconfig(self.fb_text, text="NICE! +10", fill=PICO["green"])
            self.c.itemconfig(self.fb_sub, text=f"STREAK: {self.streak}! YOUR LABEL GIVES THE ROBOT A PRACTICE EXAMPLE.")
        else:
            self.streak = 0
            self.c.itemconfig(self.fb_text, text="CHECK THAT BIN! +0", fill=PICO["red"])
            self.c.itemconfig(self.fb_sub, text=f"MOST PROGRAMS PUT {item.name.upper()} IN "
                                                f"{CATEGORIES[item.expected].upper()}. RULES VARY - "
                                                f"THE ROBOT LEARNS YOUR LABEL, EVEN WHEN IT IS WRONG.")
        self._drop_into_bin(b, cat)
        self._update_counts()
        self._finish_if_complete()
        self._update_target()

    def _miss(self, b):
        self.belt.remove(b)
        self.items[b.index].label = None
        self.missed += 1
        self.stats.item_sorted(self.items[b.index].name, self.items[b.index].expected, None)
        self.streak = 0
        if self.drag is not None and self.drag[0] is b:
            self.drag = None
            self.c.config(cursor="")
            self._highlight_bin(None)
        self._burn_into_lava(b)
        self.c.itemconfig(self.fb_text, text="OH NO! INTO THE LAVA", fill=PICO["orange"])
        self.c.itemconfig(self.fb_sub, text="OUR ROBOT MISSED A PRACTICE EXAMPLE. CATCH THE NEXT ONE!\n"
                                         "NO POINTS THIS TIME. MISSED ITEMS HAVE NO TRAINING LABEL.")
        self._update_counts()
        self._finish_if_complete()
        self._update_target()
        if not self.done:
            self._show_miss_help()

    def _burn_into_lava(self, b):
        """Shrink a missed sprite into the pool and release square sparks."""
        self.c.delete(b.text_id)
        self.c.dtag(b.image_id, 'trash')
        sparks = [self.c.create_rectangle(0, 0, 0, 0, fill=col, outline='', tags='lava-spark')
                  for col in [PICO['yellow'], PICO['orange']] * 4]

        def step(k):
            if k > 10:
                self.c.delete(b.image_id)
                for spark in sparks:
                    self.c.delete(spark)
                return
            size = max(8, round(ITEM_PX * (1 - k / 11)))
            b.photo = ImageTk.PhotoImage(cutout(sprite(self.items[b.index].image, size)))
            self.c.itemconfig(b.image_id, image=b.photo)
            self.c.coords(b.image_id, BELT_MID, BELT_END + 18 + k * 2)
            self.c.tag_raise(b.image_id)
            for i, spark in enumerate(sparks):
                x = BELT_MID + (i - 3.5) * (k + 4)
                y = BELT_END + 36 - k * 4 + (i % 3) * 6
                self.c.coords(spark, x, y, x + 6, y + 6)
                self.c.tag_raise(spark)
            self._later(FRAME_MS, lambda: step(k + 1))

        step(1)

    def _finish_if_complete(self):
        if not self.done and self.sorted + self.missed == len(self.items):
            self.done = True
            self._close_miss_help()
            self.stats.finish_game(self.score, self.correct, self.sorted - self.correct, self.missed,
                                   self.best_streak)
            self.app.game_summary = (f"SCORE {self.score}/{len(self.items) * 10} | RIGHT {self.correct} | "
                                     f"WRONG {self.sorted - self.correct} | MISSED {self.missed} | BEST STREAK {self.best_streak}")
            self._later(500, self._show_summary)

    def _show_summary(self):
        perfect = self.correct == len(self.items)
        self.c.itemconfig(self.fb_text, text="PERFECT SORTING!" if perfect else "SORTING MISSION COMPLETE!", fill=ACCENT)
        self.c.itemconfig(self.fb_sub, text=f"{self.app.game_summary}\n\n"
                                         "DID OUR ROBOT IMPROVE? TRAIN IT TO FIND OUT.\n"
                                         "GAME POINTS ARE NOT MODEL ACCURACY.")
        self.button(self, "TEACH THE ROBOT >", self.app.show_lab, 11, bg=PICO["green"]).place(x=840, y=380)
        self.button(self, "PLAY AGAIN", self.app.new_game, 11, bg=PICO["light_gray"]).place(x=840, y=440)

    def _drop_into_bin(self, b, cat, steps=7):
        """Slide the item into the bin opening, flash the bin, then remove the item."""
        x0, y0 = self.c.coords(b.image_id)
        tx, ty = BIN_CENTERS[cat], BIN_TOP + (BIN_H - 58) / 2 + 8
        self.c.delete(b.text_id)

        def step(k):
            if k > steps:
                self.c.delete(b.image_id)
                return
            t = k / steps
            self.c.coords(b.image_id, x0 + (tx - x0) * t, y0 + (ty - y0) * t)
            self._later(FRAME_MS, lambda: step(k + 1))

        step(1)
        rim = self.bin_rims[cat]
        self.c.itemconfig(rim, fill=ACCENT)
        self._later(180, lambda: self.c.itemconfig(rim, fill=CAT_COLORS[cat]))

    def destroy(self):
        top = self.winfo_toplevel()
        for seq in self._key_seqs:           # the keys belong to this screen only
            top.unbind(seq)
        for job in self._jobs + [self._tick_job]:
            try:
                if job:
                    self.after_cancel(job)
            except tk.TclError:
                pass
        super().destroy()
