import { useEffect, useRef, useState } from 'react'
import { api } from './api'
import EpochFlow from './EpochFlow'
import DatasetSummary from './DatasetSummary'
import RobotDetective, { Network } from './RobotDetective'
import './TrainingLab.css'

const percent = value => `${(value * 100).toFixed(1)}%`
const rateLabel = exponent => Number.isFinite(exponent) ? (10 ** exponent).toExponential(1) : 'not recorded here'

function Help({ title, topic, track, children }) {
  return <details className="training-help" onToggle={event => {
    if (event.target === event.currentTarget && event.currentTarget.open) track?.(topic)
  }}><summary>{title}</summary>{children}</details>
}

function Curve({ history, loss = false, selected, onSelect }) {
  const keys = loss ? ['train_loss', 'val_loss'] : ['train_acc', 'val_acc']
  const maxY = loss ? Math.max(1, ...history.flatMap(row => keys.map(key => row[key]))) : 1
  const maxX = Math.max(3, ...history.map(row => row.epoch))
  const x = epoch => 42 + epoch / maxX * 373
  const y = value => 140 - value / maxY * 115
  return <figure className="curve"><h3>{loss ? 'Smaller mistakes ↓' : 'More label matches ↑'} <small>{loss ? 'Loss' : 'Accuracy'}</small></h3>
    <svg viewBox="0 0 430 180" role="group" aria-label={`${loss ? 'Loss' : 'Accuracy'} by epoch; training is a cyan solid line, validation is a gold dashed line. Select a point to review a completed round.`}>
      {[0, .5, 1].map(level => <g key={level}><path d={`M42 ${140 - level * 115} H415`} stroke="#625b8e" strokeDasharray="3 4" /><text x="35" y={144 - level * 115} textAnchor="end" fill="#c2bbd6" fontSize="11">{loss ? (maxY * level).toFixed(1) : `${level * 100}%`}</text></g>)}
      {selected && <path className="epoch-cursor" data-epoch={selected.epoch} d={`M${x(selected.epoch)} 20 V145`} stroke="#fff1d6" strokeDasharray="2 4" />}
      {keys.map((key, i) => <polyline key={key} fill="none" stroke={i ? '#ffd66b' : '#75e5f5'} strokeWidth="3" strokeDasharray={i ? '8 5' : undefined} points={history.map(row => `${x(row.epoch)},${y(row[key])}`).join(' ')} />)}
      {history.map(row => <g className="epoch-point" key={row.epoch} role="button" tabIndex="0" aria-label={`Review epoch ${row.epoch} on ${loss ? 'loss' : 'accuracy'} graph`} aria-pressed={selected?.epoch === row.epoch}
        onClick={() => onSelect(row.epoch)} onKeyDown={event => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); onSelect(row.epoch) } }}>
        <title>Round {row.epoch}: training {loss ? row.train_loss.toFixed(3) : percent(row.train_acc)}, validation {loss ? row.val_loss.toFixed(3) : percent(row.val_acc)}</title>
        <rect x={x(row.epoch) - 7} y="16" width="14" height="131" fill="transparent" />
        {keys.map((key, i) => <circle key={key} cx={x(row.epoch)} cy={y(row[key])} r={selected?.epoch === row.epoch ? 5 : 3} fill={i ? '#ffd66b' : '#75e5f5'} stroke="#17162c" />)}
      </g>)}
      <text x="42" y="164" fill="#c2bbd6" fontSize="11">0</text><text x="415" y="164" fill="#c2bbd6" textAnchor="end" fontSize="11">Epoch {maxX}</text>
    </svg><figcaption><span className="train-key">Training · solid</span> <span className="val-key">Validation · dashed</span>{!history.length && ' · Waiting for a completed round'}</figcaption></figure>
}

function RunResult({ results, baseline, settings }) {
  const comparing = baseline && results !== baseline.results
  return <section className="training-result-card" aria-label="Training result">
    <div><p className="eyebrow">Hidden test check</p><h3>{percent(results.before_accuracy)} → {percent(results.test_accuracy)}</h3><p>Before → after this run. Same hidden test views. Best practice round: {results.best_epoch}.</p></div>
    {comparing && <div className="training-run-comparison" aria-label="Compare completed runs">
      <p><b>Run A</b><strong>{percent(baseline.results.test_accuracy)}</strong><span>{baseline.settings.epochs} rounds · step {rateLabel(baseline.settings.rate)}</span></p>
      <p><b>Run B</b><strong>{percent(results.test_accuracy)}</strong><span>{settings.epochs} rounds · step {rateLabel(settings.rate)}</span></p>
      <p className="training-comparison-note">Same labeled dataset and test views; each run starts a fresh model. Random learning can also change the result. One comparison cannot prove which setting is best.</p>
    </div>}
  </section>
}

