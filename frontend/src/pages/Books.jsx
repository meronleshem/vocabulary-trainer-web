import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight, ChevronDown, Book, Layers } from 'lucide-react'
import { getBooks } from '../api/client'

function BookItem({ book }) {
  const [expanded, setExpanded] = useState(false)
  const navigate = useNavigate()

  const browseGroup = (groupName) => {
    navigate(`/browse?group=${encodeURIComponent(groupName)}`)
  }

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
          {book.groups
            .sort((a, b) => {
              const numA = parseInt(a.group_name.match(/\d+$/)?.[0] || '0')
              const numB = parseInt(b.group_name.match(/\d+$/)?.[0] || '0')
              return numA - numB
            })
            .map((g) => (
              <button
                key={g.group_name}
                className="w-full flex items-center justify-between px-5 py-3 hover:bg-dark-500 transition-colors text-left"
                onClick={() => browseGroup(g.group_name)}
              >
                <div className="flex items-center gap-3">
                  <Layers size={14} className="text-slate-600" />
                  <span className="text-slate-300 text-sm">
                    {(g.group_name || 'Uncategorized').replace(/_/g, ' ')}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500">{g.count} words</span>
                  <ChevronRight size={14} className="text-slate-600" />
                </div>
              </button>
            ))}
        </div>
      )}
    </div>
  )
}

export default function Books() {
  const [books, setBooks] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getBooks()
      .then((r) => setBooks(r.data))
      .finally(() => setLoading(false))
  }, [])

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
        <h1 className="text-2xl font-bold text-slate-100">Books</h1>
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
          <BookItem key={b.book} book={b} />
        ))}
      </div>
    </div>
  )
}
