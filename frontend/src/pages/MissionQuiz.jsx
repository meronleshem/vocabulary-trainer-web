import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  CheckCircle, XCircle, Trophy, RefreshCw, ArrowRight, Volume2,
  Star, Zap, ChevronLeft,
} from 'lucide-react'
import { getMissionQuiz, submitMissionAttempt, recordSession } from '../api/client'

const RESULT_COLORS = {
  correct:    'bg-emerald-500/20 border-emerald-500/50 text-emerald-300',
  wrong:      'bg-red-500/20 border-red-500/50 text-red-300',
  default:    'bg-dark-500 border-dark-400 text-slate-300 hover:border-primary/40 hover:bg-dark-400',
  unselected: 'bg-dark-500 border-dark-400 text-slate-500',
}

const TYPE_LABELS = {
  group:        { title: 'Group Mission',       color: 'text-primary-light',  bg: 'bg-primary/15'    },
  checkpoint_3: { title: 'Mini Checkpoint',     color: 'text-amber-400',      bg: 'bg-amber-500/15'  },
  checkpoint_9: { title: 'Master Checkpoint',   color: 'text-purple-400',     bg: 'bg-purple-500/15' },
}

const speak = (text, lang = 'en-US') => {
  if (!window.speechSynthesis) return
  window.speechSynthesis.cancel()
  const utt = new SpeechSynthesisUtterance(text)
  utt.lang = lang
  window.speechSynthesis.speak(utt)
}

