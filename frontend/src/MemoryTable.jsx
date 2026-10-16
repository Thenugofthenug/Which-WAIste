import { useEffect, useRef } from 'react'
import BinLogo from './BinLogo'
import { BINS, COLORS } from './gameEngine'

export default function MemoryTable({ records, items }) {
  const viewport = useRef()
  const firstRender = useRef(true)
  useEffect(() => {
    const top = Math.max(0, records.length - 4) * 48
    const behavior = firstRender.current || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
    firstRender.current = false
    if (viewport.current.scrollTo) viewport.current.scrollTo({ top, behavior })
    else viewport.current.scrollTop = top
  }, [records.length])

  return <foreignObject x="-236" y="39" width="244" height="267">
    <section className="memory-panel" aria-label="Sorting memory">
      <h2>MEMORY</h2>
      <div className="memory-scroll" ref={viewport} tabIndex={0} aria-label="Sorting history, four items visible at a time">
        <table className="memory-table" aria-label="Items sorted or missed">
          <colgroup><col className="memory-number-column" /><col /><col /></colgroup>
          <thead><tr><th scope="col">#</th><th scope="col">ITEM</th><th scope="col">BIN</th></tr></thead>
          <tbody>{records.map((record, index) => {
            const item = items.find(item => item.index === record.index)
            const missed = record.outcome === 'missed'
            return <tr className="memory-row" key={record.index}>
              <th scope="row">{index + 1}</th>
              <td><img src={item?.image} alt={item?.name || `Item ${record.index + 1}`} width="40" height="40" /></td>
              <td><span className="memory-result" role="img" aria-label={missed ? 'Lava — missed item' : BINS[record.chosen_class]} style={{ backgroundColor: missed ? '#953019' : COLORS[record.chosen_class] }}>
                {missed ? <svg className="memory-flame" width="30" height="30" viewBox="0 0 24 28" aria-hidden="true"><path d="M12 0h4v6h4v6h4v10h-4v4H4v-4H0V12h4v4h4V8h4Z" fill="#ffec27" /><path d="M12 14h4v6h4v4H8v-6h4Z" fill="#fff1e8" /></svg> : <BinLogo bin={record.chosen_class} x={15} y={0} width={30} height={30} animate={false} />}
              </span></td>
            </tr>
          })}</tbody>
        </table>
      </div>
    </section>
  </foreignObject>
}
