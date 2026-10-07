import { useEffect, useState } from 'react'
import './ConveyorReplay.css'
import GuidedLesson from './GuidedLesson'

const bins = ['Recycling', 'Compost', 'Landfill']
const colors = ['#38bdf8', '#34d399', '#a5b4fc']
const layers = ['RGB image', 'Conv 16', 'Conv 32', 'Conv 64', 'Conv 64', 'Pool → 64']

function NetworkDiagram({ item, phase, revealed }) {
  const active = phase === 'Reading image' || revealed
  return <div className="cnn-diagram">
    <h3>Inside the image classifier</h3>
    <svg viewBox="0 0 860 170" role="img" aria-label="CNN schematic: RGB image, four convolution blocks, average pooling, and three class probabilities">
      {layers.slice(0, -1).map((_, index) => <path key={index}
        d={`M ${116 + index * 106} 80 H ${136 + index * 106}`}
        className={`signal-wire ${active ? 'signal-active' : ''}`} />)}
      {layers.map((label, index) => <g key={label}>
        <rect x={30 + index * 106} y="51" width="86" height="58" rx="10"
          className={`cnn-block ${active ? 'cnn-lit' : ''}`} />
        <text x={73 + index * 106} y="85" textAnchor="middle">{label}</text>
        {index > 0 && index < 5 && <text className="layer-detail" x={73 + index * 106} y="133" textAnchor="middle">ReLU + pool</text>}
      </g>)}
      {bins.map((category, index) => {
        const selected = revealed && category === item.predicted_class
        return <g key={category}>
          <path d={`M 646 80 L 693 ${35 + index * 50}`} className={`signal-wire ${selected ? 'signal-active' : ''}`} />
          <rect x="693" y={15 + index * 50} width="150" height="40" rx="10"
            fill={selected ? '#173c45' : '#101e36'} stroke={colors[index]} strokeWidth={selected ? 3 : 1} />
          <text x="704" y={40 + index * 50}>{category}</text>
          <text x="833" y={40 + index * 50} textAnchor="end">
            {revealed ? `${(item.probabilities[category] * 100).toFixed(1)}%` : '—'}
          </text>
        </g>
      })}
      <text className="layer-detail" x="763" y="169" textAnchor="middle">Softmax scores</text>
    </svg>
    <p className="lab-caption">Layer schematic. The animation illustrates the steps; scores come from the trained Python CNN.</p>
  </div>
}

