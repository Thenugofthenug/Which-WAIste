import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { advanceActors, BINS, binAt, COLORS, createWorld, initialActors, missionReportHeading, SPEEDS } from './gameEngine'
import BinLogo from './BinLogo'
import MemoryTable from './MemoryTable'
import TVStatic from './TVStatic'
import RobotSummary from './RobotSummary'
import BeltSpeedControl from './BeltSpeedControl'
import ConveyorPrompt from './ConveyorPrompt'

const SPEED_LEVELS = Object.keys(SPEEDS)
const DELIVERY_STOP_Y = 145
const MIN_SCENE_HEIGHT = 820
const MISSES_BEFORE_SLOWDOWN = 3
const BURN_SECONDS = .85

export default function Conveyor({ game, paused, onResolve, help, onReturnToStart, onTrain, onResort, busy = false, saving, saveError, stageNavigation, active = true, feedback = '', feedbackKind = 'ready', feedbackKey = 'ready' }) {
  const [store] = useState(() => {
    const world = createWorld(initialActors(game.items, game.actions))
    world.read().deliveryY = -190
    world.publish()
    return world
  })
  const w = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const callback = useRef(onResolve)
  useEffect(() => { callback.current = onResolve }, [onResolve])
  const svg = useRef()
  const keyboardControls = useRef()
  const [sceneHeight, setSceneHeight] = useState(MIN_SCENE_HEIGHT)
  const binOffset = sceneHeight - 770
  const [started, setStarted] = useState(false)
  const [showGuidance, setShowGuidance] = useState(true)
  const [speedLevel, setSpeedLevel] = useState(2)
  const [prompt, setPrompt] = useState(game.summary.resolved === 30 ? null : 'intro')
  const consecutiveMisses = useRef(0)
  const slowdownShown = useRef(false)
  const [pauseSettled, setPauseSettled] = useState(false)
  const [deliveryDone, setDeliveryDone] = useState(false)
  const [selected, setSelected] = useState(null)
  const [binCounts, setBinCounts] = useState(() => BINS.map((_, bin) => game.actions.filter(action => action.outcome === 'sorted' && action.chosen_class === bin).length))
  const [binPulses, setBinPulses] = useState(() => BINS.map(() => 0))
  const [memory, setMemory] = useState(() => [...game.actions])
  const robotMotion = useRef()
  const [robotPhase, setRobotPhase] = useState('pacing')
  const [settleFrom, setSettleFrom] = useState('translateY(0)')
  const complete = game.summary.resolved === 30
  const guidanceVisible = showGuidance && !complete
  const delivering = complete && !deliveryDone
  const displayedSpeedLevel = delivering ? Math.max(1, speedLevel) : speedLevel
  const speed = SPEED_LEVELS[Math.max(0, displayedSpeedLevel - 1)]
  const running = active && (delivering || (!complete && speedLevel > 0)) && !paused && !saveError && !prompt
  const robotAwake = (started || complete) && active
  const feedbackVisible = started && feedbackKind !== 'ready'
  const beltPaused = started && speedLevel === 0 && !complete && active && !paused && !saveError
  const robotIdle = beltPaused && pauseSettled

  function changeSpeed(level) {
    if (prompt) return
    setPauseSettled(false)
    setSpeedLevel(level)
    if (level > 0) setStarted(true)
  }

  function continueSorting() {
    setPauseSettled(false)
    setSpeedLevel(prompt === 'slowdown' ? 1 : 2)
    setStarted(true)
    setPrompt(null)
  }

  useEffect(() => {
    if (!beltPaused) return
    const timer = setTimeout(() => setPauseSettled(true), 2000)
    return () => clearTimeout(timer)
  }, [beltPaused])

  useLayoutEffect(() => {
    if (!complete) return
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const current = window.getComputedStyle(robotMotion.current).transform
    setSettleFrom(current && current !== 'none' ? current : 'translateY(0)')
    setRobotPhase(reduceMotion ? 'settled' : 'settling')
    if (reduceMotion) return
    const timer = setTimeout(() => setRobotPhase('settled'), 1400)
    return () => clearTimeout(timer)
  }, [complete])

  useLayoutEffect(() => {
    if (!active) return
    function resizeScene() {
      const canvas = svg.current
      const bounds = canvas.getBoundingClientRect()
      if (!bounds.width) return
      const main = canvas.closest('main')
      const bottomPadding = main ? parseFloat(getComputedStyle(main).paddingBottom) : 22
      const border = parseFloat(getComputedStyle(canvas.closest('.game-board')).borderBottomWidth) || 0
      const available = window.innerHeight - (bounds.top + window.scrollY) - keyboardControls.current.getBoundingClientRect().height - bottomPadding - border
      const height = Math.max(MIN_SCENE_HEIGHT, available * 1920 / bounds.width)
      setSceneHeight(current => Math.abs(current - height) > .1 ? height : current)
    }
    resizeScene()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resizeScene)
    observer?.observe(svg.current)
    observer?.observe(keyboardControls.current)
    observer?.observe(svg.current.closest('.game-board').querySelector('.board-controls'))
    window.addEventListener('resize', resizeScene)
    return () => { observer?.disconnect(); window.removeEventListener('resize', resizeScene) }
  }, [active, saveError])

  useEffect(() => {
    if (!started) return
    const timer = setTimeout(() => setShowGuidance(false), 5000)
    return () => clearTimeout(timer)
  }, [started])

  function resolve(actor, outcome, chosen = null) {
    const w = store.read()
    if (!w.actors.some(item => item.index === actor.index)) return
    w.actors = w.actors.filter(item => item.index !== actor.index)
    if (w.drag?.index === actor.index) w.drag = null
    if (outcome === 'missed') {
      w.burnt = [...w.burnt, { ...actor, age: 0 }]
      consecutiveMisses.current += 1
      if (!slowdownShown.current && consecutiveMisses.current >= MISSES_BEFORE_SLOWDOWN && speedLevel > 1 && w.actors.length) {
        slowdownShown.current = true
        consecutiveMisses.current = 0
        w.drag = null
        setSpeedLevel(1)
        setPrompt('slowdown')
      }
    } else consecutiveMisses.current = 0
    setMemory(records => [...records, { index: actor.index, outcome, chosen_class: chosen }])
    if (outcome === 'sorted') {
      setBinCounts(counts => counts.map((count, bin) => count + (bin === chosen ? 1 : 0)))
      setBinPulses(pulses => pulses.map((pulse, bin) => pulse + (bin === chosen ? 1 : 0)))
    }
    if (selected === actor.index) setSelected(null)
    callback.current(actor, outcome, chosen, speed)
    store.publish()
  }
  const resolveRef = useRef(null)
  useEffect(() => { resolveRef.current = resolve })

  useEffect(() => {
    if (!running) return
    let frame, previous
    function tick(now) {
      const seconds = previous === undefined ? 0 : Math.min((now - previous) / 1000, .1)
      previous = now
      const w = store.read()
      const next = advanceActors(w.actors, seconds, speed)
      // Leave missed actors in the world until resolve has emitted each action exactly once.
      w.actors = [...next.actors, ...next.missed]
      next.missed.forEach(actor => resolveRef.current(actor, 'missed'))
      w.treads = (w.treads + SPEEDS[speed] * seconds) % 30
      w.burnt = w.burnt.map(item => ({ ...item, age: item.age + seconds })).filter(item => item.age < BURN_SECONDS)
      if (complete) w.deliveryY = Math.min(DELIVERY_STOP_Y, w.deliveryY + SPEEDS[speed] * seconds)
      store.publish()
      if (complete && w.deliveryY === DELIVERY_STOP_Y) { setDeliveryDone(true); setSpeedLevel(0); return }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [running, speed, store, complete])

  // Let the last splash finish even when a learning prompt has paused the belt.
  const burning = w.burnt.length > 0
  useEffect(() => {
    if (running || !burning || !active || paused || saveError) return
    let frame, previous
    function tick(now) {
      const seconds = previous === undefined ? 0 : Math.min((now - previous) / 1000, .1)
      previous = now
      const world = store.read()
      world.burnt = world.burnt.map(item => ({ ...item, age: item.age + seconds })).filter(item => item.age < BURN_SECONDS)
      store.publish()
      if (world.burnt.length) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [running, burning, active, paused, saveError, store])

  useEffect(() => {
    const pauseHidden = () => { if (document.hidden) setSpeedLevel(0) }
    document.addEventListener('visibilitychange', pauseHidden)
    return () => document.removeEventListener('visibilitychange', pauseHidden)
  }, [])

  useEffect(() => {
    if (paused || saveError) { store.read().drag = null; store.publish() }
  }, [paused, saveError, store])

  function point(event) {
    const p = svg.current.createSVGPoint()
    p.x = event.clientX; p.y = event.clientY
    return p.matrixTransform(svg.current.getScreenCTM().inverse())
  }
  function startDrag(event, actor) {
    if (!running) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    const p = point(event)
    store.read().drag = { index: actor.index, x: p.x, y: p.y }
    setSelected(actor.index)
    store.publish()
  }
  function moveDrag(event) {
    if (!store.read().drag || !running) return
    const p = point(event)
    store.read().drag = { ...store.read().drag, x: p.x, y: p.y }
    store.publish()
  }
  function release(event) {
    const w = store.read()
    const drag = w.drag
    if (!drag) return
    const p = point(event)
    const bin = binAt(p.x, p.y, binOffset)
    const actor = w.actors.find(item => item.index === drag.index)
    w.drag = null
    if (running && actor && bin !== null) resolve(actor, 'sorted', bin)
    store.publish()
  }
  function chooseBin(bin) {
    const actor = store.read().actors.find(item => item.index === selected && item.y >= -64)
    if (running && actor) resolve(actor, 'sorted', bin)
  }
  const selectedItem = w.actors.find(item => item.index === selected)
  const empty = !w.actors.length
  return <section className={`game-board pixel-panel ${running ? 'moving' : ''} ${robotAwake ? 'robot-awake' : ''} ${robotIdle ? 'robot-idle' : ''}`} aria-label="Conveyor sorting game">
    <div inert={prompt ? true : undefined}><div className="board-controls">{stageNavigation}<div className="button-row">
      <button className="secondary" onClick={help} title="The belt pauses while you explore labels, filters, weights and fair testing.">? Learning tips</button>
      <button onClick={onReturnToStart} disabled={saving > 0} title={saving > 0 ? 'Wait for progress to finish saving before returning to start.' : undefined}>Return to start</button>
    </div></div>
    <div hidden={!active}>
    <svg ref={svg} className="conveyor-svg" viewBox={`-320 0 1920 ${sceneHeight}`} style={{ aspectRatio: `1920 / ${sceneHeight}` }} aria-label="Animated conveyor above a pixel lava pit and three sorting bins"
      onPointerMove={moveDrag} onPointerUp={release} onPointerCancel={() => { store.read().drag = null; store.publish() }}>
      <defs><pattern id="floor" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="#142a1d" /></pattern>
        <clipPath id="belt-clip"><rect x="530" y="0" width="220" height="470" /></clipPath></defs>
      <rect x="-320" width="1920" height={sceneHeight} fill="#080e0a" /><rect x="-320" width="1920" height={sceneHeight} fill="url(#floor)" />
      <BeltSpeedControl value={displayedSpeedLevel} onChange={changeSpeed} disabled={!!prompt || empty || !!saveError} />
      <g className="sorting-tv memory-tv" transform="translate(0 21)">
        <g fill="rgb(95, 87, 79)" stroke="rgb(194, 195, 199)" strokeWidth="4">
          <rect x="-320" y="125" width="80" height="14" />
          <rect x="-320" y="235" width="80" height="14" />
          <rect x="-240" y="35" width="252" height="275" fill="rgb(43, 43, 49)" strokeWidth="8" />
        </g>
        <MemoryTable records={memory} items={game.items} />
      </g>
      <g className="sorting-tv feedback-tv" transform="translate(0 386)">
        <g fill="rgb(95, 87, 79)" stroke="rgb(194, 195, 199)" strokeWidth="4">
          <rect x="-320" y="125" width="80" height="14" />
          <rect x="-320" y="235" width="80" height="14" />
          <rect x="-240" y="35" width="252" height="275" fill="rgb(43, 43, 49)" strokeWidth="8" />
        </g>
        <foreignObject x="-232" y="43" width="236" height="259">
          <div className={`feedback-tv-screen${complete ? ' sorting-complete' : ''}`}>
          <div className="tv-score" hidden={!feedbackVisible && !complete} aria-hidden={complete || !feedbackVisible || undefined} aria-label={`Current score: ${game.summary.score}`}><span>SCORE</span><strong>{game.summary.score}</strong></div>
          <div className="tv-feedback-region" role="status" aria-atomic="true" aria-label="Sorting feedback">
          <div key={complete ? 'complete' : feedbackKey} className={`tv-feedback ${complete ? 'mission-heading' : !started || feedbackKind === 'ready' ? 'showing-static' : 'feedback-flash'}`} data-outcome={complete ? 'complete' : feedbackKind}>
            {complete ? <p><span className="mission-final-score">SCORE: {game.summary.score}</span>{missionReportHeading(game.summary)}</p> : !started || feedbackKind === 'ready' ? <TVStatic /> : <p>{feedback}</p>}
          </div>
          </div>
          </div>
        </foreignObject>
      </g>
      <g className="sorting-tv right-tv" aria-label="Right television">
        <g fill="rgb(95, 87, 79)" stroke="rgb(194, 195, 199)" strokeWidth="4">
          <rect x="1512" y="335" width="88" height="14" />
          <rect x="1512" y="445" width="88" height="14" />
          <rect x="1260" y="245" width="252" height="275" fill="rgb(43, 43, 49)" strokeWidth="8" />
        </g>
      </g>
      <rect x="514" width="252" height="470" fill="#c2c3c7" stroke="#5f574f" strokeWidth="4" />
      <rect x="530" width="220" height="470" fill="#2b2b31" />
      <g clipPath="url(#belt-clip)">{Array.from({ length: 18 }, (_, i) => <path key={i} d={`M534 ${i * 30 + w.treads - 30} H746`} stroke="#46464f" strokeWidth="3" />)}</g>
      {complete && <g clipPath="url(#belt-clip)" className={`belt-mission-actions${deliveryDone ? ' delivered' : ''}`}>
        <foreignObject x="542" y={w.deliveryY} width="196" height="180">
          <div className="belt-action-buttons">
            <button className="green" disabled={!deliveryDone || !!saving} onClick={onTrain}>Phase 2 * TRAIN</button>
            <button disabled={!deliveryDone || busy || !!saving} onClick={onResort}>RE-SORT</button>
          </div>
        </foreignObject>
      </g>}
      <rect x="510" y="470" width="260" height="20" fill="#000" />
      {Array.from({ length: 11 }, (_, i) => <path key={i} d={`M${510 + i * 24} 490 l12 -20 h12 l-12 20Z`} fill="#ffec27" />)}
      <g className="lava-pool" role="img" aria-label="Lava pool: missed items receive no training label">
        <rect className="lava-glow" x="460" y="486" width="360" height="100" fill="#ff6b00" opacity=".2" />
        <rect x="470" y="490" width="340" height="90" fill="#5f574f" stroke="#c2c3c7" strokeWidth="5" />
        {Array.from({ length: 80 }, (_, i) => <rect className="lava-tile" key={i} x={480 + i % 16 * 20} y={500 + Math.floor(i / 16) * 14}
          width="20" height="14" style={{ animationDelay: `${-(i % 5) * .2}s`, animationPlayState: active ? 'running' : 'paused' }} />)}
        <text x="640" y="595" textAnchor="middle" fill="#ffcc80" fontSize="12">LAVA · LOST PRACTICE EXAMPLES</text>
        {Array.from({ length: 7 }, (_, i) => <rect className="lava-ember" key={i} x={495 + i * 45} y={502 + i % 3 * 12} width="6" height="6" fill={i % 2 ? '#ffa300' : '#ffec27'}
          style={{ animationDelay: `${-i * .23}s`, animationPlayState: active ? 'running' : 'paused' }} />)}
      </g>
      {guidanceVisible && <g>
      <g className="lava-arrow" fill="none" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true">
        <path d="M830 447L740 506M746 490L740 506L757 507" stroke="#fff" strokeWidth="16" />
        <path d="M830 447L740 506M746 490L740 506L757 507" stroke="#ff004d" strokeWidth="10" />
      </g>
      <text x="845" y="457" fill="#ffec27" fontSize="24">LAVA PIT!</text>
      <text x="875" y="484" fill="#ffccaa" fontSize="16"><tspan x="875">Items that fall in are not shown </tspan><tspan x="875" dy="22">to RE-CYCLER in the Train phase</tspan></text>
      </g>}
      <g ref={robotMotion} className={robotPhase === 'settled' ? 'robot-settled' : robotPhase === 'settling' ? 'robot-settling' : !guidanceVisible ? 'robot-pacing' : undefined} style={{ '--robot-settle-from': settleFrom }}>
      <g className={started || complete ? 'robot-floating' : undefined}>
      <svg x="196" y="80" width="128" height="128" viewBox="-4 -24 128 168" className="pixel-robot" role="img" aria-label="Re-cycler, new hire robot"><path d="M0 0h120v90H0zM20 90h80v50H20z" fill="#5f574f" stroke="#c2c3c7" strokeWidth="6" />
        <rect className="robot-eye" x="20" y="24" width="22" height="22" fill="#00e436" /><rect className="robot-eye" x="78" y="24" width="22" height="22" fill="#00e436" />
        <path d="M30 68h60M60 0v-20h16" stroke="#69f58e" strokeWidth="6" /></svg>
      </g>
      {(started || complete) && <g className="robot-hover-lines" stroke="rgb(0, 228, 54)" strokeWidth="5" aria-hidden="true">
        {[80, 56, 32].map((width, index) => <line key={width} className="robot-hover-line" x1={260 - width / 2} x2={260 + width / 2} y1={220 + index * 14} y2={220 + index * 14} style={{ animationDelay: `${index * .2}s` }} />)}
      </g>}
      {robotIdle && <g className="robot-restart-prompt">
        <g role="img" aria-label="would you like to restart your sorting?">
          <path d="M92 6H428V14H436V58H428V66H276V74H268V84H252V74H244V66H92V58H84V14H92Z" fill="#fff1e8" stroke="#c2c3c7" strokeWidth="4" strokeLinejoin="miter" />
          <text x="260" y="31" textAnchor="middle" fill="#102117" fontSize="20"><tspan x="260">would you like to</tspan><tspan x="260" dy="25">restart your sorting?</tspan></text>
        </g>
        <foreignObject className="robot-resort" x="170" y="272" width="180" height="54">
          <button disabled={busy || !!saving} onClick={onResort}>RESET BELT</button>
        </foreignObject>
      </g>}
      </g>
      {complete && robotPhase === 'settled' && <RobotSummary summary={game.summary} saving={saving} />}
      {guidanceVisible && <g>
      {!robotIdle && <g>
      <text x="260" y="267" textAnchor="middle" fill="#00e436" fontSize="21">RE-CYCLER, NEW HIRE</text>
      <text x="260" y="300" textAnchor="middle" fill="#a3b9aa" fontSize="17"><tspan x="260">I brought in 30 items, </tspan><tspan x="260" dy="24">could you show me where </tspan><tspan x="260" dy="24">to put them?</tspan></text>
      </g>}
      {!running && !empty && <text className="belt-start-hint" x="848" y="185" textAnchor="middle" fill="#69f58e" fontSize="16">{paused || prompt ? 'LEARNING BREAK' : 'Set BELT SPEED above 0 to resume'}</text>}
      </g>}
      {[280, 640, 1000].map((cx, i) => <g key={cx} className="sorting-bin" transform={`translate(0 ${binOffset})`} role="button" tabIndex={0} aria-label={`Sort selected item into ${BINS[i]}`}
        onClick={() => chooseBin(i)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); chooseBin(i) } }}>
        <rect x={cx - 142} y="556" width="300" height="200" fill="#000" />
        <rect x={cx - 150} y="548" width="300" height="200" fill={COLORS[i]} stroke={binAt(w.drag?.x, w.drag?.y, binOffset) === i ? '#ffec27' : '#fff1e8'} strokeWidth="5" />
        <rect x={cx - 132} y="564" width="264" height="126" fill="#0a1a10" stroke="#355e41" strokeWidth="4" />
        {binPulses[i] > 0 && <BinLogo key={binPulses[i]} bin={i} x={cx} />}
        <text className="bin-item-count" x={cx} y="680" textAnchor="middle" fill="#fff1e8" fontSize="20">ITEMS: {binCounts[i]}</text>
        <text x={cx} y="723" textAnchor="middle" fill="#000" fontSize="22">{BINS[i].toUpperCase()}</text></g>)}
      {w.actors.filter(actor => actor.y > -128).map(actor => {
        const drag = w.drag?.index === actor.index ? w.drag : null
        return <g key={actor.index} transform={`translate(${(drag?.x ?? 640) - 64}, ${(drag?.y ?? actor.y) - 64})`} role="button" tabIndex={0}
          aria-label={`Select ${actor.name}`} onPointerDown={event => startDrag(event, actor)}
          onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelected(actor.index) } }}>
          {selected === actor.index && <rect x="-4" y="-4" width="136" height="136" fill="none" stroke="#ffec27" strokeWidth="4" />}
          <image href={actor.image} width="128" height="128" draggable="false" />
          <text x="64" y="148" fill="#fff1e8" textAnchor="middle" fontSize="18">{actor.name}</text></g>
      })}
      {w.burnt.map(actor => { const progress = actor.age / BURN_SECONDS, size = 128 * (1 - progress)
        return <g key={actor.index} aria-label="Missed item destroyed in lava"><image href={actor.image} x={640 - size / 2} y={520 - size / 2 + progress * 16} width={size} height={size} />
          {Array.from({ length: 14 }, (_, i) => <rect className="lava-spark" key={i} x={640 + (i - 6.5) * (progress * 20 + 2)} y={535 - progress * 110 + i % 3 * 10 + progress * progress * 45}
            width={i % 3 ? '8' : '11'} height={i % 3 ? '8' : '11'} opacity={1 - progress} fill={i % 2 ? '#ffa300' : '#ffec27'} />)}</g> })}
    </svg>
    <div ref={keyboardControls} className="keyboard-controls"><span>{selectedItem ? `Selected: ${selectedItem.name}` : 'Keyboard: Tab to an item, press Enter, then choose its bin.'}</span>
      <div className="button-row">{BINS.map((bin, i) => <button key={bin} disabled={!running || !selectedItem} onClick={() => chooseBin(i)}>{bin}</button>)}</div></div>
    </div>
    </div>
    {active && prompt && <ConveyorPrompt slowdown={prompt === 'slowdown'} onContinue={continueSorting} />}
  </section>
}
