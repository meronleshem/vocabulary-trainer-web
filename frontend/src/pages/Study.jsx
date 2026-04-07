import { useState, useEffect, useCallback } from 'react'
import {
  RefreshCw, ChevronLeft, ChevronRight, RotateCcw,
  Eye, EyeOff, CheckCircle, Settings,
} from 'lucide-react'
import { getStudyWords, patchDifficulty, getGroups } from '../api/client'
import DifficultyBadge, { DIFF_LABELS } from '../components/DifficultyBadge'

const DIFF_BUTTONS = [
  { key: 'EASY', label: 'Easy', cls: 'bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/30 border border-emerald-500/20' },
  { key: 'MEDIUM', label: 'Medium', cls: 'bg-amber-500/15 text-amber-400 hover:bg-amber-500/30 border border-amber-500/20' },
  { key: 'HARD', label: 'Hard', cls: 'bg-red-500/15 text-red-400 hover:bg-red-500/30 border border-red-500/20' },
]

export default function Study() {
  const [groups, setGroups] = useState([])
  const [words, setWords] = useState([])
  const [idx, setIdx] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [showHeb, setShowHeb] = useState(false) // show heb on front or eng
  const [settings, setSettings] = useState({
    difficulty: '',
    group_name: '',
    limit: 20,
    showExamples: true,
  })
  const [showSettings, setShowSettings] = useState(false)
  const [loading, setLoading] = useState(false)
  const [session, setSession] = useState(null) // null means not started
  const [marked, setMarked] = useState({}) // id -> difficulty

  useEffect(() => {
    getGroups().then((r) => setGroups(r.data))
  }, [])

  const start = useCallback(async () => {
    setLoading(true)
    try {
      const res = await getStudyWords({
        difficulty: settings.difficulty || undefined,
        group_name: settings.group_name || undefined,
        limit: settings.limit,
      })
      setWords(res.data)
      setIdx(0)
      setFlipped(false)
      setMarked({})
      setSession({ total: res.data.length, startTime: Date.now() })
      setShowSettings(false)
    } finally {
      setLoading(false)
    }
  }, [settings])

  const current = words[idx]
  const progress = session ? Math.round((idx / session.total) * 100) : 0

  const goNext = () => {
    if (idx < words.length - 1) {
      setIdx((i) => i + 1)
      setFlipped(false)
    }
  }

  const goPrev = () => {
    if (idx > 0) {
      setIdx((i) => i - 1)
      setFlipped(false)
    }
  }

  const markDifficulty = async (diff) => {
    if (!current) return
    setMarked((m) => ({ ...m, [current.id]: diff }))
    await patchDifficulty(current.id, diff)
    goNext()
  }

  // Key bindings
  useEffect(() => {
    const handler = (e) => {
      if (!session || showSettings) return
      if (e.key === 'ArrowRight' || e.key === 'l') goNext()
      if (e.key === 'ArrowLeft' || e.key === 'h') goPrev()
      if (e.key === ' ') { e.preventDefault(); setFlipped((f) => !f) }
      if (e.key === '1') markDifficulty('EASY')
      if (e.key === '2') markDifficulty('MEDIUM')
      if (e.key === '3') markDifficulty('HARD')
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [session, showSettings, idx, current])

  // Not started
  if (!session) {
    return (
      <div className="max-w-lg mx-auto mt-8 space-y-6 animate-fade-in">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Flashcards</h1>
          <p className="text-slate-500 text-sm mt-1">Study words with flip cards</p>
        </div>

        <div className="card space-y-4">
          <h2 className="text-base font-semibold text-slate-200">Session Settings</h2>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Difficulty Filter</label>
            <select
              className="input"
              value={settings.difficulty}
              onChange={(e) => setSettings((s) => ({ ...s, difficulty: e.target.value }))}
            >
              <option value="">All difficulties</option>
              {['NEW_WORD', 'EASY', 'MEDIUM', 'HARD'].map((d) => (
                <option key={d} value={d}>{DIFF_LABELS[d]}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Group Filter</label>
            <select
              className="input"
              value={settings.group_name}
              onChange={(e) => setSettings((s) => ({ ...s, group_name: e.target.value }))}
            >
              <option value="">All groups</option>
              {groups.map((g) => (
                <option key={g.group_name} value={g.group_name}>
                  {(g.group_name || 'Uncategorized').replace(/_/g, ' ')} ({g.count})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">
              Card Count: {settings.limit}
            </label>
            <input
              type="range"
              min={5}
              max={100}
              step={5}
              value={settings.limit}
              onChange={(e) => setSettings((s) => ({ ...s, limit: Number(e.target.value) }))}
              className="w-full accent-primary"
            />
            <div className="flex justify-between text-xs text-slate-600 mt-0.5">
              <span>5</span><span>100</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="showEx"
              checked={settings.showExamples}
              onChange={(e) => setSettings((s) => ({ ...s, showExamples: e.target.checked }))}
              className="accent-primary"
            />
            <label htmlFor="showEx" className="text-sm text-slate-400">Show examples</label>
          </div>

          <button
            className="btn-primary w-full py-2.5"
            onClick={start}
            disabled={loading}
          >
            {loading ? 'Loading…' : 'Start Session'}
          </button>
        </div>
      </div>
    )
  }

  // Finished
  if (idx >= words.length) {
    const markedCount = Object.keys(marked).length
    const easy = Object.values(marked).filter((d) => d === 'EASY').length
    const medium = Object.values(marked).filter((d) => d === 'MEDIUM').length
    const hard = Object.values(marked).filter((d) => d === 'HARD').length

    return (
      <div className="max-w-lg mx-auto mt-8 space-y-6 animate-fade-in">
        <div className="card text-center space-y-4">
          <CheckCircle size={48} className="text-emerald-400 mx-auto" />
          <h2 className="text-xl font-bold text-slate-100">Session Complete!</h2>
          <p className="text-slate-400">You reviewed {session.total} words</p>

          {markedCount > 0 && (
            <div className="flex justify-center gap-4 text-sm">
              <span className="text-emerald-400">Easy: {easy}</span>
              <span className="text-amber-400">Medium: {medium}</span>
              <span className="text-red-400">Hard: {hard}</span>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button className="btn-ghost flex-1" onClick={() => setSession(null)}>
              New Session
            </button>
            <button className="btn-primary flex-1" onClick={start}>
              <RefreshCw size={14} className="inline mr-1" /> Restart
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Study card
  return (
    <div className="max-w-2xl mx-auto space-y-5 animate-fade-in">
      {/* Top bar */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Flashcards</h1>
          <p className="text-slate-500 text-sm">
            {idx + 1} / {session.total} · {Object.keys(marked).length} marked
          </p>
        </div>
        <div className="flex gap-2">
          <button
            className="btn-ghost p-2"
            onClick={() => { setSession(null); setShowSettings(false) }}
            title="End session"
          >
            <RotateCcw size={16} />
          </button>
        </div>
      </div>

      {/* Progress */}
      <div className="h-1.5 bg-dark-400 rounded-full overflow-hidden">
        <div
          className="h-full bg-primary rounded-full transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Card */}
      <div
        className="card min-h-64 flex flex-col items-center justify-center text-center cursor-pointer select-none
          hover:border-primary/40 transition-colors border-2 border-dark-400 relative"
        onClick={() => setFlipped((f) => !f)}
      >
        {/* Marked badge */}
        {marked[current.id] && (
          <div className="absolute top-4 right-4">
            <DifficultyBadge difficulty={marked[current.id]} />
          </div>
        )}

        {!flipped ? (
          <div className="space-y-3 px-4 animate-fade-in">
            <p className="text-3xl font-bold text-slate-100">{current.engWord}</p>
            <p className="text-slate-600 text-sm">{(current.group_name || '').replace(/_/g, ' ')}</p>
            <p className="text-slate-600 text-xs mt-6">Click to reveal →</p>
          </div>
        ) : (
          <div className="space-y-4 px-4 animate-flip-in">
            <p className="text-slate-400 text-sm">{current.engWord}</p>
            <p className="text-2xl font-bold text-slate-100 heb">{current.hebWord}</p>
            {settings.showExamples && current.examples && (
              <div className="mt-4 max-w-md text-left">
                {current.examples.split('\n').slice(0, 2).map((ex, i) => (
                  <p key={i} className="text-slate-500 text-sm italic mb-1">"{ex}"</p>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Difficulty buttons */}
      <div className="grid grid-cols-3 gap-3">
        {DIFF_BUTTONS.map((b) => (
          <button
            key={b.key}
            className={`py-2.5 rounded-lg font-medium text-sm transition-all ${b.cls}`}
            onClick={() => markDifficulty(b.key)}
          >
            {b.label}
          </button>
        ))}
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <button
          onClick={goPrev}
          disabled={idx === 0}
          className="btn-ghost flex items-center gap-1 disabled:opacity-30"
        >
          <ChevronLeft size={16} /> Prev
        </button>
        <p className="text-xs text-slate-600">Space to flip · 1/2/3 to mark · ←/→ to navigate</p>
        <button
          onClick={goNext}
          disabled={idx >= words.length - 1}
          className="btn-ghost flex items-center gap-1 disabled:opacity-30"
        >
          Next <ChevronRight size={16} />
        </button>
      </div>
    </div>
  )
}
