import { useEffect, useId, useRef, useState } from 'react'
import { api } from './api'
import { BINS, COLORS } from './gameEngine'
import HomeRobot from './HomeRobot'
import './RobotDetective.css'

const percent = value => `${(value * 100).toFixed(1)}%`
const winner = values => BINS[values.indexOf(Math.max(...values))]
const STEPS = [
  { name: 'Robot eyes', title: 'Look through robot eyes', action: 'Switch views, then try a different filter block.', takeaway: 'The robot receives numbers. Its layers respond to patterns in those numbers.' },
  { name: 'The decision', title: 'Follow the decision', action: 'Reveal the scores. Compare the same item before and after training.', takeaway: 'The highest score chooses a bin. Training changes the scores by adjusting weights.' },
  { name: 'The test', title: 'Test the robot', action: 'Try a new drawing, then an unfamiliar item. Does the chosen bin make sense?', takeaway: 'A high score can still be wrong, especially when none of the three bins fits.' },
]

function ExtraHelp({ title, topic, track, children }) {
  return <details className="detective-help" onToggle={event => {
    if (event.target === event.currentTarget && event.currentTarget.open) track?.(topic)
  }}>
    <summary>{title}</summary>{children}
  </details>
}

// These are the existing CNN responses, shared with the training screen.
export function Network({ viz }) {
  if (!viz) return <p className="muted">Train the CNN to see real filter responses and connections here.</p>
  const point = (layer, node) => [65 + layer * 162, 72 + node * 30 + (6 - viz.layers[layer].labels.length) * 15]
  return <figure className="network-figure"><svg viewBox="0 0 1040 290" role="img" aria-label="CNN responses from RGB through four convolution blocks to class scores. Cyan solid lines summarize positive weights; coral dashed lines summarize negative weights.">
    {viz.edges.map((matrix, layer) => {
      const max = Math.max(...matrix.flat().map(Math.abs), .000001)
      return matrix.flatMap((row, source) => row.map((weight, dest) => {
        const [x1, y1] = point(layer, source), [x2, y2] = point(layer + 1, dest)
        return <line key={`${layer}-${source}-${dest}`} x1={x1 + 26} y1={y1} x2={x2 - 26} y2={y2}
          stroke={weight >= 0 ? '#75e5f5' : '#ff8d8d'} strokeDasharray={weight < 0 ? '5 4' : undefined} opacity={.08 + .65 * Math.abs(weight) / max * viz.layers[layer].level[source]} />
      }))
    })}
    {viz.layers.map((layer, i) => <g key={i}><text x={65 + i * 162} y="25" textAnchor="middle" fill="#ffd66b" fontSize="14">{i === 0 ? 'RGB INPUT' : i === 5 ? 'SOFTMAX' : `BLOCK ${i}`}</text>
      {layer.labels.map((label, j) => { const [x, y] = point(i, j)
        return <g key={label}><rect x={x - 26} y={y - 12} width="52" height="24" fill={i === 5 ? '#211f3a' : '#40859a'}
          fillOpacity={i === 5 ? 1 : .2 + .8 * layer.level[j]} stroke={i === 5 ? COLORS[j] : '#c2bbd6'} strokeWidth="2" /><text x={x} y={y + 4} fill="#fff1d6" textAnchor="middle" fontSize="11">{i === 5 ? percent(layer.raw[j]) : label}</text>
          {i === 5 && <text x={x + 36} y={y + 4} fill={COLORS[j]} fontSize="13">{label}</text>}</g>
      })}</g>)}
    <g fontSize="12"><line x1="64" y1="267" x2="98" y2="267" stroke="#75e5f5" strokeWidth="2" /><text x="108" y="271" fill="#75e5f5">+ Positive weight</text><line x1="298" y1="267" x2="332" y2="267" stroke="#ff8d8d" strokeWidth="2" strokeDasharray="5 4" /><text x="342" y="271" fill="#ff8d8d">− Negative weight</text></g>
  </svg><figcaption>Real responses on the original image. Top channels only. Lines summarize kernel weights and batch normalization; they do not explain the entire decision.</figcaption></figure>
}

