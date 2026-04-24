import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import {
  CalendarClock, ChevronRight, RotateCcw, CheckCircle2,
  Volume2, AlertCircle, Sparkles,
} from 'lucide-react'
import { getSRSDue, getSRSStats, postSRSReview, recordSession } from '../api/client'
import { getImageUrl } from '../utils/image'

// Quality buttons shown after flipping a card
const QUALITY_BUTTONS = [
  { quality: 0, label: 'Again',  sub: '< 1 day',  cls: 'bg-red-500/15 text-red-400 hover:bg-red-500/30 border border-red-500/25' },
  { quality: 1, label: 'Hard',   sub: '~1 day',   cls: 'bg-orange-500/15 text-orange-400 hover:bg-orange-500/30 border border-orange-500/25' },
  { quality: 3, label: 'Good',   sub: 'scheduled', cls: 'bg-blue-500/15 text-blue-400 hover:bg-blue-500/30 border border-blue-500/25' },
  { quality: 5, label: 'Easy',   sub: 'longer',   cls: 'bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/30 border border-emerald-500/25' },
]

const speak = (text, lang = 'en-US') => {
  if (!window.speechSynthesis) return
  window.speechSynthesis.cancel()
  const utt = new SpeechSynthesisUtterance(text)
  utt.lang = lang
  window.speechSynthesis.speak(utt)
}

function UpcomingBar({ upcoming }) {
  if (!upcoming?.length) return null
  const max = Math.max(...upcoming.map((d) => d.count), 1)
  return (
    <div className="flex items-end gap-1 h-10">
      {upcoming.map((d) => {
        const height = Math.max(4, Math.round((d.count / max) * 40))
        const label = new Date(d.date + 'T00:00:00').toLocaleDateString('en', { weekday: 'short' })
        return (
          <div key={d.date} className="flex flex-col items-center gap-0.5 flex-1">
            <span className="text-[9px] text-slate-500">{d.count || ''}</span>
            <div
              className="w-full rounded-sm bg-primary/40"
              style={{ height: `${height}px` }}
              title={`${label}: ${d.count} due`}
            />
            <span className="text-[9px] text-slate-600">{label}</span>
          </div>
        )
      })}
    </div>
  )
}

// ── Setup screen ──────────────────────────────────────────────────────────────
function SetupScreen({ stats, onStart }) {
  const [limit, setLimit] = useState(20)

  if (!stats) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="max-w-md mx-auto space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-slate-100">SRS Review</h1>
        <p className="text-slate-500 text-sm mt-1">
          Spaced repetition — review words at the optimal time
        </p>
      </div>

      {/* Due count card */}
      <div className="card space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-slate-400 text-sm">Due today</span>
          <span className="text-3xl font-bold text-slate-100">{stats.due_now}</span>
        </div>
        <div className="flex gap-4 text-sm">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-violet-400" />
            <span className="text-slate-400">{stats.new_words} new</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-blue-400" />
            <span className="text-slate-400">{stats.in_review} review</span>
          </div>
        </div>

        {/* Upcoming sparkline */}
        {stats.upcoming?.some((d) => d.count > 0) && (
          <div>
            <p className="text-xs text-slate-500 mb-2">Upcoming (next 7 days)</p>
            <UpcomingBar upcoming={stats.upcoming} />
          </div>
        )}
      </div>

      {stats.due_now === 0 ? (
        <div className="card text-center py-8 space-y-2">
          <CheckCircle2 size={36} className="mx-auto text-emerald-400" />
          <p className="text-slate-200 font-medium">All caught up!</p>
          <p className="text-slate-500 text-sm">No reviews due. Come back tomorrow.</p>
          <Link to="/dashboard" className="btn-secondary inline-flex items-center gap-2 mt-2">
            Back to Dashboard
          </Link>
        </div>
      ) : (
        <div className="card space-y-4">
          <div>
            <label className="text-sm text-slate-400 mb-1 block">
              Cards to review: <span className="text-slate-200 font-medium">{limit}</span>
            </label>
            <input
              type="range"
              min={5}
              max={Math.min(stats.due_now, 100)}
              step={5}
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              className="w-full accent-primary"
            />
            <div className="flex justify-between text-xs text-slate-600 mt-0.5">
              <span>5</span>
              <span>{Math.min(stats.due_now, 100)}</span>
            </div>
          </div>
          <button
            onClick={() => onStart(limit)}
            className="btn-primary w-full flex items-center justify-center gap-2"
          >
            <CalendarClock size={16} />
            Start Review ({Math.min(limit, stats.due_now)} cards)
          </button>
        </div>
      )}
    </div>
  )
}

