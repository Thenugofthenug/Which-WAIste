export default function RobotSummary({ summary, saving }) {
  return <g className="robot-summary" role="img" aria-label={`Mission complete: ${summary.score} points, ${summary.correct} correct, ${summary.missed} missed, best streak ${summary.best_streak}.`}>
    <path d="M76 70H444V78H452V86H460V222H452V230H284V238H276V246H268V266H252V238H244V230H68V222H60V86H68V78H76Z" fill="#fff1e8" stroke="#c2c3c7" strokeWidth="4" strokeLinejoin="miter" />
    <g fill="#102117" fontSize="18">
      <text x="260" y="104" textAnchor="middle" fontSize="22">MISSION COMPLETE!</text>
      <text x="260" y="135" textAnchor="middle">Score: {summary.score}</text>
      <text x="84" y="165">Right: {summary.correct}</text><text x="285" y="165">Missed: {summary.missed}</text>
      <text x="260" y="195" textAnchor="middle">Best streak: {summary.best_streak}</text>
      <text x="260" y="218" textAnchor="middle" fontSize="16" fill="#105710">{saving ? `Saving ${saving}…` : 'Progress saved'}</text>
    </g>
  </g>
}
