import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

const CATEGORIES = ['Recycling', 'Compost', 'Landfill']
const CATEGORY_COLORS = ['#29adff', '#00e436', '#c2c3c7']
const SPEEDS = { LOW: 0.7, MEDIUM: 1.25, HIGH: 1.9 }
const API = '/api'

async function request(path, options) {
  const response = await fetch(`${API}${path}`, options)
  const body = await response.json()
  if (!response.ok) {
    const message = typeof body.detail === 'string'
      ? body.detail
      : Array.isArray(body.detail)
        ? body.detail.map((issue) => issue.msg).join(' ')
        : 'The request failed.'
    throw new Error(message)
  }
  return body
}

function Header({ onHome, onGuide, actions }) {
  return (
    <header className="topbar">
      <a className="wordmark" href="#" onClick={(event) => { event.preventDefault(); onHome() }}>
        which <span>wAI</span>ste
      </a>
      <div className="top-actions">
        {actions}
        {onGuide && <button className="button button-blue button-small" onClick={onGuide}>? FIELD GUIDE</button>}
        <button className="button button-blue button-small" onClick={onHome}>HOME</button>
      </div>
    </header>
  )
}

function ItemCard({ item, selected, onSelect }) {
  return (
    <button
      className={`item-card${selected ? ' item-card-selected' : ''}`}
      draggable
      onClick={() => onSelect(item.id)}
      onDragStart={(event) => {
        event.dataTransfer.setData('text/plain', String(item.id))
        event.dataTransfer.effectAllowed = 'move'
      }}
      style={{ top: `${Math.min(item.progress, 72)}%`, left: `${8 + (item.id % 3) * 31}%` }}
      aria-label={`Select ${item.name}`}
    >
      <img src={item.image} alt="" />
      <span>{item.name}</span>
    </button>
  )
}

