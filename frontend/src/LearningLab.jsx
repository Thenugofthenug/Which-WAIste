import { useState } from 'react'
import { api } from './api'
import { BINS, COLORS } from './gameEngine'

const percent = value => `${(value * 100).toFixed(1)}%`

export function Network({ viz }) {
  if (!viz) return <p className="muted">Train the CNN to see real filter responses and connections here.</p>
  const point = (layer, node) => [65 + layer * 162, 72 + node * 30 + (6 - viz.layers[layer].labels.length) * 15]
  return <figure className="network-figure"><svg viewBox="0 0 1040 290" role="img" aria-label="CNN responses from RGB through four convolution blocks to class scores">
    {viz.edges.map((matrix, layer) => {
      const max = Math.max(...matrix.flat().map(Math.abs), .000001)
      return matrix.flatMap((row, source) => row.map((weight, dest) => {
        const [x1, y1] = point(layer, source), [x2, y2] = point(layer + 1, dest)
        return <line key={`${layer}-${source}-${dest}`} x1={x1 + 26} y1={y1} x2={x2 - 26} y2={y2}
          stroke={weight >= 0 ? '#00e436' : '#ff004d'} opacity={.08 + .65 * Math.abs(weight) / max * viz.layers[layer].level[source]} />
      }))
    })}
    {viz.layers.map((layer, i) => <g key={i}><text x={65 + i * 162} y="25" textAnchor="middle" fill="#ffec27" fontSize="14">{i === 0 ? 'RGB INPUT' : i === 5 ? 'SOFTMAX' : `BLOCK ${i}`}</text>
      {layer.labels.map((label, j) => { const [x, y] = point(i, j)
        return <g key={label}><rect x={x - 26} y={y - 12} width="52" height="24" fill={i === 5 ? COLORS[j] : '#008751'}
          fillOpacity={.2 + .8 * layer.level[j]} stroke="#c2c3c7" strokeWidth="2" /><text x={x} y={y + 4} fill="#fff1e8" textAnchor="middle" fontSize="11">{i === 5 ? percent(layer.raw[j]) : label}</text>
          {i === 5 && <text x={x + 36} y={y + 4} fill={COLORS[j]} fontSize="13">{label}</text>}</g>
      })}</g>)}
  </svg><figcaption>Real responses on the original image. Top channels only. Lines summarize kernel weights and batch normalization; they do not explain the entire decision.</figcaption></figure>
}

function Curve({ history, loss = false }) {
  const keys = loss ? ['train_loss', 'val_loss'] : ['train_acc', 'val_acc']
  const maxY = loss ? Math.max(1, ...history.flatMap(row => keys.map(key => row[key]))) : 1
  const maxX = Math.max(3, ...history.map(row => row.epoch))
  return <figure className="curve"><h3>{loss ? 'Prediction error (loss)' : 'Matches to labels (accuracy)'}</h3>
    <svg viewBox="0 0 430 180" role="img" aria-label={`${loss ? 'Loss' : 'Accuracy'} by epoch; training green, validation amber`}>
      {[0, .5, 1].map(level => <g key={level}><path d={`M42 ${140 - level * 115} H415`} stroke="#2e4c38" strokeDasharray="3 4" /><text x="35" y={144 - level * 115} textAnchor="end" fill="#a3b9aa" fontSize="11">{loss ? (maxY * level).toFixed(1) : `${level * 100}%`}</text></g>)}
      {keys.map((key, i) => <polyline key={key} fill="none" stroke={i ? '#ffcc80' : '#69f58e'} strokeWidth="3" points={history.map(row => `${42 + row.epoch / maxX * 373},${140 - row[key] / maxY * 115}`).join(' ')} />)}
      <text x="42" y="164" fill="#a3b9aa" fontSize="11">0</text><text x="415" y="164" fill="#a3b9aa" textAnchor="end" fontSize="11">Epoch {maxX}</text>
    </svg><figcaption><span className="train-key">■ Training</span> <span className="val-key">■ Validation</span>{!history.length && ' · Waiting for training'}</figcaption></figure>
}

function Scores({ values }) {
  return <div className="scores">{BINS.map((bin, i) => <div key={bin}><span>{bin}</span><meter min="0" max="1" value={values[i]} aria-label={`${bin} model score`} /><b style={{ color: COLORS[i] }}>{percent(values[i])}</b></div>)}</div>
}

