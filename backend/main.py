"""Run from the repository root: uv run uvicorn backend.main:app --reload."""
from functools import lru_cache
from io import BytesIO
import threading
from uuid import uuid4

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image, ImageOps, UnidentifiedImageError
from pydantic import BaseModel, Field

from backend.game import Game
from backend.inspection import image_url

from trash_sorter_cnn import CATEGORIES, EPOCHS, MODEL_PATH, load_model, predict_image

app = FastAPI(title="Which wAIste")
games = {}
games_lock = threading.Lock()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@lru_cache(maxsize=1)
def get_model():
    try:
        return load_model()
    except FileNotFoundError as exc:
        raise HTTPException(503, "Train the desktop game first: uv run python trash_sorter_cnn.py") from exc
    except (ValueError, RuntimeError, KeyError) as exc:
        raise HTTPException(503, "Model checkpoint is incompatible. Retrain the three-class CNN.") from exc


@app.get("/")
def health():
    return {"status": "ok", "categories": CATEGORIES, "checkpoint_available": MODEL_PATH.is_file()}


def get_game(game_id):
    with games_lock:
        game = games.get(game_id)
    if game is None:
        raise HTTPException(404, "Game expired or backend restarted. Start a new game.")
    return game


@app.post("/games")
def new_game():
    game = Game()
    return store_game(game)


def store_game(game):
    game_id = str(uuid4())
    with games_lock:
        # Keep this local demo's in-memory sessions bounded.
        if len(games) >= 32:
            expired = next((key for key, value in games.items()
                            if value.training["status"] != "training"), None)
            if expired is None:
                raise HTTPException(503, "All game slots are busy. Try again later.")
            del games[expired]
        games[game_id] = game
    return {"game_id": game_id, **game.view()}


@app.post("/demo")
def guided_demo():
    game = Game()
    game.demo = True
    for item in game.items:
        item["label"] = item["expected"]
    game.index = len(game.items)
    game.score = len(game.items)
    game.training = {"status": "training", "epoch": 0, "epochs": 3, "history": []}
    result = store_game(game)
    threading.Thread(target=game.train, args=(3,), daemon=True).start()
    return result


@app.get("/games/{game_id}")
def game_status(game_id: str):
    game = get_game(game_id)
    with game.lock:
        return {"game_id": game_id, **game.view()}


@app.get("/games/{game_id}/labels")
def review_labels(game_id: str):
    game = get_game(game_id)
    with game.lock:
        return {"items": [{"index": index, "name": item["name"], "image": image_url(item["image"]),
                           "label": CATEGORIES[item["label"]]}
                          for index, item in enumerate(game.items) if item["label"] is not None]}


class SortChoice(BaseModel):
    index: int = Field(ge=0, lt=30)
    category: int = Field(ge=0, lt=3)


@app.post("/games/{game_id}/sort")
def sort_item(game_id: str, choice: SortChoice):
    game = get_game(game_id)
    with game.lock:
        if choice.index != game.index or game.index >= len(game.items):
            raise HTTPException(409, "This item has already been sorted. Refresh the game.")
        item = game.items[game.index]
        item["label"] = choice.category
        correct = choice.category == item["expected"]
        game.score += int(correct)
        game.index += 1
        feedback = {"name": item["name"], "correct": correct,
                    "chosen": CATEGORIES[choice.category], "expected": CATEGORIES[item["expected"]]}
        return {"game_id": game_id, **game.view(), "feedback": feedback}


@app.post("/games/{game_id}/train")
def train_game(game_id: str):
    game = get_game(game_id)
    with game.lock:
        if game.index != len(game.items):
            raise HTTPException(409, "Sort all items before training.")
        if game.training["status"] == "training":
            raise HTTPException(409, "Training is already running.")
        game.training = {"status": "training", "epoch": 0, "epochs": EPOCHS, "history": []}
        threading.Thread(target=game.train, daemon=True).start()
        return {"game_id": game_id, **game.view()}


@app.post("/predict")
def predict(file: UploadFile = File(...)):
    # A small upload limit keeps the student demo from reading arbitrarily large files.
    contents = file.file.read(10 * 1024 * 1024 + 1)
    if len(contents) > 10 * 1024 * 1024:
        raise HTTPException(413, "Please upload an image smaller than 10 MB.")
    try:
        with Image.open(BytesIO(contents)) as source:
            image = ImageOps.exif_transpose(source).convert("RGB")
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError) as exc:
        raise HTTPException(400, "Please upload a valid image.") from exc
    return predict_image(get_model(), image)
