export const DIFF_LABELS = {
  EASY: 'Easy',
  MEDIUM: 'Medium',
  HARD: 'Hard',
  NEW_WORD: 'New',
  DONT_KNOW: "Don't Know",
}

export const DIFF_COLORS = {
  EASY: 'badge-easy',
  MEDIUM: 'badge-medium',
  HARD: 'badge-hard',
  NEW_WORD: 'badge-new',
  DONT_KNOW: 'badge-dont-know',
}

export const DIFF_DOT = {
  EASY: 'bg-emerald-400',
  MEDIUM: 'bg-amber-400',
  HARD: 'bg-red-400',
  NEW_WORD: 'bg-violet-400',
  DONT_KNOW: 'bg-rose-400',
}

export default function DifficultyBadge({ difficulty }) {
  return (
    <span className={DIFF_COLORS[difficulty] || 'badge-new'}>
      {DIFF_LABELS[difficulty] || difficulty}
    </span>
  )
}