function WeightExperiment() {
  const [response, setResponse] = useState(.8), [weight, setWeight] = useState(1)
  const exponentials = [.7, response * weight, .5].map(value => Math.exp(value))
  const total = exponentials.reduce((a, b) => a + b)
  return <section className="inset"><h3>Play with a weight</h3><p className="muted">A tiny illustrative model. These sliders do not change the real CNN.</p>
    <label>Pattern response: {response.toFixed(1)}<input type="range" min="0" max="1" step=".1" value={response} onChange={e => setResponse(Number(e.target.value))} /></label>
    <label>Weight toward Compost: {weight.toFixed(1)}<input type="range" min="-3" max="3" step=".1" value={weight} onChange={e => setWeight(Number(e.target.value))} /></label>
    <p>Response × weight = {(response * weight).toFixed(2)}</p><Scores values={exponentials.map(value => value / total)} />
    <details><summary>Try this + extra help</summary><p>Make Compost the highest score, then lower it. What happens with a negative weight or a zero response? Recycling and Landfill start at 0.7 and 0.5. Softmax turns the three values into scores adding to 100%.</p></details></section>
}

export default function LearningLab({ game, setGame, view, saving, help }) {
  const [epochs, setEpochs] = useState(3), [rate, setRate] = useState(-3)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [index, setIndex] = useState(0), [step, setStep] = useState(0), [fresh, setFresh] = useState(null)
  const training = game.training, results = training.results
  const item = results?.predictions[Math.min(index, results.predictions.length - 1)]
  async function train() {
    setError(''); setBusy(true); setFresh(null)
    try {
      await api(`/sessions/${game.id}/train`, { epochs, learning_rate: 10 ** rate })
      setGame(current => ({ ...current, training: { ...current.training, status: 'running', history: [], epochs } }))
    } catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }
  async function tryItem(novel) {
    setBusy(true); setError('')
    try { setFresh(await api(`/sessions/${game.id}/try-item?novel=${novel}`, {})) }
    catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }
  if (view === 'explore') return <section className="pixel-panel lab-panel"><div className="section-heading"><div><p className="eyebrow">Mission 3 · Explore the decision</p><h2>What did our robot learn?</h2></div><button onClick={help}>? Field guide</button></div>
    {!item ? <p>Complete training to look inside the CNN.</p> : <>
      <label>Choose a held-out item <select value={index} onChange={e => { setIndex(Number(e.target.value)); setFresh(null) }}>{results.predictions.map((p, i) => <option key={i} value={i}>{p.name}</option>)}</select></label>
      <div className="explore-grid"><aside className="inset filters-box"><h3>Filters & feature maps</h3><p className="muted">Real responses to {item.name}. Each map is scaled to its own maximum.</p>
        <div className="feature-layers">{item.inspection.layers.map(layer => <section key={layer.name}><b>{layer.name}</b><small>{layer.shape.join(' × ')}</small><div>{layer.maps.map(map => <figure key={map.channel}><img src={map.image} alt={`${layer.name} channel ${map.channel} response`} /><figcaption>F{map.channel}</figcaption></figure>)}</div></section>)}</div>
        <details><summary>What do these pictures mean?</summary><p>Two channels per block are selected by average response. Brighter means stronger within that map. Brightness cannot be compared across maps. These are activation maps, not human concepts or a complete explanation.</p></details></aside>
        <div><Network viz={item.viz} /><div className="lesson-steps">{['Pixels', 'Patterns', 'Scores', 'Decision'].map((label, i) => <button key={label} aria-pressed={step === i} onClick={() => setStep(i)}>{i + 1}. {label}</button>)}</div>
          <article className="inset lesson-content" aria-live="polite">{step === 0 && <><h3>Pixels become numbers</h3><div className="pixel-example"><img src={item.inspection.input_image} alt={`64 by 64 model input: ${item.name}`} /><p>Center RGB: {item.inspection.rgb.join(', ')}<br />Normalized: {item.inspection.normalized.join(', ')}</p></div><p>The CNN sees color values, not the item's name. Values are scaled to −1–1.</p></>}
            {step === 1 && <><h3>Layers respond to patterns</h3><p>Filters respond across the image. ReLU keeps positive responses; pooling shrinks the grids. Later layers combine earlier responses. Explore the actual maps in the filters box.</p></>}
            {step === 2 && <><h3>Same test item, before and after</h3><div className="comparison"><section><h4>Before</h4><Scores values={item.before} /></section><section><h4>After</h4><Scores values={item.probabilities} /></section></div><p>Scores average the same image and augmented views. The layer diagram shows the original image. A high score can still be wrong.</p></>}
            {step === 3 && <><h3>Highest score chooses a bin</h3><p>Model: <b>{BINS[item.probabilities.indexOf(Math.max(...item.probabilities))]}</b> · Your label: <b>{item.label}</b> · Guideline: {item.guideline}.</p><p>Matching a student label is different from proving the correct recycling rule. Which label would you trust?</p></>}</article>
        </div></div>
      <div className="try-grid"><WeightExperiment /><section className="inset"><h3>Try new items</h3><p>Will the robot handle a new drawing—or an item outside its three categories?</p><div className="button-row"><button disabled={busy} onClick={() => tryItem(false)}>Familiar type</button><button disabled={busy} onClick={() => tryItem(true)}>Never-seen type</button></div>
        {fresh && <><div className="fresh-item"><img src={fresh.image} alt={fresh.name} /><div><h4>{fresh.name}</h4><Scores values={fresh.probabilities} /><p>Common destination: {fresh.destination}</p></div></div><p>{fresh.has_valid_bin ? 'This drawing was not in the training dataset. Compare its prediction with the common destination.' : 'None of the model’s bins is suitable! It still has to choose one. Confidence does not create a missing category.'}</p><Network viz={fresh.viz} /></>}</section></div>
    </>}{error && <p className="error" role="alert">{error}</p>}</section>

  return <section className="pixel-panel lab-panel"><div className="section-heading"><div><p className="eyebrow">Mission 2 · Teach the robot</p><h2>Did our robot improve?</h2></div><button onClick={help}>? Field guide</button></div>
    <div className="training-grid"><section className="inset training-controls"><h3>Controls</h3>
      <label>Training run <select value={epochs} disabled={busy || training.status === 'running'} onChange={e => setEpochs(Number(e.target.value))}><option value="3">3 epochs · quick run</option><option value="10">10 epochs</option><option value="50">50 epochs · full run</option></select></label>
      <label title="Controls the size of weight updates.">Learning rate: {(10 ** rate).toExponential(1)}<input type="range" min="-4" max="-1" step=".1" value={rate} disabled={training.status === 'running'} onChange={e => setRate(Number(e.target.value))} /></label>
      <button className="green" disabled={saving || busy || training.status === 'running'} onClick={train}>{training.status === 'running' ? 'Robot is learning…' : results ? 'Train again' : 'Start training'}</button>
      <p className="status" role="status">{training.status === 'running' ? `Epoch ${training.history.length} / ${training.epochs}` : training.status.toUpperCase()}</p>
      <p>{game.summary.missed} misses excluded. Split before augmentation.</p>
      {results && <><p>Train {results.split.train} · Val {results.split.validation} · Test {results.split.test}</p><p className="accuracy-result">{percent(results.before_accuracy)} → {percent(results.test_accuracy)}</p><p>Same held-out test views. Best epoch: {results.best_epoch}.</p></>}
    </section><div className="graph-grid"><Curve history={training.history} /><Curve history={training.history} loss /></div></div>
    {(error || training.error) && <p className="error" role="alert">{error || training.error}</p>}
    <p className="education-note">Game points and accuracy measure different things. The CNN learns your labels, including incorrect ones. Higher test accuracy is not guaranteed.</p><Network viz={training.probe?.viz || item?.viz} />
    <details><summary>View epoch values and extra help</summary><div className="table-scroll"><table><thead><tr>{['Epoch', 'Train loss', 'Validation loss', 'Train accuracy', 'Validation accuracy'].map(title => <th key={title}>{title}</th>)}</tr></thead><tbody>{training.history.map(row => <tr key={row.epoch}><td>{row.epoch}</td><td>{row.train_loss.toFixed(3)}</td><td>{row.val_loss.toFixed(3)}</td><td>{percent(row.train_acc)}</td><td>{percent(row.val_acc)}</td></tr>)}</tbody></table></div><p>Training updates weights. Validation selects the best model. Test examples stay out of both. If validation gets worse while training improves, the model may be overfitting.</p></details>
  </section>
}
