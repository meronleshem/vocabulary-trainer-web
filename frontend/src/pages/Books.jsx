import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight, ChevronDown, Book, Layers, Pencil, X, Check } from 'lucide-react'
import { getBooks, getGroups, renameGroup } from '../api/client'

const DIFF_SEGMENTS = [
  { key: 'easy',     color: 'bg-emerald-400', label: 'Easy' },
  { key: 'medium',   color: 'bg-amber-400',   label: 'Medium' },
  { key: 'hard',     color: 'bg-red-400',      label: 'Hard' },
  { key: 'new_word', color: 'bg-violet-400',   label: 'New' },
]

function DiffBar({ g }) {
  const total = g.count || 1
  return (
    <div className="flex h-2 w-32 rounded-full overflow-hidden bg-dark-400 gap-px">
      {DIFF_SEGMENTS.map((s) => {
        const pct = (g[s.key] / total) * 100
        if (pct === 0) return null
        return (
          <div
            key={s.key}
            className={`${s.color} h-full`}
            style={{ width: `${pct}%` }}
            title={`${s.label}: ${g[s.key]}`}
          />
        )
      })}
    </div>
  )
}

function RenameInline({ groupName, allGroupNames, onSave, onCancel }) {
  const [value, setValue] = useState(groupName)
  const [error, setError] = useState('')
  const inputRef = useRef(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const normalized = (s) => s.trim()

  const handleSave = () => {
    const newName = normalized(value)
    if (!newName) { setError('Name cannot be empty'); return }
    if (newName === groupName) { onCancel(); return }
    if (allGroupNames.includes(newName)) {
      setError(`"${newName}" already exists`)
      return
    }
    onSave(newName)
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleSave()
    if (e.key === 'Escape') onCancel()
  }

  return (
    <div className="flex items-center gap-2 flex-1" onClick={(e) => e.stopPropagation()}>
      <div className="flex flex-col flex-1 min-w-0">
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => { setValue(e.target.value); setError('') }}
          onKeyDown={handleKeyDown}
          className="bg-dark-400 border border-primary/40 text-slate-200 text-sm rounded px-2 py-0.5 w-full focus:outline-none focus:border-primary/70"
        />
        {error && <span className="text-xs text-red-400 mt-0.5">{error}</span>}
      </div>
      <button
        onClick={handleSave}
        className="text-emerald-400 hover:text-emerald-300 flex-shrink-0"
        title="Save"
      >
        <Check size={15} />
      </button>
      <button
        onClick={onCancel}
        className="text-slate-500 hover:text-slate-300 flex-shrink-0"
        title="Cancel"
      >
        <X size={15} />
      </button>
    </div>
  )
}

function BookItem({ book, allGroupNames, onRenamed }) {
  const [expanded, setExpanded] = useState(false)
  const [renamingGroup, setRenamingGroup] = useState(null)
  const [saving, setSaving] = useState(false)
  const navigate = useNavigate()

  const browseGroup = (groupName) => {
    navigate(`/browse?group=${encodeURIComponent(groupName)}`)
  }

  const handleRename = async (oldName, newName) => {
    setSaving(true)
    try {
      await renameGroup(oldName, newName)
      setRenamingGroup(null)
      onRenamed()
    } finally {
      setSaving(false)
    }
  }

  const sortedGroups = [...book.groups].sort((a, b) => {
    const numA = parseInt(a.group_name.match(/\d+$/)?.[0] || '0')
    const numB = parseInt(b.group_name.match(/\d+$/)?.[0] || '0')
    return numA - numB
  })

  return (
    <div className="card p-0 overflow-hidden">
      {/* Book header */}
      <button
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-dark-500 transition-colors text-left"
        onClick={() => setExpanded((e) => !e)}
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-primary/15 rounded-lg flex items-center justify-center">
            <Book size={16} className="text-primary-light" />
          </div>
          <div>
            <p className="font-semibold text-slate-200">{book.book}</p>
            <p className="text-xs text-slate-500 mt-0.5">
              {book.total} words · {book.groups.length} chapters
            </p>
          </div>
        </div>
        {expanded
          ? <ChevronDown size={18} className="text-slate-500" />
          : <ChevronRight size={18} className="text-slate-500" />
        }
      </button>

      {/* Chapters */}
      {expanded && (
        <div className="border-t border-dark-400 divide-y divide-dark-400/50">
          {sortedGroups.map((g) => (
            <div
              key={g.group_name}
              className="flex items-center justify-between px-5 py-3 hover:bg-dark-500 transition-colors group"
            >
              {renamingGroup === g.group_name ? (
                <>
                  <Layers size={14} className="text-slate-600 flex-shrink-0 mr-3" />
                  <RenameInline
                    groupName={g.group_name}
                    allGroupNames={allGroupNames}
                    onSave={(newName) => handleRename(g.group_name, newName)}
                    onCancel={() => setRenamingGroup(null)}
                  />
                </>
              ) : (
                <>
                  <button
                    className="flex items-center gap-3 flex-1 text-left min-w-0"
                    onClick={() => browseGroup(g.group_name)}
                    disabled={saving}
                  >
                    <Layers size={14} className="text-slate-600 flex-shrink-0" />
                    <span className="text-slate-300 text-sm truncate">
                      {(g.group_name || 'Uncategorized').replace(/_/g, ' ')}
                    </span>
                  </button>
                  <div className="flex items-center gap-3">
                    <DiffBar g={g} />
                    <span className="text-xs text-slate-500 w-14 text-right">{g.count} words</span>
                    <button
                      className="text-slate-600 hover:text-primary-light opacity-0 group-hover:opacity-100 transition-opacity ml-1"
                      title="Rename group"
                      onClick={(e) => { e.stopPropagation(); setRenamingGroup(g.group_name) }}
                    >
                      <Pencil size={14} />
                    </button>
                    <ChevronRight size={14} className="text-slate-600" />
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function Books() {
  const [books, setBooks] = useState([])
  const [allGroupNames, setAllGroupNames] = useState([])
  const [loading, setLoading] = useState(true)

  const load = () => {
    return Promise.all([getBooks(), getGroups()])
      .then(([booksRes, groupsRes]) => {
        setBooks(booksRes.data)
        setAllGroupNames(groupsRes.data.map((g) => g.group_name))
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const totalWords = books.reduce((s, b) => s + b.total, 0)

  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-slate-100">Groups</h1>
        <p className="text-slate-500 text-sm mt-1">
          {books.length} books · {totalWords.toLocaleString()} words total
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {books.map((b) => (
          <div key={b.book} className="card hover:border-primary/30 transition-colors cursor-default">
            <p className="font-semibold text-slate-300 text-sm truncate">{b.book}</p>
            <p className="text-2xl font-bold text-slate-100 mt-1">{b.total}</p>
            <p className="text-xs text-slate-600">{b.groups.length} chapters</p>
          </div>
        ))}
      </div>

      {/* Book list */}
      <div className="space-y-3">
        {books.map((b) => (
          <BookItem
            key={b.book}
            book={b}
            allGroupNames={allGroupNames}
            onRenamed={load}
          />
        ))}
      </div>
    </div>
  )
}
