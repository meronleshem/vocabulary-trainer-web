/**
 * FrequencyPicker — inline multi-select for frequency levels.
 *
 * Props:
 *   value    – number[]  selected levels ([] = all)
 *   onChange – (number[]) => void
 */

const LEVELS = [
  { value: 1, label: 'Essential',   dot: 'bg-emerald-500' },
  { value: 2, label: 'Very Common', dot: 'bg-blue-500'    },
  { value: 3, label: 'Common',      dot: 'bg-yellow-500'  },
  { value: 4, label: 'Useful',      dot: 'bg-orange-500'  },
  { value: 5, label: 'Rare',        dot: 'bg-red-500'     },
]

export default function FrequencyPicker({ value = [], onChange }) {
  const toggle = (level) => {
    if (value.includes(level)) {
      onChange(value.filter((v) => v !== level))
    } else {
      onChange([...value, level])
    }
  }

  const isAll = value.length === 0

  return (
    <div className="border border-dark-400 rounded-lg overflow-hidden text-sm">
      {/* All frequencies */}
      <button
        type="button"
        onClick={() => onChange([])}
        className={`w-full text-left px-3 py-2 flex items-center justify-between transition-colors ${
          isAll ? 'bg-primary/15 text-primary-light' : 'text-slate-400 hover:bg-dark-400'
        }`}
      >
        <span>All frequencies</span>
        {!isAll && (
          <span className="text-xs bg-primary/20 text-primary-light rounded-full px-1.5 py-0.5">
            {value.length} selected
          </span>
        )}
      </button>

      {/* Individual levels */}
      {LEVELS.map(({ value: lvl, label, dot }) => {
        const active = value.includes(lvl)
        return (
          <button
            key={lvl}
            type="button"
            onClick={() => toggle(lvl)}
            className={`w-full text-left px-3 py-1.5 flex items-center justify-between border-t border-dark-400 transition-colors ${
              active ? 'bg-primary/15 text-primary-light' : 'text-slate-400 hover:bg-dark-400 hover:text-slate-300'
            }`}
          >
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dot}`} />
              <span>{label}</span>
            </div>
            <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center flex-shrink-0 ${
              active ? 'bg-primary border-primary' : 'border-slate-600'
            }`}>
              {active && (
                <svg viewBox="0 0 10 10" className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="1.5,5 4,7.5 8.5,2" />
                </svg>
              )}
            </span>
          </button>
        )
      })}
    </div>
  )
}
