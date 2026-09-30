# Which wAIst local setup

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

Open the local address printed by Vite, usually <http://localhost:5173/>. Click the test button to confirm React is working. Then edit `frontend/src/App.jsx` and save it; the browser should update automatically. Press `Ctrl+C` in PowerShell to stop the server.

`npm run setup` installs frontend dependencies after a fresh copy or when dependencies change. On this computer, it has already completed.

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

As the frontend grows, add `src/components/` for reusable UI and `src/services/` for calls to the backend. There is no need to create empty folders yet.

## When you add FastAPI

Keep it in a separate `backend/` folder and run it in a second terminal. The React app will make HTTP requests to the backend. During local development, you can configure a Vite proxy for `/api` requests or enable CORS in FastAPI. Put environment-specific frontend values in a `.env.local` file and use the `VITE_` prefix for values the browser needs; never put secrets there.

Further reading: [Vite getting started](https://vite.dev/guide/), [React quick start](https://react.dev/learn), and [React build from scratch](https://react.dev/learn/build-a-react-app-from-scratch).