function Scores({ values }) {
  const highest = values.indexOf(Math.max(...values))
  return <div className="scores">{BINS.map((bin, i) => <div key={bin} data-winner={i === highest || undefined}>
    <span>{bin}</span><meter min="0" max="1" value={values[i]} aria-label={`${bin} model score`} />
    <b style={{ color: COLORS[i] }}>{percent(values[i])}</b>
  </div>)}</div>
}

const STARTING_KNOBS = { response: .8, weight: .5 }

// Deliberately small demonstration: it never changes the trained CNN or its scores.
export function WeightExperiment({ track, onActivity, navigationKey }) {
  const [knobs, setKnobs] = useState(STARTING_KNOBS)
  const [progress, setProgress] = useState({ raised: false, lowered: false, negative: false, zero: false })
  const { response, weight } = knobs, contribution = response * weight
  const raw = [.7, contribution, .5], exponentials = raw.map(value => Math.exp(value))
  const total = exponentials.reduce((a, b) => a + b), probabilities = exponentials.map(value => value / total)
  const selected = raw.indexOf(Math.max(...raw)), labelId = useId()
  const latest = useRef(STARTING_KNOBS), pending = useRef(null), timer = useRef(null), record = useRef(onActivity)
  useEffect(() => { record.current = onActivity }, [onActivity])
  function flush() {
    clearTimeout(timer.current)
    const event = pending.current
    pending.current = null
    if (event) record.current?.(event)
  }
  function queueActivity(next) {
    pending.current = { kind: 'weight_experiment', ...next }
    clearTimeout(timer.current)
    timer.current = setTimeout(flush, 700)
  }
  function changeKnob(changes) {
    const next = { ...latest.current, ...changes }
    if (next.response === latest.current.response && next.weight === latest.current.weight) return
    latest.current = next
    setKnobs(next)
    const nextContribution = next.response * next.weight
    setProgress(current => ({
      raised: current.raised || nextContribution > .7,
      lowered: current.lowered || (current.raised && nextContribution < .7),
      negative: current.negative || next.weight < 0,
      zero: current.zero || next.response === 0,
    }))
    queueActivity(next)
  }
  function reset() {
    // Keep the last explored setting, even if reset happens during a drag's debounce.
    flush()
    if (latest.current.response !== STARTING_KNOBS.response || latest.current.weight !== STARTING_KNOBS.weight) queueActivity(STARTING_KNOBS)
    latest.current = STARTING_KNOBS
    setKnobs(STARTING_KNOBS)
    setProgress({ raised: false, lowered: false, negative: false, zero: false })
  }
  useEffect(() => { flush() }, [navigationKey])
  useEffect(() => () => flush(), [])
  return <section className="detective-weight" aria-label="Demonstration weights lab">
    <header className="weight-lab-heading"><div><p className="eyebrow">Bonus level / You control the connection</p><h3>Flip the robot's pick</h3><p className="muted">A tiny demonstration model. These sliders do not change your trained CNN.</p></div><button onClick={reset}>Reset experiment</button></header>
    <div className="weight-lab-grid">
      <div className="weight-controls inset">
        <p className="eyebrow">Your mission</p>
        <ol className="weight-milestones" aria-label="Weight experiment goals">
          <li data-complete={progress.raised || undefined}><span aria-hidden="true">{progress.raised ? '✓' : '1'}</span><div>Make Compost the highest score.<small>{progress.raised ? 'Done! You boosted its connection.' : 'Increase its weight. Watch the scores change.'}</small></div></li>
          <li data-complete={progress.lowered || undefined}><span aria-hidden="true">{progress.lowered ? '✓' : '2'}</span><div>Then make another bin win.<small>{progress.lowered ? 'Done! The same response can lead to a different pick.' : 'Lower the weight or turn down the response.'}</small></div></li>
        </ol>
        <p className="weight-mission-status" role="status">{progress.lowered ? 'Connection mastered! A weight can change the winning bin.' : progress.raised ? 'Compost reached the top. Now lower its score until another bin wins.' : 'Recycling leads. Can you move Compost into first place?'}</p>
        <label>Pattern response: <output>{response.toFixed(1)}</output><input type="range" min="0" max="1" step=".1" value={response} aria-describedby={`${labelId}-response-help`} onChange={e => changeKnob({ response: Number(e.target.value) })} /></label>
        <p className="weight-control-help" id={`${labelId}-response-help`}>How strongly a pretend filter responds. Zero switches this signal off.</p>
        <label>Weight toward Compost: <output>{weight.toFixed(1)}</output><input type="range" min="-3" max="3" step=".1" value={weight} aria-describedby={`${labelId}-weight-help`} onChange={e => changeKnob({ weight: Number(e.target.value) })} /></label>
        <p className="weight-control-help" id={`${labelId}-weight-help`}>Positive boosts the raw value. Negative lowers it. This experiment's other two raw values stay fixed.</p>
        <div className="weight-discoveries" aria-label="Extra things to explore"><span data-found={progress.negative || undefined}>{progress.negative ? '✓' : '◇'} Try a negative weight</span><span data-found={progress.zero || undefined}>{progress.zero ? '✓' : '◇'} Try a zero response</span></div>
      </div>
      <div className="weight-decision inset">
        <p className="eyebrow">Live decision / Follow the numbers</p>
        <svg className="weight-mini-network" viewBox="0 0 500 232" role="img" aria-label={`Demonstration: response ${response.toFixed(1)} times weight ${weight.toFixed(1)} gives Compost raw value ${contribution.toFixed(2)}. Recycling raw value 0.70; Landfill raw value 0.50. Current pick: ${BINS[selected]}.`}>
          <text x="74" y="21" textAnchor="middle">PATTERN</text><text x="249" y="21" textAnchor="middle">WEIGHT</text><text x="421" y="21" textAnchor="middle">RAW VALUES</text>
          <path d="M126 116 H360" fill="none" stroke={weight < 0 ? '#ff8d8d' : '#b5e879'} strokeWidth={2 + Math.abs(contribution) * 2} strokeDasharray={weight < 0 ? '7 5' : undefined} />
          <rect x="20" y="87" width="108" height="58" className="weight-signal-node" />
          <text x="74" y="110" textAnchor="middle">Response</text><text className="weight-number" x="74" y="131" textAnchor="middle">{response.toFixed(1)}</text>
          <rect x="202" y="94" width="94" height="43" className="weight-edge-label" /><text className="weight-number" x="249" y="121" textAnchor="middle">× {weight.toFixed(1)}</text>
          {BINS.map((bin, i) => <g key={bin} data-picked={selected === i || undefined}><rect x="360" y={36 + i * 58} width="124" height="44" stroke={COLORS[i]} className="weight-bin-node" /><text x="422" y={53 + i * 58} textAnchor="middle">{bin}</text><text className="weight-number" x="422" y={72 + i * 58} textAnchor="middle">{raw[i].toFixed(2)}</text></g>)}
          <text x="250" y="219" textAnchor="middle">Only the Compost connection is adjustable here.</text>
        </svg>
        <div className="weight-mobile-flow" aria-hidden="true"><span>Pattern<strong>{response.toFixed(1)}</strong></span><b>×</b><span>Weight<strong>{weight.toFixed(1)}</strong></span><b>→</b><span>Compost raw<strong>{contribution.toFixed(2)}</strong></span></div>
        <div className="weight-equation"><span>Response × weight</span><strong>{response.toFixed(1)} × {weight.toFixed(1)} = {contribution.toFixed(2)}</strong></div>
        <p className="weight-softmax-note">Softmax turns these raw values into three scores that add up to 100%.</p>
        <Scores values={probabilities} />
        <p className="weight-live-pick">Demo robot's pick: <strong style={{ color: COLORS[selected] }}>{BINS[selected]}</strong></p>
      </div>
    </div>
    <ExtraHelp title="Try this + extra help" topic="weights" track={track}><p>Make Compost the highest score, then lower it. A negative weight pulls its raw value down. A zero response contributes zero, whatever the weight. Recycling and Landfill start at 0.7 and 0.5. Softmax turns the three values into scores adding to 100%.</p><p>This tiny model has one adjustable connection. Your real CNN learns many connections during training, using your labeled images. Experimenting here does not retrain it.</p></ExtraHelp>
  </section>
}

