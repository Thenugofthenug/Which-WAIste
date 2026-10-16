import { useId } from 'react'

export default function TVStatic() {
  const id = useId()
  return <div className="tv-static" role="img" aria-label="TV static">
    <svg className="tv-static-noise" viewBox="0 0 160 180" preserveAspectRatio="none" aria-hidden="true">
      <defs><filter id={id} x="0" y="0" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency=".8" numOctaves="3" seed="7" stitchTiles="stitch" />
        <feColorMatrix type="saturate" values="0" />
      </filter></defs>
      <rect width="160" height="180" filter={`url(#${id})`} />
    </svg>
  </div>
}
