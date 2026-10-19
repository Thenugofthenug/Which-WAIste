# Which wAIst local setup

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

## Robot Detective (Explore)

After training, **3 · Explore** guides students through three investigations:
robot eyes (pixels and actual filter maps), the decision (reveal bin scores and
compare before/after training), and the test (try a new drawing or an unfamiliar
item). Back/Next and the step buttons allow students to revisit each idea.
The network diagram and demonstration weight sliders remain available as optional
activities. Extra-help openings use the existing anonymous help-topic recording.
Predictions and filter maps still come from the trained CNN, and unfamiliar-item
results explain when none of the robot's three bins is suitable.

Run the web backend and frontend in separate terminals from the repository root:

```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

```powershell
npm.cmd run dev
```

Open http://localhost:5173. The desktop launcher below is a separate earlier demo.

## Desktop conveyor experiment

The current experiment builds on the Python/Tkinter game in `file_consolidation`,
keeping its retro palette, sprites, conveyor and drag-and-drop bins. From the
repository root, run it with the existing Python environment:

```powershell
.\.venv\Scripts\python.exe .\file_consolidation\main.py
```

The belt keeps moving, with a default speed about 60% faster than the first experiment.
Choose Slow, Normal or Fast before or during the round. Missed items shrink into
an animated blocky lava pit with pixel sparks. The lava is only a game effect;
misses still receive no label and score zero.

Correct sorts earn 10 points; wrong sorts and missed items
earn zero and reset the streak. Drop each item into a bin before its belt slot
passes the exit, even while dragging it. Sorting all 30 correctly earns a perfect
sorting round. The end screen shows points, correct/wrong sorts, misses, and the
best streak, with buttons to replay or teach the robot.

Only items students actually label enter the learning dataset; misses are excluded.
Incorrect choices still supply the student's label, demonstrating why label
quality matters. If too few items remain for separate training, validation and
test sets, the lab offers a replay instead of training. Training results compare
accuracy before and after learning on the same held-out image views. This measures
agreement with student labels, not proof of correct recycling rules. Game points
and model accuracy are separate; improvement is not guaranteed.

Use **? Learning Tips** during sorting or **? Robot Field Guide** in the lab for
optional explanations of labels, pixels, filters/feature maps, weights, epochs,
loss, learning rate, fair testing, overfitting, accuracy and confidence. The belt
pauses while its guide is open and resumes when it closes; lab training continues.
Hover or focus the speed/help controls and the lab learning-rate, epoch, status
and probe labels for shorter contextual tips. No quiz is required.

Run the desktop interaction and training checks with:

```powershell
.\.venv\Scripts\python.exe -B -m unittest discover -s file_consolidation/tests -v
```

The React setup instructions below describe the starter frontend, which is not
connected to this desktop game.

Which wAIst is a waste sorting game with a neural network. It starts with a React frontend built with Vite. A Python/FastAPI backend can be added later.

## Prerequisites

- Node.js and npm. Check them in PowerShell with `node --version` and `npm --version`. Vite currently requires Node.js 20.19+ or 22.12+.
- A code editor and a modern web browser.
- Python is **not needed yet**. Python will be needed for when we begin working on the backend, then you can check it with `py --version` or `python --version`.

## Run the frontend

Open a terminal in the `Which wAIst` project folder and run:
```powershell
npm run setup
npm run dev
```

Open the local address printed by Vite, usually <http://localhost:5173/>. Edit `frontend/src/App.jsx` and save it;  browser should update automatically. Press `Ctrl+C` in PowerShell to stop the server.

`npm run setup` installs frontend dependencies after a fresh copy or when dependencies change.

## Useful checks

Run these from the `Which wAIst` project folder:

```powershell
npm run lint
npm run build
```

`lint` checks the source for common mistakes. `build` checks that the app can create production files in `frontend/dist/`.

## Folder guide

```text
Which wAIst/
├─ frontend/             React app
│  ├─ public/            files served directly
│  ├─ src/
│  │  ├─ App.jsx         starter screen
│  │  ├─ App.css         screen styles
│  │  ├─ index.css       global styles
│  │  └─ main.jsx        React entry point
│  └─ package.json       scripts and dependencies
├─ backend/              add later for FastAPI
```

As the frontend grows, add `src/components/` for reusable UI and `src/services/` for calls to the backend.

## When you add FastAPI

Keep it in a separate `backend/` folder and run it in a second terminal. The React app will make HTTP requests to the backend. During local development, you can configure a Vite proxy for `/api` requests or enable CORS in FastAPI. Put environment-specific frontend values in a `.env.local` file and use the `VITE_` prefix for values the browser needs; never put secrets there.

Further reading: [Vite getting started](https://vite.dev/guide/), [React quick start](https://react.dev/learn), and [React build from scratch](https://react.dev/learn/build-a-react-app-from-scratch).
