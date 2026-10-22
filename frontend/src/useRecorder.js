import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { api } from './api'
import { BINS } from './gameEngine'

const CORRECT_FEEDBACK = ['Nice +10', 'GREAT +10', 'SMART +10']
const storageKey = id => `waiste-events-${id}`

function restoredQueue(id) {
  try {
    const saved = JSON.parse(window.sessionStorage.getItem(storageKey(id)) || '[]')
    return Array.isArray(saved) ? saved : []
  } catch { return [] }
}

export default function useRecorder(id, setGame, setFeedback) {
  // Each session keeps its own pump, including while a different student plays.
  const [sessions] = useState(() => new Map())
  const active = useRef(null), callbacks = useRef({ setGame, setFeedback })
  const [, refresh] = useState(0)
  const context = useMemo(() => {
    if (!id) return null
    if (!sessions.has(id)) sessions.set(id, { id, queue: restoredQueue(id), sending: false, error: '' })
    return sessions.get(id)
  }, [id, sessions])
  const publish = useCallback(session => {
    if (active.current === session) refresh(value => value + 1)
  }, [refresh])
  const persist = useCallback(session => {
    window.sessionStorage.setItem(storageKey(session.id), JSON.stringify(session.queue))
    publish(session)
  }, [publish])
  const pump = useCallback(async session => {
    if (!session || session.sending || !session.queue.length) return
    session.sending = true
    session.error = ''
    publish(session)
    try {
      while (session.queue.length) {
        const event = session.queue[0]
        const result = await api(`/sessions/${session.id}${event.path}`, event.body)
        if (event.type === 'action' && active.current === session) {
          callbacks.current.setGame(current => {
            if (current?.id !== session.id || active.current !== session) return current
            return { ...current, summary: result.summary, actions: [
              ...current.actions.filter(action => action.index !== event.index),
              { index: event.index, ...event.body, correct: result.correct, expected_class: result.expected_class },
            ] }
          })
          const feedback = {
            id: `${session.id}-${event.index}`,
            kind: event.body.outcome === 'missed' ? 'missed' : result.correct ? 'correct' : 'incorrect',
            message: event.body.outcome === 'missed' ? 'NOT THE LAVA! RE-CYCLER wont be able to see that item in training.' :
              result.correct ? CORRECT_FEEDBACK[Math.floor(Math.random() * CORRECT_FEEDBACK.length)] :
                `${BINS[event.body.chosen_class]}, really? I thought that was ${BINS[result.expected_class]}`,
          }
          callbacks.current.setFeedback(current => active.current === session ? feedback : current)
        }
        session.queue.shift()
        persist(session)
      }
    } catch (err) {
      session.error = `Progress is waiting to save: ${err.message}`
      publish(session)
    } finally { session.sending = false }
  }, [persist, publish])
  useLayoutEffect(() => {
    active.current = context
    callbacks.current = { setGame, setFeedback }
    void pump(context)
    return () => { if (active.current === context) active.current = null }
  }, [context, pump, setGame, setFeedback])
  const enqueue = useCallback(event => {
    if (!context) return
    context.queue.push(event)
    persist(context)
    void pump(context)
  }, [context, persist, pump])
  const retry = useCallback(() => pump(context), [context, pump])
  const pendingActions = context?.queue.filter(event => event.type === 'action')
    .map(event => ({ index: event.index, ...event.body })) || []
  return { enqueue, pending: context?.queue.length || 0, pendingActions, error: context?.error || '', retry }
}
