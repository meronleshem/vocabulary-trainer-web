import { useState, useEffect, useRef } from 'react'
import { ChevronRight, ChevronDown } from 'lucide-react'

/** Sort key matching the backend natural_sort_key: treats trailing numbers numerically */
function naturalSortKey(groupName) {
  if (!groupName) return ['', 0]
  const name = groupName.replace(/_/g, ' ').trim()
  const m = name.match(/(\d+)$/)
  if (m) return [name.slice(0, m.index).trim().toLowerCase(), parseInt(m[1], 10)]
  return [name.toLowerCase(), 0]
}

function sortedBooks(books) {
  return [...books]
    .sort((a, b) => a.book.toLowerCase().localeCompare(b.book.toLowerCase()))
    .map((b) => ({
      ...b,
      groups: [...b.groups].sort((x, y) => {
        const [ax, an] = naturalSortKey(x.group_name)
        const [bx, bn] = naturalSortKey(y.group_name)
        return ax < bx ? -1 : ax > bx ? 1 : an - bn
      }),
    }))
}

const displayName = (group_name) => (group_name || 'Uncategorized').replace(/_/g, ' ')

/**
 * Inline hierarchical group picker — used inside settings panels (Study, Quiz).
 */
export function GroupPickerInline({ books, value, onChange }) {
  const sorted = sortedBooks(books)
  const [expanded, setExpanded] = useState({})

  useEffect(() => {
    if (!value) return
    const owner = sorted.find((b) => b.groups.some((g) => g.group_name === value))
    if (owner) setExpanded((e) => ({ ...e, [owner.book]: true }))
  }, [value]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (bookName) =>
    setExpanded((prev) => ({ ...prev, [bookName]: !prev[bookName] }))

  return (
    <div className="border border-dark-400 rounded-lg overflow-hidden text-sm max-h-64 overflow-y-auto">
      <button
        type="button"
        onClick={() => onChange('')}
        className={`w-full text-left px-3 py-2 flex items-center justify-between transition-colors
          ${value === '' ? 'bg-primary/15 text-primary-light' : 'text-slate-400 hover:bg-dark-400'}`}
      >
        <span>All groups</span>
      </button>

      {sorted.map((b) => {
        const isOpen = !!expanded[b.book]
        const hasSelection = b.groups.some((g) => g.group_name === value)
        return (
          <div key={b.book} className="border-t border-dark-400">
            <button
              type="button"
              onClick={() => toggle(b.book)}
              className={`w-full text-left px-3 py-2 flex items-center gap-2 transition-colors
                ${hasSelection && !isOpen ? 'bg-primary/10 text-primary-light' : 'text-slate-300 hover:bg-dark-400'}`}
            >
              {isOpen
                ? <ChevronDown size={14} className="flex-shrink-0 text-slate-500" />
                : <ChevronRight size={14} className="flex-shrink-0 text-slate-500" />}
              <span className="flex-1 font-medium capitalize">{b.book}</span>
              <span className="text-slate-600 text-xs">{b.total}</span>
            </button>

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
                        : 'text-slate-400 hover:bg-dark-400 hover:text-slate-300'}`}
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

/**
 * Dropdown group picker — used in compact filter bars (Browse).
 */
export function GroupPickerDropdown({ books, value, onChange }) {
  const sorted = sortedBooks(books)
  const [open, setOpen] = useState(false)
  const [expanded, setExpanded] = useState({})
  const ref = useRef(null)

  // Auto-expand book of selected group
  useEffect(() => {
    if (!value) return
    const owner = sorted.find((b) => b.groups.some((g) => g.group_name === value))
    if (owner) setExpanded((e) => ({ ...e, [owner.book]: true }))
  }, [value]) // eslint-disable-line react-hooks/exhaustive-deps

  // Close on outside click
  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const toggle = (bookName) =>
    setExpanded((prev) => ({ ...prev, [bookName]: !prev[bookName] }))

  const select = (val) => { onChange(val); setOpen(false) }

  const label = value ? displayName(value) : 'All groups'

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`input w-52 text-left flex items-center justify-between gap-2 ${
          value ? 'text-primary-light' : 'text-slate-400'
        }`}
      >
        <span className="truncate text-sm">{label}</span>
        <ChevronDown size={14} className={`flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute z-50 top-full mt-1 left-0 w-72 bg-dark-600 border border-dark-400 rounded-lg shadow-2xl overflow-hidden text-sm max-h-80 overflow-y-auto">
          <button
            type="button"
            onClick={() => select('')}
            className={`w-full text-left px-3 py-2 transition-colors
              ${value === '' ? 'bg-primary/15 text-primary-light' : 'text-slate-400 hover:bg-dark-500'}`}
          >
            All groups
          </button>

          {sorted.map((b) => {
            const isOpen = !!expanded[b.book]
            const hasSelection = b.groups.some((g) => g.group_name === value)
            return (
              <div key={b.book} className="border-t border-dark-400">
                <button
                  type="button"
                  onClick={() => toggle(b.book)}
                  className={`w-full text-left px-3 py-2 flex items-center gap-2 transition-colors
                    ${hasSelection && !isOpen ? 'bg-primary/10 text-primary-light' : 'text-slate-300 hover:bg-dark-500'}`}
                >
                  {isOpen
                    ? <ChevronDown size={14} className="flex-shrink-0 text-slate-500" />
                    : <ChevronRight size={14} className="flex-shrink-0 text-slate-500" />}
                  <span className="flex-1 font-medium capitalize">{b.book}</span>
                  <span className="text-slate-600 text-xs">{b.total}</span>
                </button>

                {isOpen && (
                  <div className="bg-dark-700/40">
                    {b.groups.map((g) => (
                      <button
                        key={g.group_name}
                        type="button"
                        onClick={() => select(g.group_name)}
                        className={`w-full text-left pl-8 pr-3 py-1.5 flex items-center justify-between transition-colors
                          ${value === g.group_name
                            ? 'bg-primary/15 text-primary-light'
                            : 'text-slate-400 hover:bg-dark-500 hover:text-slate-300'}`}
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
      )}
    </div>
  )
}

// Default export = inline (existing usage in Study/Quiz)
export default GroupPickerInline
