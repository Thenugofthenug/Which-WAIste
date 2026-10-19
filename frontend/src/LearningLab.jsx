import { useEffect, useRef, useState } from 'react'
import { api } from './api'
import HomeRobot from './HomeRobot'
import EpochFlow from './EpochFlow'
import DatasetSummary from './DatasetSummary'
import RobotDetective, { Network } from './RobotDetective'

const percent = value => `${(value * 100).toFixed(1)}%`

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

export default function LearningLab({ game, setGame, view, saving, track, onRateSettled }) {
  const [epochs, setEpochs] = useState(3), [rate, setRate] = useState(-3)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const training = game.training, results = training.results
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
  useEffect(() => {
    if (view !== 'train') flushRate()
  }, [view])
  useEffect(() => () => flushRate(), [])
  async function train() {
    flushRate()
    setError(''); setBusy(true)
    try {
      await api(`/sessions/${game.id}/train`, { epochs, learning_rate: 10 ** rate })
      setGame(current => ({ ...current, training: { ...current.training, status: 'running', history: [], epochs } }))
    } catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }
  if (view === 'explore') return <RobotDetective game={game} track={track} />

  return <section className="pixel-panel lab-panel training-panel" aria-label="Train">
    <div className="lab-top-padding">
      <DatasetSummary game={game} />
      <p className="lab-epoch-note"><span>*Visualization of a Neural Network gong through it's EPOCHS * Each  EPOCH allows for the ROBOT to see every item once*</span></p>
    </div>
    <div className="section-heading training-heading"><div className="robot-desk-stage">
    <HomeRobot variant="heading" />
    <svg className="robot-table" viewBox="0 0 180 32" aria-hidden="true">
      <path d="M8 8H24V30H16V16H8ZM156 8H172V16H164V30H156Z" fill="#5f574f" stroke="#c2c3c7" strokeWidth="2" />
      <path d="M8 1H172V5H179V12H1V5H8Z" fill="#5f574f" stroke="#c2c3c7" strokeWidth="2" />
    </svg>
  </div>{view === 'train' && <EpochFlow game={game} />}</div>
    <div className="training-grid"><section className="inset training-controls"><h3>Controls</h3>
      <label>Training run <select value={epochs} disabled={busy || training.status === 'running'} onChange={e => setEpochs(Number(e.target.value))}><option value="3">3 epochs · quick run</option><option value="10">10 epochs</option><option value="50">50 epochs · full run</option></select></label>
      <label title="Controls the size of weight updates.">Learning rate: {(10 ** rate).toExponential(1)}<input type="range" min="-4" max="-1" step=".1" value={rate} disabled={training.status === 'running'} onChange={e => changeRate(Number(e.target.value))} /></label>
      <button className="green training-button" disabled={saving || busy || training.status === 'running'} onClick={train}>{training.status === 'running' ? 'Robot is learning…' : training.status === 'done' || results ? 'RE-TRAIN' : 'Start training'}</button>
      {training.status !== 'done' && <p className="status" role="status">{training.status === 'running' ? `Epoch ${training.history.length} / ${training.epochs}` : training.status.toUpperCase()}</p>}
      {results && <><p className="accuracy-result">{percent(results.before_accuracy)} → {percent(results.test_accuracy)}</p><p>Same held-out test views. Best epoch: {results.best_epoch}.</p></>}
    </section><div className="graph-grid"><Curve history={training.history} /><Curve history={training.history} loss /></div></div>
    {(error || training.error) && <p className="error" role="alert">{error || training.error}</p>}
    <p className="education-note">Game points and accuracy measure different things. The CNN learns your labels, including incorrect ones. Higher test accuracy is not guaranteed.</p><Network viz={training.probe?.viz || item?.viz} />
    <details><summary>View epoch values and extra help</summary><div className="table-scroll"><table><thead><tr>{['Epoch', 'Train loss', 'Validation loss', 'Train accuracy', 'Validation accuracy'].map(title => <th key={title}>{title}</th>)}</tr></thead><tbody>{training.history.map(row => <tr key={row.epoch}><td>{row.epoch}</td><td>{row.train_loss.toFixed(3)}</td><td>{row.val_loss.toFixed(3)}</td><td>{percent(row.train_acc)}</td><td>{percent(row.val_acc)}</td></tr>)}</tbody></table></div><p>Training updates weights. Validation selects the best model. Test examples stay out of both. If validation gets worse while training improves, the model may be overfitting.</p></details>
  </section>
}
