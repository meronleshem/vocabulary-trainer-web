import { useState, useEffect, useCallback } from 'react'
import {
  Volume2, CheckCircle, XCircle, Trophy, RefreshCw,
  ArrowRight, Search, X, Loader2, Eye, Headphones,
  PenLine, Zap, Delete,
} from 'lucide-react'
import { getWords, getStudySession, getBooks } from '../api/client'
import { getImageUrl } from '../utils/image'
import { GroupPickerDropdown } from '../components/GroupPicker'
import DifficultyBadge from '../components/DifficultyBadge'

// ── Utilities ─────────────────────────────────────────────────────────────────

const speak = (text, lang = 'en-US') => {
  if (!window.speechSynthesis) return
  window.speechSynthesis.cancel()
  const utt = new SpeechSynthesisUtterance(text)
  utt.lang = lang
  window.speechSynthesis.speak(utt)
}

const playSound = (type) => {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    if (type === 'correct') {
      osc.type = 'sine'
      osc.frequency.setValueAtTime(660, ctx.currentTime)
      osc.frequency.setValueAtTime(880, ctx.currentTime + 0.1)
      gain.gain.setValueAtTime(0.25, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35)
      osc.start(ctx.currentTime)
      osc.stop(ctx.currentTime + 0.35)
    } else {
      osc.type = 'sawtooth'
      osc.frequency.setValueAtTime(220, ctx.currentTime)
      osc.frequency.setValueAtTime(160, ctx.currentTime + 0.15)
      gain.gain.setValueAtTime(0.2, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35)
      osc.start(ctx.currentTime)
      osc.stop(ctx.currentTime + 0.35)
    }
  } catch (_) {
    // AudioContext unavailable — silent fallback
  }
}

