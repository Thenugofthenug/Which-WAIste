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
  return <figure className="curve"><h3>{loss ? 'How far off is it? (loss)' : 'How often does it match? (accuracy)'}</h3>
    <svg viewBox="0 0 430 180" role="img" aria-label={`${loss ? 'Loss' : 'Accuracy'} by epoch; training is a cyan solid line, validation is a gold dashed line`}>
      {[0, .5, 1].map(level => <g key={level}><path d={`M42 ${140 - level * 115} H415`} stroke="#625b8e" strokeDasharray="3 4" /><text x="35" y={144 - level * 115} textAnchor="end" fill="#c2bbd6" fontSize="11">{loss ? (maxY * level).toFixed(1) : `${level * 100}%`}</text></g>)}
      {keys.map((key, i) => <polyline key={key} fill="none" stroke={i ? '#ffd66b' : '#75e5f5'} strokeWidth="3" strokeDasharray={i ? '8 5' : undefined} points={history.map(row => `${42 + row.epoch / maxX * 373},${140 - row[key] / maxY * 115}`).join(' ')} />)}
      <text x="42" y="164" fill="#c2bbd6" fontSize="11">0</text><text x="415" y="164" fill="#c2bbd6" textAnchor="end" fontSize="11">Epoch {maxX}</text>
    </svg><figcaption><span className="train-key">Training · solid</span> <span className="val-key">Validation · dashed</span>{!history.length && ' · Waiting for training'}</figcaption></figure>
}

export default function LearningLab({ game, setGame, view, saving, track, onRateSettled, onNext, onBack }) {
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
  if (view === 'explore') return <RobotDetective game={game} track={track} onBack={onBack} />

  return <section className="pixel-panel lab-panel training-panel" aria-label="Train">
    <header className="lab-mission-intro"><p className="eyebrow">Step 02 / Train</p><h2>Teach your robot</h2><p>You supplied examples and labels. Now the robot practices finding patterns in them.</p></header>
    <div className="lab-top-padding">
      <DatasetSummary game={game} />
      <p className="lab-epoch-note"><span>ONE EPOCH = ONE PRACTICE ROUND · Watch the robot review your labeled examples.</span></p>
    </div>
    <div className="section-heading training-heading"><div className="robot-desk-stage">
    <HomeRobot variant="heading" />
    <svg className="robot-table" viewBox="0 0 180 32" aria-hidden="true">
      <path d="M8 8H24V30H16V16H8ZM156 8H172V16H164V30H156Z" fill="#5f574f" stroke="#c2c3c7" strokeWidth="2" />
      <path d="M8 1H172V5H179V12H1V5H8Z" fill="#5f574f" stroke="#c2c3c7" strokeWidth="2" />
    </svg>
  </div>{view === 'train' && <EpochFlow game={game} />}</div>
    <div className="training-grid"><section className="inset training-controls"><h3>Ready to practice?</h3><p>Start with 3 rounds. Then test whether the robot learned useful patterns.</p>
      <label>Practice rounds <small>Scientific name: epochs</small><select value={epochs} disabled={busy || training.status === 'running'} onChange={e => setEpochs(Number(e.target.value))}><option value="3">3 rounds · quick run</option><option value="10">10 rounds</option><option value="50">50 rounds · full run</option></select></label>
      <label title="Controls the size of weight updates.">Learning step size: {(10 ** rate).toExponential(1)}<small>Scientific name: learning rate</small><input type="range" min="-4" max="-1" step=".1" value={rate} disabled={training.status === 'running'} onChange={e => changeRate(Number(e.target.value))} /></label>
      <button className="green training-button" disabled={saving || busy || training.status === 'running'} onClick={train}>{training.status === 'running' ? 'Robot is learning…' : training.status === 'done' || results ? 'Train again' : 'Train your robot'}</button>
      {training.status !== 'done' && <p className="status" role="status">{training.status === 'running' ? `Epoch ${training.history.length} / ${training.epochs}` : training.status.toUpperCase()}</p>}
      {results && <><p className="accuracy-result">{percent(results.before_accuracy)} → {percent(results.test_accuracy)}</p><p>Same held-out test views. Best epoch: {results.best_epoch}.</p></>}
    </section><div className="training-evidence"><p className="training-graph-guide">Follow the lines: higher accuracy means more label matches. Lower loss means smaller errors. Validation checks examples the robot does not practice on.</p><div className="graph-grid"><Curve history={training.history} /><Curve history={training.history} loss /></div></div></div>
    {(error || training.error) && <p className="error" role="alert">{error || training.error}</p>}
    <p className="education-note">Game points and accuracy measure different things. The CNN learns your labels, including incorrect ones. Higher test accuracy is not guaranteed.</p>
    <details className="training-deeper" onToggle={event => { if (event.target === event.currentTarget && event.currentTarget.open) track?.('weights') }}><summary>Look deeper: inside the neural network</summary><Network viz={training.probe?.viz || item?.viz} /><p>Each block responds to patterns in the picture. Training changes the weights connecting those responses to the three bin scores.</p></details>
    <details><summary>View epoch values and extra help</summary><div className="table-scroll"><table><thead><tr>{['Epoch', 'Train loss', 'Validation loss', 'Train accuracy', 'Validation accuracy'].map(title => <th key={title}>{title}</th>)}</tr></thead><tbody>{training.history.map(row => <tr key={row.epoch}><td>{row.epoch}</td><td>{row.train_loss.toFixed(3)}</td><td>{row.val_loss.toFixed(3)}</td><td>{percent(row.train_acc)}</td><td>{percent(row.val_acc)}</td></tr>)}</tbody></table></div><p>Training updates weights. Validation selects the best model. Test examples stay out of both. If validation gets worse while training improves, the model may be overfitting.</p></details>
    <footer className="lab-stage-navigation"><button onClick={onBack}>← Back: sorting</button><p role="status">{training.status === 'done' ? 'Practice complete. See how your robot makes a decision.' : training.status === 'running' ? 'Your robot is practicing. The next step unlocks when training finishes.' : 'Train your robot to unlock the final step.'}</p><button className="green" disabled={training.status !== 'done'} onClick={onNext}>Next: test your robot →</button></footer>
  </section>
}
