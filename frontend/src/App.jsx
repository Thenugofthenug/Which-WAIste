import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api'
import Conveyor from './Conveyor'
import HelpGuide from './HelpGuide'
import LearningLab from './LearningLab'
import { BINS } from './gameEngine'
import bottle from './assets/waste/bottle.png'
import can from './assets/waste/can.png'
import newspaper from './assets/waste/newspaper.png'
import cardboard from './assets/waste/cardboard.png'
import banana from './assets/waste/banana.png'
import apple from './assets/waste/apple.png'
import './App.css'

const homePictures = [
  ['Plastic bottle', bottle], ['Aluminum can', can], ['Newspaper', newspaper],
  ['Cardboard box', cardboard], ['Banana peel', banana], ['Apple core', apple],
]

function useRecorder(id, setGame, setFeedback) {
  const queue = useRef([]), sending = useRef(false)
  const [pending, setPending] = useState(0), [error, setError] = useState('')
  const persist = useCallback(() => {
    if (id) window.sessionStorage.setItem(`waiste-events-${id}`, JSON.stringify(queue.current))
    setPending(queue.current.length)
  }, [id])
  const pump = useCallback(async () => {
    if (sending.current || !id) return
    sending.current = true
    setPending(queue.current.length)
    setError('')
    try {
      while (queue.current.length) {
        const event = queue.current[0]
        const result = await api(`/sessions/${id}${event.path}`, event.body)
        if (event.type === 'action') {
          setGame(current => ({ ...current, summary: result.summary, actions: [
            ...current.actions.filter(action => action.index !== event.index),
            { index: event.index, ...event.body, correct: result.correct, expected_class: result.expected_class },
          ] }))
          setFeedback(event.body.outcome === 'missed' ? 'Oh no! Into the lava. Our robot missed a practice example—catch the next one!' :
            result.correct ? 'Nice! +10 points. Your label gives the robot a practice example.' :
              `Check that bin! Most programs put this in ${BINS[result.expected_class]}. Your chosen label still teaches the robot.`)
        }
        queue.current.shift()
        persist()
      }
    } catch (err) { setError(`Progress is waiting to save: ${err.message}`) }
    finally { sending.current = false }
  }, [id, persist, setFeedback, setGame])
  useEffect(() => {
    queue.current = id ? JSON.parse(window.sessionStorage.getItem(`waiste-events-${id}`) || '[]') : []
    void pump()
  }, [id, persist, pump])
  const enqueue = useCallback(event => {
    queue.current.push(event)
    persist()
    void pump()
  }, [persist, pump])
  return { enqueue, pending, error, retry: pump }
}

