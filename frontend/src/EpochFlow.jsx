import HomeRobot from './HomeRobot'
import { datasetSplitCounts } from './gameEngine'

const percent = value => `${(value * 100).toFixed(1)}%`

// The server reports completed epochs, not per-picture progress. Replay one
// illustration when the selected real epoch changes; never simulate a live count.
export default function EpochFlow({ game, selected, live = false }) {
  const split = game.training.results?.split || datasetSplitCounts(game.actions)
  return <section className="training-round-card inset" aria-label="Selected practice round" data-epoch={selected?.epoch || 0} data-live={live || undefined}>
    <div className="training-round-heading"><h3>{selected ? `Round ${selected.epoch}: one whole practice pass` : 'What happens in one round?'}</h3><span>{live ? 'Latest completed round' : selected ? 'Round replay' : 'Ready to practice'}</span></div>
    <div key={selected?.epoch || 'idle'} className={`training-round-illustration${selected ? ' training-round-replay' : ''}`} aria-hidden="true">
      <div className="training-example-stack"><span>IMAGE</span><span>+ YOUR LABEL</span></div><b className="training-round-arrow">→</b>
      <div className="training-round-robot"><HomeRobot variant="heading" /><span>Adjust weights</span></div><b className="training-round-arrow">→</b>
      <div className="training-round-check"><span>CHECK</span><strong>{selected ? selected.epoch : '?'}</strong><span>{selected ? 'Round complete' : 'Then plot a point'}</span></div>
    </div>
    <p><b>{split.train} training examples</b> update weights each round. {game.summary.missed > 0 && 'Missed items have no label, so they stay out.'}</p>
    {selected && <dl className="training-round-values"><div><dt>Training</dt><dd>{percent(selected.train_acc)} matches <small>loss {selected.train_loss.toFixed(3)}</small></dd></div><div><dt>Validation</dt><dd>{percent(selected.val_acc)} matches <small>loss {selected.val_loss.toFixed(3)}</small></dd></div></dl>}
    <p className="training-illustration-note">Whole-round illustration, not live picture-by-picture progress. Values and graph highlights show the selected completed round.</p>
  </section>
}
