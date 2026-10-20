import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api'
import Conveyor from './Conveyor'
import HelpGuide from './HelpGuide'
import LearningLab from './LearningLab'
import HomePictures from './HomePictures'
import HomeBins from './HomeBins'
import HomeRobot from './HomeRobot'
import { BINS } from './gameEngine'
import './App.css'

const CORRECT_FEEDBACK = ['Nice +10', 'GREAT +10', 'SMART +10']

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
          setFeedback({
            id: `${id}-${event.index}`,
            kind: event.body.outcome === 'missed' ? 'missed' : result.correct ? 'correct' : 'incorrect',
            message: event.body.outcome === 'missed' ? 'NOT THE LAVA! RE-CYCLER wont be able to see that item in training.' :
              result.correct ? CORRECT_FEEDBACK[Math.floor(Math.random() * CORRECT_FEEDBACK.length)] :
                `${BINS[event.body.chosen_class]}, really? I thought that was ${BINS[result.expected_class]}`,
          })
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
  const [showHome, setShowHome] = useState(false)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [pollError, setPollError] = useState('')
  const [feedback, setFeedback] = useState(null), [guide, setGuide] = useState(false)
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
      setGame(value); setView('sort'); setShowHome(false); setFeedback(null); setGuide(false)
    } catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }
  function returnToStart() {
    setShowHome(true); setGuide(false)
  }
  function track(topic) {
    if (game) recorder.enqueue({ type: 'help', path: '/help', body: { event_id: crypto.randomUUID(), topic } })
  }
  function openGuide() { track('labels'); setGuide(true) }
  function recordLearningRate(exponent) {
    recorder.enqueue({ type: 'rate', path: '/learning-rate', body: { event_id: crypto.randomUUID(), exponent } })
  }
  function resolve(actor, outcome, chosen, speed) {
    recorder.enqueue({ type: 'action', index: actor.index, path: `/items/${actor.index}`,
      body: { outcome, chosen_class: chosen, response_ms: Math.min(3_600_000, Math.round(actor.responseMs)), speed } })
  }
  const complete = game?.summary.resolved === 30
  const nextStage = view === 'sort' && complete ? 'train' : view === 'train' && game?.training.status === 'done' ? 'explore' : null
  return <main className="app-shell" data-stage={game && !showHome ? view : 'home'}>
    <header className="arcade-header"><div className="arcade-brand"><span className="brand-sprite" aria-hidden="true">▣</span><span>which w<span className="logo-ai">AI</span>ste<span className="brand-question">?</span></span></div><span className="arcade-edition">NEURAL NETWORK ARCADE</span></header>
    {(!game || showHome) && <section className="title-screen pixel-panel" aria-labelledby="home-title"><HomeRobot /><p className="eyebrow home-eyebrow">PLAYER ONE · MEET YOUR ROBOT</p><h2 id="home-title">which w<span className="logo-ai">AI</span>ste?</h2><p className="home-tagline">A little sorting. A little science. A smarter robot?</p>
      <HomePictures />
      <ol className="mission-path" aria-label="Your mission"><li><span className="mission-number">01</span><div><strong>Sort it</strong><p>Your bin choices teach the robot.</p></div></li><li><span className="mission-number">02</span><div><strong>Train it</strong><p>Watch it learn from your examples.</p></div></li><li><span className="mission-number">03</span><div><strong>Test it</strong><p>Find out what it learned.</p></div></li></ol>
      <div className="home-actions"><button className="green start-button" disabled={busy} onClick={game ? () => setShowHome(false) : newGame}>{busy ? 'Preparing your mission…' : game ? 'Resume mission' : 'START'}</button>{game && <button disabled={busy || recorder.pending > 0} onClick={newGame}>New mission</button>}</div>
      <p className="home-prompt">{game ? 'Your current mission is waiting right where you left it.' : '30 items. 3 bins. You are the robot’s teacher.'}</p>
      <HomeBins />
      </section>}
    {game && <div hidden={showHome} className="mission-screen">
      {recorder.error && <div className="error" role="alert">{recorder.error} <button onClick={recorder.retry}>Retry saving</button><p>The belt is paused. Keep this tab open while reconnecting.</p></div>}
      {pollError && <p role="status" className="education-note">{pollError}</p>}
      <Conveyor key={game.id} game={game} active={view === 'sort' && !showHome} paused={guide || showHome || view !== 'sort'} onResolve={resolve}
        feedback={feedback?.message || ''} feedbackKind={feedback?.kind || 'ready'} feedbackKey={feedback?.id || 'ready'}
        help={openGuide} onReturnToStart={returnToStart} saving={recorder.pending} saveError={recorder.error}
        onTrain={() => setView('train')} onResort={newGame} busy={busy}
        stageNavigation={<nav className="stage-nav" aria-label="Game stages">{[['sort', '1 · Sort'], ['train', '2 · Train'], ['explore', '3 · Explore']].map(([id, label]) =>
          <button key={id} data-stage={id} className={nextStage === id ? 'stage-ready' : undefined} aria-current={view === id ? 'step' : undefined} disabled={id === 'train' ? !complete : id === 'explore' ? game.training.status !== 'done' : false} onClick={() => setView(id)}>{label}</button>)}</nav>} />
      {complete && <div hidden={view === 'sort'}><LearningLab key={game.id} game={game} setGame={setGame} view={view} saving={recorder.pending} track={track} onRateSettled={recordLearningRate} onBack={() => setView(view === 'explore' ? 'train' : 'sort')} onNext={() => setView('explore')} /></div>}
    </div>}
    {error && <p className="error" role="alert">{error}</p>}
    {guide && <HelpGuide close={closeGuide} track={track} />}
  </main>
}
