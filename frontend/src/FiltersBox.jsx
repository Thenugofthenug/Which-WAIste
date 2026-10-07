export default function FiltersBox({ inspection }) {
  return <section className="filters-box" aria-label="CNN filters and feature maps">
    <p className="eyebrow">Filters & feature maps</p><h3>What patterns light up?</h3>
    <p>A filter is a learned pattern detector. These grids show how selected filters respond to this image.</p>
    {inspection ? <div className="feature-layers">{inspection.layers.map((layer) => <div className="feature-layer" key={layer.name}>
      <strong>{layer.name}</strong><small>{layer.shape[0]} channels · {layer.shape[1]} × {layer.shape[2]}</small>
      <div>{layer.maps.map((map) => <figure key={map.channel}><img src={map.image} alt={`${layer.name}, channel ${map.channel} activation map`} />
        <figcaption>Channel {map.channel}</figcaption></figure>)}</div>
    </div>)}</div> : <div className="filters-pending"><strong>16 → 32 → 64 → 64 channels</strong>
      <p>Train the CNN to see real responses here. You can experiment with a weight while it learns.</p></div>}
    <details><summary>Help: what do these filter pictures mean?</summary><p>These are actual activation maps from the trained CNN on the original image.
      Each map is scaled to its own maximum; brighter means a stronger response within that map.
      Two channels per block are selected by their average response. They don’t identify a human concept
      or explain the entire decision, and their brightness cannot be compared directly across maps.</p></details>
  </section>
}