export default function ConveyorReplay({ predictions }) {
  const [position, setPosition] = useState({ index: 0, progress: 0 })
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const finished = position.index >= predictions.length

  useEffect(() => {
    if (!playing || finished) return
    let frame
    let previous
    function tick(now) {
      const elapsed = previous === undefined ? 0 : Math.min(now - previous, 100)
      previous = now
      setPosition((current) => {
        if (current.index >= predictions.length) return current
        const progress = current.progress + elapsed * speed / 75
        return progress >= 100 ? { index: current.index + 1, progress: 0 } : { ...current, progress }
      })
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing, finished, speed, predictions.length])

  if (predictions.length === 0) return null
  const item = predictions[Math.min(position.index, predictions.length - 1)]
  const progress = finished ? 100 : position.progress
  const revealed = progress >= 65
  const phase = finished ? 'Replay complete' : progress < 35 ? 'On the belt' :
    progress < 65 ? 'Reading image' : progress < 82 ? 'Choosing a bin' : 'Routing item'
  const winner = bins.indexOf(item.predicted_class)
  const drop = Math.max(0, (progress - 82) / 18)
  const destination = 650 + winner * 84
  const itemX = progress < 82 ? 55 + (progress / 82) * 470 : 525 + drop * (destination - 525)
  const itemY = 124 + drop * 115
  const processed = finished ? predictions : predictions.slice(0, position.index)
  const agreements = processed.filter((row) => row.predicted_class === row.your_label).length

  function restart() {
    setPosition({ index: 0, progress: 0 })
    setPlaying(false)
  }

  return <section className={`conveyor-lab ${playing && !finished ? 'lab-running' : ''}`} aria-label="CNN conveyor replay">
    <header className="lab-header">
      <div><p className="lab-eyebrow">Stage 3 · Watch the CNN sort</p>
        <h2>From your labels to the sorting line</h2></div>
      <span className="lab-badge">Held-out test items</span>
    </header>
    <p className="lab-intro">Follow each drawing through image analysis, class scores, and the selected bin.
      These decisions use the best model from your training run.</p>

    <div className="conveyor-workspace"><div className="conveyor-stage">
    <NetworkDiagram item={item} phase={phase} revealed={revealed} />

    <div className="conveyor-toolbar">
      <strong>{finished ? 'All items replayed' : `Item ${position.index + 1} of ${predictions.length}`} · {phase}</strong>
      <div className="conveyor-controls">
        <button disabled={finished} onClick={() => setPlaying(!playing)}>{playing ? 'Pause' : 'Play'}</button>
        <button disabled={finished} onClick={() => {
          setPlaying(false)
          setPosition((current) => current.progress < 35 ? { ...current, progress: 35 } : current.progress < 65 ? { ...current, progress: 65 } :
            current.progress < 100 ? { ...current, progress: 100 } : { index: current.index + 1, progress: 0 })
        }}>Step</button>
        <button onClick={restart}>Replay</button>
        <label>Speed <select value={speed} onChange={(event) => setSpeed(Number(event.target.value))}>
          <option value={0.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option>
        </select></label>
      </div>
    </div>

    <div className="conveyor-viewport"><svg className="conveyor-scene" viewBox="0 0 900 305" role="img"
      aria-label={`${item.name}: ${phase}${revealed ? `, selected bin ${item.predicted_class}` : ''}`}>
      <defs><pattern id="belt-treads" width="28" height="24" patternUnits="userSpaceOnUse">
        <rect width="28" height="24" fill="#233851" /><rect width="12" height="24" fill="#49617c" />
      </pattern></defs>
      <text x="28" y="32" className="scene-label">AUTOMATED CONVEYOR</text>
      <rect x="10" y="180" width="575" height="26" rx="12" fill="#0a1224" stroke="#536983" />
      <svg x="14" y="182" width="568" height="22" aria-hidden="true">
        <rect className="moving-treads" x="-28" width="650" height="24" fill="url(#belt-treads)" />
      </svg>
      {[35, 135, 235, 335, 435, 555].map((x) => <circle key={x} cx={x} cy="216" r="9" fill="#17283f" stroke="#49617c" />)}
      <path d="M 290 180 V 62 H 350 V 180" fill="none" stroke={phase === 'Reading image' ? '#67e8f9' : '#3d536e'} strokeWidth="5" />
      <rect x="277" y="40" width="87" height="32" rx="7" fill="#142c42" stroke="#67e8f9" />
      <text x="320" y="61" textAnchor="middle">Camera</text>
      <path className={phase === 'Reading image' ? 'camera-beam active-beam' : 'camera-beam'} d="M 311 73 L 289 178 H 350 L 329 73 Z" />
      <text x="535" y="78" className="scene-label">{revealed ? `Gate: ${item.predicted_class}` : 'Waiting for image analysis'}</text>
      {bins.map((category, index) => <g key={category}>
        <path d={`M 585 193 Q ${650 + index * 84} 193 ${650 + index * 84} 238`}
          fill="none" stroke={revealed && index === winner ? colors[index] : '#30425b'} strokeWidth={revealed && index === winner ? 4 : 2} />
        <rect x={613 + index * 84} y="238" width="74" height="50" rx="8"
          fill={revealed && index === winner ? '#193447' : '#101e36'}
          stroke={revealed && index === winner ? colors[index] : '#30425b'} strokeWidth="2" />
        <text x={650 + index * 84} y="269" textAnchor="middle" fill={colors[index]}>{category}</text>
      </g>)}
      {!finished && <g transform={`translate(${itemX - 27}, ${itemY - 27})`}>
        <image href={item.image} width="54" height="54" />
      </g>}
    </svg></div>

    <div className="decision-layout">
      <div><h3>{item.name}</h3>
        <p className="decision-summary" aria-live="polite">{revealed ?
          `${item.predicted_class} · ${(item.confidence * 100).toFixed(1)}% model score` : 'Image approaches the camera…'}</p>
        <p className="lab-caption">Your label: <strong>{item.your_label}</strong>
          {revealed && (item.your_label === item.predicted_class ? ' · Matches your label' : ' · Differs from your label')}</p>
      </div>
      <div className="class-scores">{bins.map((category, index) => <div key={category}>
        <div className="score-label"><span>{category}</span><strong>{revealed ? `${(item.probabilities[category] * 100).toFixed(1)}%` : '—'}</strong></div>
        <div className="score-track"><div style={{ width: `${revealed ? item.probabilities[category] * 100 : 0}%`, background: colors[index] }} /></div>
      </div>)}</div>
    </div>
    <p className="lab-caption">Replayed: {processed.length} / {predictions.length} · Matches your labels: {agreements} / {processed.length}.
      Scores are averaged across the original test image and its augmented views; this replay does not retrain the model.</p>
    </div>
    <GuidedLesson item={item} step={progress < 35 ? 0 : progress < 65 ? 1 : progress < 100 ? 2 : 3}
      onStep={(step) => { setPlaying(false); setPosition({ index: Math.min(position.index, predictions.length - 1), progress: [0, 35, 65, 100][step] }) }} />
    </div>
  </section>
}
