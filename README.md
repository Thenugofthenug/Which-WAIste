# Which wAIste

A browser waste-sorting game that teaches how a CNN learns from students' labels.
React + Vite calls a FastAPI backend. SQLite stores browser records locally;
PostgreSQL stores them when hosted on Render.

## Run locally

From the repository root, install dependencies once:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
npm.cmd run setup
```

Start the backend:

```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

In a second terminal, start the frontend:

```powershell
npm.cmd run dev
```

Open <http://localhost:5173>. Vite forwards `/api` requests to FastAPI on port 8000.
Node.js 22.12+ and Python 3.11+ are supported. The local database is
`.data/waiste.db`; keep `.data` and any database credentials out of Git.

## Hosting and data collection

See [the Render deployment guide](docs/RENDER.md) for the exact Blueprint steps,
DataGrip connection, database tables, exports and free-trial limits.
Use the combined branch **`integration/temp-data-collection`** for deployment.

Browser records include sorting outcomes and timings, each training run,
learning-rate choices, item tests, help topics, experiment plans, reviewed rounds
and demonstration weight changes. New students enter first and last names on the
start screen. Names live in a separate `players` table; `game_players` links each
student ID to their rounds. Older anonymous records remain intact. The extra
tables are added at startup without replacing existing records.

Export the local browser data:

```powershell
.\.venv\Scripts\python.exe -m backend.stats_report --csv .data\stats_csv
```

Set `DATABASE_URL` to export the hosted PostgreSQL data instead. Exports omit
embedded images and model weights. There is no public export endpoint.
Names are excluded by default. To include the separate name-to-ID table, export
to a separate private folder with `--include-names`:

```powershell
.\.venv\Scripts\python.exe -m backend.stats_report --csv .data\named-stats --include-names
```

## Guided training and weights activities

Screen two now gives students a goal: train, inspect a completed round, and test
the robot. Click a graph point, use the round slider, or step backward/forward to
highlight the same epoch on both graphs and in the round illustration. The graph
values are real completed-epoch metrics. The illustration explains a whole
practice pass; it does not invent live picture-by-picture progress.

Help sits below the graphs. Students can optionally change one setting and
compare two real runs; repeated training is not required to continue. The weights
activity uses both columns for controls and a live decision diagram. Its goal is
to raise Compost's score, then lower it. This small demonstration never changes
the actual trained CNN.

Student names are submitted only to `/api/players`; gameplay, browser session
storage and activity events use IDs. **Different student** starts a fresh name
entry on shared classroom computers. See the SQL join example in
[the hosting guide](docs/RENDER.md) to connect names to study records.

## Retro arcade design and lesson flow

The `which-wAIste-retro` branch adds an indigo arcade theme with
cyan, gold and coral accents, pixel headings, and the original waste artwork.
The Press Start 2P font is bundled locally; its open font license is in
`frontend/public/fonts/OFL-PressStart2P.txt`.

The mission follows **Sort → Train → Test**. Each stage explains the student's
goal. Training has Back/Next controls, with the next step unlocking after a run
finishes. The full network diagram is available under **Look deeper**; graphs,
filters and extra help remain available. Solid/dashed graph lines and network
connections distinguish information without relying only on color.

**Main menu** pauses the mission and **Resume mission** returns to the same
items, belt speed and learning screen. **New mission** starts a fresh round.
While sorting, **1 / 2 / 3** sends the next visible item to Recycling / Compost /
Landfill. Tab + Enter selects a specific item; dragging still works. Number keys
do not sort while a dialog is open, a control has focus, or progress is waiting
to save. Speed arrows show Paused / Slow / Normal / Fast.

## Consistent pixel-art items

New missions use original 32-pixel inventory sprites with fixed colors per item,
blocky outlines and small pose variations. The banana has a curved yellow shape
and a folded peel. White newspaper, cup and glass pixels stay opaque on the belt.
The same drawings supply the home gallery, sorting items and actual CNN examples.

The source artwork is in `file_consolidation/pixel_items.py`. Regenerate the
home gallery after changing those drawings:

```powershell
.\.venv\Scripts\python.exe -B frontend/scripts/export_home_items.py
```

Saved browser sessions retain their original renderer and trained model behavior.
Choose **New mission** to see the inventory sprites in the sorting game. Earlier
pixel-art sessions remain supported. The guided lab records new sessions as
`lava-web-v4-guided-lab`; existing data needs no column migration.

## Browser conveyor update

This branch keeps Jack's home screen and game layout, with an instruction splash
before sorting. Click **Start sorting at speed 2** to begin. After three consecutive
misses at speed 2 or 3, the belt pauses for an explanation: lava items have no
labels, so the robot has fewer examples to learn from. Click **Continue at speed 1**
to resume with more time. Any bin drop resets the consecutive-miss counter. Saved
labels and points remain intact; fewer examples do not guarantee lower accuracy.
The slowdown prompt appears only once per round. Afterward, students can increase
the speed without another automatic slowdown; misses and their speeds are still
recorded. Starting a new round enables the prompt again.
Speed arrows still allow manual adjustment and pausing at 0 after the splash.
The larger lava pool has persistent embers and a burst of sparks for each miss.

## Robot Detective (Test)

After training, **3 · Test** guides students through three investigations:
robot eyes (pixels and actual filter maps), the decision (reveal bin scores and
compare before/after training), and the test (try a new drawing or an unfamiliar
item). Back/Next and the step buttons allow students to revisit each idea.
The network diagram and demonstration weight sliders remain available as optional
activities. Extra-help openings use the existing help-topic recording by session ID.
Predictions and filter maps still come from the trained CNN, and unfamiliar-item
results explain when none of the robot's three bins is suitable.

## Development checks

Install test and desktop dependencies once:

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
```

Then run:

```powershell
npm.cmd run test
npm.cmd run lint
npm.cmd run build
.\.venv\Scripts\python.exe -B -m unittest discover -s backend/tests -v
.\.venv\Scripts\python.exe -B -m unittest discover -s file_consolidation/tests -v
```

Backend tests use temporary SQLite databases by default. To run them against
PostgreSQL, set `TEST_DATABASE_URL` to a **local test server** whose user may
create databases. The tests create and remove their own `waiste_test_*` databases.

## Nug's desktop version

The merged desktop game remains available separately:

```powershell
.\.venv\Scripts\python.exe .\file_consolidation\main.py
```

It includes Nug's player entry, mission briefing, number-key sorting, training
explanations, tooltips and SQLite analytics. Its statistics are in
`file_consolidation/whichwaiste_stats.db`, independent of the browser database.
Use `file_consolidation/stats_report.py --csv .data/desktop-export` to export them.
The hosted game uses the shared CNN and the browser API rather than launching Tkinter.
