#!/usr/bin/env python3
"""
Trash Sorter + CNN
==================
1. Play: sort 30 procedurally-drawn trash items into Recycling / Compost /
   Landfill / Hazardous. YOUR choices become the labels of the dataset.
2. Train: a small convolutional neural network learns from your 30 labeled
   images for 50 epochs.
     - The 30 items are split (stratified) into train / validation / test.
     - A learning-rate slider can be moved at any time, even mid-training.
     - A Stop button ends training early; the best model so far (lowest
       validation loss) is then evaluated on the held-out test set.

Requirements:  pip install torch numpy pillow matplotlib
Run:           python trash_sorter_cnn.py
"""

import copy
import math
import queue
import random
import threading
import traceback
import tkinter as tk
from tkinter import ttk

import numpy as np
from PIL import Image, ImageDraw, ImageEnhance, ImageTk

import torch
import torch.nn as nn
import torch.nn.functional as F

import matplotlib
matplotlib.use("TkAgg")
from matplotlib.backends.backend_tkagg import FigureCanvasTkAgg
from matplotlib.figure import Figure

# ----------------------------------------------------------------------------
# Configuration
# ----------------------------------------------------------------------------
CATEGORIES = ["Recycling", "Compost", "Landfill"]
CAT_COLORS = ["#2b7bd6", "#3a9d4a", "#6b6b6b"]
NUM_ITEMS = 30          # items the player sorts
EPOCHS = 50             # training epochs
DRAW_SIZE = 128         # resolution items are drawn at (and shown to player)
IMG_SIZE = 64           # resolution fed to the CNN
BATCH_SIZE = 16
AUG_PER_ITEM = 8        # augmented copies of each training item per epoch
EVAL_VIEWS = 4          # fixed views per val/test item (1 original + 3 augmented)
DEFAULT_LR = 1e-3

RESAMPLE = getattr(Image, "Resampling", Image)
TRANSPOSE = getattr(Image, "Transpose", Image)


# ----------------------------------------------------------------------------
# Procedural trash drawings
# ----------------------------------------------------------------------------
def P(cx, cy, s, pts):
    """Scale and translate a list of (x, y) offsets."""
    return [(cx + x * s, cy + y * s) for x, y in pts]


def B(cx, cy, s, x0, y0, x1, y1):
    """Scale and translate a bounding box."""
    return [cx + x0 * s, cy + y0 * s, cx + x1 * s, cy + y1 * s]


def jitter(rng, rgb, amt=20):
    return tuple(max(0, min(255, c + rng.randint(-amt, amt))) for c in rgb)


def shade(rgb, f):
    return tuple(max(0, min(255, int(c * f))) for c in rgb)


def draw_plastic_bottle(d, rng, cx, cy, s):
    body = jitter(rng, rng.choice([(170, 210, 235), (190, 225, 200), (225, 225, 235)]))
    cap = jitter(rng, rng.choice([(30, 90, 200), (200, 40, 40), (240, 240, 240), (40, 150, 60)]))
    d.rounded_rectangle(B(cx, cy, s, -15, -18, 15, 42), radius=int(8 * s), fill=body,
                        outline=(90, 110, 130), width=2)
    d.polygon(P(cx, cy, s, [(-15, -18), (-6, -32), (6, -32), (15, -18)]), fill=body,
              outline=(90, 110, 130))
    d.rectangle(B(cx, cy, s, -7, -42, 7, -32), fill=cap, outline=(40, 40, 40))
    d.rectangle(B(cx, cy, s, -15, 0, 15, 18),
                fill=jitter(rng, rng.choice([(230, 60, 60), (250, 200, 50), (60, 160, 230)])))


def draw_can(d, rng, cx, cy, s):
    metal = jitter(rng, (185, 190, 198), 15)
    brand = jitter(rng, rng.choice([(200, 30, 40), (30, 60, 160), (20, 140, 70), (240, 180, 20)]))
    d.ellipse(B(cx, cy, s, -18, 26, 18, 38), fill=metal, outline=(80, 80, 90), width=2)
    d.rectangle(B(cx, cy, s, -18, -30, 18, 32), fill=metal, outline=(80, 80, 90), width=2)
    d.rectangle(B(cx, cy, s, -18, -14, 18, 16), fill=brand)
    d.ellipse(B(cx, cy, s, -18, -36, 18, -24), fill=(215, 218, 225), outline=(80, 80, 90), width=2)
    d.ellipse(B(cx, cy, s, -5, -33, 5, -27), fill=(120, 120, 130))


