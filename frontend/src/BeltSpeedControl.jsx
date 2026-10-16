const SEGMENTS = {
  a: '18,8 62,8 70,16 62,24 18,24 10,16',
  b: '64,28 72,20 80,28 80,66 72,74 64,66',
  c: '64,86 72,78 80,86 80,124 72,132 64,124',
  d: '18,128 62,128 70,136 62,144 18,144 10,136',
  e: '0,86 8,78 16,86 16,124 8,132 0,124',
  f: '0,28 8,20 16,28 16,66 8,74 0,66',
  g: '18,68 62,68 70,76 62,84 18,84 10,76',
}
const DIGITS = { 0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd' }
const TRIANGLE = '-8,0 8,0 8,8 16,8 16,16 24,16 24,24 32,24 32,32 -32,32 -32,24 -24,24 -24,16 -16,16 -16,8 -8,8'

function SpeedArrow({ up, disabled, onClick }) {
  function activate() { if (!disabled) onClick() }
  return <g className="speed-arrow" role="button" tabIndex={0} aria-label={up ? 'Increase belt speed' : 'Decrease belt speed'} aria-disabled={disabled}
    onClick={activate} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate() } }}>
    <rect x="8" y={up ? -8 : 90} width="80" height={up ? 32 : 24} fill="transparent" />
    <polygon points={TRIANGLE} transform={up ? 'translate(48 0) scale(.35)' : 'translate(48 108) scale(.35 -.35)'} fill="#00e436" stroke="rgb(194, 195, 199)" strokeWidth="3" />
  </g>
}

export default function BeltSpeedControl({ value, onChange, disabled = false }) {
  return <g className="belt-speed-control" transform="translate(800 220)" role="group" aria-label="Belt speed control">
    <g className="sorting-tv speed-control-tv" aria-hidden="true" fill="rgb(95, 87, 79)" stroke="rgb(194, 195, 199)" strokeWidth="4">
      <rect x="-34" y="-4" width="26" height="10" />
      <rect x="-34" y="122" width="26" height="10" />
      <rect className="speed-tv-frame" x="-8" y="-16" width="112" height="168" fill="rgb(43, 43, 49)" strokeWidth="8" />
    </g>
    <SpeedArrow up disabled={disabled || value === 3} onClick={() => onChange(Math.min(3, value + 1))} />
    <g role="img" aria-label={`Belt speed ${value} of 3`}>
      <rect x="24" y="23" width="48" height="62" fill="#101412" stroke="rgb(194, 195, 199)" strokeWidth="3" />
      <g transform="translate(34 29) scale(.35)">{Object.entries(SEGMENTS).map(([segment, points]) => <polygon key={segment} points={points} fill={DIGITS[value].includes(segment) ? '#00e436' : '#073418'} />)}</g>
    </g>
    <SpeedArrow disabled={disabled || value === 0} onClick={() => onChange(Math.max(0, value - 1))} />
    <text x="48" y="136" textAnchor="middle" fill="#00e436" fontSize="13">BELT SPEED</text>
  </g>
}
