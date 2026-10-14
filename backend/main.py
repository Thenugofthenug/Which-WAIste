"""HTTP API for the Vite version of Which wAIste."""
import base64
import io
import json
import queue
import random
import secrets
import sys
import threading
import traceback
import uuid
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from PIL import Image
from pydantic import BaseModel, Field

APP_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(APP_ROOT / "file_consolidation"))

from config import CATEGORIES  # noqa: E402
from data import build_eval_set, stratified_split  # noqa: E402
from items import ITEM_TYPES, NOVEL_TYPES, TrashItem, make_game_items  # noqa: E402
from model import probe_model, train_model  # noqa: E402
from sprites import render_item  # noqa: E402

app = FastAPI(title="Which wAIste API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)

JOBS: dict[str, dict] = {}


class LabeledImage(BaseModel):
    image: str
    label: int = Field(ge=0, lt=len(CATEGORIES))
    name: str


class TrainRequest(BaseModel):
    items: list[LabeledImage] = Field(min_length=6, max_length=30)
    learning_rate: float = Field(default=1e-3, gt=1e-5, le=0.1)


class PredictRequest(BaseModel):
    image: str


def image_from_data_url(value: str) -> Image.Image:
    try:
        encoded = value.split(",", 1)[1] if value.startswith("data:") else value
        image = Image.open(io.BytesIO(base64.b64decode(encoded, validate=True)))
        image.load()
        return image.convert("RGB")
    except (IndexError, ValueError, OSError) as exc:
        raise HTTPException(status_code=422, detail="Image must be a valid base64-encoded image.") from exc


def png_data_url(image: Image.Image) -> str:
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


def generate_game_items() -> list[dict]:
    items = make_game_items(rng=random.Random(secrets.randbits(64)))
    return [
        {
            "id": index,
            "name": item.name,
            "expected": item.expected,
            "image": png_data_url(item.image),
        }
        for index, item in enumerate(items)
    ]


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/game-items")
def game_items(mode: str = "train"):
    if mode not in {"train", "trick"}:
        raise HTTPException(status_code=422, detail="Mode must be train or trick.")
    items = generate_game_items()
    if mode == "trick":
        for item in items:
            item.pop("expected")
    return {"items": items, "categories": CATEGORIES}


@app.get("/api/novel-item/{kind}")
def novel_item(kind: str):
    rng = random.Random(secrets.randbits(64))
    if kind == "familiar":
        name, draw_fn, expected = rng.choice(ITEM_TYPES)
        destination = CATEGORIES[expected]
    elif kind == "novel":
        name, draw_fn, destination, expected = rng.choice(NOVEL_TYPES)
    else:
        raise HTTPException(status_code=404, detail="Item kind must be familiar or novel.")
    return {
        "name": name,
        "expected": expected,
        "destination": destination,
        "image": png_data_url(render_item(draw_fn, rng)),
    }


@app.post("/api/train")
def start_training(request: TrainRequest):
    labels = [item.label for item in request.items]
    train_idx, val_idx, test_idx = stratified_split(labels, random.Random(42))
    if not train_idx or not val_idx or not test_idx:
        raise HTTPException(
            status_code=422,
            detail="Add more labeled items so the dataset can be split into train, validation, and test sets.",
        )

    training_items = [
        TrashItem(item.name, image_from_data_url(item.image), item.label, item.label)
        for item in request.items
    ]
    job_id = str(uuid.uuid4())
    events: queue.Queue = queue.Queue()
    stop_event = threading.Event()
    job = {
        "events": events,
        "stop_event": stop_event,
        "model": None,
        "status": "running",
    }
    JOBS[job_id] = job

    def emit(kind, data):
        if kind == "done":
            job["model"] = data.pop("model")
            job["status"] = "done"
        events.put((kind, data))

    def run():
        try:
            val_set = build_eval_set(training_items, val_idx, random.Random(7))
            test_set = build_eval_set(training_items, test_idx, random.Random(8))
            events.put(("dataset", {
                "train": len(train_idx),
                "validation": len(val_idx),
                "test": len(test_idx),
            }))
            train_model(
                [training_items[i].image for i in train_idx],
                [labels[i] for i in train_idx],
                val_set,
                test_set,
                get_lr=lambda: request.learning_rate,
                get_probe=lambda: (val_idx[0], training_items[val_idx[0]].image),
                stop_event=stop_event,
                emit=emit,
            )
            if job["status"] == "running":
                job["status"] = "done"
                events.put(("done", {"stopped": True, "model": None}))
        except Exception:
            job["status"] = "error"
            events.put(("training_error", traceback.format_exc()))

    threading.Thread(target=run, daemon=True).start()
    return {"job_id": job_id}


@app.get("/api/train/{job_id}/events")
def training_events(job_id: str):
    job = JOBS.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Training job was not found.")

    def stream():
        events = job["events"]
        while True:
            try:
                kind, data = events.get(timeout=1)
            except queue.Empty:
                if job["status"] in {"done", "error"} and events.empty():
                    break
                yield ": keep-alive\n\n"
                continue
            yield f"event: {kind}\ndata: {json.dumps(data)}\n\n"
            if kind in {"done", "training_error"}:
                break

    return StreamingResponse(stream(), media_type="text/event-stream")


@app.post("/api/train/{job_id}/stop")
def stop_training(job_id: str):
    job = JOBS.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Training job was not found.")
    job["stop_event"].set()
    return {"status": "stopping"}


@app.post("/api/train/{job_id}/predict")
def predict(job_id: str, request: PredictRequest):
    job = JOBS.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Training job was not found.")
    if job["status"] != "done" or job["model"] is None:
        raise HTTPException(status_code=409, detail="The training job has no completed model yet.")
    image = image_from_data_url(request.image)
    _, probabilities = probe_model(job["model"], image)
    predicted = max(range(len(probabilities)), key=probabilities.__getitem__)
    return {
        "predicted": predicted,
        "category": CATEGORIES[predicted],
        "confidence": probabilities[predicted],
        "probabilities": probabilities,
    }