function RobotEyes({ item, track }) {
  const [vision, setVision] = useState('filters'), [block, setBlock] = useState(0)
  const layer = item.inspection.layers[block]
  return <>
    <div className="detective-view-switch" role="group" aria-label="How the robot sees the item">
      {['original', 'pixels', 'filters'].map(view => <button key={view} aria-pressed={vision === view} onClick={() => setVision(view)}>{view === 'original' ? 'Original' : view === 'pixels' ? 'Pixels' : 'Filters'}</button>)}
    </div>
    {vision === 'original' && <figure className="detective-image-view"><img src={item.image} alt={`Original test image: ${item.name}`} /><figcaption>You recognize an item. The robot receives its picture as color values.</figcaption></figure>}
    {vision === 'pixels' && <div className="detective-pixels">
      <figure className="detective-image-view"><div className="detective-pixel-image"><img src={item.inspection.input_image} alt={`64 by 64 model input: ${item.name}`} /><span aria-hidden="true" /></div><figcaption>64 × 64 pixels. The marker shows the center pixel.</figcaption></figure>
      <dl><div><dt>Center pixel (red, green, blue)</dt><dd><span className="detective-swatch" style={{ background: `rgb(${item.inspection.rgb.join(',')})` }} />{item.inspection.rgb.join(', ')}</dd></div><div><dt>Scaled for the CNN</dt><dd>{item.inspection.normalized.join(', ')}</dd></div></dl>
    </div>}
    {vision === 'filters' && <section className="filters-box"><h4>Filters & feature maps</h4>
      <div className="detective-view-switch" role="group" aria-label="CNN filter blocks">{item.inspection.layers.map((layer, i) => <button key={layer.name} aria-pressed={block === i} onClick={() => setBlock(i)}>{layer.name}</button>)}</div>
      {layer && <><div className="detective-maps">{layer.maps.map(map => <figure key={map.channel}><img src={map.image} alt={`${layer.name} channel ${map.channel} response for ${item.name}`} /><figcaption>Filter {map.channel}</figcaption></figure>)}</div><p className="muted">{layer.name}: {layer.shape.join(' × ')} · Two real response maps</p></>}
      <ExtraHelp title="What do these pictures mean?" topic="filters" track={track}><p>Two channels per block are selected by average response. Brighter means stronger within that map. Each map is scaled to its own maximum, so brightness cannot be compared across maps. These are activation maps, not human concepts or a complete explanation.</p><p>ReLU keeps positive responses; pooling shrinks the grids. Later layers combine earlier responses.</p></ExtraHelp>
    </section>}
  </>
}

