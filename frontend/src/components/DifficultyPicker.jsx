import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { DIFF_LABELS, DIFF_DOT } from './DifficultyBadge'

const DIFFS = ['NEW_WORD', 'EASY', 'MEDIUM', 'HARD']

export default function DifficultyPicker({ value = [], onChange }) {
  const [open, setOpen] = useState(false)
  const isAll = value.length === 0

  const toggle = (d) => {
    if (value.includes(d)) onChange(value.filter((x) => x !== d))
    else onChange([...value, d])
  }

  return (
    <div className="border border-dark-400 rounded-lg overflow-hidden text-sm">
      {/* Collapse header */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full text-left px-3 py-2 flex items-center justify-between transition-colors hover:bg-dark-400"
      >
        <div className="flex items-center gap-2">
          {isAll ? (
            <span className="text-slate-300">All difficulties</span>
          ) : (
            <div className="flex items-center gap-1.5">
              {value.map((d) => (
                <span key={d} className={`w-2 h-2 rounded-full ${DIFF_DOT[d]}`} />
              ))}
              <span className="text-primary-light ml-0.5">{value.length} selected</span>
            </div>
          )}
        </div>
        <ChevronDown
          size={14}
          className={`text-slate-500 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {/* Options */}
      {open && (
        <>
          <button
            type="button"
            onClick={() => onChange([])}
            className={`w-full text-left px-3 py-1.5 border-t border-dark-400 transition-colors ${
              isAll ? 'bg-primary/15 text-primary-light' : 'text-slate-400 hover:bg-dark-400 hover:text-slate-300'
            }`}
          >
            All
          </button>
          {DIFFS.map((d) => {
            const active = value.includes(d)
            return (
              <button
                key={d}
                type="button"
                onClick={() => toggle(d)}
                className={`w-full text-left px-3 py-1.5 flex items-center justify-between border-t border-dark-400 transition-colors ${
                  active ? 'bg-primary/15 text-primary-light' : 'text-slate-400 hover:bg-dark-400 hover:text-slate-300'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${DIFF_DOT[d]}`} />
                  <span>{DIFF_LABELS[d]}</span>
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
        </>
      )}
    </div>
  )
}
