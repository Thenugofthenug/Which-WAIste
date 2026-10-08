"""
Model
=====
The CNN, helpers that look inside it for the synaptic view, and a training
loop that reports progress through a callback (no GUI code here).
"""
import copy
import random

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

from config import BATCH_SIZE, CATEGORIES, CHANNELS, EPOCHS, SHOW_PER_BLOCK
from data import make_train_epoch, to_tensor


# ----------------------------------------------------------------------------
# Network
# ----------------------------------------------------------------------------
class TrashCNN(nn.Module):
    def __init__(self, n_classes=len(CATEGORIES)):
        super().__init__()

        def block(cin, cout):
            return nn.Sequential(nn.Conv2d(cin, cout, 3, padding=1), nn.BatchNorm2d(cout),
                                 nn.ReLU(inplace=True), nn.MaxPool2d(2))

        chans = [3] + CHANNELS
        self.features = nn.Sequential(*[block(chans[i], chans[i + 1]) for i in range(len(CHANNELS))])
        self.head = nn.Sequential(nn.AdaptiveAvgPool2d(1), nn.Flatten(), nn.Dropout(0.3),
                                  nn.Linear(CHANNELS[-1], n_classes))

    def forward(self, x):
        return self.head(self.features(x))

    def forward_with_acts(self, x):
        """Forward pass that also returns each block's output feature maps."""
        acts = []
        for blk in self.features:
            x = blk(x)
            acts.append(x)
        return self.head(x), acts


@torch.no_grad()
def evaluate(model, X, y):
    model.eval()
    logits = model(X)
    loss = F.cross_entropy(logits, y).item()
    acc = (logits.argmax(1) == y).float().mean().item()
    return loss, acc, logits


def block_weights(model):
    return [blk[0].weight.detach().clone() for blk in model.features]


@torch.no_grad()
def probe_model(model, img):
    """Run one image through the net and summarize it for the synaptic view.

    Returns (viz, probs). viz["layers"] holds each column's nodes: the RGB input
    channels, the SHOW_PER_BLOCK most active filters of every conv block, and the
    output classes. viz["edges"][k] is an (n_src, n_dst) matrix of the real
    weights joining column k to column k+1:
      - into a conv block: each 3x3 kernel summed into one number (its net
        excitatory/inhibitory effect), scaled by that filter's batch-norm gain;
      - last block -> output: the classifier's weights, which act directly on
        each filter's average activation."""
    model.eval()
    logits, acts = model.forward_with_acts(to_tensor(img).unsqueeze(0))
    probs = F.softmax(logits, dim=1)[0].tolist()

    rgb = np.asarray(img, dtype=np.float32).mean(axis=(0, 1)) / 255.0
    layers = [{"labels": ["R", "G", "B"], "idx": [0, 1, 2], "raw": rgb, "level": rgb}]
    for a in acts:
        mean_act = a[0].mean(dim=(1, 2))                    # firing strength per filter
        top = mean_act.topk(min(SHOW_PER_BLOCK, len(mean_act))).indices.tolist()
        peak = max(float(mean_act.max()), 1e-6)
        raw = mean_act[top].cpu().numpy()
        layers.append({"labels": [f"F{i}" for i in top], "idx": top, "raw": raw, "level": raw / peak})
    pr = np.array(probs, dtype=np.float32)
    layers.append({"labels": list(CATEGORIES), "idx": list(range(len(CATEGORIES))), "raw": pr, "level": pr})

    edges = []
    for k, blk in enumerate(model.features):
        conv, bn = blk[0], blk[1]
        gain = bn.weight / torch.sqrt(bn.running_var + bn.eps)
        net = conv.weight.sum(dim=(2, 3)) * gain[:, None]   # (C_out, C_in)
        src, dst = layers[k]["idx"], layers[k + 1]["idx"]
        edges.append(net[dst][:, src].T.cpu().numpy())
    fc = model.head[-1].weight                              # (classes, C)
    edges.append(fc[:, layers[-2]["idx"]].T.cpu().numpy())
    return {"layers": layers, "edges": edges}, probs


# ----------------------------------------------------------------------------
# Training loop (GUI-agnostic)
# ----------------------------------------------------------------------------
def train_model(train_imgs, train_labels, val_set, test_set, get_lr, get_probe, stop_event, emit):
    """Train a fresh TrashCNN for EPOCHS epochs.

    get_lr()      -> current learning rate; read every batch, so a live slider works.
    get_probe()   -> (item index, image) to visualize after each epoch.
    stop_event    -> threading.Event; set it to stop early.
    emit(kind, data) receives progress: "probe", "log", "epoch" and finally "done".
    The best epoch (lowest validation loss) is restored before testing."""
    Xv, yv, _ = val_set
    Xt, yt, test_owner = test_set
    rng = random.Random()
    model = TrashCNN()
    last_lr = get_lr()
    opt = torch.optim.Adam(model.parameters(), lr=last_lr, weight_decay=1e-4)
    best = {"loss": float("inf"), "epoch": 0, "state": None}
    stopped = False

    def probe_payload():
        idx, img = get_probe()
        viz, probs = probe_model(model, img)
        return {"probe_idx": idx, "viz": viz, "probs": probs}

    emit("probe", probe_payload())

    for epoch in range(1, EPOCHS + 1):
        X, y = make_train_epoch(train_imgs, train_labels, rng)
        perm = torch.randperm(len(X))
        prev_w = block_weights(model)
        model.train()
        tot_loss, correct, seen = 0.0, 0, 0
        for b in range(0, len(X), BATCH_SIZE):
            if stop_event.is_set():
                stopped = True
                break
            lr = get_lr()
            if lr != last_lr:
                emit("log", f"   learning rate -> {lr:.1e}")
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
            emit("log", f"Training stopped by player during epoch {epoch}.")
            break

        dw = [((w - p).norm() / p.norm()).item() for w, p in zip(block_weights(model), prev_w)]
        vl, va, _ = evaluate(model, Xv, yv)
        if vl < best["loss"]:
            best = {"loss": vl, "epoch": epoch, "state": copy.deepcopy(model.state_dict())}
        emit("epoch", {"epoch": epoch, "train_loss": tot_loss / seen, "train_acc": correct / seen,
                       "val_loss": vl, "val_acc": va, "lr": last_lr, "dw": dw, **probe_payload()})

    if best["state"] is not None:
        model.load_state_dict(best["state"])
    tl, ta, logits = evaluate(model, Xt, yt)
    per_item = {}
    for p, owner in zip(F.softmax(logits, dim=1), test_owner):
        per_item.setdefault(owner, []).append(p)
    item_probs = {o: torch.stack(ps).mean(0).tolist() for o, ps in per_item.items()}
    model.eval()
    emit("done", {"test_loss": tl, "test_acc": ta, "best_epoch": best["epoch"],
                  "item_probs": item_probs, "stopped": stopped, "model": model})
