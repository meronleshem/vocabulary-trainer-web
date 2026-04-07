export const DIFF_LABELS = {
  EASY: 'Easy',
  MEDIUM: 'Medium',
  HARD: 'Hard',
  NEW_WORD: 'New',
}

export const DIFF_COLORS = {
  EASY: 'badge-easy',
  MEDIUM: 'badge-medium',
  HARD: 'badge-hard',
  NEW_WORD: 'badge-new',
}

export const DIFF_DOT = {
  EASY: 'bg-emerald-400',
  MEDIUM: 'bg-amber-400',
  HARD: 'bg-red-400',
  NEW_WORD: 'bg-violet-400',
}

export default function DifficultyBadge({ difficulty }) {
  return (
    <span className={DIFF_COLORS[difficulty] || 'badge-new'}>
      {DIFF_LABELS[difficulty] || difficulty}
    </span>
  )
}
