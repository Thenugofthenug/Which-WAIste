import { useEffect, useRef } from 'react'

export default function ConveyorPrompt({ slowdown, onContinue }) {
  const panel = useRef()
  useEffect(() => {
    const previous = document.activeElement
    const button = panel.current.querySelector('button')
    button.focus()
    function keepFocus(event) {
      if (event.key === 'Tab') { event.preventDefault(); button.focus() }
    }
    document.addEventListener('keydown', keepFocus)
    return () => {
      document.removeEventListener('keydown', keepFocus)
      if (previous?.isConnected) previous.focus()
    }
  }, [])

  return <div className="modal-backdrop conveyor-prompt-backdrop"><section ref={panel} className="conveyor-prompt pixel-panel" role="dialog" aria-modal="true"
    aria-labelledby="conveyor-prompt-title" aria-describedby="conveyor-prompt-description">
    <p className="eyebrow">{slowdown ? 'Learning break · let’s slow things down' : 'Sorting mission · help RE-CYCLER learn'}</p>
    <div className={`prompt-symbol ${slowdown ? 'prompt-lava' : ''}`} aria-hidden="true">{slowdown ? '!!!' : '1 → 2 → 3'}</div>
    <h2 id="conveyor-prompt-title">{slowdown ? 'Oh no! Three items slipped into the lava.' : 'Show the robot where things belong.'}</h2>
    <div id="conveyor-prompt-description">{slowdown ? <>
      <p>Those items received <strong>no labels</strong>, so they won’t be used to train or test the neural network. Our robot has fewer examples to learn from.</p>
      <p>We’ve lowered the belt to <strong>speed 1</strong> to give you more time. Your score and saved labels stay with you.</p>
      <p className="muted">Fewer examples can make learning harder, but misses don’t guarantee lower accuracy. Let’s save the next ones!</p>
    </> : <>
      <ol><li><strong>Watch the next item</strong> on the moving belt.</li><li><strong>Press 1, 2 or 3 to choose its bin</strong> before it reaches the lava. You can also drag it.</li><li><strong>Your bin choice becomes its label.</strong> The robot learns from your choices—even incorrect ones.</li></ol>
      <p>Correct sorts earn <strong>10 points</strong>. Items lost to lava get no points or label. We’ll start at <strong>speed 2</strong> and offer more time if you miss three in a row.</p>
      <p className="muted">Quick keys: <strong>1 Recycling · 2 Compost · 3 Landfill</strong>. Use <strong>↑ / ↓ to change belt speed</strong>; speed 0 pauses. Open Learning tips anytime.</p>
    </>}</div>
    <button className="green" onClick={onContinue}>{slowdown ? 'Continue at speed 1' : 'Start sorting at speed 2'}</button>
  </section></div>
}
