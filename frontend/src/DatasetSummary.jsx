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
      <dd>The &quot;homework&quot; the AI studies to learn your sorting rules.</dd>
      </div><div>
      <dt>VALIDATE: {split.validation}</dt>
      <dd>A &quot;practice quiz&quot; to check if the AI is finding patterns or just memorizing.</dd>
      </div><div>
      <dt>TEST: {split.test}</dt>
      <dd>The &quot;final exam&quot; using hidden items to grade the AI at the very end.</dd>
      </div>
    </dl>
  </aside>
}
