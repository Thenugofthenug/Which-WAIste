// Small SVG plots keep the original graphs without adding a chart dependency.
function Plot({ history, epochs, metric, title }) {
  const accuracy = metric === 'acc'
  const maxValue = accuracy ? 1.05 : Math.max(1,
    Math.ceil(Math.max(0, ...history.flatMap((row) => [row.train_loss, row.val_loss])) * 2) / 2)
  const x = (epoch) => 48 + (epoch / epochs) * 310
  const y = (value) => 210 - (value / maxValue) * 180
  const format = (value) => accuracy ? `${Math.round(value * 100)}%` : value.toFixed(2)
  const ticks = accuracy ? [0, 0.25, 0.5, 0.75, 1] : [0, 0.25, 0.5, 0.75, 1].map((n) => n * maxValue)

  return <figure className="training-plot">
    <figcaption>{title}</figcaption>
    <svg viewBox="0 0 380 260" role="img" aria-label={`${title} by epoch: training in mint, validation in amber`}>
      {ticks.map((value) => <g key={value}>
        <line x1="48" x2="358" y1={y(value)} y2={y(value)} className="plot-grid" />
        <text x="40" y={y(value) + 4} textAnchor="end">{format(value)}</text>
      </g>)}
      <line x1="48" x2="48" y1="30" y2="210" className="plot-axis" />
      <line x1="48" x2="358" y1="210" y2="210" className="plot-axis" />
      {[0, Math.round(epochs / 2), epochs].map((epoch) => <text key={epoch}
        x={x(epoch)} y="230" textAnchor="middle">{epoch}</text>)}
      <text x="203" y="251" textAnchor="middle">Epoch</text>
      {['train', 'val'].map((series) => <g key={series} className={`plot-${series}`}>
        <polyline fill="none" strokeWidth="2.5" points={history.map((row) =>
          `${x(row.epoch)},${y(row[`${series}_${metric}`])}`).join(' ')} />
        {history.map((row) => <circle key={row.epoch} cx={x(row.epoch)} cy={y(row[`${series}_${metric}`])} r="2.5">
          <title>{`Epoch ${row.epoch}: ${series === 'train' ? 'Training' : 'Validation'} ${title.toLowerCase()} ${format(row[`${series}_${metric}`])}`}</title>
        </circle>)}
      </g>)}
    </svg>
  </figure>
}

export default function TrainingGraphs({ history = [], epochs = 50 }) {
  return <section className="training-graphs" aria-label="Training graphs">
    <h3>Learning progress</h3>
    <details className="graph-explanation"><summary>How to read the graphs</summary><p className="hint">Loss measures prediction error against the labels: lower is better. Accuracy measures how often
      the highest-scoring class matches a label. Each epoch is another pass through the training examples.</p></details>
    <p className="plot-legend"><span className="legend-train">Training</span>
      <span className="legend-val">Validation</span></p>
    <div className="plot-layout">
      <Plot history={history} epochs={epochs} metric="loss" title="Loss" />
      <Plot history={history} epochs={epochs} metric="acc" title="Accuracy" />
    </div>
    {history.length === 0 && <p className="hint">Graphs update after each completed training epoch.</p>}
    {history.length > 0 && <details>
      <summary>View epoch values</summary>
      <div className="results"><table>
        <thead><tr><th>Epoch</th><th>Train loss</th><th>Validation loss</th><th>Train accuracy</th><th>Validation accuracy</th></tr></thead>
        <tbody>{history.map((row) => <tr key={row.epoch}>
          <td>{row.epoch}</td><td>{row.train_loss.toFixed(3)}</td><td>{row.val_loss.toFixed(3)}</td>
          <td>{(row.train_acc * 100).toFixed(1)}%</td><td>{(row.val_acc * 100).toFixed(1)}%</td>
        </tr>)}</tbody>
      </table></div>
    </details>}
  </section>
}
