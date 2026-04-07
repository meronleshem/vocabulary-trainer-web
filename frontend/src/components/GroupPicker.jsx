import { useState, useEffect } from 'react'
import { ChevronRight, ChevronDown } from 'lucide-react'

/**
 * Hierarchical group selector.
 * Props:
 *   books   – array from /api/books: [{book, total, groups:[{group_name,count}]}]
 *   value   – currently selected group_name ('' = all)
 *   onChange – called with group_name string ('' = all)
 */
export default function GroupPicker({ books, value, onChange }) {
  // Track which books are expanded
  const [expanded, setExpanded] = useState({})

  // Auto-expand the book that contains the current value
  useEffect(() => {
    if (!value) return
    const ownerBook = books.find((b) => b.groups.some((g) => g.group_name === value))
    if (ownerBook) {
      setExpanded((e) => ({ ...e, [ownerBook.book]: true }))
    }
  }, [value, books])

  const toggle = (bookName, e) => {
    e.stopPropagation()
    setExpanded((prev) => ({ ...prev, [bookName]: !prev[bookName] }))
  }

  const displayName = (group_name) =>
    (group_name || 'Uncategorized').replace(/_/g, ' ')

  return (
    <div className="border border-dark-400 rounded-lg overflow-hidden text-sm">
      {/* All groups row */}
      <button
        type="button"
        onClick={() => onChange('')}
        className={`w-full text-left px-3 py-2 flex items-center justify-between transition-colors
          ${value === ''
            ? 'bg-primary/15 text-primary-light'
            : 'text-slate-400 hover:bg-dark-400'
          }`}
      >
        <span>All groups</span>
      </button>

      {/* Books */}
      {books.map((b) => {
        const isOpen = !!expanded[b.book]
        const hasSelection = b.groups.some((g) => g.group_name === value)

        return (
          <div key={b.book} className="border-t border-dark-400">
            {/* Book header row */}
            <button
              type="button"
              onClick={(e) => toggle(b.book, e)}
              className={`w-full text-left px-3 py-2 flex items-center gap-2 transition-colors
                ${hasSelection && !isOpen
                  ? 'bg-primary/10 text-primary-light'
                  : 'text-slate-300 hover:bg-dark-400'
                }`}
            >
              {isOpen
                ? <ChevronDown size={14} className="flex-shrink-0 text-slate-500" />
                : <ChevronRight size={14} className="flex-shrink-0 text-slate-500" />
              }
              <span className="flex-1 font-medium capitalize">{b.book}</span>
              <span className="text-slate-600 text-xs">{b.total}</span>
            </button>

            {/* Groups inside this book */}
            {isOpen && (
              <div className="bg-dark-600/40">
                {b.groups.map((g) => (
                  <button
                    key={g.group_name}
                    type="button"
                    onClick={() => onChange(g.group_name)}
                    className={`w-full text-left pl-8 pr-3 py-1.5 flex items-center justify-between transition-colors
                      ${value === g.group_name
                        ? 'bg-primary/15 text-primary-light'
                        : 'text-slate-400 hover:bg-dark-400 hover:text-slate-300'
                      }`}
                  >
                    <span>{displayName(g.group_name)}</span>
                    <span className="text-slate-600 text-xs">{g.count}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
