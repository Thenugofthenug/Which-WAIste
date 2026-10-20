import HomeRobot from './HomeRobot'
import BinLogo from './BinLogo'
import { BINS, COLORS, datasetSplitCounts } from './gameEngine'

const percent = value => `${(value * 100).toFixed(1)}%`

function LabeledItem({ record }) {
  return <>
    <img src={record.item.image} alt="" draggable="false" />
    <span className="training-item-label" style={{ borderColor: COLORS[record.chosen_class] }}>
      <BinLogo bin={record.chosen_class} x={9} y={0} width={18} height={18} animate={false} />
      {BINS[record.chosen_class]}
    </span>
  </>
}

// The server reports completed epochs, not per-picture progress. Replay one
// illustration when the selected real epoch changes; never simulate a live count.
export default function EpochFlow({ game, selected, live = false }) {
  const split = game.training.results?.split || datasetSplitCounts(game.actions)
  const items = new Map(game.items.map(item => [item.index, item]))
  // The API exposes split counts, not membership. These are representative
  // labeled examples, not a claim that these exact items belong to training.
  const examples = game.actions
    .filter(record => record.outcome === 'sorted' && Number.isInteger(record.chosen_class) && BINS[record.chosen_class])
    .map(record => ({ ...record, item: items.get(record.index) }))
    .filter(record => record.item?.image)
    .slice(0, 4)
  const replayDuration = Math.max(0, examples.length - 1) * 1.2 + 2.4
  return <section className="training-round-card inset" aria-label="Selected practice round" data-epoch={selected?.epoch || 0} data-live={live || undefined}>
    <div className="training-round-heading"><h3>{selected ? `Round ${selected.epoch}: one whole practice pass` : 'What happens in one round?'}</h3><span>{live ? 'Latest completed round' : selected ? 'Round replay' : 'Ready to practice'}</span></div>
    <div key={selected?.epoch || 'idle'} className={`training-round-illustration${selected ? ' training-round-replay' : ''}`} style={{ '--replay-duration': `${replayDuration}s` }}>
      <div className="training-item-stream" role="img" aria-label={examples.length ? `Examples from your labeled dataset: ${examples.map(record => `${record.item.name}, labeled ${BINS[record.chosen_class]}`).join('; ')}. Illustrative replay.` : 'No labeled items yet.'}>
        {examples.length ? <>
          <div className="training-item-preview" aria-hidden="true"><LabeledItem record={examples[0]} /></div>
          {selected && examples.map((record, index) => <div className="training-item-flight" key={record.index} data-item-index={record.index} style={{ '--item-delay': `${index * 1.2}s` }} aria-hidden="true"><LabeledItem record={record} /></div>)}
        </> : <span className="training-items-empty">No labeled items yet</span>}
      </div>
      <div className="training-round-robot"><HomeRobot variant="heading" /><span>Adjust weights</span></div><b className="training-round-arrow">→</b>
      <div className="training-round-check"><span>CHECK</span><strong>{selected ? selected.epoch : '?'}</strong><span>{selected ? 'Round complete' : 'Then plot a point'}</span></div>
    </div>
    <p><b>{split.train} training examples</b> update weights. {game.summary.missed > 0 && 'Missed items have no label, so they stay out.'}</p>
    {selected && <dl className="training-round-values"><div><dt>Training</dt><dd>{percent(selected.train_acc)} matches <small>loss {selected.train_loss.toFixed(3)}</small></dd></div><div><dt>Validation</dt><dd>{percent(selected.val_acc)} matches <small>loss {selected.val_loss.toFixed(3)}</small></dd></div></dl>}
    <p className="training-illustration-note">Example items with your labels. This illustrates a practice round, not its exact items or live progress.</p>
  </section>
}
