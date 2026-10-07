"""Small, real CNN snapshots for the guided lesson."""
import base64
from io import BytesIO

import numpy as np
from PIL import Image
import torch

from trash_sorter_cnn import CATEGORIES, IMG_SIZE, RESAMPLE, to_tensor


def image_url(image):
    output = BytesIO()
    image.save(output, format="PNG")
    return "data:image/png;base64," + base64.b64encode(output.getvalue()).decode("ascii")


def class_scores(probabilities):
    index = int(probabilities.argmax())
    return {"predicted_class": CATEGORIES[index], "confidence": float(probabilities[index]),
            "probabilities": {category: float(probabilities[c]) for c, category in enumerate(CATEGORIES)}}


@torch.inference_mode()
def inspect_image(model, image):
    model.eval()
    resized = image.convert("RGB").resize((IMG_SIZE, IMG_SIZE), RESAMPLE.BILINEAR)
    rgb = resized.getpixel((IMG_SIZE // 2, IMG_SIZE // 2))
    activations = to_tensor(resized).unsqueeze(0)
    layers = []
    for index, block in enumerate(model.features):
        activations = block(activations)
        # Choose two strongly responding channels, without assigning human meanings.
        channels = activations[0].mean(dim=(1, 2)).topk(2).indices.tolist()
        maps = []
        for channel in channels:
            values = activations[0, channel].numpy()
            peak = float(values.max())
            pixels = (values / peak * 255).astype(np.uint8) if peak > 0 else np.zeros_like(values, dtype=np.uint8)
            maps.append({"channel": channel + 1, "image": image_url(Image.fromarray(pixels))})
        layers.append({"name": f"Block {index + 1}", "shape": list(activations.shape[1:]), "maps": maps})
    return {"input_image": image_url(resized), "rgb": list(rgb),
            "normalized": [round(value / 127.5 - 1, 3) for value in rgb], "layers": layers}
