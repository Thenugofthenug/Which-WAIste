import { datasetSplitCounts } from './gameEngine'

export default function DatasetSummary({ game }) {
  const split = game.training.results?.split || datasetSplitCounts(game.actions)
  return <aside className="dataset-summary" aria-label="Your dataset summary">
    <div>
    <h3>Your dataset summary</h3>
    <p className="dataset-misses">{game.summary.missed} misses lost to lava</p>
    </div>
    <dl>
      <div>
      <dt>TRAIN: {split.train}</dt>
      <dd>The &quot;homework&quot; that teaches your sorting rules.</dd>
      </div><div>
      <dt>VALIDATE: {split.validation}</dt>
      <dd>A &quot;practice quiz&quot; to help choose the best round.</dd>
      </div><div>
      <dt>TEST: {split.test}</dt>
      <dd>The &quot;final exam&quot; with items kept out of practice.</dd>
      </div>
    </dl>
  </aside>
}
