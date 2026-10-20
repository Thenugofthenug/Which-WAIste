import { useEffect, useId, useRef, useState } from 'react'
import BinLogo from './BinLogo'
import { BINS, COLORS } from './gameEngine'

function ItemGroup({ record }) {
  const missed = record.outcome === 'missed'
  return <g aria-label={missed ? `Item ${record.number}: Lava — missed item` : `Item ${record.number}: ${record.item.name}, ${BINS[record.chosen_class]}`}>
    <text x="-54" y="72" fill="#fff" fontSize="17" textAnchor="middle">{record.number}</text>
    {!missed && <image href={record.item.image} x="-38" y="45" width="42" height="42" />}
    <rect x="12" y="50" width="32" height="32" fill={missed ? '#953019' : COLORS[record.chosen_class]} />
    {missed ? <svg className="epoch-lava-symbol" x="14" y="52" width="28" height="28" viewBox="0 0 24 28" aria-hidden="true"><path d="M12 0h4v6h4v6h4v10h-4v4H4v-4H0V12h4v4h4V8h4Z" fill="#ffec27" /><path d="M12 14h4v6h4v4H8v-6h4Z" fill="#fff1d6" /></svg>
      : <BinLogo bin={record.chosen_class} x={28} y={52} width={28} height={28} animate={false} />}
  </g>
}

export default function EpochFlow({ game }) {
  const clip = useId()
  const svg = useRef()
  const [layout, setLayout] = useState({ width: 1200, entrance: 750, desk: 140 })
  useEffect(() => {
    const heading = svg.current.closest('.section-heading')
    const panel = heading.closest('.lab-panel')
    const note = panel.querySelector('.lab-epoch-note span')
    const table = panel.querySelector('.robot-table')
    function measure() {
      const noteBounds = note.getBoundingClientRect()
      if (!noteBounds.width) return
      const panelBounds = panel.getBoundingClientRect()
      const panelStyle = window.getComputedStyle(panel)
      const contentLeft = panelBounds.left + parseFloat(panelStyle.borderLeftWidth) + parseFloat(panelStyle.paddingLeft)
      heading.style.width = `${noteBounds.width}px`
      heading.style.marginLeft = `${noteBounds.left - contentLeft}px`
      const bounds = heading.getBoundingClientRect()
      if (!bounds.width) return
      const tableBounds = table.getBoundingClientRect()
      const next = { width: bounds.width, entrance: bounds.width - 20, desk: tableBounds.left + tableBounds.width / 2 - bounds.left }
      setLayout(previous => Object.keys(next).every(key => Math.abs(previous[key] - next[key]) < .5) ? previous : next)
    }
    const frame = requestAnimationFrame(measure)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(heading)
    observer?.observe(note)
    observer?.observe(panel)
    window.addEventListener('resize', measure)
    return () => { cancelAnimationFrame(frame); observer?.disconnect(); window.removeEventListener('resize', measure) }
  }, [])

  const records = game.actions.map((record, index) => ({ ...record, number: index + 1, item: game.items.find(item => item.index === record.index) }))
    .filter(record => record.outcome === 'missed' || (record.outcome === 'sorted' && record.item && BINS[record.chosen_class]))
  const entries = ['EPOCH START', ...records, 'EPOCH END']
  const travelIn = Math.max(.5, (layout.entrance - layout.desk) / 95)
  const hold = .8
  const travelOut = Math.max(.5, (layout.desk - 20) / 95)
  const duration = travelIn + hold + travelOut
  const spacing = 2.2
  const cycle = entries.length * spacing + duration + 1
  const keyTimes = [0, travelIn / cycle, (travelIn + hold) / cycle, duration / cycle, 1].join(';')
  return <div className="epoch-stage">
    <svg ref={svg} className="epoch-flow" viewBox={`0 0 ${layout.width} 95`} role="img" aria-label="Epoch visualization: sorted items pause with their chosen labels; lava entries pass without an item or a pause, from EPOCH START to EPOCH END.">
    <defs><clipPath id={clip}><rect x="20" y="20" width={Math.max(0, layout.entrance - 20)} height="75" /></clipPath></defs>
    <path d={`M20 69H${layout.entrance}`} stroke="#625b8e" strokeWidth="2" strokeDasharray="4 6" />
    <g className="epoch-flow-animated" clipPath={`url(#${clip})`}>
      {entries.map((entry, index) => {
        const missed = entry.outcome === 'missed'
        const entryDuration = missed ? travelIn + travelOut : duration
        return <g className="epoch-token" key={typeof entry === 'string' ? entry : entry.index} opacity="0" transform={`translate(${layout.entrance} 0)`}>
        <animateTransform attributeName="transform" type="translate" values={missed ? `${layout.entrance} 0;${layout.desk} 0;20 0;20 0` : `${layout.entrance} 0;${layout.desk} 0;${layout.desk} 0;20 0;20 0`} keyTimes={missed ? [0, travelIn / cycle, entryDuration / cycle, 1].join(';') : keyTimes} dur={`${cycle}s`} begin={`${index * spacing}s`} repeatCount="indefinite" />
        <animate attributeName="opacity" values="0;1;1;0;0" keyTimes={`0;${.08 / cycle};${(entryDuration - .08) / cycle};${entryDuration / cycle};1`} dur={`${cycle}s`} begin={`${index * spacing}s`} repeatCount="indefinite" />
        {typeof entry === 'string' ? <text x="0" y="73" textAnchor="middle" fontSize="17" fill="#ffd66b">{entry}</text> : <ItemGroup record={entry} />}
      </g>})}
    </g>
    <g className="epoch-checks" transform={`translate(${layout.desk + 30} 24)`} aria-hidden="true">
      {entries.map((entry, index) => typeof entry !== 'string' && entry.outcome === 'sorted' && <path className="epoch-item-check" key={entry.index} d="M0 6H4V10H8V6H12V2H16V0H20V6H16V10H12V14H8V18H4V14H0Z" fill="#ffd66b" opacity="0">
        <animate attributeName="opacity" values="1;1;0;0" keyTimes={`0;${hold / cycle};${(hold + .08) / cycle};1`} begin={`${index * spacing + travelIn}s`} dur={`${cycle}s`} repeatCount="indefinite" />
      </path>)}
    </g>
    <g className="epoch-flow-still" transform={`translate(${layout.desk} 0)`}>{records[0] ? <ItemGroup record={records[0]} /> : <text y="73" textAnchor="middle" fill="#ffd66b" fontSize="17">EPOCH START</text>}</g>
    <g className="epoch-entrance" aria-label="Entrance">
      <rect x={layout.entrance - 12} y="24" width="24" height="67" fill="#17162c" stroke="#ffd66b" strokeWidth="3" />
      <path d={`M${layout.entrance + 4} 36v42`} stroke="#ffd66b" strokeWidth="3" />
      <text x={layout.entrance} y="16" textAnchor="middle" fill="#ffd66b" fontSize="11">ENTRANCE</text>
    </g>
    <g className="epoch-exit" aria-label="Exit">
      <rect x="8" y="24" width="24" height="67" fill="#17162c" stroke="#c2bbd6" strokeWidth="3" />
      <text x="20" y="16" textAnchor="middle" fill="#c2bbd6" fontSize="11">EXIT</text>
    </g>
  </svg></div>
}
