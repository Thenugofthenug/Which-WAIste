# Which wAIste

The React frontend plays the original Python sorting game: 30 procedurally drawn
trash items, three bins (Recycling, Compost, Landfill), then CNN training using
your choices as labels. No image uploads or pretrained weights are needed.

## Start the backend

Install uv, then run from the repository root:

```powershell
uv sync
uv run uvicorn backend.main:app --reload --port 8000
```

Health: http://localhost:8000/. API docs: http://localhost:8000/docs.

## Start the frontend

In a second terminal, from the repository root:

```powershell
npm run setup
npm run dev
```

Open http://localhost:5173. A new game starts automatically. Choose a bin or press
keys 1–3 for each item. The game shows your score against common guidelines;
your own choice is kept as the training label even when it differs.

**Try guided demo** prepares labels from the common guidelines and trains for
three epochs so you can preview the lesson without sorting 30 items. It runs the
real CNN, not canned predictions; a short run may not improve accuracy.
The normal game still uses your labels and 50 epochs.

After all 30 items, click **Start Training**. Training runs in the backend, with
progress shown in the browser.
Loss and accuracy graphs show training and validation curves for each epoch;
they remain visible when training finishes. Expand **View epoch values** to
inspect the numbers. Starting another training run clears the previous curves.
The CNN uses the original train/validation/test
split, augmentation, 50 epochs, and best-validation model selection. Results
show held-out item predictions, confidence percentages, and test accuracy.
After training, a conveyor replay moves those test drawings past a camera and
routes each to the CNN's selected bin. The network schematic shows the actual
four convolution blocks and the three class scores. Pause, Play, Step, Replay,
and speed controls let you follow the decision. Scores are the same averaged
test predictions used in the results table, not simulated physical sensors.
Use Free replay and Step to inspect the animation without the timed challenge.
All replays now start paused for guided exploration. Four lesson buttons show
the actual 64-by-64 input and pixel normalization, real activation maps from each
convolution block, before/after class scores, and the selected bin. Before and
after evaluation use exactly the same held-out items and augmented views.
Each activation map is normalized to its own maximum, and maps are selected by
mean response. They show responses, not human-readable reasons or saliency.
The application uses a single dark navy-and-mint theme across all stages.
The three slide buttons and Back/Next controls let students revisit unlocked
stages without discarding their session. Slide 1 shows the original labels after
sorting. Slide 2 is a learning workshop with a persistent filters and feature-maps
box, an illustrative weight experiment, and the real CNN inspection after training.
There is no quiz. The experiment does not change the Python model. Slide 3 focuses
on a timed claw challenge: press Play and grab an item while it crosses the marked
zone. Early or late attempts fail while the belt keeps moving. Missed items pass
automatically and count as misses. A successful catch pauses the item so students
can predict its bin; choosing a bin releases it and resumes the belt to show the
CNN's decision. Catch and miss counters track the round. Claw guesses stay separate
from training and test labels. Slow speed and Free replay are available; Step is
only available in Free replay. Leaving slide 3 pauses its animation while
preserving progress. Extra explanations, the glossary, graphs, feature-map notes,
and results tables remain available. Training continues when students switch
slides; after training, use Next to enter the claw challenge.
On desktop the lab fills the screen: training controls and graphs share a sidebar,
with sorting and decisions in the larger workspace. Wide screens place the guided
lesson beside the conveyor. Panels scroll independently on shorter displays;
tablets and phones use a stacked layout. Extra results and explanations expand
on demand.
The web game uses the original default learning rate. It does not include the
desktop learning-rate slider or Stop button.

Games and web training results are kept in memory. Refreshing starts a new game;
restarting the backend clears games. Browser training does not overwrite desktop
checkpoint files. This is a local student demo; it keeps up to 32 games.

## How the frontend talks to Python

React calls `http://localhost:8000`:

- `POST /games` generates drawings using the existing Python render functions.
- `POST /demo` prepares a short guided session with supplied labels.
- `POST /games/{id}/sort` records a label and returns feedback and the next item.
- `POST /games/{id}/train` starts CNN training in a background thread.
- `GET /games/{id}` provides progress and final predictions.
- `GET /games/{id}/labels` reads the labeled drawings for slide 1 review.

Images are returned as PNG data URLs. CORS allows http://localhost:5173.
To change the backend address, set `VITE_API_URL` in `frontend/.env.local`.

The original desktop game still runs with `uv run python trash_sorter_cnn.py`.
It saves trained weights to `backend/trash_cnn.pt`. The earlier upload API
`POST /predict` remains available for testing saved desktop weights through API
docs, but the frontend has no upload flow. Old four-class weights must be retrained.

## Checks

```powershell
uv run python -m unittest discover -s backend/tests
npm run lint
npm run test
npm run build
```

`trash_sorter_cnn.py` contains the original drawing functions, CNN, and desktop
game. `backend/game.py` adapts the game and training for web sessions.
`backend/main.py` provides HTTP routes. `frontend/src/App.jsx` displays the game.