export default function App() {
  const [game, setGame] = useState(null), [view, setView] = useState('sort')
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [pollError, setPollError] = useState('')
  const [feedback, setFeedback] = useState(''), [guide, setGuide] = useState(false)
  const recorder = useRecorder(game?.id, setGame, setFeedback)
  const closeGuide = useCallback(() => setGuide(false), [])
  useEffect(() => {
    const id = window.sessionStorage.getItem('waiste-session')
    if (!id) return
    let active = true
    api(`/sessions/${id}`).then(value => { if (active) { setGame(value); setView(value.training.status === 'done' ? 'train' : 'sort') } })
      .catch(err => {
        if (!active) return
        if (err.status === 404) window.sessionStorage.removeItem('waiste-session')
        else setError(err.message)
      })
    return () => { active = false }
  }, [])
  useEffect(() => {
    if (game?.training.status !== 'running') return
    let active = true, timer
    async function poll() {
      try {
        const training = await api(`/sessions/${game.id}/training`)
        if (active) { setGame(current => ({ ...current, training })); setPollError('') }
      } catch { if (active) setPollError('Connection interrupted. Your game is saved; checking training again…') }
      if (active) timer = setTimeout(poll, 1500)
    }
    void poll()
    return () => { active = false; clearTimeout(timer) }
  }, [game?.id, game?.training.status])

  async function newGame() {
    setBusy(true); setError('')
    try {
      const value = await api('/sessions', {})
      window.sessionStorage.setItem('waiste-session', value.id)
      setGame(value); setView('sort'); setFeedback(''); setGuide(false)
    } catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }
  function track(topic) {
    if (game) recorder.enqueue({ type: 'help', path: '/help', body: { event_id: crypto.randomUUID(), topic } })
  }
  function openGuide() { track('labels'); setGuide(true) }
  function resolve(actor, outcome, chosen, speed) {
    recorder.enqueue({ type: 'action', index: actor.index, path: `/items/${actor.index}`,
      body: { outcome, chosen_class: chosen, response_ms: Math.min(3_600_000, Math.round(actor.responseMs)), speed } })
  }
  const complete = game?.summary.resolved === 30
  return <main className="app-shell"><header className={`app-header ${!game ? 'home-header' : ''}`}><div><p className="eyebrow">Recycling lab · lava edition</p><h1>Which w<span>AI</span>ste?</h1></div>
    {game && <nav className="stage-nav" aria-label="Game stages">{[['sort', '1 · Sort'], ['train', '2 · Train'], ['explore', '3 · Explore']].map(([id, label]) =>
      <button key={id} aria-current={view === id ? 'step' : undefined} disabled={id === 'train' ? !complete : id === 'explore' ? game.training.status !== 'done' : false} onClick={() => setView(id)}>{label}</button>)}</nav>}
    <span className="edition-badge">Play. Label. Learn.</span></header>
    {!game ? <section className="title-screen" aria-labelledby="home-title"><h2 id="home-title">TRASH SORTER</h2><p className="home-tagline">SORT 30 ITEMS · TEACH A NEURAL NETWORK</p>
      <div className="home-pictures" aria-label="Original waste item illustrations">{homePictures.map(([name, image]) => <figure key={name}><img src={image} alt={name} width="128" height="128" /></figure>)}</div>
      <p className="press-start">PRESS START</p><button className="green start-button" disabled={busy} onClick={newGame}>{busy ? 'Preparing your mission…' : 'Start mission →'}</button>
      <p className="home-description">Save items from the lava, label their bins, then watch the robot learn from your choices.</p>
      <p className="data-note">This class activity saves anonymous sorting choices, misses, response times, speed, help topics opened, and training results. No student name or email is requested. Your session code stays in this browser tab.</p></section> : <>
      {recorder.error && <div className="error" role="alert">{recorder.error} <button onClick={recorder.retry}>Retry saving</button><p>The belt is paused. Keep this tab open while reconnecting.</p></div>}
      {pollError && <p role="status" className="education-note">{pollError}</p>}
      <div hidden={view !== 'sort'}><Conveyor key={game.id} game={game} paused={guide || view !== 'sort'} onResolve={resolve}
        help={openGuide} saving={recorder.pending} saveError={recorder.error} />
        <p className="feedback" role="status">{feedback || 'Press Start belt when you are ready. You can pause or read learning tips anytime.'}</p>
        {complete && <section className="mission-report pixel-panel"><div><p className="eyebrow">Sorting mission complete</p><h2>{game.summary.correct === 30 ? 'Perfect sorting!' : 'Ready to teach your robot?'}</h2><p>Score {game.summary.score}/300 · Right {game.summary.correct} · Wrong {game.summary.wrong} · Missed {game.summary.missed} · Best streak {game.summary.best_streak}</p><p className="muted">Missed items are excluded. Points are not model accuracy.</p></div>
          <div className="button-row"><button disabled={!!recorder.pending} className="green" onClick={() => setView('train')}>Teach the robot →</button><button disabled={busy || !!recorder.pending} onClick={newGame}>Play again</button></div></section>}</div>
      {complete && <div hidden={view === 'sort'}><LearningLab key={game.id} game={game} setGame={setGame} view={view} saving={recorder.pending} help={openGuide} /></div>}
      <footer><span>Anonymous session · {game.id.slice(0, 8)}</span><span>Progress and help-topic opens are saved for the class study.</span></footer>
    </>}
    {error && <p className="error" role="alert">{error}</p>}
    {guide && <HelpGuide close={closeGuide} track={track} />}
  </main>
}
