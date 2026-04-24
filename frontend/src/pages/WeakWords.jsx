import { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Flame, RotateCcw, Play, SlidersHorizontal, CheckCircle2 } from 'lucide-react'
import { getWeakWords, patchDifficulty } from '../api/client'
import { getImageUrl } from '../utils/image'
import DifficultyBadge from '../components/DifficultyBadge'

const SESSION_LIMIT = 20
const MIN_SESSION = 2

const shuffle = (arr) => {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

const KIND_TABS = [
  { value: 'all',       label: 'All' },
  { value: 'hard',      label: 'Hard only' },
  { value: 'dont_know', label: "Don't Know only" },
]

const SORT_OPTIONS = [
  { value: 'weak_count', label: 'Most struggled' },
  { value: 'last_seen',  label: 'Recently seen' },
  { value: 'difficulty', label: 'Hardest first' },
]

function WeakBadge({ count }) {
  if (count < 2) return null
  return (
    <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold bg-amber-500/15 text-amber-400 rounded-full px-1.5 py-0.5">
      {count}×
    </span>
  )
}

function WordRow({ word, onPromote }) {
  const imageUrl = word.image_url ? getImageUrl(word.image_url, word.group_name) : null
  const [promoting, setPromoting] = useState(false)
  const [promoted, setPromoted] = useState(false)

  const handlePromote = async () => {
    setPromoting(true)
    try {
      await patchDifficulty(word.id, 'MEDIUM')
      setPromoted(true)
      onPromote(word.id)
    } catch {
      setPromoting(false)
    }
  }

  if (promoted) return null

  return (
    <div className="flex items-center gap-3 py-3 px-4 rounded-lg hover:bg-dark-500 transition-colors group">
      {/* Thumbnail */}
      <div className="w-10 h-10 rounded-md overflow-hidden bg-dark-500 flex-shrink-0 border border-dark-400">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={word.engWord}
            className="w-full h-full object-cover"
            onError={(e) => { e.target.style.display = 'none' }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-slate-600 text-xs">
            {word.engWord[0]?.toUpperCase()}
          </div>
        )}
      </div>

      {/* Word info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-slate-100 truncate">{word.engWord}</span>
          <WeakBadge count={word.weak_count} />
        </div>
        <p className="text-slate-500 text-sm truncate heb">{word.hebWord}</p>
      </div>

      {/* Right side */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <DifficultyBadge difficulty={word.difficulty} />
        <button
          onClick={handlePromote}
          disabled={promoting}
          title="Mark as Good — remove from weak list"
          className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-md text-slate-500 hover:text-emerald-400 hover:bg-emerald-500/10"
        >
          <CheckCircle2 size={15} />
        </button>
      </div>
    </div>
  )
}

export default function WeakWords() {
  const navigate = useNavigate()
  const [allWords, setAllWords]     = useState([])
  const [count, setCount]           = useState(0)
  const [loading, setLoading]       = useState(true)
  const [kind, setKind]             = useState('all')
  const [sortBy, setSortBy]         = useState('weak_count')
  const [sessionLimit, setSessionLimit] = useState(SESSION_LIMIT)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await getWeakWords({ kind, sort_by: sortBy, limit: 200 })
      setAllWords(res.data.words)
      setCount(res.data.count)
    } finally {
      setLoading(false)
    }
  }, [kind, sortBy])

  useEffect(() => { load() }, [load])

  // Remove a word from the local list after "promote" action
  const handlePromote = useCallback((wordId) => {
    setAllWords((prev) => prev.filter((w) => w.id !== wordId))
    setCount((c) => Math.max(0, c - 1))
  }, [])

  const canStart = allWords.length >= MIN_SESSION

  const handleStartSession = () => {
    const pool = allWords.length > sessionLimit ? shuffle(allWords).slice(0, sessionLimit) : shuffle(allWords)
    navigate('/study-session', { state: { initialWordIds: pool.map((w) => w.id) } })
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <Flame size={22} className="text-rose-400" />
            <h1 className="text-2xl font-bold text-slate-100">Weak Words</h1>
            {count > 0 && (
              <span className="bg-rose-500/20 text-rose-300 text-xs font-semibold px-2 py-0.5 rounded-full">
                {count}
              </span>
            )}
          </div>
          <p className="text-slate-500 text-sm mt-1">
            Words you rated Hard or Don't Know — focus here to improve
          </p>
        </div>
        <button
          onClick={load}
          className="p-2 rounded-lg text-slate-500 hover:text-slate-200 hover:bg-dark-500 transition-colors flex-shrink-0"
          title="Refresh"
        >
          <RotateCcw size={16} />
        </button>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Kind filter tabs */}
        <div className="flex bg-dark-700 border border-dark-400 rounded-lg p-0.5 gap-0.5">
          {KIND_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setKind(tab.value)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                kind === tab.value
                  ? 'bg-primary/20 text-primary-light'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Sort */}
        <div className="flex items-center gap-1.5 ml-auto">
          <SlidersHorizontal size={13} className="text-slate-500" />
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="bg-dark-700 border border-dark-400 rounded-lg px-2 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-primary"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Session size control */}
      {canStart && (
        <div className="card flex items-center gap-4 py-3">
          <div className="flex-1">
            <label className="text-xs text-slate-400">
              Session size: <span className="text-slate-200 font-medium">{Math.min(sessionLimit, allWords.length)}</span>
              {allWords.length < sessionLimit && (
                <span className="text-slate-600 ml-1">({allWords.length} available)</span>
              )}
            </label>
            <input
              type="range"
              min={MIN_SESSION}
              max={Math.min(50, allWords.length)}
              step={1}
              value={sessionLimit}
              onChange={(e) => setSessionLimit(Number(e.target.value))}
              className="w-full accent-primary mt-1"
            />
          </div>
          <button
            onClick={handleStartSession}
            className="btn-primary flex items-center gap-2 flex-shrink-0"
          >
            <Play size={15} />
            Start Session
          </button>
        </div>
      )}

      {/* Word list */}
      {loading ? (
        <div className="flex items-center justify-center h-32">
          <div className="w-7 h-7 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : allWords.length === 0 ? (
        <div className="card text-center py-14 space-y-3">
          <CheckCircle2 size={44} className="mx-auto text-emerald-400" />
          <p className="text-slate-100 font-semibold text-lg">No weak words — great job!</p>
          <p className="text-slate-500 text-sm">
            Keep studying. Words you mark Hard or Don't Know will appear here.
          </p>
        </div>
      ) : (
        <div className="card divide-y divide-dark-400 p-0 overflow-hidden">
          {allWords.map((word) => (
            <WordRow key={word.id} word={word} onPromote={handlePromote} />
          ))}
        </div>
      )}

      {/* Hint */}
      {allWords.length > 0 && (
        <p className="text-center text-xs text-slate-600">
          Hover a word and click ✓ to mark it as Good and remove it from this list
        </p>
      )}
    </div>
  )
}