function Decision({ item, track }) {
  const [revealed, setRevealed] = useState(false), [compare, setCompare] = useState(false)
  return <>
    <div className="detective-flow" aria-label="Decision path"><span>Image numbers</span><b aria-hidden="true">→</b><span>Learned patterns</span><b aria-hidden="true">→</b><span>Three scores</span></div>
    {!revealed ? <div className="detective-reveal"><p>The CNN gives every bin a score.</p><p className="muted">Which bin do you think will come out on top?</p><button className="green" onClick={() => setRevealed(true)}>Reveal bin scores</button></div> : <>
      <div className="detective-pick" role="status">Robot's pick: <strong>{winner(item.probabilities)}</strong> <span>{percent(Math.max(...item.probabilities))} score</span></div>
      <div className={compare ? 'comparison detective-comparison' : ''}>
        {compare && <section aria-label="Before training scores"><h4>Before training</h4><Scores values={item.before} /><p className="muted">Pick: {winner(item.before)}</p></section>}
        <section aria-label="After training scores"><h4>After training</h4><Scores values={item.probabilities} /></section>
      </div>
      <button aria-pressed={compare} onClick={() => setCompare(value => !value)}>{compare ? 'Show after only' : 'Compare before & after'}</button>
      {compare && <p className="muted">Same test item and views in both checks. Training can change scores without changing the winning bin.</p>}
    </>}
    <ExtraHelp title="Open the real CNN diagram" topic="weights" track={track}><Network viz={item.viz} /><p>Cyan solid lines (+) summarize positive weights; coral dashed lines (−) summarize negative weights. Training adjusts many weights, changing how responses contribute to the next layer.</p></ExtraHelp>
    <ExtraHelp title="How are these scores calculated?" topic="confidence" track={track}><p>Softmax turns the final three values into scores adding up to 100%. The highest score chooses a bin, but it is not a promise that the answer is right. The before/after scores average the same image and augmented views. The diagram shows the original image.</p></ExtraHelp>
  </>
}

