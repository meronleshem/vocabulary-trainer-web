import { useState, useEffect, useCallback } from 'react'
import { CheckCircle, XCircle, Trophy, RefreshCw, ArrowRight, Volume2 } from 'lucide-react'
import { getFillQuiz, getBooks, patchDifficulty } from '../api/client'
import { DIFF_LABELS } from '../components/DifficultyBadge'
import GroupPicker from '../components/GroupPicker'

const RESULT_COLORS = {
  correct: 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300',
  wrong:   'bg-red-500/20 border-red-500/50 text-red-300',
  default: 'bg-dark-500 border-dark-400 text-slate-300 hover:border-primary/40 hover:bg-dark-400',
}

const DIFF_BG_CARD = {
  NEW_WORD: 'border-violet-500/40 bg-violet-900/10',
  EASY:     'border-emerald-500/40 bg-emerald-900/10',
  MEDIUM:   'border-amber-500/40 bg-amber-900/10',
  HARD:     'border-red-500/40 bg-red-900/10',
}

const DIFF_BUTTONS = [
  { key: 'EASY',   label: 'Easy',   cls: 'bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/30 border border-emerald-500/20' },
  { key: 'MEDIUM', label: 'Medium', cls: 'bg-amber-500/15 text-amber-400 hover:bg-amber-500/30 border border-amber-500/20' },
  { key: 'HARD',   label: 'Hard',   cls: 'bg-red-500/15 text-red-400 hover:bg-red-500/30 border border-red-500/20' },
]

function speakSentence(sentence) {
  window.speechSynthesis.cancel()
  const parts = sentence.split('____')
  const speakPart = (index) => {
    if (index >= parts.length) return
    const utt = new SpeechSynthesisUtterance(parts[index].trim())
    utt.rate = 0.9
    utt.onend = () => {
      if (index < parts.length - 1) {
        setTimeout(() => speakPart(index + 1), 50)
      }
    }
    window.speechSynthesis.speak(utt)
  }
  speakPart(0)
}

// Highlight ____ in the sentence
function Sentence({ text }) {
  const parts = text.split('____')
  return (
    <p className="text-xl font-medium text-slate-100 leading-relaxed text-center">
      {parts.map((part, i) => (
        <span key={i}>
          {part}
          {i < parts.length - 1 && (
            <span className="inline-block border-b-2 border-primary mx-1 min-w-[80px]" />
          )}
        </span>
      ))}
    </p>
  )
}

