import { useId } from 'react'
import recycling from './assets/bins/recycling.png'
import compost from './assets/bins/compost.png'
import landfill from './assets/bins/landfill.png'

// Crop the original title-screen pictograms and mask out the colored bin bodies.
const LOGOS = [
  { image: recycling, crop: [425, 585, 400, 400] },
  { image: compost, crop: [405, 535, 440, 465] },
  { image: landfill, crop: [455, 580, 340, 390] },
]

export default function BinLogo({ bin, x, y = 576, width = 80, height = 80, animate = true }) {
  const id = useId()
  const { image, crop } = LOGOS[bin]
  return <svg className={animate ? 'bin-sort-logo' : 'bin-symbol'} x={x - width / 2} y={y} width={width} height={height} viewBox={crop.join(' ')} aria-hidden="true">
    <defs>
      <filter id={`${id}-white`} colorInterpolationFilters="sRGB">
        <feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  3 3 3 0 -7.5" />
      </filter>
      <mask id={`${id}-mask`} maskUnits="userSpaceOnUse" x={crop[0]} y={crop[1]} width={crop[2]} height={crop[3]} style={{ maskType: 'alpha' }}>
        <image href={image} width="1254" height="1254" filter={`url(#${id}-white)`} />
      </mask>
    </defs>
    <rect x={crop[0]} y={crop[1]} width={crop[2]} height={crop[3]} fill="#fff" mask={`url(#${id}-mask)`} />
  </svg>
}
