import { useState } from 'react'
import GuidedLesson from './GuidedLesson'
import { NetworkDiagram } from './ConveyorReplay'
import { toyScores } from './toyScores'
import FiltersBox from './FiltersBox'

function WeightExperiment() {
  const [signal, setSignal] = useState(0.8)
  const [weight, setWeight] = useState(1)
  const scores = toyScores(signal, weight)
  const bins = ['Recycling', 'Compost', 'Landfill']
  return <div className="weight-experiment"><p className="eyebrow">Mini experiment · an illustrative model</p>
    <h3>Can you change the model’s favorite bin?</h3>
    <p>Imagine one learned pattern responds strongly to this picture. Move its weight to see
      how much that response contributes to the Compost score.</p>
    <div className="experiment-controls">
      <label>Pattern response <output>{signal.toFixed(1)}</output>
        <input type="range" min="0" max="1" step="0.1" value={signal} onChange={(event) => setSignal(Number(event.target.value))} /></label>
      <label>Weight toward Compost <output>{weight.toFixed(1)}</output>
        <input type="range" min="-3" max="3" step="0.1" value={weight} onChange={(event) => setWeight(Number(event.target.value))} /></label>
    </div>
    <div className="toy-connection"><span>Response {signal.toFixed(1)}</span><span>× weight {weight.toFixed(1)}</span>
      <strong>= contribution {(signal * weight).toFixed(2)}</strong></div>
    <div className="experiment-scores">{bins.map((bin, index) => <div key={bin}>
      <span>{bin}</span><meter min="0" max="1" value={scores[index]} aria-label={`${bin} illustrative score`} />
      <strong>{(scores[index] * 100).toFixed(1)}%</strong></div>)}</div>
    <p className="experiment-feedback">Highest score: <strong>{bins[scores.indexOf(Math.max(...scores))]}</strong></p>
    <details><summary>Challenge and extra help</summary><p>Make Compost the highest-scoring class, then make its score lower than before.
      What changes when the weight becomes negative? What happens when the response is zero?</p>
      <p>This is a tiny example, not a control for the real CNN. Recycling and Landfill start at fixed values of 0.7 and 0.5;
        Compost uses response × weight. Softmax turns all three values into scores summing to 100%.
        The real CNN learns many weights during training.</p></details>
    <button className="secondary-button" onClick={() => { setSignal(0.8); setWeight(1) }}>Reset experiment</button>
  </div>
}

export default function LearningWorkshop({ training, demo }) {
  const [tab, setTab] = useState('inside')
  const [step, setStep] = useState(0)
  const [itemIndex, setItemIndex] = useState(0)
  const ready = training?.status === 'done'
  const item = ready ? training.predictions[Math.min(itemIndex, training.predictions.length - 1)] : null
  return <div className="learning-workshop"><p className="eyebrow">Slide 2 · Explore the learning lab</p>
    <div className="workshop-heading"><div><h2>{ready ? 'What did the network learn?' : 'Learning is more than memorizing'}</h2>
      <p>{training?.status === 'training' ? `The real CNN is training: epoch ${training.epoch} of ${training.epochs}. Investigate while it works.` :
        ready ? 'Explore the real model here, then take the claw challenge on slide 3.' : 'Start Training from the side panel. Try the weight experiment while you wait.'}</p></div>
      {demo && <span className="lab-badge">Short demo run</span>}</div>
    <div className="workshop-tabs" aria-label="Learning activities">
      <button aria-pressed={tab === 'inside'} onClick={() => setTab('inside')}>Look inside the CNN</button>
      <button aria-pressed={tab === 'weights'} onClick={() => setTab('weights')}>Play with a weight</button>
    </div>
    <div className="filters-workspace"><FiltersBox inspection={item?.inspection} />
    <div className="workshop-detail">
    <div hidden={tab !== 'weights'}><WeightExperiment /></div>
    <div hidden={tab !== 'inside'} className="inspection-workspace">{item ? <>
      <label className="inspect-selector">Choose a held-out item <select value={itemIndex} onChange={(event) => setItemIndex(Number(event.target.value))}>
        {training.predictions.map((prediction, index) => <option key={index} value={index}>{index + 1}. {prediction.name}</option>)}
      </select></label>
      <NetworkDiagram item={item} phase="Reading image" revealed={step >= 2} />
      <GuidedLesson item={item} step={step} onStep={setStep} showFilters={false} />
    </> : <div className="inspection-pending"><h3>Your CNN is getting ready</h3>
      <p>After training, choose an item to explore pixels, the layer diagram, and before/after scores.
        The filters box stays visible as you move through these steps.</p></div>}</div>
    </div></div>
    <details className="workshop-help"><summary>Neural network words, in plain language</summary>
      <p>Training examples adjust weights. Test examples stay out of training so the final check is fair.
        If training improves but validation gets worse, the model may be memorizing practice examples (overfitting).
        A high score can still be wrong; compare it with a reliable label.</p>
      <dl><dt>Weight</dt><dd>A number that controls how strongly a response affects another part of the network.</dd>
        <dt>Epoch</dt><dd>One pass through the training examples.</dd><dt>Loss</dt><dd>A measure of prediction error against the supplied labels.</dd>
        <dt>Validation</dt><dd>Examples used to choose the best model, without updating its weights.</dd>
        <dt>Test</dt><dd>Examples kept out of training for a final check.</dd>
        <dt>Feature map</dt><dd>A grid showing how one learned filter responds at different image positions.</dd>
        <dt>Softmax</dt><dd>A calculation that turns the final class values into scores that add up to 100%.</dd></dl>
    </details>
  </div>
}