export default function FillQuiz() {
  const [books, setBooks] = useState([])
  const [questions, setQuestions] = useState([])
  const [qIdx, setQIdx] = useState(0)
  const [selected, setSelected] = useState(null)
  const [answered, setAnswered] = useState(false)
  const [score, setScore] = useState(0)
  const [loading, setLoading] = useState(false)
  const [phase, setPhase] = useState('setup') // setup | quiz | results
  const [settings, setSettings] = useState({ difficulty: '', group_names: [], count: 10 })
  const [history, setHistory] = useState([])
  const [markedDiff, setMarkedDiff] = useState({})

  useEffect(() => { getBooks().then((r) => setBooks(r.data)) }, [])

  useEffect(() => {
    if (phase === 'quiz' && questions.length) speakSentence(questions[qIdx].sentence)
  }, [qIdx, phase, questions])

  const startQuiz = useCallback(async () => {
    setLoading(true)
    try {
      const res = await getFillQuiz({
        difficulty: settings.difficulty || undefined,
        group_names: settings.group_names.length ? settings.group_names : undefined,
        count: settings.count,
      })
      if (!res.data.length) {
        alert('No words with examples found for these settings. Try different filters.')
        return
      }
      setQuestions(res.data)
      setQIdx(0)
      setSelected(null)
      setAnswered(false)
      setScore(0)
      setHistory([])
      setMarkedDiff({})
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
    setHistory((h) => [...h, { correct, word: questions[qIdx].word, chosen: option, sentence: questions[qIdx].sentence }])
  }

  const handleDifficultyChange = async (diff) => {
    const q = questions[qIdx]
    setMarkedDiff((m) => ({ ...m, [q.word.id]: diff }))
    await patchDifficulty(q.word.id, diff)
  }

  const goNext = () => {
    window.speechSynthesis.cancel()
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
    if (option === questions[qIdx].correct) return RESULT_COLORS.correct
    if (option === selected) return RESULT_COLORS.wrong
    return 'bg-dark-500 border-dark-400 text-slate-500'
  }

  const pct = questions.length ? Math.round((score / questions.length) * 100) : 0

  // ── Setup ──────────────────────────────────────────────────────────────────
  if (phase === 'setup') {
    return (
      <div className="max-w-lg mx-auto mt-8 space-y-6 animate-fade-in">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Fill in the Blank</h1>
          <p className="text-slate-500 text-sm mt-1">Guess the missing word from example sentences</p>
        </div>

        <div className="card space-y-4">
          <h2 className="text-base font-semibold text-slate-200">Quiz Settings</h2>

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
            <GroupPicker
              books={books}
              value={settings.group_names}
              onChange={(val) => setSettings((s) => ({ ...s, group_names: val }))}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">
              Questions: {settings.count}
            </label>
            <input
              type="range" min={5} max={50} step={5}
              value={settings.count}
              onChange={(e) => setSettings((s) => ({ ...s, count: Number(e.target.value) }))}
              className="w-full accent-primary"
            />
            <div className="flex justify-between text-xs text-slate-600 mt-0.5">
              <span>5</span><span>50</span>
            </div>
          </div>

          <button className="btn-primary w-full py-2.5" onClick={startQuiz} disabled={loading}>
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
          <div className="space-y-3">
            {history.map((h, i) => (
              <div key={i} className="flex items-start gap-3 py-2 border-b border-dark-400/50 last:border-0">
                {h.correct
                  ? <CheckCircle size={16} className="text-emerald-400 mt-0.5 flex-shrink-0" />
                  : <XCircle    size={16} className="text-red-400 mt-0.5 flex-shrink-0" />
                }
                <div className="min-w-0 space-y-0.5">
                  <p className="text-slate-400 text-xs italic">"{h.sentence}"</p>
                  <p className="text-slate-200 text-sm font-medium">Answer: {h.word.engWord}</p>
                  {!h.correct && (
                    <p className="text-red-400 text-xs">You answered: {h.chosen}</p>
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
  const wordDifficulty = markedDiff[q.word.id] || q.word.difficulty || 'NEW_WORD'
  const cardBg = DIFF_BG_CARD[wordDifficulty] || DIFF_BG_CARD.NEW_WORD

  return (
    <div className="max-w-2xl mx-auto space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Fill in the Blank</h1>
          <p className="text-slate-500 text-sm">{qIdx + 1} / {questions.length} · Score: {score}</p>
        </div>
        <button className="btn-ghost text-sm" onClick={() => setPhase('setup')}>Quit</button>
      </div>

      {/* Progress */}
      <div className="h-1.5 bg-dark-400 rounded-full overflow-hidden">
        <div className="h-full bg-primary rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
      </div>

      {/* Sentence card */}
      <div className={`card py-10 px-8 border-2 transition-colors ${cardBg}`}>
        <p className="text-xs text-slate-600 mb-5 uppercase tracking-wider text-center">
          Choose the word that completes the sentence
        </p>
        <Sentence text={q.sentence} />
        <div className="flex justify-center mt-5">
          <button
            onClick={() => speakSentence(q.sentence)}
            className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-primary transition-colors"
            title="Listen"
          >
            <Volume2 size={15} />
            Listen
          </button>
        </div>
        {q.word.group_name && (
          <p className="text-slate-600 text-xs mt-3 text-center">{q.word.group_name.replace(/_/g, ' ')}</p>
        )}
      </div>

      {/* Options */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {q.options.map((opt, i) => (
          <button
            key={i}
            onClick={() => handleSelect(opt)}
            className={`py-4 px-5 rounded-xl border-2 text-left font-medium transition-all duration-200 ${getOptionStyle(opt)}`}
          >
            <span className="text-slate-600 text-xs mr-2">{['A', 'B', 'C', 'D'][i]}.</span>
            {opt}
          </button>
        ))}
      </div>

      {/* Feedback + difficulty + next */}
      {answered && (
        <div className="space-y-3 animate-slide-up">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {selected === q.correct
                ? <><CheckCircle size={18} className="text-emerald-400" /><span className="text-emerald-400 font-medium">Correct! <span className="heb text-slate-400 font-normal">({q.word.hebWord})</span></span></>
                : <><XCircle    size={18} className="text-red-400"     /><span className="text-red-400 font-medium">The answer was: <span className="font-bold">{q.correct}</span> <span className="heb text-slate-400 font-normal">({q.word.hebWord})</span></span></>
              }
            </div>
            <button className="btn-primary flex items-center gap-2" onClick={goNext}>
              {qIdx + 1 >= questions.length ? 'See Results' : 'Next'}
              <ArrowRight size={16} />
            </button>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">Mark difficulty:</span>
            <div className="flex gap-2">
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
          </div>
        </div>
      )}
    </div>
  )
}