def draw_newspaper(d, rng, cx, cy, s):
    d.rectangle(B(cx, cy, s, -30, -40, 30, 40), fill=jitter(rng, (232, 228, 215), 12),
                outline=(120, 120, 110), width=2)
    d.rectangle(B(cx, cy, s, -24, -34, 24, -24), fill=(40, 40, 40))
    d.rectangle(B(cx, cy, s, -24, -18, -2, 4), fill=jitter(rng, (150, 150, 150), 30))
    for y in range(-18, 34, 6):
        x0 = 2 if y < 6 else -24
        d.line(P(cx, cy, s, [(x0, y), (24, y)]), fill=(110, 110, 110), width=2)


def draw_cardboard(d, rng, cx, cy, s):
    base = jitter(rng, (190, 140, 85), 15)
    edge = (90, 60, 30)
    d.polygon(P(cx, cy, s, [(-34, -8), (-18, -28), (40, -28), (24, -8)]), fill=shade(base, 1.12), outline=edge)
    d.polygon(P(cx, cy, s, [(24, -8), (40, -28), (40, 18), (24, 38)]), fill=shade(base, 0.8), outline=edge)
    d.rectangle(B(cx, cy, s, -34, -8, 24, 38), fill=base, outline=edge, width=2)
    d.line(P(cx, cy, s, [(-26, -18), (32, -18)]), fill=(210, 190, 150), width=max(1, int(5 * s)))


def draw_glass_jar(d, rng, cx, cy, s):
    glass = jitter(rng, rng.choice([(150, 200, 160), (200, 225, 230), (170, 120, 70)]), 15)
    d.rounded_rectangle(B(cx, cy, s, -22, -24, 22, 40), radius=int(10 * s), fill=glass,
                        outline=(70, 90, 80), width=2)
    d.rectangle(B(cx, cy, s, -18, -36, 18, -24), fill=jitter(rng, (160, 160, 165), 20),
                outline=(60, 60, 60), width=2)
    d.line(P(cx, cy, s, [(-14, -16), (-14, 30)]), fill=(245, 250, 250), width=max(1, int(4 * s)))


def draw_banana_peel(d, rng, cx, cy, s):
    yellow = jitter(rng, (240, 205, 50), 15)
    for k in (-1, 0, 1):
        pts = [(k * 26 * t + k * 10 * math.sin(math.pi * t), -8 + 44 * t)
               for t in (i / 11 for i in range(12))]
        d.line(P(cx, cy, s, pts), fill=yellow, width=max(2, int(11 * s)), joint="curve")
    d.ellipse(B(cx, cy, s, -12, -18, 12, 4), fill=yellow)
    d.rectangle(B(cx, cy, s, -4, -32, 4, -14), fill=(120, 90, 40))
    for _ in range(3):
        x, y = rng.uniform(-6, 6), rng.uniform(-12, 10)
        d.ellipse(B(cx, cy, s, x - 2, y - 2, x + 2, y + 2), fill=(110, 80, 30))


def draw_apple_core(d, rng, cx, cy, s):
    skin = jitter(rng, rng.choice([(200, 30, 40), (120, 180, 50), (220, 180, 40)]), 15)
    d.ellipse(B(cx, cy, s, -20, -36, 20, -14), fill=skin)
    d.ellipse(B(cx, cy, s, -20, 14, 20, 38), fill=skin)
    d.polygon(P(cx, cy, s, [(-16, -22), (16, -22), (8, 0), (16, 22), (-16, 22), (-8, 0)]),
              fill=jitter(rng, (245, 235, 195), 10))
    for y in (-6, 4):
        d.ellipse(B(cx, cy, s, -3, y - 3, 3, y + 3), fill=(70, 40, 20))
    d.line(P(cx, cy, s, [(0, -36), (3, -46)]), fill=(90, 60, 30), width=max(1, int(3 * s)))


def draw_leaves(d, rng, cx, cy, s):
    for dx, dy, col in [(-10, -6, (80, 150, 60)), (12, 8, (190, 120, 40))]:
        col = jitter(rng, col, 20)
        lx, ly = cx + dx * s, cy + dy * s
        pts = [(0, -34), (16, -14), (18, 10), (0, 32), (-18, 10), (-16, -14)]
        d.polygon(P(lx, ly, s, pts), fill=col, outline=shade(col, 0.6))
        d.line(P(lx, ly, s, [(0, -30), (0, 38)]), fill=shade(col, 0.6), width=2)


def draw_eggshell(d, rng, cx, cy, s):
    shell = jitter(rng, rng.choice([(245, 240, 230), (215, 170, 120)]), 10)
    for ox, flip in [(-17, 1), (17, -1)]:
        pts = [(ox + 16 * math.cos(math.radians(a)), 4 + 20 * math.sin(math.radians(a)) * flip)
               for a in range(0, 181, 15)]
        pts += [(ox + x, 4 + (-4 if j % 2 else 2) * flip) for j, x in enumerate(range(-16, 17, 8))]
        d.polygon(P(cx, cy, s, pts), fill=shell, outline=shade(shell, 0.7))


