import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { advanceActors, BINS, binAt, COLORS, createWorld, initialActors, SPEEDS } from './gameEngine'

export default function Conveyor({ game, paused, onResolve, help, onReturnToStart, saving, saveError, stageNavigation, active = true }) {
  const [store] = useState(() => createWorld(initialActors(game.items, game.actions)))
  const w = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const callback = useRef(onResolve)
  useEffect(() => { callback.current = onResolve }, [onResolve])
  const svg = useRef()
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState('NORMAL')
  const [selected, setSelected] = useState(null)
  const running = playing && !paused && !saveError

  function resolve(actor, outcome, chosen = null) {
    const w = store.read()
    if (!w.actors.some(item => item.index === actor.index)) return
    w.actors = w.actors.filter(item => item.index !== actor.index)
    if (w.drag?.index === actor.index) w.drag = null
    if (outcome === 'missed') w.burnt.push({ ...actor, age: 0 })
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
      w.burnt = w.burnt.map(item => ({ ...item, age: item.age + seconds })).filter(item => item.age < .5)
      store.publish()
      if (!w.actors.length && !w.burnt.length) { setPlaying(false); return }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [running, speed, store])

  useEffect(() => {
    const pauseHidden = () => { if (document.hidden) setPlaying(false) }
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
    const bin = binAt(p.x, p.y)
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
  return <section className={`game-board pixel-panel ${running ? 'moving' : ''}`} aria-label="Conveyor sorting game">
    <div className="board-controls"><div className="button-row" hidden={!active}>
      <button disabled={empty || paused || !!saveError} onClick={() => setPlaying(!playing)}>{running ? 'Pause belt' : 'Start belt'}</button>
      <label title="Slow gives you more time; Normal is the faster lava version.">Speed <select value={speed} onChange={event => setSpeed(event.target.value)}>
        {Object.keys(SPEEDS).map(value => <option key={value}>{value}</option>)}</select></label>
    </div>{stageNavigation}<div className="button-row">
      <button className="secondary" onClick={help} title="The belt pauses while you explore labels, filters, weights and fair testing.">? Learning tips</button>
      <button onClick={onReturnToStart} disabled={saving > 0} title={saving > 0 ? 'Wait for progress to finish saving before returning to start.' : undefined}>Return to start</button>
    </div></div>
    <div hidden={!active}>
    <div className="mission-strip"><span>{game.summary.resolved}/30 complete</span><span>Score <b>{game.summary.score}</b></span>
      <span>Right <b>{game.summary.correct}</b></span><span>Missed <b>{game.summary.missed}</b></span>
      <span>Streak <b>{game.summary.streak}</b></span><span className="save-indicator">{saving ? `Saving ${saving}…` : '✓ Progress saved'}</span></div>
    <svg ref={svg} className="conveyor-svg" viewBox="0 0 1280 770" aria-label="Animated conveyor above a pixel lava pit and three sorting bins"
      onPointerMove={moveDrag} onPointerUp={release} onPointerCancel={() => { store.read().drag = null; store.publish() }}>
      <defs><pattern id="floor" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="#142a1d" /></pattern>
        <clipPath id="belt-clip"><rect x="530" y="0" width="220" height="470" /></clipPath></defs>
      <rect width="1280" height="770" fill="#080e0a" /><rect width="1280" height="770" fill="url(#floor)" />
      <rect x="514" width="252" height="470" fill="#c2c3c7" stroke="#5f574f" strokeWidth="4" />
      <rect x="530" width="220" height="470" fill="#2b2b31" />
      <g clipPath="url(#belt-clip)">{Array.from({ length: 18 }, (_, i) => <path key={i} d={`M534 ${i * 30 + w.treads - 30} H746`} stroke="#46464f" strokeWidth="3" />)}</g>
      <rect x="510" y="470" width="260" height="20" fill="#000" />
      {Array.from({ length: 11 }, (_, i) => <path key={i} d={`M${510 + i * 24} 490 l12 -20 h12 l-12 20Z`} fill="#ffec27" />)}
      <rect x="510" y="490" width="260" height="52" fill="#5f574f" stroke="#c2c3c7" strokeWidth="4" />
      {Array.from({ length: 36 }, (_, i) => <rect className="lava-tile" key={i} x={520 + i % 12 * 20} y={494 + Math.floor(i / 12) * 12}
        width="20" height="12" style={{ animationDelay: `${-(i % 5) * .2}s`, animationPlayState: running ? 'running' : 'paused' }} />)}
      <text x="800" y="487" fill="#ffec27" fontSize="16">← LAVA PIT!</text><text x="800" y="514" fill="#ffccaa" fontSize="13">Save the practice examples!</text>
      <g transform="translate(200 85)" className="pixel-robot"><path d="M0 0h120v90H0zM20 90h80v50H20z" fill="#5f574f" stroke="#c2c3c7" strokeWidth="6" />
        <rect x="20" y="24" width="22" height="22" fill="#00e436" /><rect x="78" y="24" width="22" height="22" fill="#00e436" />
        <path d="M30 68h60M60 0v-20h16" stroke="#69f58e" strokeWidth="6" /></g>
      <text x="260" y="267" textAnchor="middle" fill="#00e436" fontSize="21">TEACH THE ROBOT</text>
      <text x="260" y="300" textAnchor="middle" fill="#a3b9aa" fontSize="15">Your choices become its labels.</text>
      <text x="1015" y="160" textAnchor="middle" fill="#fff1e8" fontSize="23">{empty ? 'MISSION COMPLETE' : running ? 'KEEP SORTING!' : 'READY WHEN YOU ARE'}</text>
      <text x="1015" y="200" textAnchor="middle" fill="#a3b9aa" fontSize="16">{empty ? 'See your mission report below.' : `${w.actors.length} items left to help the robot`}</text>
      {!running && !empty && <text x="1015" y="255" textAnchor="middle" fill="#69f58e" fontSize="16">{paused ? 'LEARNING BREAK' : 'Press START BELT to play'}</text>}
      {[280, 640, 1000].map((cx, i) => <g key={cx} role="button" tabIndex={0} aria-label={`Sort selected item into ${BINS[i]}`}
        onClick={() => chooseBin(i)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); chooseBin(i) } }}>
        <rect x={cx - 142} y="556" width="300" height="200" fill="#000" />
        <rect x={cx - 150} y="548" width="300" height="200" fill={COLORS[i]} stroke={binAt(w.drag?.x, w.drag?.y) === i ? '#ffec27' : '#fff1e8'} strokeWidth="5" />
        <rect x={cx - 132} y="564" width="264" height="126" fill="#0a1a10" stroke="#355e41" strokeWidth="4" />
        <text x={cx} y="723" textAnchor="middle" fill="#000" fontSize="22">{BINS[i].toUpperCase()}</text></g>)}
      {w.actors.filter(actor => actor.y > -128).map(actor => {
        const drag = w.drag?.index === actor.index ? w.drag : null
        return <g key={actor.index} transform={`translate(${(drag?.x ?? 640) - 64}, ${(drag?.y ?? actor.y) - 64})`} role="button" tabIndex={0}
          aria-label={`Select ${actor.name}`} onPointerDown={event => startDrag(event, actor)}
          onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelected(actor.index) } }}>
          {selected === actor.index && <rect x="-4" y="-4" width="136" height="136" fill="none" stroke="#ffec27" strokeWidth="4" />}
          <image href={actor.image} width="128" height="128" draggable="false" />
          <text x="64" y="144" fill="#fff1e8" textAnchor="middle" fontSize="14">{actor.name}</text></g>
      })}
      {w.burnt.map(actor => { const progress = actor.age / .5, size = 128 * (1 - progress)
        return <g key={actor.index} aria-label="Missed item destroyed in lava"><image href={actor.image} x={640 - size / 2} y={500 - size / 2 + progress * 12} width={size} height={size} />
          {Array.from({ length: 8 }, (_, i) => <rect key={i} x={640 + (i - 3.5) * (progress * 18 + 4)} y={510 - progress * 60 + i % 3 * 8}
            width="7" height="7" opacity={1 - progress} fill={i % 2 ? '#ffa300' : '#ffec27'} />)}</g> })}
    </svg>
    <div className="keyboard-controls"><span>{selectedItem ? `Selected: ${selectedItem.name}` : 'Keyboard: Tab to an item, press Enter, then choose its bin.'}</span>
      <div className="button-row">{BINS.map((bin, i) => <button key={bin} disabled={!running || !selectedItem} onClick={() => chooseBin(i)}>{bin}</button>)}</div></div>
    </div>
  </section>
}