const shuffle = (arr) => {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

const DEFAULT_IMG = '/api/images/default.jpg'
const getImg = (url) => getImageUrl(url) || DEFAULT_IMG

function buildLetterBank(word) {
  const normalized = word.toLowerCase().replace(/[\s-]+/g, '')
  const wordLetters = normalized.split('').map((l, i) => ({ id: `w${i}`, letter: l }))
  const alphabet = 'abcdefghijklmnopqrstuvwxyz'
  const extras = Array.from({ length: 5 + Math.floor(Math.random() * 3) }, (_, i) => ({
    id: `e${i}`,
    letter: alphabet[Math.floor(Math.random() * alphabet.length)],
  }))
  return shuffle([...wordLetters, ...extras])
}

function prepareSessionData(words) {
  return words.map((word) => {
    // Use the other session words as distractors — the user knows these words,
    // so distinguishing between them is meaningful practice.
    const distractors = shuffle(words.filter((w) => w.id !== word.id)).slice(0, 2)

    return {
      ...word,
      stage1Options: shuffle([word.engWord, ...distractors.map((d) => d.engWord)]),
      stage2Options: shuffle([word.hebWord, ...distractors.map((d) => d.hebWord)]),
      stage3Options: shuffle([
        { hebWord: word.hebWord, image_url: word.image_url, isCorrect: true },
        ...distractors.map((d) => ({ hebWord: d.hebWord, image_url: d.image_url, isCorrect: false })),
      ]),
      stage4Letters: buildLetterBank(word.engWord),
    }
  })
}

const STAGE_META = [
  { num: 1, title: 'Stage 1', subtitle: 'Hebrew → English', icon: Eye,        color: 'text-violet-400', border: 'border-violet-500/30', bg: 'bg-violet-500/10' },
  { num: 2, title: 'Stage 2', subtitle: 'Listen → Hebrew',  icon: Volume2,    color: 'text-blue-400',   border: 'border-blue-500/30',   bg: 'bg-blue-500/10'   },
  { num: 3, title: 'Stage 3', subtitle: 'Audio → Hebrew',   icon: Headphones, color: 'text-cyan-400',   border: 'border-cyan-500/30',   bg: 'bg-cyan-500/10'   },
  { num: 4, title: 'Stage 4', subtitle: 'Spell it out',     icon: PenLine,    color: 'text-amber-400',  border: 'border-amber-500/30',  bg: 'bg-amber-500/10'  },
]

// ── Option button style helper ────────────────────────────────────────────────

function optionCls(answered, isCorrect, isSelected) {
  if (!answered)
    return 'bg-dark-500 border-dark-400 text-slate-300 hover:border-primary/50 hover:bg-dark-400 cursor-pointer'
  if (isCorrect)
    return 'bg-emerald-500/20 border-emerald-500/60 text-emerald-300'
  if (isSelected)
    return 'bg-red-500/20 border-red-500/60 text-red-300 animate-shake'
  return 'bg-dark-500 border-dark-400 text-slate-500 opacity-40'
}

// ── Stage 1: Hebrew + Image → English options ─────────────────────────────────

function Stage1({ word, answered, selectedOption, onAnswer }) {
  return (
    <div className="space-y-4 animate-fade-in">
      <div className="card py-5 space-y-3 text-center">
        <p className="text-xs text-slate-500 uppercase tracking-wider">What is the English translation?</p>
        <img
          src={getImg(word.image_url)}
          alt=""
          className="mx-auto w-44 h-32 object-contain bg-dark-700 rounded-lg border border-dark-400"
          onError={(e) => { e.target.src = DEFAULT_IMG }}
        />
        <p className="text-3xl font-bold text-slate-100 heb">{word.hebWord}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {word.stage1Options.map((opt, i) => (
          <button
            key={i}
            disabled={answered}
            onClick={() => onAnswer(opt === word.engWord, opt)}
            className={`py-3 px-4 rounded-xl border-2 text-center font-medium transition-all duration-200 ${optionCls(
              answered, opt === word.engWord, opt === selectedOption
            )}`}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Stage 2: English + TTS → Hebrew options ───────────────────────────────────

function Stage2({ word, answered, selectedOption, onAnswer }) {
  useEffect(() => {
    speak(word.engWord, 'en-US')
  }, [word.id]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="card py-6 space-y-3 text-center">
        <p className="text-xs text-slate-500 uppercase tracking-wider">What is the Hebrew translation?</p>
        <div className="flex items-center justify-center gap-3">
          <p className="text-3xl font-bold text-slate-100">{word.engWord}</p>
          <button
            onClick={() => speak(word.engWord, 'en-US')}
            className="text-slate-500 hover:text-primary-light transition-colors"
            title="Play again"
          >
            <Volume2 size={20} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {word.stage2Options.map((opt, i) => (
          <button
            key={i}
            disabled={answered}
            onClick={() => onAnswer(opt === word.hebWord, opt)}
            className={`py-3 px-4 rounded-xl border-2 text-center font-medium heb transition-all duration-200 ${optionCls(
              answered, opt === word.hebWord, opt === selectedOption
            )}`}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Stage 3: TTS only → Hebrew + image options ────────────────────────────────

function Stage3({ word, answered, selectedOption, onAnswer }) {
  useEffect(() => {
    speak(word.engWord, 'en-US')
  }, [word.id]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="card py-5 space-y-3 text-center">
        <p className="text-xs text-slate-500 uppercase tracking-wider">Listen and choose the Hebrew word</p>
        <button
          onClick={() => speak(word.engWord, 'en-US')}
          className="mx-auto flex flex-col items-center gap-2 group"
        >
          <div className="w-14 h-14 rounded-full bg-primary/15 border border-primary/30 flex items-center justify-center group-hover:bg-primary/25 transition-colors">
            <Volume2 size={24} className="text-primary-light" />
          </div>
          <span className="text-xs text-slate-500 group-hover:text-slate-400 transition-colors">Tap to replay</span>
        </button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {word.stage3Options.map((opt, i) => (
          <button
            key={i}
            disabled={answered}
            onClick={() => onAnswer(opt.isCorrect, opt.hebWord)}
            className={`p-3 rounded-xl border-2 flex flex-col items-center gap-2 transition-all duration-200 ${optionCls(
              answered, opt.isCorrect, opt.hebWord === selectedOption
            )}`}
          >
            <img
              src={getImg(opt.image_url)}
              alt=""
              className="w-full h-24 object-contain bg-dark-700 rounded-lg border border-dark-400/50"
              onError={(e) => { e.target.src = DEFAULT_IMG }}
            />
            <span className="heb font-medium text-center text-sm">{opt.hebWord}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Stage 4: Hebrew + Image → spell English ───────────────────────────────────

function Stage4({ word, answered, onAnswer }) {
  const [builtLetters, setBuiltLetters] = useState([])
  const [bank, setBank] = useState(word.stage4Letters)
  const [submitted, setSubmitted] = useState(false)

  useEffect(() => {
    setBuiltLetters([])
    setBank(word.stage4Letters)
    setSubmitted(false)
  }, [word.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const addLetter = (letterObj) => {
    if (submitted) return
    setBuiltLetters((prev) => [...prev, letterObj])
    setBank((prev) => prev.filter((l) => l.id !== letterObj.id))
  }

  const removeLetter = (idx) => {
    if (submitted) return
    const letter = builtLetters[idx]
    setBuiltLetters((prev) => prev.filter((_, i) => i !== idx))
    setBank((prev) => [...prev, letter])
  }

  const removeLast = () => {
    if (submitted || builtLetters.length === 0) return
    const last = builtLetters[builtLetters.length - 1]
    setBuiltLetters((prev) => prev.slice(0, -1))
    setBank((prev) => [...prev, last])
  }

  const handleSubmit = () => {
    if (builtLetters.length === 0 || submitted) return
    const built = builtLetters.map((l) => l.letter).join('')
    const target = word.engWord.toLowerCase().replace(/[\s-]+/g, '')
    const isCorrect = built === target
    setSubmitted(true)
    onAnswer(isCorrect, built)
  }

  const built = builtLetters.map((l) => l.letter).join('')
  const target = word.engWord.toLowerCase().replace(/[\s-]+/g, '')
  const isComplete = built === target

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Question */}
      <div className="card py-5 space-y-3 text-center">
        <p className="text-xs text-slate-500 uppercase tracking-wider">
          Spell the English word · {target.length} letters
        </p>
        <img
          src={getImg(word.image_url)}
          alt=""
          className="mx-auto w-44 h-32 object-contain bg-dark-700 rounded-lg border border-dark-400"
          onError={(e) => { e.target.src = DEFAULT_IMG }}
        />
        <p className="text-3xl font-bold text-slate-100 heb">{word.hebWord}</p>
      </div>

      {/* Built word display */}
      <div className="min-h-12 flex items-center justify-center gap-2 flex-wrap px-2">
        {builtLetters.length === 0 ? (
          <span className="text-slate-600 text-sm italic">Click letters below to build the word…</span>
        ) : (
          builtLetters.map((l, i) => (
            <button
              key={l.id}
              onClick={() => !submitted && removeLetter(i)}
              disabled={submitted}
              className={`w-10 h-10 rounded-lg text-lg font-bold uppercase border-2 transition-all ${
                submitted
                  ? isComplete
                    ? 'bg-emerald-500/20 border-emerald-500/60 text-emerald-300'
                    : 'bg-red-500/20 border-red-500/60 text-red-300'
                  : 'bg-primary/15 border-primary/40 text-primary-light hover:bg-red-500/15 hover:border-red-500/40 hover:text-red-300 cursor-pointer'
              }`}
            >
              {l.letter}
            </button>
          ))
        )}
      </div>

      {/* Action buttons */}
      {!submitted && (
        <div className="flex gap-2 justify-center">
          <button
            onClick={removeLast}
            disabled={builtLetters.length === 0}
            className="btn-ghost flex items-center gap-1.5 py-1.5 px-3 text-sm disabled:opacity-30"
          >
            <Delete size={14} /> Back
          </button>
          <button
            onClick={handleSubmit}
            disabled={builtLetters.length === 0}
            className="btn-primary flex items-center gap-1.5 py-1.5 px-3 text-sm disabled:opacity-50"
          >
            Check <ArrowRight size={14} />
          </button>
        </div>
      )}

      {/* Show correct spelling after wrong answer */}
      {submitted && !isComplete && (
        <p className="text-center text-slate-400 text-sm">
          Correct: <span className="text-emerald-400 font-bold">{word.engWord}</span>
        </p>
      )}

      {/* Letter bank */}
      <div className="card py-3 px-4">
        <p className="text-xs text-slate-600 mb-2 text-center uppercase tracking-wider">Letter Bank</p>
        <div className="flex flex-wrap gap-1.5 justify-center">
          {bank.length === 0 ? (
            <span className="text-slate-600 text-sm">All letters used</span>
          ) : (
            bank.map((l) => (
              <button
                key={l.id}
                onClick={() => addLetter(l)}
                disabled={submitted}
                className={`w-10 h-10 rounded-lg text-lg font-bold uppercase border-2 transition-all ${
                  submitted
                    ? 'bg-dark-500 border-dark-400 text-slate-600 cursor-not-allowed'
                    : 'bg-dark-500 border-dark-400 text-slate-300 hover:border-primary/50 hover:bg-dark-400 hover:text-slate-100 cursor-pointer'
                }`}
              >
                {l.letter}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

// ── Stage Transition ──────────────────────────────────────────────────────────

function StageTransition({ completedStage, nextStage, wordsCount, onContinue }) {
  const next = STAGE_META.find((s) => s.num === nextStage)
  const NextIcon = next?.icon

  return (
    <div className="max-w-md mx-auto text-center space-y-5 animate-fade-in">
      <div className="card py-10 space-y-5">
        <div className="w-14 h-14 rounded-full bg-emerald-500/15 border border-emerald-500/40 flex items-center justify-center mx-auto">
          <CheckCircle size={28} className="text-emerald-400" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-slate-100">Stage {completedStage} Complete!</h2>
          <p className="text-slate-500 text-sm mt-1">Practiced all {wordsCount} words</p>
        </div>

        {next && (
          <div className={`rounded-xl border p-3 ${next.bg} ${next.border}`}>
            <div className="flex items-center justify-center gap-2 mb-1">
              {NextIcon && <NextIcon size={16} className={next.color} />}
              <span className={`font-semibold text-sm ${next.color}`}>{next.title}</span>
            </div>
            <p className="text-slate-400 text-sm">{next.subtitle}</p>
          </div>
        )}

        <button
          className="btn-primary px-8 py-2 flex items-center gap-2 mx-auto"
          onClick={onContinue}
        >
          {nextStage
            ? <>Continue to Stage {nextStage} <ArrowRight size={15} /></>
            : <>See Results <Trophy size={15} /></>}
        </button>
      </div>

      {/* Stage progress dots */}
      <div className="flex items-center justify-center gap-2">
        {[1, 2, 3, 4].map((s) => (
          <div key={s} className="flex items-center">
            <div
              className={`w-7 h-7 rounded-full border-2 flex items-center justify-center text-xs font-bold transition-all ${
                s <= completedStage
                  ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-400'
                  : 'bg-dark-500 border-dark-400 text-slate-600'
              }`}
            >
              {s <= completedStage ? '✓' : s}
            </div>
            {s < 4 && (
              <div className={`w-7 h-0.5 mx-1 ${s < completedStage ? 'bg-emerald-500/40' : 'bg-dark-400'}`} />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Word Selector ─────────────────────────────────────────────────────────────

const MIN_WORDS = 2
const MAX_WORDS = 10
const PAGE_SIZE = 20

function WordSelector({ onStart }) {
  const [allWords, setAllWords] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [groupFilter, setGroupFilter] = useState('')
  const [books, setBooks] = useState([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState([])
  const [sessionLoading, setSessionLoading] = useState(false)

  useEffect(() => {
    getBooks().then((r) => setBooks(r.data))
  }, [])

  const loadWords = useCallback(async () => {
    setLoading(true)
    try {
      const res = await getWords({
        search: search || undefined,
        group_name: groupFilter || undefined,
        page,
        limit: PAGE_SIZE,
        sort_by: 'engWord',
        sort_dir: 'asc',
      })
      setAllWords(res.data.words)
      setTotal(res.data.total)
    } finally {
      setLoading(false)
    }
  }, [search, groupFilter, page])

  useEffect(() => { setPage(1) }, [search, groupFilter])
  useEffect(() => { loadWords() }, [loadWords])

  const toggleWord = (word) => {
    setSelected((prev) => {
      if (prev.find((w) => w.id === word.id)) return prev.filter((w) => w.id !== word.id)
      if (prev.length >= MAX_WORDS) return prev
      return [...prev, word]
    })
  }

  const handleStart = async () => {
    if (selected.length < MIN_WORDS) return
    setSessionLoading(true)
    try {
      const res = await getStudySession(selected.map((w) => w.id))
      onStart(res.data)
    } finally {
      setSessionLoading(false)
    }
  }

  const selectedIds = new Set(selected.map((w) => w.id))
  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className="max-w-3xl mx-auto space-y-5 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-slate-100">Study Session</h1>
        <p className="text-slate-500 text-sm mt-1">
          Select {MIN_WORDS}–{MAX_WORDS} words to practice through 4 stages of increasing difficulty
        </p>
      </div>

      {/* Stage overview */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {STAGE_META.map(({ num, title, subtitle, icon: Icon, color, bg, border }) => (
          <div key={num} className={`rounded-xl border p-3 text-center ${bg} ${border}`}>
            <Icon size={14} className={`mx-auto mb-1 ${color}`} />
            <p className={`text-xs font-semibold ${color}`}>{title}</p>
            <p className="text-slate-500 text-xs mt-0.5">{subtitle}</p>
          </div>
        ))}
      </div>

      {/* Selected words strip */}
      {selected.length > 0 && (
        <div className="card space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-300">
              Selected ({selected.length}/{MAX_WORDS})
            </span>
            <button
              className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
              onClick={() => setSelected([])}
            >
              Clear all
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {selected.map((w) => (
              <span
                key={w.id}
                className="flex items-center gap-1.5 bg-primary/10 border border-primary/25 text-primary-light text-sm px-3 py-1 rounded-full"
              >
                {w.engWord}
                <button onClick={() => toggleWord(w)} className="text-primary/50 hover:text-red-400 transition-colors">
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
          <button
            onClick={handleStart}
            disabled={selected.length < MIN_WORDS || sessionLoading}
            className="btn-primary w-full py-2.5 flex items-center justify-center gap-2"
          >
            {sessionLoading
              ? <><Loader2 size={16} className="animate-spin" /> Loading…</>
              : <><Zap size={16} /> Start Session ({selected.length} words)</>}
          </button>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            className="input pl-9"
            placeholder="Search words…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <GroupPickerDropdown books={books} value={groupFilter} onChange={setGroupFilter} />
      </div>

      {/* Word list */}
      <div className="card divide-y divide-dark-400/50 p-0 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 size={22} className="animate-spin text-primary" />
          </div>
        ) : allWords.length === 0 ? (
          <div className="text-center py-12 text-slate-500 text-sm">No words found</div>
        ) : (
          allWords.map((word) => {
            const isSel = selectedIds.has(word.id)
            const isDisabled = !isSel && selected.length >= MAX_WORDS
            return (
              <button
                key={word.id}
                onClick={() => !isDisabled && toggleWord(word)}
                disabled={isDisabled}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                  isSel
                    ? 'bg-primary/10 hover:bg-primary/15'
                    : isDisabled
                    ? 'opacity-40 cursor-not-allowed'
                    : 'hover:bg-dark-500'
                }`}
              >
                {/* Checkbox */}
                <div
                  className={`w-5 h-5 rounded border-2 flex-shrink-0 flex items-center justify-center transition-colors ${
                    isSel ? 'bg-primary border-primary' : 'border-dark-300'
                  }`}
                >
                  {isSel && (
                    <svg viewBox="0 0 10 10" className="w-3 h-3" fill="none" stroke="white" strokeWidth="2">
                      <polyline points="1.5,5 4,7.5 8.5,2" />
                    </svg>
                  )}
                </div>

                <div className="min-w-0 flex-1 flex items-center gap-2 flex-wrap">
                  <span className="text-slate-200 font-medium">{word.engWord}</span>
                  <span className="text-slate-600 text-xs">·</span>
                  <span className="text-slate-400 heb text-sm">{word.hebWord}</span>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  <DifficultyBadge difficulty={word.difficulty} />
                  {word.image_url && (
                    <div className="w-7 h-7 rounded overflow-hidden border border-dark-400">
                      <img
                        src={getImageUrl(word.image_url)}
                        alt=""
                        className="w-full h-full object-cover"
                        onError={(e) => { e.target.style.display = 'none' }}
                      />
                    </div>
                  )}
                </div>
              </button>
            )
          })
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-500">{total} words total</span>
          <div className="flex items-center gap-2">
            <button disabled={page === 1} onClick={() => setPage((p) => p - 1)} className="btn-ghost px-3 py-1.5 text-sm disabled:opacity-30">Prev</button>
            <span className="text-slate-500 text-xs">{page} / {totalPages}</span>
            <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="btn-ghost px-3 py-1.5 text-sm disabled:opacity-30">Next</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Session Results ────────────────────────────────────────────────────────────

function SessionResults({ score, mistakes, totalWords, onRetry, onNew }) {
  const total = score.correct + score.incorrect
  const pct = total ? Math.round((score.correct / total) * 100) : 0

  const grade =
    pct >= 90 ? { label: 'Excellent!',       color: 'text-emerald-400' }
    : pct >= 70 ? { label: 'Great job!',      color: 'text-primary-light' }
    : pct >= 50 ? { label: 'Keep going!',     color: 'text-amber-400' }
    :             { label: 'Keep practicing', color: 'text-red-400' }

  const uniqueMistakes = [
    ...new Map(mistakes.map((m) => [`${m.word.id}-${m.stage}`, m])).values(),
  ]

  return (
    <div className="max-w-2xl mx-auto space-y-5 animate-fade-in">
      <div className="card text-center space-y-3 py-8">
        <Trophy size={44} className={`mx-auto ${grade.color}`} />
        <h2 className="text-2xl font-bold text-slate-100">{grade.label}</h2>
        <p className={`text-5xl font-bold ${grade.color}`}>{pct}%</p>
        <p className="text-slate-400 text-sm">
          {score.correct} correct · {score.incorrect} incorrect · {totalWords} words × 4 stages
        </p>
        <div className="flex gap-3 pt-1 max-w-xs mx-auto">
          <button className="btn-ghost flex-1 py-2.5" onClick={onNew}>New Session</button>
          <button className="btn-primary flex-1 py-2.5 flex items-center justify-center gap-2" onClick={onRetry}>
            <RefreshCw size={14} /> Retry
          </button>
        </div>
      </div>

      {uniqueMistakes.length > 0 && (
        <div className="card">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">Words to Review ({uniqueMistakes.length})</h3>
          <div className="divide-y divide-dark-400/50">
            {uniqueMistakes.map((m, i) => (
              <div key={i} className="flex items-center gap-3 py-2.5">
                <XCircle size={15} className="text-red-400 flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-slate-200 text-sm font-medium">{m.word.engWord}</span>
                    <span className="text-xs bg-dark-500 border border-dark-400 text-slate-500 px-1.5 py-0.5 rounded-full">
                      Stage {m.stage}
                    </span>
                  </div>
                  <p className="text-slate-400 text-sm heb">{m.word.hebWord}</p>
                </div>
                {m.word.image_url && (
                  <img
                    src={getImageUrl(m.word.image_url)}
                    alt=""
                    className="w-9 h-9 rounded-lg object-cover border border-dark-400 flex-shrink-0"
                    onError={(e) => { e.target.style.display = 'none' }}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main StudySession ─────────────────────────────────────────────────────────

export default function StudySession() {
  const [phase, setPhase] = useState('select')
  const [preparedWords, setPreparedWords] = useState([])
  const [stage, setStage] = useState(1)
  const [wordIdx, setWordIdx] = useState(0)
  const [answered, setAnswered] = useState(false)
  const [selectedOption, setSelectedOption] = useState(null)
  const [isCorrect, setIsCorrect] = useState(null)
  const [score, setScore] = useState({ correct: 0, incorrect: 0 })
  const [mistakes, setMistakes] = useState([])

  const currentWord = preparedWords[wordIdx]

  const startSession = useCallback((rawWords) => {
    const prepared = prepareSessionData(rawWords)
    setPreparedWords(prepared)
    setStage(1)
    setWordIdx(0)
    setAnswered(false)
    setSelectedOption(null)
    setIsCorrect(null)
    setScore({ correct: 0, incorrect: 0 })
    setMistakes([])
    setPhase('session')
  }, [])

  const handleAnswer = useCallback((correct, option) => {
    if (answered) return
    setAnswered(true)
    setSelectedOption(option)
    setIsCorrect(correct)
    playSound(correct ? 'correct' : 'wrong')
    if (correct) {
      setScore((s) => ({ ...s, correct: s.correct + 1 }))
    } else {
      setScore((s) => ({ ...s, incorrect: s.incorrect + 1 }))
      setMistakes((m) => [...m, { word: preparedWords[wordIdx], stage }])
    }
  }, [answered, preparedWords, wordIdx, stage])

  const handleNext = useCallback(() => {
    if (wordIdx + 1 >= preparedWords.length) {
      setPhase('transition')
    } else {
      setWordIdx((i) => i + 1)
      setAnswered(false)
      setSelectedOption(null)
      setIsCorrect(null)
    }
  }, [wordIdx, preparedWords.length])

  const handleTransitionContinue = useCallback(() => {
    if (stage >= 4) {
      setPhase('results')
    } else {
      setStage((s) => s + 1)
      setWordIdx(0)
      setAnswered(false)
      setSelectedOption(null)
      setIsCorrect(null)
      setPhase('session')
    }
  }, [stage])

  if (phase === 'select') return <WordSelector onStart={startSession} />

  if (phase === 'transition') {
    return (
      <StageTransition
        completedStage={stage}
        nextStage={stage < 4 ? stage + 1 : null}
        wordsCount={preparedWords.length}
        onContinue={handleTransitionContinue}
      />
    )
  }

  if (phase === 'results') {
    return (
      <SessionResults
        score={score}
        mistakes={mistakes}
        totalWords={preparedWords.length}
        onRetry={() => startSession(preparedWords)}
        onNew={() => setPhase('select')}
      />
    )
  }

  if (!currentWord) return null

  const progress = ((stage - 1) * preparedWords.length + wordIdx) / (4 * preparedWords.length)
  const stageMeta = STAGE_META.find((s) => s.num === stage)
  const StageIcon = stageMeta?.icon
  const correctAnswerHint = [1, 4].includes(stage) ? currentWord.engWord : currentWord.hebWord
  const hintIsHeb = [2, 3].includes(stage)

  return (
    <div className="max-w-2xl mx-auto space-y-4 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {StageIcon && <StageIcon size={14} className={stageMeta?.color} />}
          <span className="font-semibold text-slate-100 text-sm">{stageMeta?.title}</span>
          <span className="text-slate-600 text-xs hidden sm:inline">· {stageMeta?.subtitle}</span>
          <span className="text-slate-500 text-xs">· {wordIdx + 1}/{preparedWords.length}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-slate-500 text-xs">{score.correct} correct</span>
          <button className="btn-ghost text-xs py-1 px-2" onClick={() => setPhase('select')}>Quit</button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-1 bg-dark-400 rounded-full overflow-hidden">
        <div
          className="h-full bg-primary rounded-full transition-all duration-500"
          style={{ width: `${progress * 100}%` }}
        />
      </div>

      {/* Stage component */}
      {stage === 1 && <Stage1 word={currentWord} answered={answered} selectedOption={selectedOption} onAnswer={handleAnswer} />}
      {stage === 2 && <Stage2 word={currentWord} answered={answered} selectedOption={selectedOption} onAnswer={handleAnswer} />}
      {stage === 3 && <Stage3 word={currentWord} answered={answered} selectedOption={selectedOption} onAnswer={handleAnswer} />}
      {stage === 4 && <Stage4 key={`${stage}-${wordIdx}`} word={currentWord} answered={answered} onAnswer={handleAnswer} />}

      {/* Feedback + Next button */}
      {answered && (
        <div className="flex items-center justify-between animate-slide-up py-1">
          <div className="flex items-center gap-2">
            {isCorrect ? (
              <>
                <CheckCircle size={16} className="text-emerald-400" />
                <span className="text-emerald-400 font-medium text-sm">Correct!</span>
              </>
            ) : (
              <>
                <XCircle size={16} className="text-red-400" />
                <span className="text-red-400 font-medium text-sm">
                  Answer: <span className={hintIsHeb ? 'heb' : ''}>{correctAnswerHint}</span>
                </span>
              </>
            )}
          </div>
          <button className="btn-primary flex items-center gap-1.5 py-1.5 px-3 text-sm" onClick={handleNext}>
            {wordIdx + 1 >= preparedWords.length
              ? stage >= 4 ? 'See Results' : `Stage ${stage + 1}`
              : 'Next'}
            <ArrowRight size={14} />
          </button>
        </div>
      )}
    </div>
  )
}
