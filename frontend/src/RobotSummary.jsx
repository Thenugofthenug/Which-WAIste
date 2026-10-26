export default function RobotSummary({ summary, saving }) {
  return <g className="robot-summary" role="img" aria-label={`Mission complete: ${summary.score} points, ${summary.correct} sorted correctly, ${summary.missed} lost to lava, best streak ${summary.best_streak}.`}>
    <path d="M76 70H444V78H452V86H460V222H452V230H284V238H276V246H268V266H252V238H244V230H68V222H60V86H68V78H76Z" fill="#fff1d6" stroke="#c2bbd6" strokeWidth="4" strokeLinejoin="miter" />
    <g fill="#211f3a" fontSize="18">
      <text x="260" y="104" textAnchor="middle" fontSize="22">MISSION COMPLETE!</text>
      <text x="260" y="130" textAnchor="middle">Score: {summary.score}</text>
      <text x="260" y="153" textAnchor="middle">Sorted Correctly: <tspan fill="#187338" fontWeight="bold">{summary.correct}</tspan></text>
      <text x="260" y="176" textAnchor="middle">Lost to Lava: <tspan fill="#c62828" fontWeight="bold">{summary.missed}</tspan></text>
      <text x="260" y="199" textAnchor="middle">Best streak: {summary.best_streak}</text>
      <text x="260" y="218" textAnchor="middle" fontSize="16" fill="#3d485b">{saving ? `Saving ${saving}…` : 'Progress saved'}</text>
    </g>
  </g>
}
