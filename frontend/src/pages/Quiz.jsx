import { useState, useEffect, useCallback } from 'react'
import { CheckCircle, XCircle, Trophy, RefreshCw, ArrowRight } from 'lucide-react'
import { getQuiz, getGroups } from '../api/client'
import { DIFF_LABELS } from '../components/DifficultyBadge'

const RESULT_COLORS = {
  correct: 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300',
  wrong: 'bg-red-500/20 border-red-500/50 text-red-300',
  unanswered: 'bg-primary/10 border-primary/30 text-primary-light',
  default: 'bg-dark-500 border-dark-400 text-slate-300 hover:border-primary/40 hover:bg-dark-400',
}

export default function Quiz() {
  const [groups, setGroups] = useState([])
  const [questions, setQuestions] = useState([])
  const [qIdx, setQIdx] = useState(0)
  const [selected, setSelected] = useState(null)
  const [answered, setAnswered] = useState(false)
  const [score, setScore] = useState(0)
  const [loading, setLoading] = useState(false)
  const [phase, setPhase] = useState('setup') // setup | quiz | results
  const [settings, setSettings] = useState({
    difficulty: '',
    group_name: '',
    count: 10,
    direction: 'eng_to_heb',
  })
  const [history, setHistory] = useState([]) // {correct: bool, word: obj}

  useEffect(() => {
    getGroups().then((r) => setGroups(r.data))
  }, [])

  const startQuiz = useCallback(async () => {
    setLoading(true)
    try {
      const res = await getQuiz({
        difficulty: settings.difficulty || undefined,
        group_name: settings.group_name || undefined,
        count: settings.count,
        direction: settings.direction,
      })
      setQuestions(res.data)
      setQIdx(0)
      setSelected(null)
      setAnswered(false)
      setScore(0)
      setHistory([])
      setPhase('quiz')
    } finally {
      setLoading(false)
    }
  }, [settings])

  const handleSelect = (option) => {
    if (answered) return
    setSelected(option)
    setAnswered(true)
    const correct = option === questions[qIdx].correct
    if (correct) setScore((s) => s + 1)
    setHistory((h) => [...h, { correct, word: questions[qIdx].word, chosen: option }])
  }

  const goNext = () => {
    if (qIdx + 1 >= questions.length) {
      setPhase('results')
    } else {
      setQIdx((i) => i + 1)
      setSelected(null)
      setAnswered(false)
    }
  }

  const getOptionStyle = (option) => {
    if (!answered) return RESULT_COLORS.default
    const isCorrect = option === questions[qIdx].correct
    const isSelected = option === selected
    if (isCorrect) return RESULT_COLORS.correct
    if (isSelected && !isCorrect) return RESULT_COLORS.wrong
    return 'bg-dark-500 border-dark-400 text-slate-500'
  }

  const pct = questions.length ? Math.round((score / questions.length) * 100) : 0

  // ── Setup ──────────────────────────────────────────────────────────────────
  if (phase === 'setup') {
    return (
      <div className="max-w-lg mx-auto mt-8 space-y-6 animate-fade-in">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Quiz</h1>
          <p className="text-slate-500 text-sm mt-1">Test your vocabulary knowledge</p>
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
            <label className="block text-xs font-medium text-slate-400 mb-1">Group</label>
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

          <button
            className="btn-primary w-full py-2.5"
            onClick={startQuiz}
            disabled={loading}
          >
            {loading ? 'Loading…' : 'Start Quiz'}
          </button>
        </div>
      </div>
    )
  }

  // ── Results ────────────────────────────────────────────────────────────────
  if (phase === 'results') {
    const grade =
      pct >= 90 ? { label: 'Excellent!', color: 'text-emerald-400' }
      : pct >= 70 ? { label: 'Good job!', color: 'text-primary-light' }
      : pct >= 50 ? { label: 'Keep practicing', color: 'text-amber-400' }
      : { label: 'Needs work', color: 'text-red-400' }

    return (
      <div className="max-w-2xl mx-auto mt-6 space-y-5 animate-fade-in">
        <div className="card text-center space-y-3">
          <Trophy size={44} className={`mx-auto ${grade.color}`} />
          <h2 className="text-2xl font-bold text-slate-100">{grade.label}</h2>
          <p className={`text-4xl font-bold ${grade.color}`}>{pct}%</p>
          <p className="text-slate-400 text-sm">
            {score} correct out of {questions.length}
          </p>
          <div className="flex gap-3 pt-2">
            <button className="btn-ghost flex-1" onClick={() => setPhase('setup')}>
              New Quiz
            </button>
            <button className="btn-primary flex-1" onClick={startQuiz}>
              <RefreshCw size={14} className="inline mr-1" /> Retry
            </button>
          </div>
        </div>

        {/* Review */}
        <div className="card">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">Review Answers</h3>
          <div className="space-y-2">
            {history.map((h, i) => (
              <div key={i} className="flex items-start gap-3 py-2 border-b border-dark-400/50 last:border-0">
                {h.correct
                  ? <CheckCircle size={16} className="text-emerald-400 mt-0.5 flex-shrink-0" />
                  : <XCircle size={16} className="text-red-400 mt-0.5 flex-shrink-0" />
                }
                <div className="min-w-0">
                  <p className="text-slate-200 text-sm font-medium">{h.word.engWord}</p>
                  <p className="text-slate-400 text-sm heb">{h.word.hebWord}</p>
                  {!h.correct && (
                    <p className="text-red-400 text-xs mt-0.5">You answered: {h.chosen}</p>
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
  const q = questions[qIdx]
  const progress = Math.round((qIdx / questions.length) * 100)

  return (
    <div className="max-w-2xl mx-auto space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Quiz</h1>
          <p className="text-slate-500 text-sm">{qIdx + 1} / {questions.length} · Score: {score}</p>
        </div>
        <button className="btn-ghost text-sm" onClick={() => setPhase('setup')}>
          Quit
        </button>
      </div>

      {/* Progress */}
      <div className="h-1.5 bg-dark-400 rounded-full overflow-hidden">
        <div
          className="h-full bg-primary rounded-full transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Question */}
      <div className="card text-center py-10">
        <p className="text-xs text-slate-600 mb-2 uppercase tracking-wider">
          {settings.direction === 'eng_to_heb' ? 'What is the Hebrew for:' : 'What is the English for:'}
        </p>
        <p className={`text-3xl font-bold text-slate-100 ${settings.direction === 'heb_to_eng' ? 'heb' : ''}`}>
          {q.question}
        </p>
        {q.word.group_name && (
          <p className="text-slate-600 text-xs mt-3">{q.word.group_name.replace(/_/g, ' ')}</p>
        )}
      </div>

      {/* Options */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {q.options.map((opt, i) => (
          <button
            key={i}
            onClick={() => handleSelect(opt)}
            className={`py-4 px-5 rounded-xl border-2 text-left font-medium transition-all duration-200 ${getOptionStyle(opt)} ${
              settings.direction === 'eng_to_heb' ? 'heb text-right' : ''
            }`}
          >
            <span className="text-slate-600 text-xs mr-2">{['A', 'B', 'C', 'D'][i]}.</span>
            {opt}
          </button>
        ))}
      </div>

      {/* Feedback + Next */}
      {answered && (
        <div className="flex items-center justify-between animate-slide-up">
          <div className="flex items-center gap-2">
            {selected === q.correct
              ? <><CheckCircle size={18} className="text-emerald-400" /><span className="text-emerald-400 font-medium">Correct!</span></>
              : <><XCircle size={18} className="text-red-400" /><span className="text-red-400 font-medium">Incorrect</span></>
            }
          </div>
          <button className="btn-primary flex items-center gap-2" onClick={goNext}>
            {qIdx + 1 >= questions.length ? 'See Results' : 'Next'}
            <ArrowRight size={16} />
          </button>
        </div>
      )}
    </div>
  )
}