export default function LearningLab({ game, setGame, view, saving, track, onRateSettled, onActivity, onNext, onBack }) {
  const [epochs, setEpochs] = useState(game.training.epochs || 3), [rate, setRate] = useState(game.training.learning_rate ? Math.log10(Number(game.training.learning_rate)) : -3)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [reviewEpoch, setReviewEpoch] = useState(null), [goal, setGoal] = useState(null)
  const [baseline, setBaseline] = useState(null)
  const [runSettings, setRunSettings] = useState({ epochs: game.training.epochs || 3, rate: game.training.learning_rate ? Math.log10(Number(game.training.learning_rate)) : null })
  const training = game.training, results = training.results, running = training.status === 'running'
  const history = training.history || []
  const selected = history.find(row => row.epoch === reviewEpoch) || history.at(-1)
  const selectedIndex = history.indexOf(selected)
  const item = results?.predictions[0]
  const rateTimer = useRef(null), pendingRate = useRef(null), recordRate = useRef(onRateSettled)
  useEffect(() => { recordRate.current = onRateSettled }, [onRateSettled])
  function flushRate() {
    clearTimeout(rateTimer.current)
    if (pendingRate.current !== null) {
      recordRate.current?.(pendingRate.current)
      pendingRate.current = null
    }
  }
  function changeRate(exponent) {
    setRate(exponent)
    pendingRate.current = exponent
    clearTimeout(rateTimer.current)
    rateTimer.current = setTimeout(flushRate, 700)
  }
  useEffect(() => { if (view !== 'train') flushRate() }, [view])
  useEffect(() => () => flushRate(), [])
  function selectEpoch(epoch) {
    if (!history.some(row => row.epoch === epoch)) return
    setReviewEpoch(epoch)
    if (reviewEpoch !== epoch) onActivity?.({ kind: 'epoch_review', epoch })
  }
  function chooseGoal(next) {
    setGoal(next)
    if (next === 'more_practice' && runSettings.rate !== null) changeRate(runSettings.rate)
    if (next === 'step_size') setEpochs(runSettings.epochs)
    if (goal !== next) onActivity?.({ kind: 'training_plan', goal: next })
  }
  async function train() {
    flushRate()
    setError(''); setBusy(true)
    try {
      await api(`/sessions/${game.id}/train`, { epochs, learning_rate: 10 ** rate })
      if (results) setBaseline({ results, settings: runSettings })
      setRunSettings({ epochs, rate }); setReviewEpoch(null)
      setGame(current => ({ ...current, training: { ...current.training, status: 'running', history: [], results: null, probe: null, error: null, epochs, learning_rate: 10 ** rate } }))
    } catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }
  if (view === 'explore') return <RobotDetective game={game} track={track} onActivity={onActivity} onBack={onBack} />

  return <section className="pixel-panel lab-panel training-panel guided-training" aria-label="Train">
    <header className="lab-mission-intro"><p className="eyebrow">Step 02 / Train</p><h2>Teach your robot</h2><p>Your mission: train once, inspect a practice round, then test what your robot learned.</p></header>
    <DatasetSummary game={game} />
    <div className="training-grid">
      <section className="inset training-controls"><p className="eyebrow">1 / Set up a practice run</p><h3>Ready to practice?</h3><p>{results ? 'You can stop here, or change one setting and compare runs.' : 'Start with 3 rounds. Your robot learns from your labels, including mistakes.'}</p>
        <label>Practice rounds <small>Scientific name: epochs</small><select value={epochs} disabled={busy || running || (!!results && goal === 'step_size')} onChange={e => setEpochs(Number(e.target.value))}><option value="3">3 rounds · quick run</option><option value="10">10 rounds</option><option value="50">50 rounds · full run</option></select></label>
        <label>Learning step size: {(10 ** rate).toExponential(1)}<small>Scientific name: learning rate</small><input type="range" min="-4" max="-1" step=".1" value={rate} disabled={busy || running || (!!results && goal === 'more_practice')} onChange={e => changeRate(Number(e.target.value))} /></label>
        <button className="green training-button" disabled={saving || busy || running} onClick={train}>{running ? 'Robot is learning…' : results ? 'Train again' : 'Train your robot'}</button>
        <p className="status" role="status">{running ? `${history.length} / ${training.epochs} rounds complete${history.length ? '' : ' · preparing the first round'}` : results ? 'Practice complete! Inspect a round or go straight to testing.' : 'Ready when you are.'}</p>
        {results && <div className="training-plan"><p className="eyebrow">Optional / Change one thing</p><p>Pick a question for a second run, or continue to testing.</p><div role="group" aria-label="Choose a training experiment"><button aria-pressed={goal === 'more_practice'} onClick={() => chooseGoal('more_practice')}>Do more rounds help?</button><button aria-pressed={goal === 'step_size'} onClick={() => chooseGoal('step_size')}>Does step size matter?</button></div><p className="muted">{goal === 'more_practice' ? 'Change the rounds above; keep step size the same. Then train again and compare.' : goal === 'step_size' ? 'Move the step-size slider; keep the rounds the same. Then train again and compare.' : 'Choose one setting to change. A higher score is not guaranteed.'}</p></div>}
      </section>
      <div className="training-evidence">
        <div className="training-evidence-heading"><div><p className="eyebrow">2 / Inspect a round</p><h3>What changed while it practiced?</h3></div><span className="training-live-status">{running && reviewEpoch === null ? 'LIVE · latest completed round' : selected ? `Reviewing round ${selected.epoch}` : 'Graphs appear after round 1'}</span></div>
        <div className="graph-grid"><Curve history={history} selected={selected} onSelect={selectEpoch} /><Curve history={history} selected={selected} onSelect={selectEpoch} loss /></div>
        <div className="training-epoch-review" aria-label="Review completed practice rounds"><button disabled={selectedIndex <= 0} onClick={() => selectEpoch(history[selectedIndex - 1].epoch)} aria-label="Previous completed round">←</button><label>Round <strong>{selected?.epoch || '–'}</strong><input aria-label="Completed round to inspect" type="range" min="0" max={Math.max(0, history.length - 1)} step="1" value={Math.max(0, selectedIndex)} disabled={!history.length} onChange={e => selectEpoch(history[Number(e.target.value)].epoch)} /></label><button disabled={selectedIndex < 0 || selectedIndex >= history.length - 1} onClick={() => selectEpoch(history[selectedIndex + 1].epoch)} aria-label="Next completed round">→</button><button disabled={!history.length || reviewEpoch === null} onClick={() => setReviewEpoch(null)}>{running ? 'Follow live' : 'Latest round'}</button></div>
        <div className="training-discovery-grid"><EpochFlow game={game} selected={selected} live={running && reviewEpoch === null} />
          <aside className="training-reading-guide inset" aria-label="Help reading the training graphs"><h3>Look for a pattern</h3><p>Do both lines improve together, or start to move apart? Select any completed round on either graph.</p>
            <Help title="Why are there two lines?" topic="testing" track={track}><p>The solid line checks training pictures: examples that update weights. The dashed line checks validation pictures: a separate share that does not update weights. It helps choose the best practice round.</p></Help>
            <Help title="What do accuracy and loss mean?" topic="accuracy" track={track}><p>Accuracy counts how often the highest bin score matches a label. Loss measures how far the scores are from that label. We want more matches and smaller mistakes. Neither curve measures your game points.</p></Help>
            <Help title="What if the lines move apart?" topic="learning" track={track}><p>If training improves but validation gets worse, the robot may be memorizing its practice examples. This is called overfitting. More practice does not always help.</p></Help>
            <Help title="What does step size change?" topic="weights" track={track}><p>The learning rate controls how much a weight can change with each update. A tiny step can learn slowly; a large step can jump past a useful answer. The best value depends on the task.</p></Help>
          </aside>
        </div>
      </div>
    </div>
    {results && <RunResult results={results} baseline={baseline} settings={runSettings} />}
    {(error || training.error) && <p className="error" role="alert">{error || training.error}</p>}
    <details className="training-deeper" onToggle={event => { if (event.target === event.currentTarget && event.currentTarget.open) track?.('weights') }}><summary>Look deeper: inside the neural network</summary><Network viz={training.probe?.viz || item?.viz} /><p>Real response snapshot from the latest available probe. It is not a recording of the selected epoch. Each block responds to picture patterns; training changes the connecting weights.</p></details>
    <details><summary>View epoch values and extra help</summary><div className="table-scroll"><table><thead><tr>{['Epoch', 'Train loss', 'Validation loss', 'Train accuracy', 'Validation accuracy'].map(title => <th key={title}>{title}</th>)}</tr></thead><tbody>{history.map(row => <tr key={row.epoch} aria-current={selected?.epoch === row.epoch ? 'true' : undefined}><td><button onClick={() => selectEpoch(row.epoch)} aria-label={`Review epoch ${row.epoch} from table`}>{row.epoch}</button></td><td>{row.train_loss.toFixed(3)}</td><td>{row.val_loss.toFixed(3)}</td><td>{percent(row.train_acc)}</td><td>{percent(row.val_acc)}</td></tr>)}</tbody></table></div><p>Training updates weights. Validation selects the best model. Test examples stay out of both. Test accuracy checks your labels; matching a label and following a recycling guideline can be different things.</p></details>
    <footer className="lab-stage-navigation"><button onClick={onBack}>← Back: sorting</button><p role="status">{training.status === 'done' ? '3 / Try your robot on test pictures. A second training run is optional.' : running ? 'Your robot is practicing. Testing unlocks when this run finishes.' : 'Train your robot to unlock the final step.'}</p><button className="green" disabled={busy || training.status !== 'done'} onClick={onNext}>Next: test your robot →</button></footer>
  </section>
}