export default function RobotDetective({ game, track, onBack, onActivity }) {
  const [step, setStep] = useState(0), [index, setIndex] = useState(0), [finished, setFinished] = useState(false)
  const [fresh, setFresh] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const predictions = game.training.results?.predictions || []
  const item = predictions[Math.min(index, predictions.length - 1)]
  const evidence = step === 2 && fresh ? fresh : item
  const lesson = STEPS[step]

  async function tryItem(novel) {
    setBusy(true); setError(''); setFresh(null)
    try { setFresh(await api(`/sessions/${game.id}/try-item?novel=${novel}`, {})) }
    catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }
  function goTo(next) { setStep(next); setFinished(false) }

  return <section className="pixel-panel lab-panel detective-panel" data-step={step} aria-label="Explore">
    <header className="section-heading detective-heading"><div><p className="eyebrow">Step 03 / Test</p><h2>Test your robot</h2><p>Become a Robot Detective. Find out how it chooses a bin, and whether you can trust it.</p></div><HomeRobot variant="heading" /></header>
    {!item ? <p>Complete training to investigate the robot's predictions.</p> : <>
      <nav className="detective-steps" aria-label="Investigation steps">{STEPS.map((lesson, i) => <button key={lesson.name} aria-current={step === i ? 'step' : undefined} onClick={() => goTo(i)}><span>{i + 1}</span>{lesson.name}</button>)}</nav>
      <div className="detective-task"><p className="eyebrow" role="status">Step {step + 1} of 3</p><h3 id="detective-task-title">{lesson.title}</h3><p>{lesson.action}</p></div>
      <div className="detective-workspace">
        <aside className="detective-evidence inset" aria-label="Investigation item">
          <p className="eyebrow">{step === 2 ? fresh ? 'New evidence' : 'Ready for a new test' : 'Your test item'}</p>
          {step !== 2 && <label>Choose a test item<select value={index} disabled={busy} onChange={e => { setIndex(Number(e.target.value)); setFresh(null) }}>{predictions.map((prediction, i) => <option key={i} value={i}>{prediction.name}</option>)}</select></label>}
          <img className="detective-item-image" src={evidence.image} alt={evidence.name} /><h4>{evidence.name}</h4>
          <p className="muted">{step === 2 ? fresh ? 'This new drawing was not used to train your robot.' : 'Try the buttons to give your robot a new drawing.' : 'Held aside for testing. This picture did not update the robot’s weights.'}</p>
        </aside>
        <article className="detective-main inset" aria-labelledby="detective-task-title">
          <div hidden={step !== 0}><RobotEyes key={index} item={item} track={track} /></div>
          <div hidden={step !== 1}><Decision key={index} item={item} track={track} /></div>
          <div hidden={step !== 2}>
            <div className="detective-test-buttons"><button disabled={busy} onClick={() => tryItem(false)}>Try a new drawing<span>A familiar kind of waste</span></button><button disabled={busy} onClick={() => tryItem(true)}>Try an unfamiliar item<span>Could it need a different bin?</span></button></div>
            {busy && <p role="status">The robot is checking a new image…</p>}
            {error && <p className="error" role="alert">{error} Try either test button again.</p>}
            {!fresh && !busy && !error && <div className="detective-reveal"><p>Will it recognize another drawing?</p><p className="muted">Then see what happens when an item needs a destination outside its three bins.</p></div>}
            {fresh && <div className="detective-test-result" aria-live="polite"><div className="detective-pick">Robot's pick: <strong>{winner(fresh.probabilities)}</strong><span>{percent(Math.max(...fresh.probabilities))} score</span></div><Scores values={fresh.probabilities} /><p>Common destination: <strong>{fresh.destination}</strong></p><p className={fresh.has_valid_bin ? 'education-note' : 'detective-caution'}>{fresh.has_valid_bin ? 'Compare the chosen bin with the common destination. Does the robot’s decision fit this new drawing?' : 'None of the robot’s three bins is suitable! It still has to pick one. A high score cannot create a missing category.'}</p><ExtraHelp title="Look inside this new prediction" topic="filters" track={track}><Network viz={fresh.viz} /></ExtraHelp></div>}
            <ExtraHelp title="Tell me more about new items" topic="new-items" track={track}><p>These drawings were not in your training dataset. A familiar type tests whether the robot can use its learned patterns on a new drawing. An unfamiliar type can reveal limits of its three categories. It has no “I don’t know” option.</p></ExtraHelp>
          </div>
        </article>
        <aside className="detective-notes inset" aria-label="Investigation notes"><p className="eyebrow">Detective notes</p><h4>{step === 0 ? 'Look for a change' : step === 1 ? 'Check the evidence' : 'Confidence ≠ correctness'}</h4>
          {step === 0 && <><p>Do different blocks light up in different places?</p><p className="muted">Bright means a stronger response within that map. It does not tell us the robot understands the object.</p><ExtraHelp title="Tell me more about pixels" topic="pixels" track={track}><p>Each pixel has red, green and blue values from 0–255. These are scaled to −1–1 before the CNN uses them. It receives these color values, not the item’s name.</p></ExtraHelp></>}
          {step === 1 && <><dl><div><dt>Your label</dt><dd>{item.label}</dd></div><div><dt>Common guideline</dt><dd>{item.guideline}</dd></div></dl><p className="muted">Does the robot agree with either? Matching your label and following a recycling guideline are different checks.</p><ExtraHelp title="Why might training make mistakes?" topic="accuracy" track={track}><p>The robot learns your labels, including incorrect ones. A small dataset can also make learning unreliable. Better test results are not guaranteed. Game points and model accuracy measure different things.</p></ExtraHelp></>}
          {step === 2 && <><p>The robot always chooses Recycling, Compost, or Landfill.</p><p className="muted">Would you trust its pick for an item that needs special disposal?</p><ExtraHelp title="Tell me more about confidence" topic="confidence" track={track}><p>An 80% score does not mean an 80% guarantee of being right. Compare predictions with reliable recycling guidance. Local disposal rules can vary.</p></ExtraHelp></>}
          <div className="detective-takeaway"><b>Keep this idea</b><p>{lesson.takeaway}</p></div>
        </aside>
      </div>
      <footer className="detective-navigation"><button disabled={step === 0} onClick={() => goTo(step - 1)}>← Back</button><span>You can revisit every step.</span>{step < 2 ? <button className="green" onClick={() => goTo(step + 1)}>{step === 0 ? 'Next: follow the decision →' : 'Next: test the robot →'}</button> : <button className="green" disabled={finished} onClick={() => setFinished(true)}>{finished ? 'Case closed ✓' : 'Close the case'}</button>}</footer>
      {finished && <section className="detective-case-notes" role="status"><h3>Case closed. What did we discover?</h3><p>Your labels supplied examples. Training adjusted weights to learn patterns. Those patterns produced bin scores—but even a confident robot can make a mistake.</p><button onClick={() => goTo(0)}>Investigate again</button></section>}
      <ExtraHelp title="Optional lab: experiment with weights" topic="weights" track={track}><WeightExperiment track={track} onActivity={onActivity} navigationKey={step} /></ExtraHelp>
    </>}
    <div className="detective-stage-back"><button onClick={onBack}>← Back: training</button></div>
  </section>
}
