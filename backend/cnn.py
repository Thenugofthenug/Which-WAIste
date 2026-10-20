"""Use Nug's existing catalog and CNN without importing any desktop GUI."""
import io
import random
import sys
import base64
from functools import lru_cache
from pathlib import Path

import numpy as np
import torch
from PIL import Image

# The desktop files intentionally use local imports. Keep the desktop launcher working.
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'file_consolidation'))
from config import CATEGORIES  # noqa: E402
from data import build_eval_set, stratified_split, to_tensor  # noqa: E402
from items import ITEM_TYPES, NOVEL_TYPES, make_game_items  # noqa: E402
from model import TrashCNN, probe_model, train_model  # noqa: E402
from sprites import cutout, render_item, sprite  # noqa: E402

torch.set_num_threads(2)

CURRENT_VERSION = 'lava-web-v4-guided-lab'


def uses_pixel_art(version):
    """Keep saved games and their trained models on the pictures they started with."""
    return version in ('lava-web-v3-pixel-items', CURRENT_VERSION)


def png(image):
    buffer = io.BytesIO()
    image.save(buffer, format='PNG')
    return 'data:image/png;base64,' + base64.b64encode(buffer.getvalue()).decode('ascii')


def game_items(seed, pixel_art=True):
    return make_game_items(30, random.Random(seed), pixel_art=pixel_art)


@lru_cache(maxsize=64)
def public_items(seed, pixel_art=True):
    return [{'index': i, 'name': item.name, 'image': png(cutout(sprite(item.image, 128)))}
            for i, item in enumerate(game_items(seed, pixel_art=pixel_art))]


def serializable(value):
    if isinstance(value, np.ndarray):
        return value.tolist()
    if isinstance(value, np.generic):
        return value.item()
    if isinstance(value, dict):
        return {key: serializable(item) for key, item in value.items()}
    if isinstance(value, (tuple, list)):
        return [serializable(item) for item in value]
    return value


@torch.no_grad()
def inspect(model, image):
    tensor = to_tensor(image).unsqueeze(0)
    model.eval()
    _, acts = model.forward_with_acts(tensor)
    layers = []
    for i, act in enumerate(acts):
        maps = []
        for channel in act[0].mean((1, 2)).topk(2).indices.tolist():
            grid = act[0, channel].cpu().numpy()
            normalized = np.uint8(np.clip(grid / max(float(grid.max()), 1e-6), 0, 1) * 255)
            maps.append({'channel': channel, 'image': png(Image.fromarray(normalized))})
        layers.append({'name': f'Block {i + 1}', 'shape': list(act.shape[1:]), 'maps': maps})
    rgb = np.array(image.resize((64, 64), Image.Resampling.NEAREST))[32, 32].tolist()
    return {'input_image': png(image.resize((64, 64), Image.Resampling.NEAREST)), 'rgb': rgb,
            'normalized': [round((v / 255 - .5) / .5, 3) for v in rgb], 'layers': layers}


def run_training(seed, actions, epochs, rate, emit, pixel_art=True):
    items = game_items(seed, pixel_art=pixel_art)
    labeled = []
    for action in actions:
        if action.outcome == 'sorted':
            item = items[action.item_index]
            item.label = action.chosen_class
            labeled.append(item)
    train, val, test = stratified_split([it.label for it in labeled], random.Random(42))
    if not train or not val or not test:
        raise ValueError('Sort more items in a new round so we can keep separate training, validation and test sets.')
    rng = random.Random(7)
    val_set, test_set = build_eval_set(labeled, val, rng), build_eval_set(labeled, test, rng)
    result = None

    def receive(kind, payload):
        nonlocal result
        if kind == 'done':
            result = payload
        elif kind in ('epoch', 'probe'):
            emit(kind, serializable(payload))

    import threading
    train_model([labeled[i].image for i in train], [labeled[i].label for i in train],
                val_set, test_set, lambda: rate, lambda: (val[0], labeled[val[0]].image),
                threading.Event(), receive, epochs=epochs)
    model = result.pop('model')
    predictions = []
    for i in test:
        item = labeled[i]
        probabilities = result['item_probs'][i]
        before = result['before_item_probs'][i]
        viz, _ = probe_model(model, item.image)
        predictions.append({'name': item.name, 'image': png(item.image), 'label': CATEGORIES[item.label],
                            'guideline': CATEGORIES[item.expected], 'probabilities': probabilities,
                            'before': before, 'inspection': inspect(model, item.image), 'viz': serializable(viz)})
    weights = io.BytesIO()
    torch.save(model.state_dict(), weights)
    return {'before_accuracy': result['before_test_acc'], 'test_accuracy': result['test_acc'],
            'best_epoch': result['best_epoch'], 'split': {'train': len(train), 'validation': len(val), 'test': len(test)},
            'predictions': predictions}, weights.getvalue()


def try_item(weights, novel, pixel_art=True):
    model = TrashCNN()
    model.load_state_dict(torch.load(io.BytesIO(weights), map_location='cpu', weights_only=True))
    rng = random.Random()
    if novel:
        name, draw, destination, target = rng.choice(NOVEL_TYPES)
    else:
        name, draw, target = rng.choice(ITEM_TYPES)
        destination = CATEGORIES[target]
    image = render_item(draw, rng, pixel_art=pixel_art)
    viz, probabilities = probe_model(model, image)
    return {'name': name, 'image': png(image), 'probabilities': probabilities, 'destination': destination,
            'has_valid_bin': target is not None, 'viz': serializable(viz), 'inspection': inspect(model, image)}