function App() {
  const [screen, setScreen] = useState('title')
  const [mode, setMode] = useState('train')
  const [items, setItems] = useState([])
  const [speed, setSpeed] = useState('MEDIUM')
  const [selectedItem, setSelectedItem] = useState(null)
  const [feedback, setFeedback] = useState('Drag an item to a bin, or select it and click a bin.')
  const [score, setScore] = useState(0)
  const [correct, setCorrect] = useState(0)
  const [streak, setStreak] = useState(0)
  const [bestStreak, setBestStreak] = useState(0)
  const [gameError, setGameError] = useState('')
  const [guideOpen, setGuideOpen] = useState(false)
  const gameComplete = items.length > 0 && items.every((item) => item.label !== null || item.missed)
  const [trainingJob, setTrainingJob] = useState('')
  const [trainingState, setTrainingState] = useState('idle')
  const [trainingError, setTrainingError] = useState('')
  const [epochData, setEpochData] = useState([])
  const [datasetSizes, setDatasetSizes] = useState(null)
  const [results, setResults] = useState(null)
  const [learningRate, setLearningRate] = useState(0.001)
  const [tryKind, setTryKind] = useState('familiar')
  const [tryResult, setTryResult] = useState(null)
  const [tryError, setTryError] = useState('')
  const [tryLoading, setTryLoading] = useState(false)
  const [tryTally, setTryTally] = useState({ familiar: [0, 0], validNovel: [0, 0], forced: 0 })
  const eventSource = useRef(null)
  const itemsRef = useRef(items)

  const labeledItems = useMemo(() => items.filter((item) => item.label !== null), [items])
  const missed = useMemo(() => items.filter((item) => item.missed).length, [items])
  const binCounts = useMemo(
    () => CATEGORIES.map((_, category) => labeledItems.filter((item) => item.label === category).length),
    [labeledItems],
  )
  const activeItems = useMemo(
    () => items.filter((item) => item.spawned && item.label === null && !item.missed),
    [items],
  )
  const correctCount = correct
  const wrongCount = Math.max(0, labeledItems.length - correctCount)

  useEffect(() => {
    if (screen !== 'game' || gameComplete || items.length === 0) return undefined
    const movement = window.setInterval(() => {
      let newlyMissed = false
      const next = itemsRef.current.map((item) => {
        if (!item.spawned || item.label !== null || item.missed) return item
        const progress = item.progress + SPEEDS[speed]
        if (progress >= 76) {
          newlyMissed = true
          return { ...item, progress: 76, missed: true }
        }
        return { ...item, progress }
      })
      itemsRef.current = next
      setItems(next)
      if (newlyMissed) {
        setStreak(0)
        setFeedback(mode === 'trick'
          ? 'An item passed the end of the belt. It has no practice label.'
          : 'An item was missed. No practice label was saved.')
      }
    }, 100)
    const spawning = window.setInterval(() => {
      const nextItem = itemsRef.current.find((item) => !item.spawned)
      if (!nextItem) return
      const next = itemsRef.current.map((item) => item.id === nextItem.id ? { ...item, spawned: true } : item)
      itemsRef.current = next
      setItems(next)
    }, 1750)
    return () => {
      window.clearInterval(movement)
      window.clearInterval(spawning)
    }
  }, [screen, speed, mode, gameComplete, items.length])

  useEffect(() => () => eventSource.current?.close(), [])

  async function startGame(selectedMode) {
    setGameError('')
    try {
      const data = await request(`/game-items?mode=${selectedMode}`)
      const nextItems = data.items.map((item, index) => ({
        ...item,
        progress: 0,
        spawned: index === 0,
        label: null,
        missed: false,
      }))
      itemsRef.current = nextItems
      setItems(nextItems)
      setMode(selectedMode)
      setSpeed('MEDIUM')
      setSelectedItem(null)
      setFeedback('Drag an item to a bin, or select it and click a bin.')
      setScore(0)
      setCorrect(0)
      setStreak(0)
      setBestStreak(0)
      setTrainingJob('')
      setTrainingState('idle')
      setResults(null)
      setEpochData([])
      setDatasetSizes(null)
      setTryResult(null)
      setScreen('game')
    } catch (error) {
      setGameError(error.message)
    }
  }

  async function goHome() {
    eventSource.current?.close()
    if (trainingJob && trainingState === 'running') {
      try {
        await request(`/train/${trainingJob}/stop`, { method: 'POST' })
      } catch {
        // The user can still return home if the API has gone away.
      }
    }
    setGuideOpen(false)
    setScreen('title')
    itemsRef.current = []
    setItems([])
    setTrainingState('idle')
    setTrainingJob('')
    setResults(null)
    setEpochData([])
    setTryResult(null)
    setLearningRate(0.001)
  }

  function sortItem(itemId, category) {
    if (gameComplete) return
    const item = items.find((candidate) => candidate.id === itemId)
    if (!item || item.label !== null || item.missed) return
    const nextItems = itemsRef.current.map((candidate) =>
      candidate.id === itemId ? { ...candidate, label: category } : candidate)
    itemsRef.current = nextItems
    setItems(nextItems)
    setSelectedItem(null)
    if (mode === 'trick') {
      setFeedback('Item sorted. Your label was saved as a robot practice example.')
      return
    }
    if (item.expected === category) {
      setCorrect((count) => count + 1)
      setScore((points) => points + 10)
      const nextStreak = streak + 1
      setStreak(nextStreak)
      setBestStreak(Math.max(bestStreak, nextStreak))
      setFeedback(`Correct sort! ${item.name} earned 10 points.`)
    } else {
      setStreak(0)
      setFeedback(`That bin may not be right for ${item.name}. Your label still teaches the robot.`)
    }
  }

  function onBinDrop(event, category) {
    event.preventDefault()
    const id = Number(event.dataTransfer.getData('text/plain'))
    if (Number.isInteger(id)) sortItem(id, category)
    else if (selectedItem !== null) sortItem(selectedItem, category)
  }

  async function beginTraining() {
    setTrainingError('')
    setTrainingState('starting')
    setEpochData([])
    setResults(null)
    try {
      const data = await request('/train', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          learning_rate: learningRate,
          items: labeledItems.map(({ image, label, name }) => ({ image, label, name })),
        }),
      })
      setTrainingJob(data.job_id)
      setTrainingState('running')
      const source = new EventSource(`${API}/train/${data.job_id}/events`)
      eventSource.current = source
      source.addEventListener('dataset', (event) => setDatasetSizes(JSON.parse(event.data)))
      source.addEventListener('epoch', (event) => {
        const epoch = JSON.parse(event.data)
        setEpochData((current) => [...current, epoch])
      })
      source.addEventListener('done', (event) => {
        setResults(JSON.parse(event.data))
        setTrainingState('done')
        source.close()
      })
      source.addEventListener('training_error', (event) => {
        if (event.data) setTrainingError(JSON.parse(event.data))
        else setTrainingError('The connection to the training service was interrupted.')
        setTrainingState('error')
        source.close()
      })
      source.onerror = () => {
        if (source.readyState === EventSource.CLOSED) {
          setTrainingError('The connection to the training service was interrupted.')
          setTrainingState('error')
        }
      }
    } catch (error) {
      setTrainingError(error.message)
      setTrainingState('error')
    }
  }

  async function stopTraining() {
    if (!trainingJob) return
    try {
      await request(`/train/${trainingJob}/stop`, { method: 'POST' })
      setTrainingState('stopping')
    } catch (error) {
      setTrainingError(error.message)
      setTrainingState('error')
    }
  }

  async function tryItem(kind) {
    setTryKind(kind)
    setTryLoading(true)
    setTryError('')
    try {
      const sample = await request(`/novel-item/${kind}`)
      const prediction = await request(`/train/${trainingJob}/predict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: sample.image }),
      })
      let target = sample.expected
      if (kind === 'familiar') {
        const labelsForType = labeledItems.filter((item) => item.name === sample.name).map((item) => item.label)
        if (labelsForType.length) {
          target = CATEGORIES.reduce((best, _, category) => (
            labelsForType.filter((label) => label === category).length >
            labelsForType.filter((label) => label === best).length ? category : best
          ), labelsForType[0])
        }
      }
      const correctPrediction = target !== null && prediction.predicted === target
      const result = { ...sample, ...prediction, target, correctPrediction, kind }
      setTryResult(result)
      if (kind === 'familiar') {
        setTryTally((current) => ({
          ...current,
          familiar: [current.familiar[0] + Number(correctPrediction), current.familiar[1] + 1],
        }))
      } else if (target === null) {
        setTryTally((current) => ({ ...current, forced: current.forced + 1 }))
      } else {
        setTryTally((current) => ({
          ...current,
          validNovel: [current.validNovel[0] + Number(correctPrediction), current.validNovel[1] + 1],
        }))
      }
    } catch (error) {
      setTryError(error.message)
    } finally {
      setTryLoading(false)
    }
  }

  const header = (
    <Header
      onHome={goHome}
      onGuide={screen !== 'title' ? () => setGuideOpen(true) : null}
      actions={screen === 'lab' && <button className="button button-muted button-small" onClick={() => setScreen('game')}>BACK TO SORTING</button>}
    />
  )

  return (
    <main className="app-shell">
      {header}
      {screen === 'title' && (
        <section className="title-screen">
          <div className="title-copy">
            <p className="eyebrow">A pixel-powered sorting lab</p>
            <h1>Which <span>wAI</span>ste?</h1>
            <p className="lede">Sort everyday waste. Teach a tiny neural network how you see the world.</p>
            <div className="title-actions">
              <button className="button button-green button-large" onClick={() => startGame('train')}>TRAIN MODE</button>
              <button className="button button-blue button-large" onClick={() => startGame('trick')}>TRICK MODE</button>
            </div>
            {gameError && <p className="error-message">{gameError}</p>}
            <p className="fine-print">Your bin choices become the robot&apos;s training labels. Missed items are left out.</p>
          </div>
          <div className="title-art" aria-hidden="true">
            <div className="art-sun" />
            <div className="art-conveyor"><i /><i /><i /><i /></div>
            <div className="art-item art-bottle">♻</div>
            <div className="art-item art-peel">✿</div>
            <div className="art-bin art-bin-blue" />
            <div className="art-bin art-bin-green" />
            <div className="art-bin art-bin-white" />
          </div>
          <div className="feature-row">
            <article><b>01 / SORT</b><span>Drop each item in a bin before it reaches the end.</span></article>
            <article><b>02 / TRAIN</b><span>See how your labels shape a convolutional neural network.</span></article>
            <article><b>03 / TEST</b><span>Try familiar and never-seen items with your trained robot.</span></article>
          </div>
        </section>
      )}
      {screen === 'game' && (
        <section className="game-screen">
          <div className="game-heading">
            <div>
              <p className="eyebrow">{mode === 'trick' ? 'Trick mode' : 'Train mode'} · sorting round</p>
              <h1>Sort the stream</h1>
            </div>
            <div className="game-stats">
              <span>{labeledItems.length + missed}<small> / {items.length} done</small></span>
              {mode === 'train' && <span>{score}<small> points · streak {streak}</small></span>}
              <span>{items.length - items.filter((item) => item.spawned).length}<small> on truck</small></span>
            </div>
          </div>
          {mode === 'train' && <p className="game-instructions">Correct sorts earn 10 points. Your labels are saved for training, even when they differ from common guidance.</p>}
          {mode === 'trick' && <p className="game-instructions">Sort by your best judgment. Feedback won&apos;t tell you whether a choice was correct.</p>}
          <p className={`feedback-line${mode === 'trick' ? ' feedback-neutral' : ''}`} aria-live="polite">{feedback}</p>
          <div className="sorting-layout">
            <aside className="bin-count-panel">
              <h2>Items in each bin</h2>
              {CATEGORIES.map((category, index) => (
                <div className="count-row" key={category}>
                  <span style={{ color: CATEGORY_COLORS[index] }}>{category}</span><b>{binCounts[index]}</b>
                </div>
              ))}
              <p>{missed} missed · no label</p>
            </aside>
            <div className="belt-stage">
              <div className="belt-track" aria-label="Moving conveyor belt">
                <div className="belt-rail belt-rail-left" /><div className="belt-rail belt-rail-right" />
                <div className="belt-surface"><div className="roller-lines" />
                  {activeItems.map((item) => (
                    <ItemCard key={item.id} item={item} selected={selectedItem === item.id} onSelect={setSelectedItem} />
                  ))}
                  {activeItems.length === 0 && <span className="belt-prompt">{gameComplete ? 'ROUND COMPLETE' : 'NEXT ITEM ON THE WAY'}</span>}
                </div>
                <div className="firepit"><span>END OF BELT</span><i /><i /><i /><i /><i /></div>
              </div>
            </div>
            <aside className="speed-panel">
              <h2>Still on the truck</h2>
              <strong>{items.length - items.filter((item) => item.spawned).length}</strong>
              <p>Choose belt speed</p>
              {Object.keys(SPEEDS).map((level) => (
                <button key={level} className={`button speed-button${speed === level ? ' speed-selected' : ''}`}
                  onClick={() => setSpeed(level)}>{level}</button>
              ))}
            </aside>
          </div>
          <div className="bin-row">
            {CATEGORIES.map((category, index) => (
              <button
                key={category}
                className="output-bin"
                style={{ '--bin-color': CATEGORY_COLORS[index] }}
                onClick={() => selectedItem !== null && sortItem(selectedItem, index)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => onBinDrop(event, index)}
                aria-label={`Sort into ${category}`}
              >
                <span className="bin-opening" /><b>{category}</b><small>{binCounts[index]} items</small>
              </button>
            ))}
          </div>
          {gameComplete && (
            <div className="completion-panel">
              <h2>Sorting complete</h2>
              {mode === 'train'
                ? <p>{correctCount} correct · {wrongCount} other labels · {missed} missed · best streak {bestStreak}</p>
                : <p>{labeledItems.length} practice labels saved · {missed} missed</p>}
              <button className="button button-green" onClick={() => setScreen('lab')}>TEACH THE ROBOT</button>
              <button className="button button-muted" onClick={() => startGame(mode)}>PLAY AGAIN</button>
            </div>
          )}
        </section>
      )}
      {screen === 'lab' && (
        <section className="lab-screen">
          <div className="game-heading">
            <div><p className="eyebrow">The learning lab</p><h1>Teach your robot</h1></div>
            <div className="game-stats"><span>{labeledItems.length}<small> labeled examples</small></span></div>
          </div>
          <p className="game-instructions">The model learns your bin choices. Held-out test accuracy measures agreement with those labels, not proof of recycling rules.</p>
          <div className="lab-tabs"><span>01 · TRAIN MODEL</span><span>02 · TRY NEW ITEMS</span></div>
          <div className="lab-grid">
            <section className="lab-card training-card">
              <p className="eyebrow">01 / Training</p>
              <h2>Learn from your labels</h2>
              <p>Examples are split into train, validation and test sets. The best validation checkpoint is used for the final test.</p>
              <div className="dataset-table">
                <span>BIN</span><span>COUNT</span>
                {CATEGORIES.map((category, index) => (
                  <ReactFragmentRow key={category} category={category} count={binCounts[index]} color={CATEGORY_COLORS[index]} />
                ))}
              </div>
              <label className="range-label" htmlFor="learning-rate">Learning rate <b>{learningRate.toExponential(1)}</b></label>
              <input id="learning-rate" type="range" min="-4" max="-1" step="0.1"
                value={Math.log10(learningRate)}
                onChange={(event) => setLearningRate(10 ** Number(event.target.value))}
                disabled={trainingState === 'running' || trainingState === 'starting' || trainingState === 'stopping'} />
              <div className="button-row">
                <button className="button button-green" onClick={beginTraining}
                  disabled={['starting', 'running', 'stopping'].includes(trainingState) || labeledItems.length < 6}>
                  {trainingState === 'running' || trainingState === 'starting' ? 'TRAINING…' : 'START TRAINING'}
                </button>
                {trainingState === 'running' && <button className="button button-red" onClick={stopTraining}>STOP</button>}
                {results && trainingJob && <button className="button button-blue" onClick={() => tryItem('familiar')}>TRY A FAMILIAR ITEM</button>}
              </div>
              {labeledItems.length < 6 && <p className="warning-message">Sort at least 6 items before training.</p>}
              {datasetSizes && <p className="fine-print">Train {datasetSizes.train} · validation {datasetSizes.validation} · test {datasetSizes.test}</p>}
              <p className="status-line" aria-live="polite">{trainingState === 'running' ? `Training epoch ${epochData.at(-1)?.epoch ?? 0} / 50` : trainingState.toUpperCase()}</p>
              {trainingError && <p className="error-message">{trainingError}</p>}
              {epochData.length > 0 && <EpochChart epochs={epochData} />}
              {results && (
                <div className="result-box">
                  <h3>Held-out test results</h3>
                  <p>Before training: {(results.before_test_acc * 100).toFixed(1)}%</p>
                  <p>After training: {(results.test_acc * 100).toFixed(1)}% · best epoch {results.best_epoch}</p>
                  <small>Measures agreement with student labels. Improvement is not guaranteed.</small>
                </div>
              )}
            </section>
            <section className="lab-card try-card">
              <p className="eyebrow">02 / Experiment</p>
              <h2>Try new items</h2>
              <p>Test a familiar item or one the network has never seen. The network always chooses one of its known bins.</p>
              <div className="button-row">
                <button className={`button ${tryKind === 'familiar' ? 'button-blue' : 'button-muted'}`}
                  onClick={() => { setTryKind('familiar'); if (results) tryItem('familiar') }}>FAMILIAR</button>
                <button className={`button ${tryKind === 'novel' ? 'button-pink' : 'button-muted'}`}
                  onClick={() => { setTryKind('novel'); if (results) tryItem('novel') }}>NEVER-SEEN</button>
              </div>
              {results && <button className="button button-green" onClick={() => tryItem(tryKind)} disabled={tryLoading}>
                {tryLoading ? 'CHECKING…' : 'TRY ITEM'}
              </button>}
              {!results && <p className="warning-message">Train the network before trying new items.</p>}
              {tryError && <p className="error-message">{tryError}</p>}
              {tryResult && (
                <div className="prediction-result">
                  <img src={tryResult.image} alt={tryResult.name} />
                  <div><h3>{tryResult.name}</h3><p>Robot says <b>{tryResult.category}</b> · {(tryResult.confidence * 100).toFixed(0)}% confidence</p>
                    <p>{tryResult.kind === 'familiar'
                      ? `Student label: ${CATEGORIES[tryResult.target]}`
                      : `Common guidance: ${tryResult.destination}${tryResult.expected === null ? ' (outside the robot’s label set)' : ''}`}</p>
                  </div>
                  <div className="probability-list">
                    {CATEGORIES.map((category, index) => <div key={category}><span>{category}</span><b>{(tryResult.probabilities[index] * 100).toFixed(1)}%</b>
                      <i><u style={{ width: `${tryResult.probabilities[index] * 100}%`, background: CATEGORY_COLORS[index] }} /></i></div>)}
                  </div>
                </div>
              )}
              <p className="tally">Familiar {tryTally.familiar[0]} / {tryTally.familiar[1]} · Valid novel {tryTally.validNovel[0]} / {tryTally.validNovel[1]} · Forced choices {tryTally.forced}</p>
            </section>
          </div>
        </section>
      )}
      {guideOpen && <GuideModal onClose={() => setGuideOpen(false)} />}
      <footer className="site-footer">A sorting game about labels, pixels, and what a model can learn.</footer>
    </main>
  )
}

function ReactFragmentRow({ category, count, color }) {
  return <><span style={{ color }}>{category}</span><b>{count}</b></>
}

function EpochChart({ epochs }) {
  const max = Math.max(...epochs.map((entry) => entry.train_acc), ...epochs.map((entry) => entry.val_acc), 0.05)
  return (
    <div className="chart-card">
      <div className="chart-title">Accuracy by epoch <span>Train / Validation</span></div>
      <div className="chart-bars">
        {epochs.map((entry) => <div key={entry.epoch} className="chart-column" title={`Epoch ${entry.epoch}: train ${(entry.train_acc * 100).toFixed(0)}%, validation ${(entry.val_acc * 100).toFixed(0)}%`}>
          <i style={{ height: `${(entry.train_acc / max) * 100}%` }} />
          <b style={{ height: `${(entry.val_acc / max) * 100}%` }} />
        </div>)}
      </div>
      <div className="chart-legend"><span><i />Train</span><span><i />Validation</span></div>
    </div>
  )
}

function GuideModal({ onClose }) {
  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section className="guide-modal" role="dialog" aria-modal="true" aria-labelledby="guide-title" onClick={(event) => event.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close field guide">×</button>
        <p className="eyebrow">Robot field guide</p><h2 id="guide-title">What is the robot learning?</h2>
        <p><b>Your labels are the lesson.</b> Each item sent to training includes the bin you chose. Incorrect choices are still useful for showing how label quality shapes a model.</p>
        <p><b>Training, validation, test.</b> Training examples update the network. Validation helps choose a checkpoint. The held-out test measures how well the finished model matches labels it did not train on.</p>
        <p><b>Confidence is not certainty.</b> The model compares its three known options. A high score does not mean it understands the material or the local recycling rules.</p>
        <button className="button button-green" onClick={onClose}>GOT IT</button>
      </section>
    </div>
  )
}

export default App
