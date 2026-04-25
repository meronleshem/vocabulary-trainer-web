import { useState, useEffect, useCallback, useRef } from 'react'
import {
  CheckCircle, XCircle, Trophy, RefreshCw, ArrowRight, Volume2, Lightbulb,
} from 'lucide-react'
import { getHardQuiz, getBooks, patchDifficulty, recordSession } from '../api/client'
import GroupPicker from '../components/GroupPicker'
import FrequencyPicker from '../components/FrequencyPicker'
import DifficultyPicker from '../components/DifficultyPicker'

// ── Answer validation (mirrors backend logic) ────────────────────────────────
const NIQQUD = /[ְ-ׇ]/g

function normalizeAnswer(text) {
  return text.replace(/\([^)]*\)/g, '').replace(/\[[^\]]*\]/g, '').replace(NIQQUD, '').trim()
}

function validateAnswer(userInput, accepted) {
  if (!userInput || !userInput.trim()) return false
  return accepted.includes(normalizeAnswer(userInput))
}

// ── Helpers ──────────────────────────────────────────────────────────────────
const speak = (text, lang = 'en-US') => {
  if (!window.speechSynthesis) return
  window.speechSynthesis.cancel()
  const utt = new SpeechSynthesisUtterance(text)
  utt.lang = lang
  window.speechSynthesis.speak(utt)
}

const DIFF_BG_CARD = {
  NEW_WORD: 'border-violet-500/40 bg-violet-900/10',
  EASY: 'border-emerald-500/40 bg-emerald-900/10',
  MEDIUM: 'border-amber-500/40 bg-amber-900/10',
  HARD: 'border-red-500/40 bg-red-900/10',
}

const DIFF_BUTTONS = [
  { key: 'EASY',   label: 'Easy',   cls: 'bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/30 border border-emerald-500/20' },
  { key: 'MEDIUM', label: 'Medium', cls: 'bg-amber-500/15 text-amber-400 hover:bg-amber-500/30 border border-amber-500/20' },
  { key: 'HARD',   label: 'Hard',   cls: 'bg-red-500/15 text-red-400 hover:bg-red-500/30 border border-red-500/20' },
]

