"""The original generated-item game and CNN training, without a desktop GUI."""
import copy
import random
import threading

import torch
import torch.nn.functional as F
from backend.inspection import class_scores, image_url, inspect_image

from trash_sorter_cnn import (
    BATCH_SIZE, CATEGORIES, DEFAULT_LR, EPOCHS, ITEM_TYPES,
    NUM_ITEMS, TrashCNN, build_eval_set, evaluate, make_train_epoch, render_item,
    stratified_split,
)


class Game:
    def __init__(self):
        rng = random.Random()
        order = []
        while len(order) < NUM_ITEMS:
            batch = list(range(len(ITEM_TYPES)))
            rng.shuffle(batch)
            order.extend(batch)
        self.items = []
        for index in order[:NUM_ITEMS]:
            name, draw, expected = ITEM_TYPES[index]
            self.items.append({"name": name, "image": render_item(draw, rng),
                               "expected": expected, "label": None})
        self.index = 0
        self.score = 0
        self.lock = threading.Lock()
        self.training = {"status": "ready", "epoch": 0, "epochs": EPOCHS, "history": []}
        self.demo = False

    def view(self):
        current = None
        if self.index < len(self.items):
            item = self.items[self.index]
            current = {"name": item["name"], "image": image_url(item["image"])}
        return {"index": self.index, "total": len(self.items), "score": self.score,
                "categories": CATEGORIES, "item": current, "training": self.training, "demo": self.demo}

    def train(self, epochs=None):
        """Same split, augmentation, model, optimizer, and best-validation selection."""
        try:
            epochs = EPOCHS if epochs is None else epochs
            labels = [item["label"] for item in self.items]
            train, val, test = stratified_split(labels, random.Random(42))
            eval_rng = random.Random(7)
            xv, yv, _ = build_eval_set(self.items, val, eval_rng)
            xt, yt, owners = build_eval_set(self.items, test, eval_rng)
            images = [self.items[i]["image"] for i in train]
            train_labels = [labels[i] for i in train]
            model = TrashCNN()
            # Use the exact same held-out images and views before and after training.
            _, _, initial_logits = evaluate(model, xt, yt)
            before = {}
            for index in test:
                views = [p for p, owner in zip(initial_logits.softmax(dim=1), owners) if owner == index]
                before[index] = class_scores(torch.stack(views).mean(0))
            optimizer = torch.optim.Adam(model.parameters(), lr=DEFAULT_LR, weight_decay=1e-4)
            best_loss, best_state, best_epoch = float("inf"), None, 0
            rng = random.Random()
            history = []
            for epoch in range(1, epochs + 1):
                x, y = make_train_epoch(images, train_labels, rng)
                order = torch.randperm(len(x))
                model.train()
                total_loss, correct, seen = 0.0, 0, 0
                for start in range(0, len(x), BATCH_SIZE):
                    indices = order[start:start + BATCH_SIZE]
                    optimizer.zero_grad()
                    logits = model(x[indices])
                    loss = F.cross_entropy(logits, y[indices])
                    loss.backward()
                    optimizer.step()
                    total_loss += loss.item() * len(indices)
                    correct += (logits.argmax(1) == y[indices]).sum().item()
                    seen += len(indices)
                val_loss, val_acc, _ = evaluate(model, xv, yv)
                if val_loss < best_loss:
                    best_loss = val_loss
                    best_state = copy.deepcopy(model.state_dict())
                    best_epoch = epoch
                with self.lock:
                    history.append({"epoch": epoch, "train_loss": total_loss / seen,
                                    "val_loss": val_loss, "train_acc": correct / seen,
                                    "val_acc": val_acc})
                    self.training = {"status": "training", "epoch": epoch, "epochs": epochs,
                                     "validation_accuracy": val_acc, "history": history.copy()}
            model.load_state_dict(best_state)
            _, _, logits = evaluate(model, xt, yt)
            probabilities = logits.softmax(dim=1)
            predictions = []
            for index in test:
                views = [p for p, owner in zip(probabilities, owners) if owner == index]
                average = torch.stack(views).mean(0)
                predictions.append({"name": self.items[index]["name"],
                                    "image": image_url(self.items[index]["image"]),
                                    "your_label": CATEGORIES[labels[index]],
                                    **class_scores(average), "before": before[index],
                                    "inspection": inspect_image(model, self.items[index]["image"])})
            accuracy = sum(p["your_label"] == p["predicted_class"] for p in predictions) / len(predictions)
            with self.lock:
                before_accuracy = sum(p["before"]["predicted_class"] == p["your_label"] for p in predictions) / len(predictions)
                self.training = {"status": "done", "epoch": epochs, "epochs": epochs,
                                 "best_epoch": best_epoch, "test_accuracy": accuracy,
                                 "before_accuracy": before_accuracy,
                                 "split": {"train": len(train), "validation": len(val), "test": len(test)},
                                 "predictions": predictions, "history": history.copy()}
        except Exception:
            import logging
            logging.exception("Game training failed")
            with self.lock:
                self.training = {**self.training, "status": "error",
                                 "detail": "Training failed. See the backend terminal."}