export default function MissionQuiz() {
  const { missionId } = useParams()
  const navigate = useNavigate()

  const [mission, setMission]     = useState(null)
  const [questions, setQuestions] = useState([])
  const [qIdx, setQIdx]           = useState(0)
  const [selected, setSelected]   = useState(null)
  const [answered, setAnswered]   = useState(false)
  const [score, setScore]         = useState(0)
  const [history, setHistory]     = useState([])
  const [phase, setPhase]         = useState('loading') // loading | quiz | results | result-modal
  const [direction, setDirection] = useState('eng_to_heb')
  const [submitResult, setSubmitResult] = useState(null)
  const [submitting, setSubmitting]     = useState(false)
  const startTime = useRef(null)

  const load = useCallback(async () => {
    setPhase('loading')
    try {
      const res = await getMissionQuiz(missionId, direction)
      setMission(res.data.mission)
      setQuestions(res.data.questions)
      setQIdx(0)
      setSelected(null)
      setAnswered(false)
      setScore(0)
      setHistory([])
      startTime.current = Date.now()
      setPhase('quiz')
    } catch {
      setPhase('error')
    }
  }, [missionId, direction])

  useEffect(() => { load() }, [load])

  // TTS on new question
  useEffect(() => {
    if (phase !== 'quiz' || !questions.length) return
    const q = questions[qIdx]
    speak(q.question, direction === 'eng_to_heb' ? 'en-US' : 'he-IL')
  }, [qIdx, phase, questions, direction])

  const handleSelect = (option) => {
    if (answered) return
    setSelected(option)
    setAnswered(true)
    const correct = option === questions[qIdx].correct
    if (correct) setScore((s) => s + 1)
    setHistory((h) => [...h, { correct, word: questions[qIdx].word, chosen: option, expected: questions[qIdx].correct }])
  }

  const goNext = async () => {
    const isLast = qIdx + 1 >= questions.length
    if (isLast) {
      const finalCorrect = score + (selected === questions[qIdx].correct ? 1 : 0)
      const finalScore   = finalCorrect / questions.length
      const duration     = startTime.current ? Math.round((Date.now() - startTime.current) / 1000) : null

      recordSession('quiz', questions.map((q) => q.word.id), {
        correct_count:   finalCorrect,
        incorrect_count: questions.length - finalCorrect,
        duration_seconds: duration,
      }).catch(() => {})

      setPhase('results')
    } else {
      setQIdx((i) => i + 1)
      setSelected(null)
      setAnswered(false)
    }
  }

  const submitScore = async () => {
    const finalCorrect = history.filter((h) => h.correct).length
    const finalScore   = finalCorrect / questions.length
    setSubmitting(true)
    try {
      const res = await submitMissionAttempt(missionId, {
        score:         finalScore,
        correct_count: finalCorrect,
        total_count:   questions.length,
      })
      setSubmitResult(res.data)
      setPhase('result-modal')
    } finally {
      setSubmitting(false)
    }
  }

  useEffect(() => {
    if (phase !== 'quiz') return
    const handleKey = (e) => {
      const keyMap = { '1': 0, '2': 1, '3': 2, '4': 3 }
      if (e.key in keyMap) {
        const opt = questions[qIdx]?.options[keyMap[e.key]]
        if (opt !== undefined) handleSelect(opt)
      } else if (e.key === ' ' && answered) {
        e.preventDefault()
        goNext()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [phase, qIdx, questions, answered])

  const getOptionStyle = (option) => {
    if (!answered) return RESULT_COLORS.default
    const isCorrect  = option === questions[qIdx].correct
    const isSelected = option === selected
    if (isCorrect) return RESULT_COLORS.correct
    if (isSelected && !isCorrect) return RESULT_COLORS.wrong
    return RESULT_COLORS.unselected
  }

  // ── Loading ─────────────────────────────────────────────────────────────────
  if (phase === 'loading') {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (phase === 'error') {
    return (
      <div className="max-w-lg mx-auto mt-8 text-center space-y-4">
        <p className="text-slate-400">Failed to load mission.</p>
        <button onClick={() => navigate('/roadmap')} className="btn-primary">Back to Roadmap</button>
      </div>
    )
  }

  const typeMeta = TYPE_LABELS[mission?.mission_type] || TYPE_LABELS.group
  const requiredPct = Math.round((mission?.required_score ?? 0.9) * 100)

  // ── Result modal (pass/fail) ────────────────────────────────────────────────
  if (phase === 'result-modal' && submitResult) {
    const passed     = submitResult.passed
    const scorePct   = Math.round(submitResult.score * 100)
    const nextMission = submitResult.next_mission

    return (
      <div className="max-w-lg mx-auto mt-8 animate-fade-in space-y-6">
        <div className={`card border-2 text-center py-8 ${
          passed ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-red-500/30 bg-red-500/5'
        }`}>
          {passed
            ? <Trophy size={48} className="text-amber-400 mx-auto mb-4" />
            : <XCircle size={48} className="text-red-400 mx-auto mb-4" />}

          <h2 className={`text-2xl font-bold mb-1 ${passed ? 'text-emerald-400' : 'text-red-400'}`}>
            {passed ? 'Mission Passed!' : 'Not Quite Yet'}
          </h2>
          <p className="text-slate-400 text-sm mb-4">
            {passed
              ? `You scored ${scorePct}% — required ${requiredPct}%`
              : `You scored ${scorePct}% — need ${requiredPct}% to pass`}
          </p>

          {passed && (
            <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold mb-4 ${typeMeta.bg} ${typeMeta.color}`}>
              <CheckCircle size={16} />
              {mission?.mission_type === 'group' ? 'Group Completed!' :
               mission?.mission_type === 'checkpoint_3' ? 'Checkpoint Cleared!' :
               'Mastery Achieved!'}
            </div>
          )}

          {passed && nextMission && (
            <p className="text-xs text-slate-500 mb-6">
              Next up: <span className="text-slate-300 font-medium">
                {nextMission.mission_type === 'group'
                  ? `Group ${nextMission.related_group_ids?.[0]}`
                  : nextMission.mission_type === 'checkpoint_3'
                  ? `Mini Checkpoint`
                  : `Master Checkpoint`}
              </span>
            </p>
          )}

          {!passed && (
            <p className="text-xs text-slate-500 mb-6">
              Keep studying and try again — you've got this!
            </p>
          )}

          <div className="flex gap-3 justify-center flex-wrap">
            <button onClick={() => navigate('/roadmap')} className="btn-ghost">
              Back to Roadmap
            </button>
            {!passed && (
              <button onClick={load} className="btn-primary flex items-center gap-2">
                <RefreshCw size={14} /> Retry Mission
              </button>
            )}
            {passed && nextMission && (
              <button
                onClick={() => navigate(`/mission/${nextMission.id}`)}
                className="btn-primary flex items-center gap-2"
              >
                Next Mission <ArrowRight size={14} />
              </button>
            )}
            {passed && !nextMission && (
              <button onClick={() => navigate('/roadmap')} className="btn-primary">
                View Roadmap
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }

  // ── Results (before submitting) ─────────────────────────────────────────────
  if (phase === 'results') {
    const correct = history.filter((h) => h.correct).length
    const pct     = Math.round((correct / questions.length) * 100)
    const willPass = pct >= requiredPct

    return (
      <div className="max-w-lg mx-auto mt-8 space-y-6 animate-fade-in">
        <div>
          <button
            onClick={() => navigate('/roadmap')}
            className="flex items-center gap-1.5 text-slate-400 hover:text-slate-200 text-sm mb-4 transition-colors"
          >
            <ChevronLeft size={16} /> Roadmap
          </button>
          <h1 className="text-2xl font-bold text-slate-100">Results</h1>
        </div>

        <div className={`card border-2 text-center ${
          willPass ? 'border-emerald-500/30' : 'border-amber-500/30'
        }`}>
          <p className={`text-5xl font-bold mb-1 ${
            pct >= 90 ? 'text-emerald-400' : pct >= 70 ? 'text-amber-400' : 'text-red-400'
          }`}>
            {pct}%
          </p>
          <p className="text-slate-400 text-sm">
            {correct} / {questions.length} correct
          </p>
          <p className="text-xs text-slate-500 mt-2">
            {willPass
              ? `Ready to pass (needed ${requiredPct}%)`
              : `Need ${requiredPct}% to pass — ${requiredPct - pct}% more needed`}
          </p>
        </div>

        {/* Mistake review */}
        {history.filter((h) => !h.correct).length > 0 && (
          <div className="card">
            <h3 className="text-sm font-semibold text-slate-300 mb-3">
              Review Mistakes ({history.filter((h) => !h.correct).length})
            </h3>
            <div className="space-y-2">
              {history.filter((h) => !h.correct).map((h, i) => (
                <div key={i} className="flex items-center justify-between py-2 px-3 rounded-lg bg-dark-500 text-sm">
                  <div className="min-w-0">
                    <span className="text-slate-300 font-medium">{h.word.engWord}</span>
                    <span className="text-slate-600 mx-1.5">→</span>
                    <span className="text-emerald-400">{h.expected}</span>
                  </div>
                  <span className="text-red-400 text-xs ml-3 flex-shrink-0">{h.chosen}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex gap-3">
          <button onClick={() => navigate('/roadmap')} className="btn-ghost flex-1">
            Back to Roadmap
          </button>
          <button
            onClick={submitScore}
            disabled={submitting}
            className="btn-primary flex-1 flex items-center justify-center gap-2"
          >
            {submitting
              ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              : <Star size={14} />}
            Submit Score
          </button>
        </div>
      </div>
    )
  }

  // ── Quiz ────────────────────────────────────────────────────────────────────
  const q        = questions[qIdx]
  const progress = ((qIdx + (answered ? 1 : 0)) / questions.length) * 100

  return (
    <div className="max-w-lg mx-auto mt-4 space-y-4 animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate('/roadmap')}
          className="text-slate-400 hover:text-slate-200 transition-colors"
        >
          <ChevronLeft size={20} />
        </button>
        <div className="flex-1">
          <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
            <span className={`font-semibold ${typeMeta.color}`}>{typeMeta.title}</span>
            <span>{qIdx + 1} / {questions.length}</span>
          </div>
          <div className="h-1.5 bg-dark-500 rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </div>

      {/* Direction toggle */}
      <div className="flex gap-2">
        {[
          { val: 'eng_to_heb', label: 'EN → HE' },
          { val: 'heb_to_eng', label: 'HE → EN' },
        ].map((d) => (
          <button
            key={d.val}
            onClick={() => { setDirection(d.val); load() }}
            className={`text-xs px-3 py-1.5 rounded-lg border transition-all ${
              direction === d.val
                ? 'bg-primary/15 border-primary/40 text-primary-light'
                : 'bg-dark-500 border-dark-400 text-slate-500 hover:border-dark-300'
            }`}
          >
            {d.label}
          </button>
        ))}
        <button
          onClick={() => speak(q.question, direction === 'eng_to_heb' ? 'en-US' : 'he-IL')}
          className="ml-auto text-slate-500 hover:text-slate-200 transition-colors p-1.5"
          title="Read aloud"
        >
          <Volume2 size={16} />
        </button>
      </div>

      {/* Score pill */}
      <div className="flex items-center gap-2">
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${typeMeta.bg} ${typeMeta.color}`}>
          {score}/{qIdx + (answered ? 1 : 0)} correct
        </span>
        <span className="text-xs text-slate-600">need {requiredPct}% to pass</span>
      </div>

      {/* Question card */}
      <div className="card min-h-32 flex flex-col items-center justify-center text-center py-8">
        {q.word?.image_url && (
          <img
            src={`/api/images/${q.word.image_url}`}
            alt=""
            className="w-20 h-20 object-cover rounded-lg mb-4"
            onError={(e) => { e.target.style.display = 'none' }}
          />
        )}
        <p className={`text-2xl font-bold text-slate-100 ${direction === 'heb_to_eng' ? 'heb' : ''}`}>
          {q.question}
        </p>
      </div>

      {/* Options */}
      <div className="grid grid-cols-2 gap-3">
        {q.options.map((option, i) => (
          <button
            key={option}
            onClick={() => handleSelect(option)}
            className={`rounded-xl border px-4 py-3 text-left text-sm font-medium transition-all ${getOptionStyle(option)}`}
          >
            <span className="text-xs opacity-50 mr-1.5">{i + 1}</span>
            <span className={direction === 'eng_to_heb' ? 'heb' : ''}>{option}</span>
          </button>
        ))}
      </div>

      {/* Feedback row */}
      {answered && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm">
            {selected === q.correct
              ? <><CheckCircle size={18} className="text-emerald-400" /><span className="text-emerald-400">Correct!</span></>
              : <><XCircle size={18} className="text-red-400" /><span className="text-red-400">Wrong</span></>}
          </div>
          <button
            onClick={goNext}
            className="btn-primary flex items-center gap-1.5 text-sm px-4 py-2"
          >
            {qIdx + 1 >= questions.length ? 'Finish' : 'Next'}
            <ArrowRight size={14} />
          </button>
        </div>
      )}

      {/* Keyboard hint */}
      <p className="text-xs text-slate-600 text-center">
        Press 1–4 to answer · Space to continue
      </p>
    </div>
  )
}
