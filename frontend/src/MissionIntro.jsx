import { useEffect, useRef } from 'react'

export default function MissionIntro({ close }) {
  const continueButton = useRef()
  useEffect(() => {
    const previous = document.activeElement
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    continueButton.current.focus()
    function keyboard(event) {
      if (event.key === 'Escape') close()
      if (event.key === 'Tab') { event.preventDefault(); continueButton.current.focus() }
    }
    document.addEventListener('keydown', keyboard)
    return () => {
      document.body.style.overflow = overflow
      document.removeEventListener('keydown', keyboard)
      if (previous?.isConnected && previous !== document.body) previous.focus()
      else document.querySelector('.board-controls button')?.focus()
    }
  }, [close])

  return <div className="modal-backdrop"><section className="mission-intro pixel-panel" role="dialog" aria-modal="true" aria-labelledby="mission-intro-title" aria-describedby="mission-intro-description">
    <p className="mission-intro-kicker">Phase 1 of 3 · Collect examples</p>
    <h2 id="mission-intro-title">Phase 1: the sorting room<span className="mission-intro-subtitle"> - data collection</span></h2>
    <div className="mission-intro-cards">
      <section className="mission-intro-card mission-intro-sort" aria-labelledby="intro-sort-title">
        <h3 id="intro-sort-title">1. Choose a bin</h3>
        <p id="mission-intro-description">Here you must <strong className="intro-action">click and drag items off of the conveyor belt</strong> into <strong>your chosen bin</strong>.</p>
        <ul className="intro-bins" aria-label="Your three sorting bins"><li>Recycling</li><li>Compost</li><li>Landfill</li></ul>
      </section>
      <section className="mission-intro-card mission-intro-lava" aria-labelledby="intro-lava-title">
        <h3 id="intro-lava-title">2. Watch out for the lava!</h3>
        <p>Failing to sort an item into any bin <strong className="intro-warning">before that item reaches the end of the conveyor belt</strong> sends that item into the <strong className="intro-warning">lava pit</strong> and <strong>will not be used in the data set</strong>.</p>
      </section>
      <section className="mission-intro-card mission-intro-teach" aria-labelledby="intro-teach-title">
        <h3 id="intro-teach-title">3. You teach the robot</h3>
        <p>It's <strong>up to you</strong> to decide what bin each item goes in, you are <strong className="intro-learning">creating the answer key for the robot to learn from</strong>!</p>
      </section>
    </div>
    <p className="mission-intro-next">Once you start the belt you have <strong className="intro-action">30 items to sort</strong> before we can move to <strong className="intro-learning">phase 2: training the robot</strong>.</p>
    <div className="mission-intro-footer"><p><strong>The belt is paused.</strong> After closing this, press <strong>Start belt</strong> when you’re ready. Use <strong>? Learning tips</strong> for more help.</p><button ref={continueButton} className="green" onClick={close}>Got it — let’s sort →</button></div>
  </section></div>
}
