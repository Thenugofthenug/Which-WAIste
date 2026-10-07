import FiltersBox from './FiltersBox'

const steps = ['Pixels become numbers', 'Layers respond to patterns', 'Compare class scores', 'Choose a bin']
const bins = ['Recycling', 'Compost', 'Landfill']

export default function GuidedLesson({ item, step, onStep, showFilters = true }) {
  const inspection = item.inspection
  return <div className="guided-lesson">
    <div className="lesson-steps" aria-label="Explore the decision steps">
      {steps.map((label, index) => <button key={label} aria-pressed={step === index}
        onClick={() => onStep(index)}><span>0{index + 1}</span>{label}</button>)}
    </div>
    <div className="lesson-content" aria-live="polite">
      <p className="lab-eyebrow">Explore step {step + 1}</p><h3>{steps[step]}</h3>
      {step === 0 && <>
        <p>The CNN sees a 64 × 64 grid of red, green, and blue values—not the item’s name.
          Each channel is scaled from 0–255 to −1–1 before entering the network.</p>
        {inspection && <div className="pixel-example"><img src={inspection.input_image} alt={`Actual 64 by 64 CNN input for ${item.name}`} />
          <div><strong>One pixel at the center</strong><p>RGB: {inspection.rgb.join(', ')}<br />
            Normalized: {inspection.normalized.join(', ')}</p></div></div>}
        <p className="lab-caption">Try predicting a bin yourself before opening the score step.</p>
      </>}
      {step === 1 && <>
        <p>Learned filters respond to patterns in the image. ReLU keeps positive responses;
          pooling shrinks the grids. Later layers combine earlier responses.</p>
        {showFilters && inspection && <FiltersBox inspection={inspection} />}
        <p className="lab-caption">These are real responses from the trained CNN on the original image.
          Each map is scaled to its own maximum; brighter means a stronger response within that map.
          They don’t identify a human concept or explain the entire decision.</p>
      </>}
      {step === 2 && <>
        <p>The final layer combines 64 pooled values into three numbers. Softmax converts them
          into scores that sum to 100%. Training adjusts weights to reduce errors against your labels.</p>
        {item.before && <div className="comparison-grid">{[
          ['Before training', item.before], ['After training', item],
        ].map(([title, result]) => <div className="comparison-card" key={title}><h4>{title}</h4>
          <strong>{result.predicted_class}</strong>
          {bins.map((category) => <div className="comparison-score" key={category}>
            <span>{category}</span><meter min="0" max="1" value={result.probabilities[category]} aria-label={`${title}: ${category}`} />
            <b>{(result.probabilities[category] * 100).toFixed(1)}%</b>
          </div>)}
        </div>)}</div>}
        <p className="lab-caption">Same held-out item and augmented views, before and after learning.
          A high model score can still be wrong; improvement isn’t guaranteed on this small dataset.</p>
      </>}
      {step === 3 && <>
        <p>The highest score selects <strong>{item.predicted_class}</strong>. The conveyor on slide 3 illustrates that choice;
          it doesn’t change the model’s prediction.</p>
        <div className="label-comparison"><span>Your label <strong>{item.your_label}</strong></span>
          <span>Model choice <strong>{item.predicted_class}</strong></span>
          <span>{item.your_label === item.predicted_class ? 'Label match' : 'Label mismatch'}</span></div>
        <p className="lab-caption">The network learns the labels it receives. Matching your label isn’t proof of the
          correct recycling rule. What could happen if the training labels were inconsistent?</p>
      </>}
    </div>
  </div>
}
