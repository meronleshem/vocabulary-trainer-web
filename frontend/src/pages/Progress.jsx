import { useEffect, useState, useCallback } from 'react'
import { Flame, Trophy, Target, Zap, Star, BookOpen, TrendingUp } from 'lucide-react'
import { getProgress, patchDailyGoal } from '../api/client'

const FREQ_COLORS = {
  1: { bar: 'bg-emerald-500', text: 'text-emerald-400', border: 'border-emerald-500/30', bg: 'bg-emerald-500/10' },
  2: { bar: 'bg-blue-500',    text: 'text-blue-400',    border: 'border-blue-500/30',    bg: 'bg-blue-500/10'    },
  3: { bar: 'bg-amber-500',   text: 'text-amber-400',   border: 'border-amber-500/30',   bg: 'bg-amber-500/10'   },
  4: { bar: 'bg-orange-500',  text: 'text-orange-400',  border: 'border-orange-500/30',  bg: 'bg-orange-500/10'  },
  5: { bar: 'bg-red-500',     text: 'text-red-400',     border: 'border-red-500/30',     bg: 'bg-red-500/10'     },
}

const TOTAL_WORDS = 20000

function ProgressBar({ value, max, colorClass = 'bg-primary', height = 'h-2' }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0
  return (
    <div className={`w-full bg-dark-400 rounded-full overflow-hidden ${height}`}>
      <div
        className={`h-full rounded-full transition-all duration-500 ${colorClass}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

function ActivityHeatmap({ days }) {
  // Build a map date -> words_studied for the last 30 days
  const map = {}
  days.forEach((d) => { map[d.date] = d.words_studied })

  // Generate last 30 calendar days
  const cells = []
  const today = new Date()
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const key = d.toISOString().slice(0, 10)
    const count = map[key] || 0
    cells.push({ key, count, dayLabel: d.toLocaleDateString('en', { weekday: 'short' })[0] })
  }

  const maxCount = Math.max(...cells.map((c) => c.count), 1)

  const intensity = (count) => {
    if (count === 0) return 'bg-dark-500 border border-dark-400'
    const pct = count / maxCount
    if (pct < 0.25) return 'bg-emerald-900/60 border border-emerald-700/40'
    if (pct < 0.5)  return 'bg-emerald-700/70 border border-emerald-600/50'
    if (pct < 0.75) return 'bg-emerald-600/80 border border-emerald-500/60'
    return 'bg-emerald-500 border border-emerald-400/70'
  }

  return (
    <div>
      <div className="flex flex-wrap gap-1">
        {cells.map((c) => (
          <div
            key={c.key}
            title={`${c.key}: ${c.count} words`}
            className={`w-6 h-6 rounded-sm ${intensity(c.count)} cursor-default`}
          />
        ))}
      </div>
      <div className="flex items-center gap-1.5 mt-2">
        <span className="text-xs text-slate-600">Less</span>
        {['bg-dark-500', 'bg-emerald-900/60', 'bg-emerald-700/70', 'bg-emerald-600/80', 'bg-emerald-500'].map((cls, i) => (
          <div key={i} className={`w-3 h-3 rounded-sm ${cls} border border-dark-300`} />
        ))}
        <span className="text-xs text-slate-600">More</span>
      </div>
    </div>
  )
}

function AchievementCard({ ach }) {
  return (
    <div
      className={`rounded-xl border p-3 text-center transition-all ${
        ach.unlocked
          ? 'bg-dark-600 border-primary/30'
          : 'bg-dark-700 border-dark-400 opacity-50 grayscale'
      }`}
    >
      <div className="text-2xl mb-1">{ach.emoji}</div>
      <p className={`text-xs font-semibold ${ach.unlocked ? 'text-slate-200' : 'text-slate-500'}`}>
        {ach.label}
      </p>
      <p className="text-xs text-slate-600 mt-0.5">{ach.desc}</p>
      <p className={`text-xs mt-1 font-medium ${ach.unlocked ? 'text-primary-light' : 'text-slate-700'}`}>
        +{ach.xp} XP
      </p>
    </div>
  )
}

export default function Progress() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [editingGoal, setEditingGoal] = useState(false)
  const [goalInput, setGoalInput] = useState('')

  const load = useCallback(() => {
    setLoading(true)
    getProgress()
      .then((r) => setData(r.data))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  const saveGoal = async () => {
    const val = parseInt(goalInput, 10)
    if (!val || val < 1 || val > 200) return
    await patchDailyGoal(val)
    setEditingGoal(false)
    load()
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }
  if (!data) return <p className="text-slate-500">Failed to load progress.</p>

  const {
    total_xp, level, xp_progress, xp_needed,
    daily_goal, current_streak, longest_streak,
    total_learned, total_sessions,
    by_frequency, daily_activity, today,
    achievements,
  } = data

  const todayPct = daily_goal > 0 ? Math.min(100, Math.round((today.words_studied / daily_goal) * 100)) : 0
  const unlockedCount = achievements.filter((a) => a.unlocked).length

  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-100">Progress</h1>
        <p className="text-slate-500 text-sm mt-1">Track your learning journey</p>
      </div>

      {/* Level + XP + Streak row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {/* Level */}
        <div className="card text-center py-4 col-span-2 sm:col-span-1">
          <Star size={20} className="text-amber-400 mx-auto mb-1" />
          <p className="text-3xl font-bold text-slate-100">{level}</p>
          <p className="text-xs text-slate-500 mt-0.5">Level</p>
        </div>

        {/* XP */}
        <div className="card py-4 col-span-2 sm:col-span-1 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Zap size={14} className="text-primary-light" />
              <span className="text-xs text-slate-400">XP</span>
            </div>
            <span className="text-xs text-slate-500">{total_xp.toLocaleString()} total</span>
          </div>
          <ProgressBar value={xp_progress} max={xp_needed} colorClass="bg-primary" />
          <p className="text-xs text-slate-600 text-right">{xp_progress} / {xp_needed} to Level {level + 1}</p>
        </div>

        {/* Streak */}
        <div className="card text-center py-4">
          <Flame size={20} className={`mx-auto mb-1 ${current_streak > 0 ? 'text-orange-400' : 'text-slate-600'}`} />
          <p className="text-3xl font-bold text-slate-100">{current_streak}</p>
          <p className="text-xs text-slate-500 mt-0.5">Day streak</p>
          {longest_streak > 0 && (
            <p className="text-xs text-slate-700 mt-1">Best: {longest_streak}</p>
          )}
        </div>

        {/* Sessions */}
        <div className="card text-center py-4">
          <Trophy size={20} className="text-emerald-400 mx-auto mb-1" />
          <p className="text-3xl font-bold text-slate-100">{total_sessions}</p>
          <p className="text-xs text-slate-500 mt-0.5">Sessions</p>
        </div>
      </div>

      {/* Daily goal */}
      <div className="card space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Target size={16} className="text-primary-light" />
            <span className="text-sm font-semibold text-slate-200">Daily Goal</span>
          </div>
          {!editingGoal ? (
            <button
              className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
              onClick={() => { setGoalInput(String(daily_goal)); setEditingGoal(true) }}
            >
              Edit
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1} max={200}
                value={goalInput}
                onChange={(e) => setGoalInput(e.target.value)}
                className="input w-20 py-1 text-sm"
                autoFocus
              />
              <button className="btn-primary py-1 px-2 text-xs" onClick={saveGoal}>Save</button>
              <button className="btn-ghost py-1 px-2 text-xs" onClick={() => setEditingGoal(false)}>Cancel</button>
            </div>
          )}
        </div>
        <ProgressBar
          value={today.words_studied}
          max={daily_goal}
          colorClass={todayPct >= 100 ? 'bg-emerald-500' : 'bg-primary'}
          height="h-3"
        />
        <div className="flex items-center justify-between text-xs">
          <span className={todayPct >= 100 ? 'text-emerald-400 font-medium' : 'text-slate-400'}>
            {todayPct >= 100
              ? `Goal reached! ${today.words_studied} words today`
              : `${today.words_studied} / ${daily_goal} words today`}
          </span>
          <span className="text-slate-600">{todayPct}%</span>
        </div>
      </div>

      {/* Words learned — total + per frequency */}
      <div className="card space-y-4">
        <div className="flex items-center gap-2">
          <BookOpen size={16} className="text-primary-light" />
          <span className="text-sm font-semibold text-slate-200">Words Learned</span>
          <span className="ml-auto text-xs text-slate-500">
            {total_learned.toLocaleString()} / {TOTAL_WORDS.toLocaleString()} total
          </span>
        </div>

        <ProgressBar value={total_learned} max={TOTAL_WORDS} colorClass="bg-primary" height="h-2.5" />

        <div className="space-y-3 pt-1">
          {Object.entries(by_frequency).map(([lvl, info]) => {
            const c = FREQ_COLORS[lvl] || FREQ_COLORS[5]
            const pct = info.total > 0 ? Math.round((info.learned / info.total) * 100) : 0
            return (
              <div key={lvl} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className={`font-medium ${c.text}`}>{info.label}</span>
                  <span className="text-slate-500">
                    {info.learned} / {info.total} ({pct}%)
                  </span>
                </div>
                <ProgressBar value={info.learned} max={info.total} colorClass={c.bar} height="h-1.5" />
              </div>
            )
          })}
        </div>
      </div>

      {/* Activity heatmap */}
      <div className="card space-y-3">
        <div className="flex items-center gap-2">
          <TrendingUp size={16} className="text-primary-light" />
          <span className="text-sm font-semibold text-slate-200">Last 30 Days</span>
        </div>
        <ActivityHeatmap days={daily_activity} />
      </div>

      {/* Achievements */}
      <div className="card space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Trophy size={16} className="text-amber-400" />
            <span className="text-sm font-semibold text-slate-200">Achievements</span>
          </div>
          <span className="text-xs text-slate-500">{unlockedCount} / {achievements.length} unlocked</span>
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          {achievements.map((ach) => (
            <AchievementCard key={ach.id} ach={ach} />
          ))}
        </div>
      </div>
    </div>
  )
}
