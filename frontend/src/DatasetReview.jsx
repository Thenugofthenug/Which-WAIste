import { useEffect, useState } from 'react'

export default function DatasetReview({ gameId, baseUrl, active, demo }) {
  const [items, setItems] = useState([])
  const [error, setError] = useState('')
  useEffect(() => {
    if (!active) return
    let current = true
    fetch(`${baseUrl}/games/${gameId}/labels`).then(async (response) => {
      const data = await response.json()
      if (!response.ok) throw new Error(data.detail || 'Could not load your labels.')
      if (current) { setItems(data.items); setError('') }
    }).catch((err) => { if (current) setError(err.message) })
    return () => { current = false }
  }, [active, gameId, baseUrl])
  return <div className="dataset-review"><p className="eyebrow">Slide 1 · Revisit your examples</p>
    <h2>{demo ? 'The demo’s prepared labels' : 'Your labeled dataset'}</h2>
    <p>You can revisit your choices without resetting training. Start a new game to make a different dataset.</p>
    {error && <p role="alert">{error}</p>}
    <div className="dataset-grid">{items.map((item) => <figure key={item.index}>
      <img src={item.image} alt={item.name} /><figcaption><strong>{item.name}</strong><span>{item.label}</span></figcaption>
    </figure>)}</div>
    <details><summary>Why do labels matter?</summary><p>The model learns from these labels, not from common recycling guidelines.
      Inconsistent labels can make learning harder. Some examples go to training, some to validation, and others stay held out for testing.</p></details>
  </div>
}
