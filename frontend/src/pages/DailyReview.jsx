import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import {
  Target, CheckCircle2, RotateCcw, Volume2, AlertCircle,
  Sparkles, ChevronRight, CalendarClock,
} from 'lucide-react'
import { getDailyReview, postSRSReview, recordSession } from '../api/client'
import { getImageUrl } from '../utils/image'

const QUALITY_BUTTONS = [
  { quality: 0, label: 'Again',  sub: '< 1 day',   cls: 'bg-red-500/15 text-red-400 hover:bg-red-500/30 border border-red-500/25' },
  { quality: 1, label: 'Hard',   sub: '~1 day',    cls: 'bg-orange-500/15 text-orange-400 hover:bg-orange-500/30 border border-orange-500/25' },
  { quality: 3, label: 'Good',   sub: 'scheduled', cls: 'bg-blue-500/15 text-blue-400 hover:bg-blue-500/30 border border-blue-500/25' },
  { quality: 5, label: 'Easy',   sub: 'longer',    cls: 'bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/30 border border-emerald-500/25' },
]

const speak = (text, lang = 'en-US') => {
  if (!window.speechSynthesis) return
  window.speechSynthesis.cancel()
  const utt = new SpeechSynthesisUtterance(text)
  utt.lang = lang
  window.speechSynthesis.speak(utt)
}

