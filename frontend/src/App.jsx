import { useEffect, useState } from 'react'
import './App.css'
import TrainingGraphs from './TrainingGraphs'
import ConveyorReplay from './ConveyorReplay'

const baseUrl = import.meta.env.VITE_API_URL || 'http://localhost:8000'

async function request(path, body) {
  const response = await fetch(`${baseUrl}${path}`, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  const data = await response.json()
  if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Request failed.')
  return data
}

function App() {
  const [game, setGame] = useState(null)
  const [feedback, setFeedback] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  async function act(path, body, reset = false) {
    setLoading(true)
    setError('')
    try {
      const data = await request(path, body)
      setGame(data)
      if (reset) setFeedback(null)
      else if (data.feedback) setFeedback(data.feedback)
    } catch (err) {
      setError(err instanceof TypeError ? 'Cannot reach the backend. Check that it is running on port 8000.' : err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let active = true
    request('/games', {}).then((data) => {
      if (active) setGame(data)
    }).catch((err) => {
      if (active) setError(err instanceof TypeError ? 'Start the Python backend, then click Start new game.' : err.message)
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  const gameId = game?.game_id
  const training = game?.training
  const stage = game?.item ? 0 : training?.status === 'done' ? 2 : 1
  useEffect(() => {
    if (training?.status !== 'training') return
    let active = true
    async function poll() {
      try {
        const data = await request(`/games/${gameId}`)
        if (active) {
          setGame(data)
          setError('')
        }
      } catch (err) {
        if (active) setError(err.message)
      }
    }
    const timer = setInterval(poll, 1500)
    return () => { active = false; clearInterval(timer) }
  }, [gameId, training?.status])

  useEffect(() => {
    if (!game?.item || loading) return
    function onKey(event) {
      if (event.repeat || !['1', '2', '3'].includes(event.key)) return
      document.getElementById(`bin-${Number(event.key) - 1}`)?.click()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [game?.item, loading])

  return (
    <main className="page">
      <section className="card dashboard">
        <header className="dashboard-header">
        <div><p className="eyebrow">Neural network learning lab</p>
        <h1>Which wAIste</h1>
        <p className="app-intro">Teach a sorter. Then look inside its decisions.</p></div>
        <ol className="stage-nav">{['Label the examples', 'Watch it learn', 'Explore a decision'].map((label, index) =>
          <li key={label} className={stage === index ? 'stage-current' : stage > index ? 'stage-complete' : ''}>
            <span>0{index + 1}</span>{label}</li>)}</ol>
        <button className="secondary-button" disabled={loading || training?.status === 'training'}
          onClick={() => act('/games', {}, true)}>Start new game</button>
        </header>
        <div className="workspace">
        <aside className="lab-sidebar" aria-label="Training and session controls">
        <div className="demo-launch"><div><strong>Want a quick walkthrough?</strong>
          <p>Try a 3-epoch demo with prepared labels, or sort all 30 items yourself.</p></div>
          <button className="secondary-button" disabled={loading || training?.status === 'training'}
            onClick={() => act('/demo', {}, true)}>Try guided demo</button></div>
        {loading && !game && <p role="status">Loading your game…</p>}
        {game && <>
          <p className="session-summary">{game.demo ? 'Demo: labels supplied by common guidelines' : `Score against common guidelines: ${game.score} / ${game.index}`}</p>
          {game.item ? <div className="dataset-note"><h2>You are the teacher</h2>
            <p>Choose a bin for each drawing. Your choices become the labels the network learns from.</p>
            <progress value={game.index} max={game.total} aria-label="Items labeled" />
            <p className="hint">{game.index} / {game.total} labels collected. Keys 1–3 work too.</p>
            <p className="hint">Common guidelines provide feedback, but your label is kept. Rules vary by city.</p>
          </div> : <>
            {['ready', 'done', 'error'].includes(training.status) &&
              <button disabled={loading} onClick={() => act(`/games/${game.game_id}/train`, {})}>
                {training.status === 'done' ? 'Train again' : 'Start Training'}
              </button>}
            {training.status === 'training' && <div role="status">
              <p>Training: epoch {training.epoch} / {training.epochs}</p>
              <progress value={training.epoch} max={training.epochs} />
            </div>}
            {training.status === 'error' && <p role="alert">{training.detail}</p>}
            {training.status === 'done' && <>
              <div className="learning-summary"><div><span>Before learning</span><strong>{(training.before_accuracy * 100).toFixed(0)}%</strong></div>
                <div><span>After learning</span><strong>{(training.test_accuracy * 100).toFixed(0)}%</strong></div>
                <div><span>Data split</span><strong>{training.split.train} / {training.split.validation} / {training.split.test}</strong><small>train / validation / test</small></div>
              </div>
              <details className="result-explanation"><summary>What do these results mean?</summary><p className="hint">Percentages show label matches on the same held-out test items, not training examples.
                Validation selects the best model; testing checks it on items excluded from training.
                {game.demo && ' This short demo may not improve accuracy. Play the full game for a 50-epoch run.'}</p></details>
            </>}
            <TrainingGraphs history={training.history} epochs={training.epochs} />
            {training.status === 'done' && <details className="test-results"><summary>Held-out predictions · best epoch {training.best_epoch}</summary>
              <div className="results"><table>
                <thead><tr><th>Item</th><th>Your label</th><th>CNN prediction</th><th>Model score</th></tr></thead>
                <tbody>{training.predictions.map((item, index) => <tr key={index}>
                  <td>{item.name}</td><td>{item.your_label}</td><td>{item.predicted_class}</td>
                  <td>{(item.confidence * 100).toFixed(1)}%</td>
                </tr>)}</tbody>
              </table></div>
            </details>}
          </>}
        </>}
        <div aria-live="polite">
          {error && <p role="alert">{error}</p>}
          {feedback && <p>{feedback.correct ? 'Correct!' : `Common guidelines suggest ${feedback.expected}.`}
            {' '}{feedback.name}: you chose {feedback.chosen}. Your label is kept.</p>}
        </div>
        </aside>
        <section className="main-stage" aria-label="Game and decision workspace">
          {game?.item ? <div className="sorting-workspace">
            <div><p className="eyebrow">Build your dataset · Item {game.index + 1} of {game.total}</p>
              <div className="sorting-display"><img className="trash-image" src={game.item.image} alt={game.item.name} />
                <h2>{game.item.name}</h2></div></div>
            <div className="sorting-choices"><p className="eyebrow">Assign a label</p><h2>Where should it go?</h2>
              <p>Your choice becomes a training label, even when it differs from common guidelines.</p>
              <div className="bins">{game.categories.map((category, index) => (
                <button id={`bin-${index}`} className={`bin bin-${index}`} key={category}
                  disabled={loading} onClick={() => act(`/games/${game.game_id}/sort`, { index: game.index, category: index })}>
                  {index + 1}. {category}</button>))}</div>
              <p className="hint">Drawings come from the original Python sorting game.</p>
            </div></div> : training?.status === 'done' ? <ConveyorReplay predictions={training.predictions} /> :
            <div className="training-stage"><p className="eyebrow">Stage 2 · Watch it learn</p>
              <h2>{training?.status === 'training' ? 'The network is learning your labels' : 'Your examples are ready'}</h2>
              <p>{training?.status === 'training' ? 'Training adjusts the weights. Follow the loss and accuracy curves in the panel beside you.' : 'Start Training in the control panel to teach the CNN.'}</p>
              <div className="training-roadmap">{['Split the labeled examples', 'Learn patterns from images', 'Check held-out predictions'].map((title, index) =>
                <div key={title}><span>0{index + 1}</span><h3>{title}</h3><p>{[
                  'Training teaches the model. Validation selects its best checkpoint. Test items stay out of training.',
                  'Each epoch adjusts the CNN weights to reduce prediction error against the supplied labels.',
                  'After training, compare before and after scores and inspect the real layer responses.',
                ][index]}</p></div>)}</div>
            </div>}
        </section>
        </div>
      </section>
    </main>
  )
}

export default App