def draw_chip_bag(d, rng, cx, cy, s):
    col = jitter(rng, rng.choice([(220, 40, 40), (40, 90, 210), (250, 170, 20), (130, 40, 170)]), 20)
    pts = [(x, -38 + (3 if (x // 6) % 2 else 0)) for x in range(-26, 27, 6)]
    pts += [(28, -20), (26, 0), (28, 20)]
    pts += [(x, 38 - (3 if (x // 6) % 2 else 0)) for x in range(26, -27, -6)]
    pts += [(-28, 20), (-26, 0), (-28, -20)]
    d.polygon(P(cx, cy, s, pts), fill=col, outline=(40, 40, 40))
    d.ellipse(B(cx, cy, s, -16, -14, 16, 10), fill=(250, 250, 240))
    d.line(P(cx, cy, s, [(-18, -30), (-8, 24)]), fill=shade(col, 1.5), width=max(1, int(3 * s)))


def draw_foam_cup(d, rng, cx, cy, s):
    d.polygon(P(cx, cy, s, [(-24, -30), (24, -30), (15, 36), (-15, 36)]),
              fill=jitter(rng, (245, 245, 240), 8), outline=(160, 160, 160))
    d.ellipse(B(cx, cy, s, -24, -35, 24, -25), fill=(225, 225, 220), outline=(160, 160, 160), width=2)
    for y in (-10, 8, 24):
        w = 22 - (y + 30) * 9 / 66
        d.line(P(cx, cy, s, [(-w, y), (w, y)]), fill=(215, 215, 210), width=1)


def draw_wrapper(d, rng, cx, cy, s):
    col = jitter(rng, rng.choice([(230, 50, 120), (40, 180, 200), (250, 210, 40), (120, 200, 60)]), 20)
    d.polygon(P(cx, cy, s, [(-18, 0), (-40, -16), (-36, 0), (-40, 16)]), fill=col, outline=(50, 50, 50))
    d.polygon(P(cx, cy, s, [(18, 0), (40, -16), (36, 0), (40, 16)]), fill=col, outline=(50, 50, 50))
    d.rounded_rectangle(B(cx, cy, s, -20, -12, 20, 12), radius=int(6 * s), fill=col,
                        outline=(50, 50, 50), width=2)
    d.line(P(cx, cy, s, [(-14, -4), (14, -4)]), fill=(255, 255, 255), width=max(1, int(2 * s)))


# def draw_battery(d, rng, cx, cy, s):
#     top = jitter(rng, rng.choice([(200, 120, 40), (30, 30, 30), (40, 90, 200)]), 15)
#     d.rectangle(B(cx, cy, s, -6, -42, 6, -34), fill=(170, 170, 175), outline=(60, 60, 60))
#     d.rectangle(B(cx, cy, s, -14, -34, 14, 38), fill=(35, 35, 35), outline=(20, 20, 20), width=2)
#     d.rectangle(B(cx, cy, s, -14, -34, 14, -4), fill=top, outline=(20, 20, 20), width=2)
#     d.line(P(cx, cy, s, [(-5, -20), (5, -20)]), fill=(255, 255, 255), width=2)
#     d.line(P(cx, cy, s, [(0, -25), (0, -15)]), fill=(255, 255, 255), width=2)


# def draw_light_bulb(d, rng, cx, cy, s):
#     d.ellipse(B(cx, cy, s, -24, -44, 24, 6), fill=jitter(rng, (250, 245, 190), 10),
#               outline=(150, 140, 90), width=2)
#     d.rectangle(B(cx, cy, s, -11, 0, 11, 26), fill=(175, 175, 180), outline=(90, 90, 95))
#     for y in (6, 13, 20):
#         d.line(P(cx, cy, s, [(-11, y), (11, y)]), fill=(110, 110, 115), width=2)
#     d.polygon(P(cx, cy, s, [(-7, 26), (7, 26), (0, 34)]), fill=(60, 60, 60))
#     d.line(P(cx, cy, s, [(-6, 0), (-4, -18), (4, -18), (6, 0)]), fill=(140, 110, 60), width=2)


# def draw_paint_can(d, rng, cx, cy, s):
#     paint = jitter(rng, rng.choice([(30, 120, 220), (220, 60, 50), (250, 210, 40), (60, 170, 90)]), 20)
#     d.arc(B(cx, cy, s, -22, -44, 22, -4), start=180, end=360, fill=(80, 80, 85), width=max(1, int(3 * s)))
#     d.rectangle(B(cx, cy, s, -24, -24, 24, 36), fill=(180, 182, 188), outline=(80, 80, 85), width=2)
#     d.rectangle(B(cx, cy, s, -24, -4, 24, 20), fill=(240, 240, 235))
#     d.rectangle(B(cx, cy, s, -24, -24, 24, -18), fill=paint)
#     for x in (-16, -2, 12):
#         d.rounded_rectangle(B(cx, cy, s, x, -20, x + 5, -20 + rng.randint(6, 16)), radius=2, fill=paint)
#     d.ellipse(B(cx, cy, s, -10, 0, 10, 16), fill=paint)


# def draw_phone(d, rng, cx, cy, s):
#     body = jitter(rng, rng.choice([(30, 30, 35), (200, 200, 205), (180, 150, 120)]), 10)
#     d.rounded_rectangle(B(cx, cy, s, -18, -38, 18, 38), radius=int(7 * s), fill=body,
#                         outline=(20, 20, 20), width=2)
#     d.rectangle(B(cx, cy, s, -14, -30, 14, 24), fill=jitter(rng, (40, 60, 90), 15))
#     d.line(P(cx, cy, s, [(-14, -30), (0, -4), (6, 24)]), fill=(200, 200, 210), width=1)
#     d.ellipse(B(cx, cy, s, -4, 27, 4, 35), fill=(90, 90, 95))


# (display name, draw function, category most programs would use)
ITEM_TYPES = [
    ("Plastic bottle", draw_plastic_bottle, 0),
    ("Aluminum can", draw_can, 0),
    ("Newspaper", draw_newspaper, 0),
    ("Cardboard box", draw_cardboard, 0),
    ("Glass jar", draw_glass_jar, 0),
    ("Banana peel", draw_banana_peel, 1),
    ("Apple core", draw_apple_core, 1),
    ("Fallen leaves", draw_leaves, 1),
    ("Eggshells", draw_eggshell, 1),
    ("Chip bag", draw_chip_bag, 2),
    ("Foam cup", draw_foam_cup, 2),
    ("Candy wrapper", draw_wrapper, 2),
    # ("Battery", draw_battery, 3),
    # ("Light bulb", draw_light_bulb, 3),
    # ("Paint can", draw_paint_can, 3),
    # ("Old phone", draw_phone, 3),
]


def render_item(draw_fn, rng):
    """Draw one trash item with random position, scale, color and rotation."""
    bg = jitter(rng, rng.choice([(235, 232, 225), (220, 228, 235), (230, 235, 220), (240, 235, 240)]), 10)
    img = Image.new("RGB", (DRAW_SIZE, DRAW_SIZE), bg)
    d = ImageDraw.Draw(img)
    cx = DRAW_SIZE / 2 + rng.uniform(-8, 8)
    cy = DRAW_SIZE / 2 + rng.uniform(-8, 8)
    draw_fn(d, rng, cx, cy, rng.uniform(0.85, 1.15))
    return img.rotate(rng.uniform(-30, 30), resample=RESAMPLE.BICUBIC, fillcolor=bg)


# ----------------------------------------------------------------------------
# Data utilities
# ----------------------------------------------------------------------------
def augment(img, rng):
    """Random rotation / flip / crop / color jitter, returned at IMG_SIZE."""
    bg = img.getpixel((0, 0))
    out = img.rotate(rng.uniform(-20, 20), resample=RESAMPLE.BILINEAR, fillcolor=bg)
    if rng.random() < 0.5:
        out = out.transpose(TRANSPOSE.FLIP_LEFT_RIGHT)
    crop = rng.randint(100, DRAW_SIZE)
    x0, y0 = rng.randint(0, DRAW_SIZE - crop), rng.randint(0, DRAW_SIZE - crop)
    out = out.crop((x0, y0, x0 + crop, y0 + crop))
    out = ImageEnhance.Brightness(out).enhance(rng.uniform(0.8, 1.2))
    out = ImageEnhance.Contrast(out).enhance(rng.uniform(0.8, 1.2))
    out = ImageEnhance.Color(out).enhance(rng.uniform(0.8, 1.2))
    return out.resize((IMG_SIZE, IMG_SIZE), RESAMPLE.BILINEAR)


def to_tensor(img):
    arr = np.asarray(img, dtype=np.float32) / 255.0
    return torch.from_numpy((arr - 0.5) / 0.5).permute(2, 0, 1).contiguous()


def stratified_split(labels, rng, val_frac=1 / 6, test_frac=1 / 6):
    """Split item indices into train/val/test, spreading each class across splits.
    Every class the player used keeps at least one training example."""
    by_class = {}
    for i, lab in enumerate(labels):
        by_class.setdefault(lab, []).append(i)
    train, val, test = [], [], []
    leftovers = []
    for lab in sorted(by_class):
        idxs = by_class[lab][:]
        rng.shuffle(idxs)
        train.append(idxs[0])
        leftovers.append(idxs[1:])
    # interleave classes so val/test draw from every class
    rest = [lst[k] for k in range(max(map(len, leftovers), default=0)) for lst in leftovers if k < len(lst)]
    n_val = max(1, round(len(labels) * val_frac))
    n_test = max(1, round(len(labels) * test_frac))
    for j, i in enumerate(rest):
        if j % 4 == 1 and len(val) < n_val:
            val.append(i)
        elif j % 4 == 3 and len(test) < n_test:
            test.append(i)
        else:
            train.append(i)
    return train, val, test


def build_eval_set(items, idxs, rng):
    """Fixed (non-random per epoch) views of val/test items."""
    X, y, owner = [], [], []
    for i in idxs:
        base = items[i]["image"]
        views = [base.resize((IMG_SIZE, IMG_SIZE), RESAMPLE.BILINEAR)]
        views += [augment(base, rng) for _ in range(EVAL_VIEWS - 1)]
        for v in views:
            X.append(to_tensor(v))
            y.append(items[i]["label"])
            owner.append(i)
    return torch.stack(X), torch.tensor(y, dtype=torch.long), owner


def make_train_epoch(images, labels, rng):
    """Fresh augmented copies of each training item for one epoch."""
    X, y = [], []
    for img, lab in zip(images, labels):
        for _ in range(AUG_PER_ITEM):
            X.append(to_tensor(augment(img, rng)))
            y.append(lab)
    return torch.stack(X), torch.tensor(y, dtype=torch.long)


# ----------------------------------------------------------------------------
# Model
# ----------------------------------------------------------------------------
class TrashCNN(nn.Module):
    def __init__(self, n_classes):
        super().__init__()

        def block(cin, cout):
            return nn.Sequential(nn.Conv2d(cin, cout, 3, padding=1), nn.BatchNorm2d(cout),
                                 nn.ReLU(inplace=True), nn.MaxPool2d(2))

        self.features = nn.Sequential(block(3, 16), block(16, 32), block(32, 64), block(64, 64))
        self.head = nn.Sequential(nn.AdaptiveAvgPool2d(1), nn.Flatten(), nn.Dropout(0.3),
                                  nn.Linear(64, n_classes))

    def forward(self, x):
        return self.head(self.features(x))


@torch.no_grad()
def evaluate(model, X, y):
    model.eval()
    logits = model(X)
    loss = F.cross_entropy(logits, y).item()
    acc = (logits.argmax(1) == y).float().mean().item()
    return loss, acc, logits


# ----------------------------------------------------------------------------
# GUI application
# ----------------------------------------------------------------------------
class App:
    def __init__(self, root):
        self.root = root
        root.title("Trash Sorter + CNN")
        root.geometry("1120x800")
        root.protocol("WM_DELETE_WINDOW", self.on_close)
        root.bind("<Key>", self.on_key)

        self.q = queue.Queue()
        self.stop_event = threading.Event()
        self.current_lr = DEFAULT_LR
        self.training = False
        self.phase = None
        self.frame = None

        self.new_game()
        self.root.after(100, self.poll_queue)

    # ------------------------------------------------------------ game phase
    def new_game(self):
        if self.frame is not None:
            self.frame.destroy()
        rng = random.Random()
        order = []
        while len(order) < NUM_ITEMS:
            batch = list(range(len(ITEM_TYPES)))
            rng.shuffle(batch)
            order += batch
        self.items = []
        for k in order[:NUM_ITEMS]:
            name, fn, expected = ITEM_TYPES[k]
            self.items.append({"name": name, "image": render_item(fn, rng),
                               "expected": expected, "label": None})
        self.idx, self.score, self.locked = 0, 0, False
        self.build_game_ui()
        self.show_item()

    def build_game_ui(self):
        self.phase = "game"
        f = self.frame = tk.Frame(self.root, padx=20, pady=15)
        f.pack(fill="both", expand=True)
        tk.Label(f, text="♻ Trash Sorter", font=("Helvetica", 24, "bold")).pack()
        tk.Label(f, text="Sort each item into a bin. Your choices become the labels the CNN learns from."
                         "  (Keys 1–4 work too.)", font=("Helvetica", 11)).pack(pady=(0, 10))
        self.progress_lbl = tk.Label(f, font=("Helvetica", 12))
        self.progress_lbl.pack()
        self.img_lbl = tk.Label(f, bd=2, relief="groove")
        self.img_lbl.pack(pady=8)
        self.name_lbl = tk.Label(f, font=("Helvetica", 18, "bold"))
        self.name_lbl.pack()
        row = tk.Frame(f)
        row.pack(pady=12)
        for i, (cat, col) in enumerate(zip(CATEGORIES, CAT_COLORS)):
            tk.Button(row, text=f"{i + 1}. {cat}", width=12, height=2, bg=col, fg="white",
                      activebackground=col, highlightbackground=col, font=("Helvetica", 12, "bold"),
                      command=lambda c=i: self.sort_item(c)).pack(side="left", padx=6)
        self.feedback_lbl = tk.Label(f, font=("Helvetica", 12), wraplength=700)
        self.feedback_lbl.pack(pady=4)
        self.score_lbl = tk.Label(f, font=("Helvetica", 12))
        self.score_lbl.pack()

    def show_item(self):
        item = self.items[self.idx]
        self.photo = ImageTk.PhotoImage(item["image"].resize((256, 256), RESAMPLE.BICUBIC))
        self.img_lbl.config(image=self.photo)
        self.name_lbl.config(text=item["name"])
        self.progress_lbl.config(text=f"Item {self.idx + 1} / {NUM_ITEMS}")
        self.score_lbl.config(text=f"Score vs. common guidelines: {self.score} / {self.idx}")

    def on_key(self, event):
        if self.phase == "game" and event.char in "1234" and event.char:
            self.sort_item(int(event.char) - 1)

    def sort_item(self, cat):
        if self.phase != "game" or self.locked:
            return
        item = self.items[self.idx]
        item["label"] = cat
        if cat == item["expected"]:
            self.score += 1
            self.feedback_lbl.config(fg="#2a7a2a", text=f"✓ {item['name']} → {CATEGORIES[cat]}.")
        else:
            self.feedback_lbl.config(
                fg="#b36200",
                text=f"✗ Most programs put {item['name'].lower()} in {CATEGORIES[item['expected']]}. "
                     f"(Rules vary by city — your label still goes into the dataset.)")
        self.idx += 1
        if self.idx >= NUM_ITEMS:
            self.locked = True
            self.score_lbl.config(text=f"Final score: {self.score} / {NUM_ITEMS}")
            self.root.after(1300, self.build_training_ui)
        else:
            self.show_item()

    # -------------------------------------------------------- training phase
    def build_training_ui(self):
        self.frame.destroy()
        self.phase = "train"
        labels = [it["label"] for it in self.items]
        self.train_idx, self.val_idx, self.test_idx = stratified_split(labels, random.Random(42))

        eval_rng = random.Random(7)
        self.Xv, self.yv, _ = build_eval_set(self.items, self.val_idx, eval_rng)
        self.Xt, self.yt, self.test_owner = build_eval_set(self.items, self.test_idx, eval_rng)

        f = self.frame = tk.Frame(self.root, padx=12, pady=10)
        f.pack(fill="both", expand=True)

        lines = [f"You scored {self.score}/{NUM_ITEMS} against common guidelines.  "
                 f"Dataset (your labels): train {len(self.train_idx)} · validation {len(self.val_idx)}"
                 f" · test {len(self.test_idx)} items"]
        for c, cat in enumerate(CATEGORIES):
            cnt = [sum(labels[i] == c for i in split)
                   for split in (self.train_idx, self.val_idx, self.test_idx)]
            lines.append(f"   {cat:<10}  train {cnt[0]:>2}  |  val {cnt[1]:>2}  |  test {cnt[2]:>2}")
        tk.Label(f, text="\n".join(lines), font=("Courier", 11), justify="left").pack(anchor="w")

        body = tk.Frame(f)
        body.pack(fill="both", expand=True, pady=8)

        # --- controls
        ctrl = tk.Frame(body, padx=8)
        ctrl.pack(side="left", fill="y")
        tk.Label(ctrl, text="Learning rate", font=("Helvetica", 12, "bold")).pack(anchor="w")
        self.lr_exp = tk.DoubleVar(value=math.log10(self.current_lr))
        tk.Scale(ctrl, from_=-4.0, to=-1.0, resolution=0.1, orient="horizontal", length=230,
                 showvalue=False, variable=self.lr_exp, command=self.on_lr_change).pack(anchor="w")
        self.lr_lbl = tk.Label(ctrl, text=f"{self.current_lr:.1e}", font=("Helvetica", 12))
        self.lr_lbl.pack(anchor="w")
        tk.Label(ctrl, text="Log scale 1e-4 … 1e-1.\nCan be changed mid-training;\n"
                            "applies from the next batch.", fg="#666", justify="left").pack(anchor="w", pady=(0, 12))

        self.start_btn = tk.Button(ctrl, text="▶ Start Training", width=24, command=self.start_training)
        self.start_btn.pack(pady=3)
        self.stop_btn = tk.Button(ctrl, text="■ Stop", width=24, state="disabled", command=self.stop_training)
        self.stop_btn.pack(pady=3)
        self.pbar = ttk.Progressbar(ctrl, maximum=EPOCHS, length=230)
        self.pbar.pack(pady=(12, 2))
        self.epoch_lbl = tk.Label(ctrl, text=f"Epoch 0 / {EPOCHS}")
        self.epoch_lbl.pack()
        self.status_lbl = tk.Label(ctrl, text="Ready.", wraplength=230, justify="left",
                                   font=("Helvetica", 11, "bold"))
        self.status_lbl.pack(pady=10, anchor="w")
        self.again_btn = tk.Button(ctrl, text="↺ Play again (new items)", width=24, command=self.new_game)
        self.again_btn.pack(side="bottom", pady=4)

        # --- plots
        right = tk.Frame(body)
        right.pack(side="left", fill="both", expand=True)
        self.fig = Figure(figsize=(7, 3.8), dpi=100)
        self.ax_loss = self.fig.add_subplot(1, 2, 1)
        self.ax_acc = self.fig.add_subplot(1, 2, 2)
        self.plot_canvas = FigureCanvasTkAgg(self.fig, master=right)
        self.plot_canvas.get_tk_widget().pack(fill="both", expand=True)
        self.reset_history()
        self.redraw_plot()

        # --- log
        logf = tk.Frame(f)
        logf.pack(fill="both", expand=True)
        self.log_txt = tk.Text(logf, height=11, font=("Courier", 10), wrap="none")
        sb = tk.Scrollbar(logf, command=self.log_txt.yview)
        self.log_txt.config(yscrollcommand=sb.set)
        sb.pack(side="right", fill="y")
        self.log_txt.pack(side="left", fill="both", expand=True)
        self.log("Press 'Start Training' to train the CNN on your sorted items.")

    def log(self, msg):
        self.log_txt.insert("end", msg + "\n")
        self.log_txt.see("end")

    def on_lr_change(self, val):
        self.current_lr = 10 ** float(val)
        self.lr_lbl.config(text=f"{self.current_lr:.1e}")

    def reset_history(self):
        self.history = {k: [] for k in ("epoch", "train_loss", "val_loss", "train_acc", "val_acc")}

    def redraw_plot(self):
        h = self.history
        for ax, key, title in ((self.ax_loss, "loss", "Loss"), (self.ax_acc, "acc", "Accuracy")):
            ax.clear()
            ax.plot(h["epoch"], h[f"train_{key}"], label="train", color="#2b7bd6")
            ax.plot(h["epoch"], h[f"val_{key}"], label="validation", color="#d64b2b")
            ax.set_title(title)
            ax.set_xlabel("epoch")
            ax.set_xlim(0, EPOCHS)
            ax.grid(alpha=0.3)
            ax.legend(loc="best", fontsize=8)
        self.ax_acc.set_ylim(0, 1.05)
        self.fig.tight_layout()
        self.plot_canvas.draw_idle()

    def start_training(self):
        if self.training:
            return
        self.training = True
        self.stop_event.clear()
        self.reset_history()
        self.redraw_plot()
        self.pbar["value"] = 0
        self.start_btn.config(state="disabled")
        self.stop_btn.config(state="normal")
        self.again_btn.config(state="disabled")
        self.status_lbl.config(text="Training…")
        self.log(f"\n=== Training a fresh CNN for {EPOCHS} epochs (lr {self.current_lr:.1e}) ===")

        train_imgs = [self.items[i]["image"] for i in self.train_idx]
        train_labels = [self.items[i]["label"] for i in self.train_idx]
        threading.Thread(target=self.train_worker,
                         args=(train_imgs, train_labels), daemon=True).start()

    def stop_training(self):
        self.stop_event.set()
        self.stop_btn.config(state="disabled")
        self.status_lbl.config(text="Stopping…")

    # Runs in a background thread; talks to the GUI only through self.q
    def train_worker(self, train_imgs, train_labels):
        try:
            rng = random.Random()
            model = TrashCNN(len(CATEGORIES))
            opt = torch.optim.Adam(model.parameters(), lr=self.current_lr, weight_decay=1e-4)
            best = {"loss": float("inf"), "epoch": 0, "state": None}
            last_lr = self.current_lr
            stopped = False

            for epoch in range(1, EPOCHS + 1):
                X, y = make_train_epoch(train_imgs, train_labels, rng)
                perm = torch.randperm(len(X))
                model.train()
                tot_loss, correct, seen = 0.0, 0, 0
                for b in range(0, len(X), BATCH_SIZE):
                    if self.stop_event.is_set():
                        stopped = True
                        break
                    lr = self.current_lr                     # live slider value
                    if lr != last_lr:
                        self.q.put(("log", f"   learning rate changed → {lr:.1e}"))
                        last_lr = lr
                    for g in opt.param_groups:
                        g["lr"] = lr
                    idx = perm[b:b + BATCH_SIZE]
                    xb, yb = X[idx], y[idx]
                    opt.zero_grad()
                    out = model(xb)
                    loss = F.cross_entropy(out, yb)
                    loss.backward()
                    opt.step()
                    tot_loss += loss.item() * len(yb)
                    correct += (out.argmax(1) == yb).sum().item()
                    seen += len(yb)
                if stopped:
                    self.q.put(("log", f"Training stopped by user during epoch {epoch}."))
                    break

                vl, va, _ = evaluate(model, self.Xv, self.yv)
                if vl < best["loss"]:
                    best = {"loss": vl, "epoch": epoch, "state": copy.deepcopy(model.state_dict())}
                self.q.put(("epoch", {"epoch": epoch, "train_loss": tot_loss / seen,
                                      "train_acc": correct / seen, "val_loss": vl, "val_acc": va,
                                      "lr": last_lr}))

            # Final evaluation on the held-out test set with the best checkpoint
            if best["state"] is not None:
                model.load_state_dict(best["state"])
            tl, ta, logits = evaluate(model, self.Xt, self.yt)
            probs = F.softmax(logits, dim=1)
            per_item = {}
            for p, owner in zip(probs, self.test_owner):
                per_item.setdefault(owner, []).append(p)
            item_probs = {o: torch.stack(ps).mean(0).tolist() for o, ps in per_item.items()}
            self.q.put(("done", {"test_loss": tl, "test_acc": ta, "best_epoch": best["epoch"],
                                 "item_probs": item_probs, "stopped": stopped}))
        except Exception:
            self.q.put(("error", traceback.format_exc()))

    def poll_queue(self):
        try:
            while True:
                kind, data = self.q.get_nowait()
                if self.phase != "train":
                    continue
                if kind == "log":
                    self.log(data)
                elif kind == "epoch":
                    self.on_epoch(data)
                elif kind == "done":
                    self.on_done(data)
                elif kind == "error":
                    self.log("ERROR:\n" + data)
                    self.finish_training("Training failed — see log.")
        except queue.Empty:
            pass
        self.root.after(100, self.poll_queue)

    def on_epoch(self, d):
        for k in self.history:
            self.history[k].append(d[k])
        self.pbar["value"] = d["epoch"]
        self.epoch_lbl.config(text=f"Epoch {d['epoch']} / {EPOCHS}")
        self.log(f"Epoch {d['epoch']:>2}/{EPOCHS}  lr {d['lr']:.1e}  "
                 f"train loss {d['train_loss']:.3f} acc {d['train_acc']:.2f}  |  "
                 f"val loss {d['val_loss']:.3f} acc {d['val_acc']:.2f}")
        self.redraw_plot()

    def on_done(self, d):
        if d["best_epoch"]:
            self.log(f"\nRestored best model from epoch {d['best_epoch']} (lowest validation loss).")
        else:
            self.log("\nNo full epoch completed — evaluating the untrained/partial model.")
        self.log(f"TEST  loss {d['test_loss']:.3f}   accuracy over all views {d['test_acc']:.2%}")
        item_correct = 0
        self.log("Per-item test predictions (averaged over views):")
        for i in self.test_idx:
            p = d["item_probs"][i]
            pred = int(np.argmax(p))
            ok = pred == self.items[i]["label"]
            item_correct += ok
            self.log(f"   {'✓' if ok else '✗'} {self.items[i]['name']:<15} your label: "
                     f"{CATEGORIES[self.items[i]['label']]:<10} model: {CATEGORIES[pred]:<10} ({p[pred]:.0%})")
        acc = item_correct / len(self.test_idx)
        self.log(f"TEST item accuracy: {item_correct}/{len(self.test_idx)} = {acc:.0%}")
        prefix = "Stopped early. " if d["stopped"] else "Done! "
        self.finish_training(f"{prefix}Test accuracy: {acc:.0%} of held-out items.")

    def finish_training(self, status):
        self.training = False
        self.status_lbl.config(text=status)
        self.start_btn.config(state="normal", text="▶ Train again (fresh model)")
        self.stop_btn.config(state="disabled")
        self.again_btn.config(state="normal")

    def on_close(self):
        self.stop_event.set()
        self.root.destroy()


def main():
    root = tk.Tk()
    App(root)
    root.mainloop()


if __name__ == "__main__":
    main()