function GoalBar({ done, goal }) {
  const pct = goal > 0 ? Math.min(100, Math.round((done / goal) * 100)) : 0
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-slate-500">
        <span>{done} done today</span>
        <span>goal: {goal}</span>
      </div>
      <div className="h-2 bg-dark-500 rounded-full overflow-hidden">
        <div
          className="h-full bg-primary rounded-full transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

function ReadyScreen({ reviewData, onStart }) {
  const { daily_goal, words_done_today, remaining, total_due, words } = reviewData
  const goalMet = remaining === 0
  const allCaughtUp = total_due === 0 && !goalMet

  if (goalMet) {
    return (
      <div className="max-w-md mx-auto space-y-6 animate-fade-in">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Daily Review</h1>
          <p className="text-slate-500 text-sm mt-1">Your daily goal, automatically queued</p>
        </div>
        <div className="card text-center py-10 space-y-3">
          <CheckCircle2 size={44} className="mx-auto text-emerald-400" />
          <p className="text-slate-100 font-semibold text-lg">Daily goal complete!</p>
          <p className="text-slate-500 text-sm">You've studied {words_done_today} words today.</p>
          <GoalBar done={words_done_today} goal={daily_goal} />
          <div className="flex gap-3 pt-2">
            <Link to="/dashboard" className="btn-secondary flex-1 text-center">Dashboard</Link>
            <Link to="/srs" className="btn-primary flex-1 text-center">Keep going</Link>
          </div>
        </div>
      </div>
    )
  }

  if (allCaughtUp) {
    return (
      <div className="max-w-md mx-auto space-y-6 animate-fade-in">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Daily Review</h1>
          <p className="text-slate-500 text-sm mt-1">Your daily goal, automatically queued</p>
        </div>
        <div className="card text-center py-10 space-y-3">
          <CheckCircle2 size={44} className="mx-auto text-emerald-400" />
          <p className="text-slate-100 font-semibold text-lg">All caught up!</p>
          <p className="text-slate-500 text-sm">No SRS reviews due. Come back tomorrow.</p>
          <GoalBar done={words_done_today} goal={daily_goal} />
          <Link to="/dashboard" className="btn-secondary inline-flex items-center gap-2 mt-2">
            Back to Dashboard
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-md mx-auto space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-slate-100">Daily Review</h1>
        <p className="text-slate-500 text-sm mt-1">Your daily goal, automatically queued</p>
      </div>

      <div className="card space-y-4">
        <GoalBar done={words_done_today} goal={daily_goal} />
        <div className="flex items-center justify-between pt-1">
          <div className="space-y-0.5">
            <p className="text-slate-200 font-semibold text-2xl">{words.length}</p>
            <p className="text-slate-500 text-xs">words to review now</p>
          </div>
          <div className="text-right space-y-0.5">
            <p className="text-slate-400 text-sm">{total_due} total due</p>
            {total_due > words.length && (
              <p className="text-slate-600 text-xs">capped at daily goal</p>
            )}
          </div>
        </div>
        <button
          onClick={onStart}
          className="btn-primary w-full flex items-center justify-center gap-2"
        >
          <CalendarClock size={16} />
          Start Review
        </button>
      </div>

      <p className="text-center text-xs text-slate-600">
        Want full control?{' '}
        <Link to="/srs" className="text-primary-light hover:underline">Open SRS Review</Link>
      </p>
    </div>
  )
}

function ReviewCard({ word, flipped, onFlip, onRate, progress }) {
  const imageUrl = word.image_url ? getImageUrl(word.image_url, word.group_name) : null

  return (
    <div className="max-w-lg mx-auto space-y-4">
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

      <div
        className="card cursor-pointer select-none min-h-[240px] flex flex-col items-center justify-center gap-4 transition-colors duration-150 hover:border-primary/30"
        onClick={!flipped ? onFlip : undefined}
      >
        {!flipped ? (
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

function DoneScreen({ results, reviewData }) {
  const counts = { 0: 0, 1: 0, 3: 0, 5: 0 }
  results.forEach((r) => { counts[r.quality] = (counts[r.quality] || 0) + 1 })

  const uniqueReviewed = new Set(results.map((r) => r.word_id)).size
  const wordsNowDone = reviewData.words_done_today + uniqueReviewed
  const goalPct = Math.min(100, Math.round((wordsNowDone / reviewData.daily_goal) * 100))
  const goalMet = wordsNowDone >= reviewData.daily_goal

  return (
    <div className="max-w-md mx-auto space-y-6 animate-fade-in">
      <div className="text-center space-y-2">
        {goalMet
          ? <Target size={48} className="mx-auto text-emerald-400" />
          : <CheckCircle2 size={48} className="mx-auto text-primary-light" />
        }
        <h2 className="text-2xl font-bold text-slate-100">
          {goalMet ? 'Goal complete!' : 'Session complete'}
        </h2>
        <p className="text-slate-500 text-sm">{results.length} cards reviewed</p>
      </div>

      <div className="card space-y-3">
        <p className="text-sm text-slate-400 font-medium">Daily goal</p>
        <GoalBar done={wordsNowDone} goal={reviewData.daily_goal} />
        <p className="text-xs text-slate-600 text-right">{goalPct}% complete</p>
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

      <div className="flex gap-3">
        {!goalMet && (
          <Link to="/srs" className="btn-secondary flex-1 flex items-center justify-center gap-2">
            <RotateCcw size={15} /> More reviews
          </Link>
        )}
        <Link to="/dashboard" className="btn-primary flex-1 flex items-center justify-center gap-2">
          Done
        </Link>
      </div>
    </div>
  )
}

export default function DailyReview() {
  const [phase, setPhase]         = useState('loading')
  const [reviewData, setReviewData] = useState(null)
  const [queue, setQueue]         = useState([])
  const [idx, setIdx]             = useState(0)
  const [flipped, setFlipped]     = useState(false)
  const [results, setResults]     = useState([])
  const sessionStart              = useState(() => Date.now())[0]

  useEffect(() => {
    getDailyReview()
      .then((r) => {
        setReviewData(r.data)
        setQueue(r.data.words)
      })
      .finally(() => setPhase('ready'))
  }, [])

  const handleStart = useCallback(() => {
    setIdx(0)
    setFlipped(false)
    setResults([])
    setPhase('review')
  }, [])

  const handleRate = useCallback(async (quality) => {
    const word = queue[idx]
    try {
      const res = await postSRSReview(word.id, quality)
      const newResults = [...results, { word_id: word.id, quality, next_review: res.data.next_review }]
      setResults(newResults)

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

  const handleFlip = useCallback(() => setFlipped(true), [])

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
        <ReadyScreen reviewData={reviewData} onStart={handleStart} />
      </div>
    )
  }

  if (phase === 'done') {
    return <DoneScreen results={results} reviewData={reviewData} />
  }

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