// ── Review card ───────────────────────────────────────────────────────────────
function ReviewCard({ word, flipped, onFlip, onRate, progress }) {
  const imageUrl = word.image_url ? getImageUrl(word.image_url, word.group_name) : null

  return (
    <div className="max-w-lg mx-auto space-y-4">
      {/* Progress bar */}
      <div className="flex items-center gap-3">
        <div className="flex-1 h-1.5 bg-dark-500 rounded-full overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all duration-300"
            style={{ width: `${(progress.done / progress.total) * 100}%` }}
          />
        </div>
        <span className="text-xs text-slate-500 whitespace-nowrap">
          {progress.done} / {progress.total}
        </span>
      </div>

      {/* Card */}
      <div
        className="card cursor-pointer select-none min-h-[240px] flex flex-col items-center justify-center gap-4 transition-colors duration-150 hover:border-primary/30"
        onClick={!flipped ? onFlip : undefined}
      >
        {!flipped ? (
          /* Front */
          <div className="text-center space-y-3">
            <p className="text-xs text-slate-500 uppercase tracking-widest">English</p>
            <p className="text-3xl font-bold text-slate-100">{word.engWord}</p>
            {word.group_name && (
              <p className="text-xs text-slate-600">{word.group_name}</p>
            )}
            <div className="flex items-center justify-center gap-2 pt-2">
              <button
                onClick={(e) => { e.stopPropagation(); speak(word.engWord, 'en-US') }}
                className="p-1.5 rounded-md text-slate-500 hover:text-primary hover:bg-primary/10 transition-colors"
              >
                <Volume2 size={16} />
              </button>
              <span className="text-slate-600 text-sm">Tap to reveal</span>
            </div>
            {word.days_overdue > 0 && (
              <span className="inline-flex items-center gap-1 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-full px-2 py-0.5">
                <AlertCircle size={11} /> {word.days_overdue}d overdue
              </span>
            )}
            {word.srs_repetitions === 0 && (
              <span className="inline-flex items-center gap-1 text-xs text-violet-400 bg-violet-500/10 border border-violet-500/20 rounded-full px-2 py-0.5">
                <Sparkles size={11} /> New word
              </span>
            )}
          </div>
        ) : (
          /* Back */
          <div className="text-center space-y-4 w-full">
            <div>
              <p className="text-xs text-slate-500 uppercase tracking-widest mb-1">Hebrew</p>
              <p className="text-3xl font-bold text-slate-100 leading-snug" dir="rtl">
                {word.hebWord}
              </p>
            </div>
            {imageUrl && (
              <img
                src={imageUrl}
                alt={word.engWord}
                className="mx-auto h-28 w-auto object-contain rounded-lg opacity-90"
              />
            )}
            {word.examples && (
              <p className="text-slate-400 text-sm whitespace-pre-line border-t border-dark-400 pt-3 max-w-xs mx-auto">
                {word.examples}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Rating buttons — only shown after flip */}
      {flipped && (
        <div className="grid grid-cols-4 gap-2 animate-fade-in">
          {QUALITY_BUTTONS.map((btn) => (
            <button
              key={btn.quality}
              onClick={() => onRate(btn.quality)}
              className={`flex flex-col items-center gap-0.5 px-2 py-3 rounded-lg text-sm font-medium transition-all ${btn.cls}`}
            >
              <span>{btn.label}</span>
              <span className="text-[10px] opacity-60">{btn.sub}</span>
            </button>
          ))}
        </div>
      )}

      {/* Flip button when not yet flipped */}
      {!flipped && (
        <button
          onClick={onFlip}
          className="btn-secondary w-full flex items-center justify-center gap-2"
        >
          Show Answer <ChevronRight size={16} />
        </button>
      )}
    </div>
  )
}

// ── Done screen ───────────────────────────────────────────────────────────────
function DoneScreen({ results, onRestart }) {
  const counts = { 0: 0, 1: 0, 3: 0, 5: 0 }
  results.forEach((r) => { counts[r.quality] = (counts[r.quality] || 0) + 1 })
  const nextDates = results.map((r) => r.next_review).filter(Boolean).sort()
  const earliest = nextDates[0]

  return (
    <div className="max-w-md mx-auto space-y-6 animate-fade-in">
      <div className="text-center space-y-2">
        <CheckCircle2 size={48} className="mx-auto text-emerald-400" />
        <h2 className="text-2xl font-bold text-slate-100">Session Complete</h2>
        <p className="text-slate-500 text-sm">{results.length} cards reviewed</p>
      </div>

      <div className="card grid grid-cols-2 gap-4">
        {[
          { label: 'Again', count: counts[0], cls: 'text-red-400' },
          { label: 'Hard',  count: counts[1], cls: 'text-orange-400' },
          { label: 'Good',  count: counts[3], cls: 'text-blue-400' },
          { label: 'Easy',  count: counts[5], cls: 'text-emerald-400' },
        ].map((row) => (
          <div key={row.label} className="flex items-center justify-between">
            <span className="text-slate-400 text-sm">{row.label}</span>
            <span className={`font-bold text-lg ${row.cls}`}>{row.count}</span>
          </div>
        ))}
      </div>

      {earliest && (
        <p className="text-center text-slate-500 text-sm">
          Next review due: <span className="text-slate-300">{earliest}</span>
        </p>
      )}

      <div className="flex gap-3">
        <button onClick={onRestart} className="btn-secondary flex-1 flex items-center justify-center gap-2">
          <RotateCcw size={15} /> Review Again
        </button>
        <Link to="/dashboard" className="btn-primary flex-1 flex items-center justify-center gap-2">
          Done
        </Link>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function SRSReview() {
  const [phase, setPhase]     = useState('loading')  // loading | ready | review | done
  const [stats, setStats]     = useState(null)
  const [queue, setQueue]     = useState([])
  const [idx, setIdx]         = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [results, setResults] = useState([])
  const sessionStart          = useState(() => Date.now())[0]

  useEffect(() => {
    getSRSStats()
      .then((r) => setStats(r.data))
      .finally(() => setPhase('ready'))
  }, [])

  const handleStart = useCallback(async (limit) => {
    setPhase('loading')
    try {
      const res = await getSRSDue({ limit })
      setQueue(res.data)
      setIdx(0)
      setFlipped(false)
      setResults([])
      setPhase('review')
    } catch {
      setPhase('ready')
    }
  }, [])

  const handleRate = useCallback(async (quality) => {
    const word = queue[idx]
    try {
      const res = await postSRSReview(word.id, quality)
      const newResults = [...results, { word_id: word.id, quality, next_review: res.data.next_review }]
      setResults(newResults)

      // "Again" — push card back to end of queue so it re-appears this session
      let currentQueue = queue
      if (quality === 0) {
        currentQueue = [...queue, word]
        setQueue(currentQueue)
      }

      if (idx + 1 >= currentQueue.length) {
        const duration = Math.round((Date.now() - sessionStart) / 1000)
        const uniqueIds = [...new Set(currentQueue.map((w) => w.id))]
        recordSession('srs', uniqueIds, {
          duration_seconds: duration,
          correct_count: newResults.filter((r) => r.quality >= 3).length,
          incorrect_count: newResults.filter((r) => r.quality < 3).length,
        }).catch(() => {})
        setPhase('done')
      } else {
        setIdx((i) => i + 1)
        setFlipped(false)
      }
    } catch {
      // swallow — don't block the user
    }
  }, [queue, idx, results, sessionStart])

  useEffect(() => {
    if (phase === 'review' && queue[idx]) speak(queue[idx].engWord, 'en-US')
  }, [idx, phase])

  const handleFlip = useCallback(() => {
    setFlipped(true)
  }, [])

  const handleRestart = () => {
    setPhase('loading')
    getSRSStats()
      .then((r) => setStats(r.data))
      .finally(() => setPhase('ready'))
  }

  if (phase === 'loading') {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (phase === 'ready') {
    return (
      <div className="animate-fade-in">
        <SetupScreen stats={stats} onStart={handleStart} />
      </div>
    )
  }

  if (phase === 'done') {
    return <DoneScreen results={results} onRestart={handleRestart} />
  }

  // phase === 'review'
  const word = queue[idx]
  return (
    <div className="animate-fade-in">
      <ReviewCard
        word={word}
        flipped={flipped}
        onFlip={handleFlip}
        onRate={handleRate}
        progress={{ done: idx, total: queue.length }}
      />
    </div>
  )
}
