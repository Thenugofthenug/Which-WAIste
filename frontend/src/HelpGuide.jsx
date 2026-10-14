import { useEffect, useRef, useState } from 'react'

const TOPICS = [
  ['labels', 'Labels teach the robot', 'A label is the bin you choose for a picture. The CNN learns from those choices, including incorrect ones. Points compare your choice with a common guideline; local recycling rules can vary. Missed items get no label and stay out of the learning dataset. The lava is a game effect, not a real disposal method. Could incorrect labels teach the robot a misleading pattern?'],
  ['pixels', 'Pixels become numbers', 'The robot sees a 64 × 64 image, not the item’s name. Each pixel has red, green and blue values. We scale 0–255 to −1–1 before the CNN uses them. It learns patterns in these numbers; it does not understand a banana the way you do. Look inside the lab to see an actual input pixel.'],
  ['filters', 'Filters and patterns', 'A filter is a learned pattern detector moving across an image. Its responses form a feature map. Later layers combine earlier responses. ReLU keeps positive responses; pooling shrinks the grids. This CNN has four blocks with 16, 32, 64 and 64 channels. Bright spots show strong responses, not proof that the model understands “metal.” Each displayed map is scaled to its own maximum.'],
  ['weights', 'Weights change decisions', 'A weight controls how strongly a response contributes to the next layer. Response 0.8 × weight 2 contributes 1.6. A negative weight can lower a score; zero response contributes nothing. Training adjusts many weights to reduce errors. The network diagram summarizes positive connections in green and negative connections in red; they are not physical conveyor sensors.'],
  ['learning', 'Epoch, loss & learning rate', 'An epoch is one pass through the training examples. Loss measures errors against your labels. The learning rate controls the size of weight updates: too large can be unstable, and too small may learn slowly. Watch whether training and validation curves improve together.'],
  ['testing', 'Practice versus a fair test', 'Training examples update weights. Validation examples help select the best model, without updating its weights. Test examples are kept aside for the final check. We split original items before making augmented views, so copies do not leak between sets. If training improves but validation gets worse, the model may be memorizing practice examples: overfitting.'],
  ['accuracy', 'Points are not accuracy', '+10 points for a correct sort, +0 for a wrong or missed item. Mistakes reset your streak. Model accuracy is different: the fraction of held-out test predictions matching your supplied labels. Before/after scores use the same test views. Good labels can help, but improvement is not guaranteed, especially with a tiny dataset.'],
  ['confidence', 'A high score can be wrong', 'Softmax converts the final three values into scores that add up to 100%. The largest score chooses the bin. An 80% score is not a promise that the answer is right. The model always chooses from its three bins, with no “I don’t know” option. Compare its prediction with a reliable label.'],
  ['new-items', 'Try something new', 'After training, try a new drawing of a familiar item or a never-seen type. Some items need a destination outside our three bins. The CNN will still choose one of its bins even when none is suitable. More confidence does not fix a missing category.'],
]

export default function HelpGuide({ close, track }) {
  const [topic, setTopic] = useState(0)
  const panel = useRef()
  useEffect(() => {
    const previous = document.activeElement
    panel.current.querySelector('button').focus()
    function keyboard(event) {
      if (event.key === 'Escape') close()
      if (event.key !== 'Tab') return
      const buttons = [...panel.current.querySelectorAll('button')]
      const first = buttons[0], last = buttons.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', keyboard)
    return () => { document.removeEventListener('keydown', keyboard); previous?.focus() }
  }, [close])
  return <div className="modal-backdrop"><section className="field-guide pixel-panel" role="dialog" aria-modal="true" aria-labelledby="guide-title" ref={panel}>
    <header><h2 id="guide-title">Robot field guide</h2><button onClick={close}>Close ×</button></header>
    <p className="muted">Choose a topic. The sorting belt pauses while you read; lab training continues.</p>
    <div className="guide-grid"><nav aria-label="Learning topics">{TOPICS.map(([id, title], index) => <button key={id} aria-pressed={topic === index}
      onClick={() => { if (index !== topic) { setTopic(index); track(id) } }}>{title}</button>)}</nav>
      <article><p className="eyebrow">Learn at your own pace</p><h3>{TOPICS[topic][1]}</h3><p>{TOPICS[topic][2]}</p>
        <p className="muted">Explore these ideas in the lab after your sorting mission.</p></article></div>
  </section></div>
}
