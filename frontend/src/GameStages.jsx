const STAGES = [['sort', '1 · Sort'], ['train', '2 · Train'], ['explore', '3 · Test']]

// Both sets of tabs use App's view and the same progress checks.
export default function GameStages({ view, complete, trainingStatus, onChange, bottom = false, navigationRef }) {
  const nextStage = view === 'sort' && complete ? 'train' : view === 'train' && trainingStatus === 'done' ? 'explore' : null
  return <nav ref={navigationRef} className={`stage-nav${bottom ? ' bottom-stage-nav' : ''}`} aria-label={bottom ? 'Game stages at bottom' : 'Game stages'}>
    {STAGES.map(([id, label]) => <button key={id} type="button" data-stage={id} className={nextStage === id ? 'stage-ready' : undefined}
      aria-current={view === id ? 'step' : undefined} disabled={id === 'train' ? !complete : id === 'explore' ? trainingStatus !== 'done' : false}
      onClick={() => onChange(id)}>{label}</button>)}
  </nav>
}
