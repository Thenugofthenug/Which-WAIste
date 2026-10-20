import { useState } from 'react'

export default function StudentEntry({ busy, hasMission, onStart, onCancel }) {
  const [firstName, setFirstName] = useState(''), [lastName, setLastName] = useState('')
  function submit(event) {
    event.preventDefault()
    if (!firstName.trim() || !lastName.trim()) return
    void onStart({ first_name: firstName.trim(), last_name: lastName.trim() })
  }
  return <form className="student-entry" aria-labelledby="student-entry-title" onSubmit={submit}>
    <div className="student-entry-heading"><h3 id="student-entry-title">Who is teaching the robot?</h3><p>Your name links your game activity for this class project.</p></div>
    <div className="student-name-fields">
      <label htmlFor="student-first-name">First name<input id="student-first-name" name="first_name" autoComplete="given-name" required maxLength={80} value={firstName} disabled={busy} onChange={event => setFirstName(event.target.value)} /></label>
      <label htmlFor="student-last-name">Last name<input id="student-last-name" name="last_name" autoComplete="family-name" required maxLength={80} value={lastName} disabled={busy} onChange={event => setLastName(event.target.value)} /></label>
    </div>
    <div className="home-actions"><button type="submit" className="green start-button" disabled={busy || !firstName.trim() || !lastName.trim()}>{busy ? 'Preparing your mission…' : 'START'}</button>{hasMission && <button type="button" disabled={busy} onClick={onCancel}>Back to current mission</button>}</div>
  </form>
}
