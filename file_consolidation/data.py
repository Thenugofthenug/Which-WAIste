"""
Data
====
Turning sprites into network-ready tensors: conversion, augmentation, the
stratified train/validation/test split, and dataset builders.
"""
import numpy as np
import torch
from PIL import ImageEnhance

from config import AUG_PER_ITEM, DRAW_SIZE, EVAL_VIEWS, IMG_SIZE, RESAMPLE, TRANSPOSE


def to_tensor(img):
    """PIL image -> normalized (3, IMG_SIZE, IMG_SIZE) tensor."""
    if img.size != (IMG_SIZE, IMG_SIZE):
        img = img.resize((IMG_SIZE, IMG_SIZE), RESAMPLE.NEAREST)
    arr = np.asarray(img, dtype=np.float32) / 255.0
    return torch.from_numpy((arr - 0.5) / 0.5).permute(2, 0, 1).contiguous()


def augment(img, rng):
    """Gentle random rotation / flip / crop / color jitter of a sprite, at IMG_SIZE.
    Kept mild so every variation still clearly looks like the same item."""
    bg = img.getpixel((0, 0))
    out = img.rotate(rng.uniform(-10, 10), resample=RESAMPLE.BILINEAR, fillcolor=bg)
    if rng.random() < 0.5:
        out = out.transpose(TRANSPOSE.FLIP_LEFT_RIGHT)
    crop = rng.randint(112, DRAW_SIZE)
    x0, y0 = rng.randint(0, DRAW_SIZE - crop), rng.randint(0, DRAW_SIZE - crop)
    out = out.crop((x0, y0, x0 + crop, y0 + crop))
    for enhancer in (ImageEnhance.Brightness, ImageEnhance.Contrast, ImageEnhance.Color):
        out = enhancer(out).enhance(rng.uniform(0.88, 1.12))
    return out.resize((IMG_SIZE, IMG_SIZE), RESAMPLE.BOX)


def stratified_split(labels, rng, val_frac=1 / 6, test_frac=1 / 6):
    """Split item indices into train/val/test, spreading each class across splits.
    Every class the player used keeps at least one training example."""
    by_class = {}
    for i, lab in enumerate(labels):
        by_class.setdefault(lab, []).append(i)
    train, val, test, leftovers = [], [], [], []
    for lab in sorted(by_class):
        idxs = by_class[lab][:]
        rng.shuffle(idxs)
        train.append(idxs[0])
        leftovers.append(idxs[1:])
    # interleave the classes so val/test draw from every class
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
    """Fixed views of val/test items -> (X, y, owner item index per view)."""
    X, y, owner = [], [], []
    for i in idxs:
        img = items[i].image
        for view in [img] + [augment(img, rng) for _ in range(EVAL_VIEWS - 1)]:
            X.append(to_tensor(view))
            y.append(items[i].label)
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
