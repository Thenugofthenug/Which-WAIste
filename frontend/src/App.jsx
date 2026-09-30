import { useState } from 'react'
import './App.css'

function App() {
  const [clicks, setClicks] = useState(0)

  return (
    <main className="page">
      <section className="card">
        <p className="eyebrow">React + Vite starter</p>
        <h1>Which wAIst</h1>
        <p>
          placeholder text for the app. This is a React + Vite starter template with TailwindCSS and TypeScript support.
        </p>
        <button type="button" onClick={() => setClicks((value) => value + 1)}>
          Test the button: {clicks}
        </button>
        <p className="hint">
          A Python/FastAPI backend can be added later  <code>backend/</code> folder.
        </p>
      </section>
    </main>
  )
}

export default App
