import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import './DefinitionBubble.css'

// Click-to-open definitions work with touch and keyboard, too. A portal keeps
// the small popup clear of clipped game panels without covering the whole game.
export default function DefinitionBubble({ title, label = title, topic, track, className = '', children }) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const trigger = useRef(null), popup = useRef(null), closeButton = useRef(null)
  const id = useId()

  const close = useCallback(() => {
    setOpen(false)
    trigger.current?.focus({ preventScroll: true })
  }, [])
  function toggle() {
    if (open) close()
    else {
      document.dispatchEvent(new window.CustomEvent('waiste:definition-open', { detail: id }))
      setOpen(true); track?.(topic)
    }
  }
  useLayoutEffect(() => {
    if (!open) return
    function place() {
      const anchor = trigger.current.getBoundingClientRect()
      const bounds = popup.current.getBoundingClientRect()
      const width = window.innerWidth, height = window.innerHeight
      const left = Math.max(12, Math.min(anchor.left, width - bounds.width - 12))
      const below = anchor.bottom + 8
      const top = below + bounds.height <= height - 12 ? below : Math.max(12, anchor.top - bounds.height - 8)
      setPosition({ top, left })
    }
    place()
    closeButton.current.focus({ preventScroll: true })
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true) }
  }, [open])
  useEffect(() => {
    if (!open) return
    function outside(event) {
      if (!popup.current?.contains(event.target) && !trigger.current?.contains(event.target)) close()
    }
    function escape(event) {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() }
    }
    function anotherDefinition(event) { if (event.detail !== id) close() }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape, true)
    document.addEventListener('waiste:definition-open', anotherDefinition)
    return () => {
      document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape, true)
      document.removeEventListener('waiste:definition-open', anotherDefinition)
    }
  }, [open, close, id])

  return <span className={`definition-bubble ${className}`}>
    <button ref={trigger} type="button" className="definition-trigger" aria-label={title} aria-expanded={open} aria-haspopup="dialog" aria-controls={`${id}-popup`} onClick={toggle}
      onKeyDown={event => {
        if (['Enter', ' '].includes(event.key)) { event.preventDefault(); if (!event.repeat) toggle() }
      }}><span className="definition-question" aria-hidden="true">?</span><span>{label}</span></button>
    {open && createPortal(<section ref={popup} id={`${id}-popup`} className="definition-popup" style={position} role="dialog" aria-modal="false" aria-labelledby={`${id}-title`}>
      <header><h3 id={`${id}-title`}>{title}</h3><button ref={closeButton} type="button" className="definition-close" aria-label={`Close help: ${title}`} onClick={close}>×</button></header>
      <div className="definition-content">{children}</div>
    </section>, document.body)}
  </span>
}