// ── Component ────────────────────────────────────────────────────────────────
export default function HardQuiz() {
  const [books, setBooks]         = useState([])
  const [questions, setQuestions] = useState([])
  const [qIdx, setQIdx]           = useState(0)
  const [userInput, setUserInput] = useState('')
  const [answered, setAnswered]   = useState(false)
  const [isCorrect, setIsCorrect] = useState(false)
  const [score, setScore]         = useState(0)
  const [loading, setLoading]     = useState(false)
  const [phase, setPhase]         = useState('setup') // setup | quiz | results
  const [history, setHistory]     = useState([])
  const [markedDiff, setMarkedDiff] = useState({})
  const [hintChars, setHintChars] = useState(0) // chars of primary answer revealed
  const [settings, setSettings]   = useState({
    difficulty: [],
    group_names: [],
    frequency_level: [],
    count: 10,
    direction: 'eng_to_heb',
  })
  const startTime = useRef(null)
  const inputRef  = useRef(null)

  useEffect(() => { getBooks().then((r) => setBooks(r.data)) }, [])

  // Auto-focus input + TTS on each new question
  useEffect(() => {
    if (phase !== 'quiz' || !questions.length) return
    const q    = questions[qIdx]
    const lang = settings.direction === 'eng_to_heb' ? 'en-US' : 'he-IL'
    speak(q.question, lang)
    setHintChars(0)
    setTimeout(() => inputRef.current?.focus(), 50)
  }, [qIdx, phase, questions])

  // Keyboard: Enter to submit / advance
  useEffect(() => {
    if (phase !== 'quiz') return
    const handler = (e) => {
      if (e.key === 'Enter') {
        if (!answered) handleSubmit()
        else goNext()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  })

  const startQuiz = useCallback(async () => {
    setLoading(true)
    try {
      const res = await getHardQuiz({
        difficulty:      settings.difficulty.length      ? settings.difficulty      : undefined,
        group_names:     settings.group_names.length     ? settings.group_names     : undefined,
        frequency_level: settings.frequency_level.length ? settings.frequency_level : undefined,
        count:     settings.count,
        direction: settings.direction,
      })
      setQuestions(res.data)
      setQIdx(0)
      setUserInput('')
      setAnswered(false)
      setIsCorrect(false)
      setScore(0)
      setHistory([])
      setMarkedDiff({})
      setHintChars(0)
      startTime.current = Date.now()
      setPhase('quiz')
    } finally {
      setLoading(false)
    }
  }, [settings])

  const handleSubmit = () => {
    if (answered || !userInput.trim()) return
    const q       = questions[qIdx]
    const correct = validateAnswer(userInput, q.accepted)
    setIsCorrect(correct)
    setAnswered(true)
    if (correct) setScore((s) => s + 1)
    setHistory((h) => [
      ...h,
      { correct, word: q.word, chosen: userInput, accepted: q.accepted, correct_raw: q.correct },
    ])
  }

  const goNext = () => {
    if (qIdx + 1 >= questions.length) {
      const duration = startTime.current
        ? Math.round((Date.now() - startTime.current) / 1000)
        : null
      recordSession('hard_quiz', questions.map((q) => q.word.id), {
        correct_count:   score,
        incorrect_count: questions.length - score,
        duration_seconds: duration,
      }).catch(() => {})
      setPhase('results')
    } else {
      setQIdx((i) => i + 1)
      setUserInput('')
      setAnswered(false)
      setIsCorrect(false)
    }
  }

  const handleDifficultyChange = async (diff) => {
    const q = questions[qIdx]
    setMarkedDiff((m) => ({ ...m, [q.word.id]: diff }))
    await patchDifficulty(q.word.id, diff)
  }

  const handleHint = () => {
    const q       = questions[qIdx]
    const primary = q.accepted[0] || ''
    setHintChars((n) => Math.min(n + 1, primary.length))
  }

  const pct = questions.length ? Math.round((score / questions.length) * 100) : 0

  // ── Setup ──────────────────────────────────────────────────────────────────
  if (phase === 'setup') {
    return (
      <div className="max-w-lg mx-auto mt-8 space-y-6 animate-fade-in">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Hard Mode</h1>
          <p className="text-slate-500 text-sm mt-1">Type the translation — no options given</p>
        </div>

        <div className="card space-y-4">
          <h2 className="text-base font-semibold text-slate-200">Quiz Settings</h2>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Direction</label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { val: 'eng_to_heb', label: 'English → Hebrew' },
                { val: 'heb_to_eng', label: 'Hebrew → English' },
              ].map((opt) => (
                <button
                  key={opt.val}
                  onClick={() => setSettings((s) => ({ ...s, direction: opt.val }))}
                  className={`py-2.5 px-3 rounded-lg border text-sm font-medium transition-all ${
                    settings.direction === opt.val
                      ? 'bg-primary/15 border-primary/40 text-primary-light'
                      : 'bg-dark-500 border-dark-400 text-slate-400 hover:border-dark-300'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Difficulty</label>
            <DifficultyPicker
              value={settings.difficulty}
              onChange={(val) => setSettings((s) => ({ ...s, difficulty: val }))}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Group</label>
            <GroupPicker
              books={books}
              value={settings.group_names}
              onChange={(val) => setSettings((s) => ({ ...s, group_names: val }))}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Frequency</label>
            <FrequencyPicker
              value={settings.frequency_level}
              onChange={(val) => setSettings((s) => ({ ...s, frequency_level: val }))}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">
              Questions: {settings.count}
            </label>
            <input
              type="range"
              min={5}
              max={50}
              step={5}
              value={settings.count}
              onChange={(e) => setSettings((s) => ({ ...s, count: Number(e.target.value) }))}
              className="w-full accent-primary"
            />
            <div className="flex justify-between text-xs text-slate-600 mt-0.5">
              <span>5</span><span>50</span>
            </div>
          </div>

          <button className="btn-primary w-full py-2.5" onClick={startQuiz} disabled={loading}>
            {loading ? 'Loading…' : 'Start Hard Mode'}
          </button>
        </div>
      </div>
    )
  }

  // ── Results ────────────────────────────────────────────────────────────────
  if (phase === 'results') {
    const grade =
      pct >= 90 ? { label: 'Excellent!',       color: 'text-emerald-400' }
      : pct >= 70 ? { label: 'Good job!',       color: 'text-primary-light' }
      : pct >= 50 ? { label: 'Keep practicing', color: 'text-amber-400' }
      :             { label: 'Needs work',       color: 'text-red-400' }

    return (
      <div className="max-w-2xl mx-auto mt-6 space-y-5 animate-fade-in">
        <div className="card text-center space-y-3">
          <Trophy size={44} className={`mx-auto ${grade.color}`} />
          <h2 className="text-2xl font-bold text-slate-100">{grade.label}</h2>
          <p className={`text-4xl font-bold ${grade.color}`}>{pct}%</p>
          <p className="text-slate-400 text-sm">{score} correct out of {questions.length}</p>
          <div className="flex gap-3 pt-2">
            <button className="btn-ghost flex-1" onClick={() => setPhase('setup')}>New Quiz</button>
            <button className="btn-primary flex-1" onClick={startQuiz}>
              <RefreshCw size={14} className="inline mr-1" /> Retry
            </button>
          </div>
        </div>

        <div className="card">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">Review Answers</h3>
          <div className="space-y-2">
            {history.map((h, i) => (
              <div key={i} className="flex items-start gap-3 py-2 border-b border-dark-400/50 last:border-0">
                {h.correct
                  ? <CheckCircle size={16} className="text-emerald-400 mt-0.5 flex-shrink-0" />
                  : <XCircle    size={16} className="text-red-400 mt-0.5 flex-shrink-0" />
                }
                <div className="min-w-0 flex-1">
                  <p className="text-slate-200 text-sm font-medium">{h.word.engWord}</p>
                  {!h.correct && (
                    <>
                      <p className="text-red-400 text-xs mt-0.5">
                        You typed: <span className="heb">{h.chosen}</span>
                      </p>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {h.accepted.map((a) => (
                          <span key={a} className="heb text-xs px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">
                            {a}
                          </span>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  // ── Quiz ───────────────────────────────────────────────────────────────────
  const q              = questions[qIdx]
  const progress       = Math.round((qIdx / questions.length) * 100)
  const wordDifficulty = markedDiff[q.word.id] || q.word.difficulty || 'NEW_WORD'
  const cardBg         = DIFF_BG_CARD[wordDifficulty] || DIFF_BG_CARD.NEW_WORD
  const ttsLang        = settings.direction === 'eng_to_heb' ? 'en-US' : 'he-IL'
  const inputIsHeb     = settings.direction === 'eng_to_heb'
  const primaryHint    = q.accepted[0] || ''
  const hintText       = hintChars > 0
    ? primaryHint.slice(0, hintChars) + '…'
    : null

  return (
    <div className="max-w-2xl mx-auto space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Hard Mode</h1>
          <p className="text-slate-500 text-sm">{qIdx + 1} / {questions.length} · Score: {score}</p>
        </div>
        <button className="btn-ghost text-sm" onClick={() => setPhase('setup')}>Quit</button>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 bg-dark-400 rounded-full overflow-hidden">
        <div
          className="h-full bg-primary rounded-full transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Question card */}
      <div className={`card text-center py-10 border-2 transition-colors ${cardBg}`}>
        <p className="text-xs text-slate-600 mb-2 uppercase tracking-wider">
          {inputIsHeb ? 'What is the Hebrew for:' : 'What is the English for:'}
        </p>
        <div className="flex items-center justify-center gap-3">
          <p className={`text-3xl font-bold text-slate-100 ${!inputIsHeb ? 'heb' : ''}`}>
            {q.question}
          </p>
          <button
            onClick={() => speak(q.question, ttsLang)}
            className="text-slate-600 hover:text-slate-300 transition-colors flex-shrink-0"
            title="Hear pronunciation"
          >
            <Volume2 size={20} />
          </button>
        </div>
        {q.word.group_name && (
          <p className="text-slate-600 text-xs mt-3">{q.word.group_name.replace(/_/g, ' ')}</p>
        )}
      </div>

      {/* Input area */}
      <div className="space-y-2">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={userInput}
            onChange={(e) => setUserInput(e.target.value)}
            disabled={answered}
            dir={inputIsHeb ? 'rtl' : 'ltr'}
            placeholder={inputIsHeb ? 'הקלד תרגום…' : 'Type translation…'}
            className={`flex-1 px-4 py-3 rounded-xl border-2 bg-dark-500 text-slate-100 placeholder-slate-600
              font-medium transition-all outline-none text-lg
              ${inputIsHeb ? 'heb text-right' : ''}
              ${answered
                ? isCorrect
                  ? 'border-emerald-500/60 bg-emerald-900/10'
                  : 'border-red-500/60 bg-red-900/10'
                : 'border-dark-400 focus:border-primary/60'
              }`}
          />
          {!answered && (
            <button
              onClick={handleHint}
              disabled={hintChars >= primaryHint.length}
              className="px-3 py-2 rounded-xl border-2 border-dark-400 bg-dark-500 text-slate-400
                hover:text-amber-400 hover:border-amber-500/40 transition-all disabled:opacity-30"
              title="Reveal a hint"
            >
              <Lightbulb size={18} />
            </button>
          )}
        </div>

        {/* Hint display */}
        {hintText && !answered && (
          <p className={`text-xs text-amber-400/80 px-1 ${inputIsHeb ? 'heb text-right' : ''}`}>
            Hint: {hintText}
          </p>
        )}

        {/* Submit button */}
        {!answered && (
          <button
            className="btn-primary w-full py-3 text-base"
            onClick={handleSubmit}
            disabled={!userInput.trim()}
          >
            Submit
          </button>
        )}
      </div>

      {/* Feedback */}
      {answered && (
        <div className="space-y-3 animate-slide-up">
          {/* Verdict */}
          <div className={`flex items-center gap-2 px-4 py-3 rounded-xl border-2 ${
            isCorrect
              ? 'bg-emerald-500/10 border-emerald-500/30'
              : 'bg-red-500/10 border-red-500/30'
          }`}>
            {isCorrect
              ? <CheckCircle size={20} className="text-emerald-400 flex-shrink-0" />
              : <XCircle     size={20} className="text-red-400 flex-shrink-0" />
            }
            <div className="flex-1 min-w-0">
              {isCorrect
                ? <p className="text-emerald-400 font-semibold">Correct!</p>
                : (
                  <div>
                    <p className="text-red-400 font-semibold">Incorrect</p>
                    <p className="text-slate-400 text-xs mt-0.5">Accepted answers:</p>
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {q.accepted.map((a) => (
                        <span
                          key={a}
                          className="heb text-sm px-2 py-0.5 rounded-lg bg-emerald-500/15 text-emerald-300 border border-emerald-500/20"
                        >
                          {a}
                        </span>
                      ))}
                    </div>
                  </div>
                )
              }
            </div>
          </div>

          {/* Next + difficulty */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500">Mark:</span>
              {DIFF_BUTTONS.map((b) => (
                <button
                  key={b.key}
                  className={`px-3 py-1 rounded-lg font-medium text-xs transition-all ${b.cls} ${
                    wordDifficulty === b.key ? 'ring-2 ring-offset-1 ring-offset-dark-600 ring-current' : ''
                  }`}
                  onClick={() => handleDifficultyChange(b.key)}
                >
                  {b.label}
                </button>
              ))}
            </div>
            <button className="btn-primary flex items-center gap-2" onClick={goNext}>
              {qIdx + 1 >= questions.length ? 'See Results' : 'Next'}
              <ArrowRight size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
