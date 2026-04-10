import { useEffect, useState, useCallback, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Plus, Search, Upload, ChevronUp, ChevronDown, Pencil, Trash2, ChevronLeft, ChevronRight } from 'lucide-react'
import { getWords, deleteWord, getGroups, getBooks, patchDifficulty } from '../api/client'
import { DIFF_LABELS } from '../components/DifficultyBadge'
import WordModal from '../components/WordModal'
import QuickAddModal from '../components/QuickAddModal'
import ImportModal from '../components/ImportModal'
import { GroupPickerDropdown } from '../components/GroupPicker'

const DIFFICULTIES = ['', 'NEW_WORD', 'EASY', 'MEDIUM', 'HARD']

function SortIcon({ col, sortBy, sortDir }) {
  if (sortBy !== col) return <ChevronUp size={14} className="text-slate-600" />
  return sortDir === 'asc'
    ? <ChevronUp size={14} className="text-primary-light" />
    : <ChevronDown size={14} className="text-primary-light" />
}

export default function Browse() {
  const [searchParams] = useSearchParams()
  const [data, setData] = useState({ words: [], total: 0 })
  const [loading, setLoading] = useState(false)
  const [groups, setGroups] = useState([])
  const [books, setBooks] = useState([])

  // Filters — seed groupName from ?group= query param (from Books page)
  const [search, setSearch] = useState('')
  const [difficulty, setDifficulty] = useState('')
  const [groupName, setGroupName] = useState(() => searchParams.get('group') || '')

  // Pagination
  const [page, setPage] = useState(1)
  const LIMIT = 50

  // Sort
  const [sortBy, setSortBy] = useState('id')
  const [sortDir, setSortDir] = useState('asc')

  // Modal
  const [modalWord, setModalWord] = useState(undefined) // undefined=closed, null=new, obj=edit
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [showQuickAdd, setShowQuickAdd] = useState(false)
  const [showImport, setShowImport] = useState(false)

  const searchTimer = useRef(null)

  const fetchWords = useCallback(async () => {
    setLoading(true)
    try {
      const res = await getWords({
        search: search || undefined,
        difficulty: difficulty || undefined,
        group_name: groupName || undefined,
        page,
        limit: LIMIT,
        sort_by: sortBy,
        sort_dir: sortDir,
      })
      setData(res.data)
    } finally {
      setLoading(false)
    }
  }, [search, difficulty, groupName, page, sortBy, sortDir])

  useEffect(() => { fetchWords() }, [fetchWords])

  useEffect(() => {
    getGroups().then((r) => setGroups(r.data))
    getBooks().then((r) => setBooks(r.data))
  }, [])

  const handleSearchChange = (val) => {
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => {
      setSearch(val)
      setPage(1)
    }, 300)
  }

  const handleSort = (col) => {
    if (sortBy === col) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortBy(col)
      setSortDir('asc')
    }
    setPage(1)
  }

  const handleDelete = async (id) => {
    await deleteWord(id)
    setDeleteConfirm(null)
    fetchWords()
  }

  const totalPages = Math.ceil(data.total / LIMIT)

  const handleDiffChange = async (word, newDiff) => {
    await patchDifficulty(word.id, newDiff)
    fetchWords()
  }

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Browse Words</h1>
          <p className="text-slate-500 text-sm mt-0.5">{data.total.toLocaleString()} words</p>
        </div>
        <div className="flex gap-2">
          <button
            className="btn-ghost flex items-center gap-2"
            onClick={() => setShowImport(true)}
          >
            <Upload size={16} /> Import
          </button>
          <button
            className="btn-ghost flex items-center gap-2"
            onClick={() => setShowQuickAdd(true)}
          >
            <Search size={16} /> Quick Add
          </button>
          <button
            className="btn-primary flex items-center gap-2"
            onClick={() => setModalWord(null)}
          >
            <Plus size={16} /> Add Word
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="card flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-48">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            className="input pl-9"
            placeholder="Search English or Hebrew…"
            onChange={(e) => handleSearchChange(e.target.value)}
          />
        </div>
        <select
          className="input w-36"
          value={difficulty}
          onChange={(e) => { setDifficulty(e.target.value); setPage(1) }}
        >
          <option value="">All difficulties</option>
          {DIFFICULTIES.filter(Boolean).map((d) => (
            <option key={d} value={d}>{DIFF_LABELS[d] || d}</option>
          ))}
        </select>
        <GroupPickerDropdown
          books={books}
          value={groupName}
          onChange={(val) => { setGroupName(val); setPage(1) }}
        />
      </div>

      {/* Table */}
      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-dark-400 text-left">
                {[
                  { key: 'engWord', label: 'English' },
                  { key: 'hebWord', label: 'Hebrew' },
                  { key: 'difficulty', label: 'Difficulty' },
                  { key: 'group_name', label: 'Group' },
                ].map((col) => (
                  <th
                    key={col.key}
                    className="px-4 py-3 text-slate-500 font-medium text-xs uppercase tracking-wider cursor-pointer select-none hover:text-slate-300 transition-colors"
                    onClick={() => handleSort(col.key)}
                  >
                    <div className="flex items-center gap-1">
                      {col.label}
                      <SortIcon col={col.key} sortBy={sortBy} sortDir={sortDir} />
                    </div>
                  </th>
                ))}
                <th className="px-4 py-3 text-slate-500 font-medium text-xs uppercase tracking-wider text-right">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={5} className="text-center py-12 text-slate-500">
                    <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
                  </td>
                </tr>
              )}
              {!loading && data.words.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center py-12 text-slate-500">
                    No words found.
                  </td>
                </tr>
              )}
              {!loading &&
                data.words.map((word) => (
                  <tr
                    key={word.id}
                    className="border-b border-dark-400/50 hover:bg-dark-500/50 transition-colors group"
                  >
                    <td className="px-4 py-3 font-medium text-slate-200">{word.engWord}</td>
                    <td className="px-4 py-3 text-slate-300 heb">{word.hebWord}</td>
                    <td className="px-4 py-3">
                      <select
                        className="bg-transparent text-xs border-0 outline-none cursor-pointer"
                        value={word.difficulty}
                        onChange={(e) => handleDiffChange(word, e.target.value)}
                      >
                        {['NEW_WORD', 'EASY', 'MEDIUM', 'HARD'].map((d) => (
                          <option key={d} value={d} style={{ background: '#1a1d27' }}>
                            {DIFF_LABELS[d]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs">
                      {(word.group_name || '').replace(/_/g, ' ')}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => setModalWord(word)}
                          className="p-1.5 rounded-md text-slate-400 hover:text-slate-200 hover:bg-dark-400 transition-colors"
                          title="Edit"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => setDeleteConfirm(word)}
                          className="p-1.5 rounded-md text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                          title="Delete"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-dark-400">
            <p className="text-xs text-slate-500">
              Page {page} of {totalPages} · {data.total} results
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="btn-ghost p-1.5 disabled:opacity-30"
              >
                <ChevronLeft size={16} />
              </button>
              <span className="text-sm text-slate-400 w-12 text-center">{page} / {totalPages}</span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="btn-ghost p-1.5 disabled:opacity-30"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Import Modal */}
      {showImport && (
        <ImportModal
          books={books}
          onClose={() => setShowImport(false)}
          onSaved={() => {
            fetchWords()
            getBooks().then((r) => setBooks(r.data))
          }}
        />
      )}

      {/* Quick Add Modal */}
      {showQuickAdd && (
        <QuickAddModal
          books={books}
          onClose={() => setShowQuickAdd(false)}
          onSaved={() => {
            fetchWords()
            getBooks().then((r) => setBooks(r.data))
          }}
        />
      )}

      {/* Word Modal */}
      {modalWord !== undefined && (
        <WordModal
          word={modalWord}
          groups={groups}
          onClose={() => setModalWord(undefined)}
          onSaved={() => {
            setModalWord(undefined)
            fetchWords()
          }}
        />
      )}

      {/* Delete confirm */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-dark-600 border border-dark-400 rounded-xl p-6 w-full max-w-sm shadow-2xl animate-slide-up">
            <h3 className="text-lg font-semibold text-slate-100 mb-2">Delete Word</h3>
            <p className="text-slate-400 text-sm mb-5">
              Delete <span className="text-slate-200 font-medium">"{deleteConfirm.engWord}"</span>? This cannot be undone.
            </p>
            <div className="flex gap-3">
              <button className="btn-ghost flex-1" onClick={() => setDeleteConfirm(null)}>
                Cancel
              </button>
              <button
                className="flex-1 bg-red-500 text-white px-4 py-2 rounded-lg font-medium hover:bg-red-600 transition-colors"
                onClick={() => handleDelete(deleteConfirm.id)}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
