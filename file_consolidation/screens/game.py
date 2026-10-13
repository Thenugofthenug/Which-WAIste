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
        self.trick_mode = getattr(app, "trick_mode", False)
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
        self.paused = False
        self.guide = None
        self.speed = tk.StringVar(value="NORMAL")

        hud = tk.Frame(self, bg=PANEL, highlightthickness=3, highlightbackground=FG)
        hud.pack(fill="x", padx=12, pady=(12, 6))
        self.button(hud, "RESTART", app.home, 10, bg=PICO["blue"]).pack(side="right", padx=10)
        self.count_lbl = self.label(hud, "", 11, padx=16, pady=8)
        self.count_lbl.pack(side="left")
        self.label(hud, "TRASH SORTER", 14, fg=PICO["green"], padx=16).pack(side="right")
        instructions = ("SORT BEFORE ITEMS SLIP PAST! YOUR LABELS TEACH THE ROBOT."
                        if self.trick_mode else
                        "SORT BEFORE ITEMS SLIP PAST! +10 FOR A CORRECT BIN. WRONG OR MISSED: +0. YOUR LABELS TEACH THE ROBOT.")
        self.label(self, instructions, 11, fg=MUTED).pack(pady=(0, 6))
        controls = tk.Frame(self, bg=self.cget('bg'))
        controls.pack(fill='x', padx=16, pady=(0, 6))
        self.label(controls, "BELT SPEED", 10, fg=ACCENT).pack(side='left', padx=(0, 10))
        speed_menu = tk.OptionMenu(controls, self.speed, *SPEEDS)
        speed_menu.configure(bg=PANEL, fg=FG, activebackground=PANEL, activeforeground=ACCENT,
                             font=self.fonts(10), highlightthickness=0)
        speed_menu['menu'].configure(bg=PANEL, fg=FG, font=self.fonts(10))
        speed_menu.pack(side='left')
        add_tooltip(speed_menu, "Normal is faster than before. Choose Slow for more time or Fast for a challenge.", self.fonts)
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
            c.create_text(cx, y1 - 29, text=CATEGORIES[i].upper(), fill=PICO["black"], font=self.fonts(15))

    def _draw_text(self):
        self.fb_text = self.c.create_text(265, 170, text="", fill=FG, font=self.fonts(22), width=440)
        self.fb_sub = self.c.create_text(265, 250, text="", fill=MUTED, font=self.fonts(10), width=440)
        self.truck_text = self.c.create_text(1015, 170, text="", fill=FG, font=self.fonts(12), width=420)
        self._draw_bin_counts()

    def _draw_bin_counts(self):
        left, top, right, bottom = 28, 320, 502, 510
        self.c.create_rectangle(left, top, right, bottom, fill=PANEL, outline=FG, width=3)
        self.c.create_text((left + right) / 2, top + 22, text="ITEMS IN EACH BIN",
                           fill=ACCENT, font=self.fonts(12))
        self.bin_count_lbls = []
        for i, color in enumerate(CAT_COLORS):
            y = top + 65 + i * 40
            if i:
                self.c.create_line(left + 14, y - 19, right - 14, y - 19, fill="#46464f")
            self.c.create_text(left + 24, y, text=CATEGORIES[i].upper(), anchor="w",
                               fill=color, font=self.fonts(11))
            self.bin_count_lbls.append(
                self.c.create_text(right - 24, y, text="0", anchor="e",
                                   fill=FG, font=self.fonts(13)))

    # -------------------------------------------------------------- helpers
    def open_guide(self):
        if self.guide is not None and self.guide.winfo_exists():
            self.guide.lift()
            return
        self.paused = True
        if self.drag is not None:
            b = self.drag[0]
            b.dragging = False
            self._place(b)
            self.drag = None
            self.c.config(cursor='')
            self._highlight_bin(None)
        self.guide = LearningGuide(self, self._close_guide)

    def _close_guide(self):
        self.guide = None
        self.paused = False

    def _animate_lava(self):
        colors = [PICO['orange'], PICO['yellow'], PICO['red'], PICO['orange']]
        for i, tile in enumerate(self.lava_tiles):
            self.c.itemconfig(tile, fill=colors[(i * 7 + i // 12 + self.frame // 6) % len(colors)])

    def _later(self, ms, fn):
        self._jobs.append(self.after(ms, fn))

    def _update_counts(self):
        if self.trick_mode:
            counts = f"DONE {self.sorted + self.missed:02d}/{len(self.items)}  MISSED {self.missed}"
        else:
            counts = (f"DONE {self.sorted + self.missed:02d}/{len(self.items)}  "
                      f"SCORE {self.score}  RIGHT {self.correct}  MISSED {self.missed}  STREAK {self.streak}")
        self.count_lbl.config(text=counts)
        bin_counts = [sum(item.label == i for item in self.items) for i in range(len(CATEGORIES))]
        for count_lbl, count in zip(self.bin_count_lbls, bin_counts):
            self.c.itemconfig(count_lbl, text=str(count))
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
        self._tick_job = self.after(FRAME_MS, self._tick)

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
        is_correct = cat == item.expected
        if is_correct:
            self.correct += 1
            self.score += 10
            self.streak += 1
            self.best_streak = max(self.best_streak, self.streak)
        else:
            self.streak = 0
        if self.trick_mode:
            self.c.itemconfig(self.fb_text, text="ITEM SORTED", fill=FG)
            self.c.itemconfig(self.fb_sub, text="YOUR LABEL WAS SAVED AS A ROBOT PRACTICE EXAMPLE.")
        elif is_correct:
            self.c.itemconfig(self.fb_text, text="NICE! +10", fill=PICO["green"])
            self.c.itemconfig(self.fb_sub, text=f"STREAK: {self.streak}! YOUR LABEL GIVES THE ROBOT A PRACTICE EXAMPLE.")
        else:
            self.c.itemconfig(self.fb_text, text="CHECK THAT BIN! +0", fill=PICO["red"])
            self.c.itemconfig(self.fb_sub, text=f"MOST PROGRAMS PUT {item.name.upper()} IN "
                                                f"{CATEGORIES[item.expected].upper()}. RULES VARY - "
                                                f"THE ROBOT LEARNS YOUR LABEL, EVEN WHEN IT IS WRONG.")
        self._drop_into_bin(b, cat)
        self._update_counts()
        self._finish_if_complete()

    def _miss(self, b):
        self.belt.remove(b)
        self.items[b.index].label = None
        self.missed += 1
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
            if self.trick_mode:
                self.app.game_summary = f"ROUND COMPLETE | MISSED {self.missed}"
            else:
                self.app.game_summary = (f"SCORE {self.score}/{len(self.items) * 10} | RIGHT {self.correct} | "
                                         f"WRONG {self.sorted - self.correct} | MISSED {self.missed} | BEST STREAK {self.best_streak}")
            self._later(500, self._show_summary)

    def _show_summary(self):
        perfect = self.correct == len(self.items)
        if self.trick_mode:
            self.c.itemconfig(self.fb_text, text="ROUND COMPLETE!", fill=ACCENT)
            self.c.itemconfig(self.fb_sub, text="YOUR LABELS ARE READY.\n\n"
                                                "DID OUR ROBOT IMPROVE? TRAIN IT TO FIND OUT.")
        else:
            self.c.itemconfig(self.fb_text, text="PERFECT SORTING!" if perfect else "SORTING MISSION COMPLETE!", fill=ACCENT)
            self.c.itemconfig(self.fb_sub, text=f"{self.app.game_summary}\n\n"
                                                "DID OUR ROBOT IMPROVE? TRAIN IT TO FIND OUT.\n"
                                                "GAME POINTS ARE NOT MODEL ACCURACY.")
        self.button(self, "TEACH THE ROBOT >", self.app.show_lab, 11, bg=PICO["green"]).place(x=840, y=380)
        self.button(self, "PLAY AGAIN", self.app.new_game, 11, bg=MUTED).place(x=840, y=440)

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
        for job in self._jobs + [self._tick_job]:
            try:
                if job:
                    self.after_cancel(job)
            except tk.TclError:
                pass
        super().destroy()
