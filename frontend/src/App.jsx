import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api'
import { newEventId } from './eventId'
import Conveyor from './Conveyor'
import HelpGuide from './HelpGuide'
import LearningLab from './LearningLab'
import HomePictures from './HomePictures'
import HomeBins from './HomeBins'
import HomeRobot from './HomeRobot'
import StudentEntry from './StudentEntry'
import useRecorder from './useRecorder'
import GameStages from './GameStages'
import './App.css'

export default function App() {
  const [game, setGame] = useState(null), [view, setView] = useState('sort')
  const [showHome, setShowHome] = useState(false)
  const [playerId, setPlayerId] = useState(() => window.sessionStorage.getItem('waiste-player'))
  const [needsName, setNeedsName] = useState(false)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [pollError, setPollError] = useState('')
  const [feedback, setFeedback] = useState(null), [guide, setGuide] = useState(false)
  const topNavigation = useRef(null), bottomDestination = useRef(null)
  const recorder = useRecorder(game?.id, setGame, setFeedback)
  const closeGuide = useCallback(() => setGuide(false), [])
  function changeStageFromBottom(next) {
    if (next === view) return
    bottomDestination.current = next
    setView(next)
  }
  useEffect(() => {
    const destination = bottomDestination.current
    bottomDestination.current = null
    if (destination !== view) return
    // Wait for the new stage to render, then return to the shared navigation.
    // Instant movement also respects reduced-motion preferences.
    topNavigation.current?.scrollIntoView?.({ behavior: 'instant', block: 'start' })
    topNavigation.current?.querySelector('[aria-current="step"]')?.focus({ preventScroll: true })
  }, [view])
  useEffect(() => {
    const id = window.sessionStorage.getItem('waiste-session')
    if (!id) return
    let active = true
    api(`/sessions/${id}`).then(value => { if (active) {
      setGame(value); setView(value.training.status === 'done' ? 'train' : 'sort')
      if (value.player_id) { setPlayerId(value.player_id); window.sessionStorage.setItem('waiste-player', value.player_id) }
    } })
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

  async function newGame(names) {
    if (!playerId && !names) { setNeedsName(true); setShowHome(true); return }
    setBusy(true); setError('')
    let student = playerId
    try {
      if (!student) {
        const player = await api('/players', names)
        student = player.id
        window.sessionStorage.setItem('waiste-player', student)
        setPlayerId(student)
      }
      const value = await api('/sessions', { player_id: student })
      window.sessionStorage.setItem('waiste-session', value.id)
      setGame(value); setView('sort'); setShowHome(false); setNeedsName(false); setFeedback(null); setGuide(false)
    } catch (err) {
      if (err.status === 404 && student) {
        window.sessionStorage.removeItem('waiste-player'); setPlayerId(null); setNeedsName(true)
        setError('Please enter your name again to start a new mission.')
      } else setError(err.message)
    }
    finally { setBusy(false) }
  }
  function changeStudent() {
    window.sessionStorage.removeItem('waiste-player')
    window.sessionStorage.removeItem('waiste-session')
    setPlayerId(null); setGame(null); setNeedsName(true); setShowHome(true); setView('sort'); setFeedback(null); setError(''); setPollError('')
  }
  function returnToStart() {
    setShowHome(true); setGuide(false)
  }
  function track(topic) {
    if (game) recorder.enqueue({ type: 'help', path: '/help', body: { event_id: newEventId(), topic } })
  }
  function openGuide() { track('labels'); setGuide(true) }
  function recordLearningRate(exponent) {
    recorder.enqueue({ type: 'rate', path: '/learning-rate', body: { event_id: newEventId(), exponent } })
  }
  const sessionId = game?.id, trainingRunId = game?.training.run_id, enqueue = recorder.enqueue
  const recordActivity = useCallback(event => {
    if (!sessionId) return
    const run = event.kind === 'training_plan' ? null : trainingRunId
    enqueue({ type: 'activity', path: '/activity', body: {
      ...event, event_id: newEventId(), ...(run ? { training_run_id: run } : {}),
    } })
  }, [sessionId, trainingRunId, enqueue])
  function resolve(actor, outcome, chosen, speed) {
    recorder.enqueue({ type: 'action', index: actor.index, path: `/items/${actor.index}`,
      body: { outcome, chosen_class: chosen, response_ms: Math.min(3_600_000, Math.round(actor.responseMs)), speed } })
  }
  const complete = game?.summary.resolved === 30
  return <main className="app-shell" data-stage={game && !showHome ? view : 'home'}>
    <header className="arcade-header"><div className="arcade-brand"><img className="brand-sprite" src="/favicon.svg?v=robot-3" width="32" height="32" alt="" aria-hidden="true" /><span>which w<span className="logo-ai">AI</span>ste<span className="brand-question">?</span></span></div><span className="arcade-edition">NEURAL NETWORK ARCADE</span></header>
    {(!game || showHome) && <section className="title-screen pixel-panel" aria-labelledby="home-title"><HomeRobot /><p className="eyebrow home-eyebrow">PLAYER ONE · MEET YOUR ROBOT</p><h2 id="home-title">which w<span className="logo-ai">AI</span>ste?</h2><p className="home-tagline">A little sorting. A little science. A smarter robot?</p>
      <HomePictures />
      <ol className="mission-path" aria-label="Your mission"><li><span className="mission-number">01</span><div><strong>Sort it</strong><p>Your bin choices teach the robot.</p></div></li><li><span className="mission-number">02</span><div><strong>Train it</strong><p>Watch it learn from your examples.</p></div></li><li><span className="mission-number">03</span><div><strong>Test it</strong><p>Find out what it learned.</p></div></li></ol>
      {(!playerId && (!game || needsName)) ? <StudentEntry busy={busy} hasMission={!!game} onStart={newGame} onCancel={() => setNeedsName(false)} /> : <div className="home-actions"><button className="green start-button" disabled={busy} onClick={game ? () => setShowHome(false) : () => void newGame()}>{busy ? 'Preparing your mission…' : game ? 'Resume mission' : 'START'}</button>{game && <button disabled={busy || recorder.pending > 0} onClick={() => void newGame()}>New mission</button>}</div>}
      {playerId && <div className="student-ready"><span>Student registered for this visit.</span><button disabled={busy || recorder.pending > 0} onClick={changeStudent}>Different student</button></div>}
      <p className="home-prompt">{game ? 'Your current mission is waiting right where you left it.' : '30 items. 3 bins. You are the robot’s teacher.'}</p>
      <HomeBins />
      </section>}
    {game && <div hidden={showHome} className="mission-screen">
      {recorder.error && <div className="error" role="alert">{recorder.error} <button onClick={recorder.retry}>Retry saving</button><p>The belt is paused. Keep this tab open while reconnecting.</p></div>}
      {pollError && <p role="status" className="education-note">{pollError}</p>}
      <Conveyor key={game.id} game={game} active={view === 'sort' && !showHome} paused={guide || showHome || view !== 'sort'} onResolve={resolve}
        feedback={feedback?.message || ''} feedbackKind={feedback?.kind || 'ready'} feedbackKey={feedback?.id || 'ready'}
        help={openGuide} onReturnToStart={returnToStart} saving={recorder.pending} saveError={recorder.error} pendingActions={recorder.pendingActions}
        onTrain={() => setView('train')} onResort={() => void newGame()} busy={busy}
        stageNavigation={<GameStages view={view} complete={complete} trainingStatus={game.training.status} onChange={setView} navigationRef={topNavigation} />} />
      {complete && <div hidden={view === 'sort'}><LearningLab key={game.id} game={game} setGame={setGame} view={view} saving={recorder.pending} track={track} onRateSettled={recordLearningRate} onActivity={recordActivity} onBack={() => setView(view === 'explore' ? 'train' : 'sort')} onNext={() => setView('explore')} /><GameStages view={view} complete={complete} trainingStatus={game.training.status} onChange={changeStageFromBottom} bottom /></div>}
    </div>}
    {error && <p className="error" role="alert">{error}</p>}
    {guide && <HelpGuide close={closeGuide} track={track} />}
  </main>
}
