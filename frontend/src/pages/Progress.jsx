import { useEffect, useState, useCallback } from 'react'
import {
  Flame, Trophy, Target, Zap, Star, BookOpen, TrendingUp,
  TableProperties, BarChart2, AlertTriangle, Clock, CheckCircle2,
} from 'lucide-react'
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import {
  getProgress, patchDailyGoal, getDifficultyTracking,
  getWeakWords, getTrends,
} from '../api/client'
import DifficultyBadge from '../components/DifficultyBadge'

// ── Helpers ───────────────────────────────────────────────────────────────────

const FREQ_COLORS = {
  1: { bar: 'bg-emerald-500', text: 'text-emerald-400', border: 'border-emerald-500/30', bg: 'bg-emerald-500/10' },
  2: { bar: 'bg-blue-500',    text: 'text-blue-400',    border: 'border-blue-500/30',    bg: 'bg-blue-500/10'    },
  3: { bar: 'bg-amber-500',   text: 'text-amber-400',   border: 'border-amber-500/30',   bg: 'bg-amber-500/10'   },
  4: { bar: 'bg-orange-500',  text: 'text-orange-400',  border: 'border-orange-500/30',  bg: 'bg-orange-500/10'  },
  5: { bar: 'bg-red-500',     text: 'text-red-400',     border: 'border-red-500/30',     bg: 'bg-red-500/10'     },
}

const TOTAL_WORDS = 20000

const fmtDate  = (iso) => iso ? iso.split('-').reverse().join('-') : '—'
const fmtMins  = (secs) => secs ? `${Math.round(secs / 60)}m` : '—'
const fmtPct   = (n) => n != null ? `${n}%` : '—'

function ProgressBar({ value, max, colorClass = 'bg-primary', height = 'h-2' }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0
  return (
    <div className={`w-full bg-dark-400 rounded-full overflow-hidden ${height}`}>
      <div className={`h-full rounded-full transition-all duration-500 ${colorClass}`} style={{ width: `${pct}%` }} />
    </div>
  )
}

function Spinner() {
  return (
    <div className="flex items-center justify-center h-32">
      <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

// ── Activity Heatmap ──────────────────────────────────────────────────────────

function ActivityHeatmap({ days }) {
  const map = {}
  days.forEach((d) => { map[d.date] = d.words_studied })

  const cells = []
  const today = new Date()
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const key = d.toISOString().slice(0, 10)
    const count = map[key] || 0
    cells.push({ key, count })
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
          <div key={c.key} title={`${c.key}: ${c.count} words`}
            className={`w-6 h-6 rounded-sm ${intensity(c.count)} cursor-default`} />
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

// ── Achievement Card ──────────────────────────────────────────────────────────

function AchievementCard({ ach }) {
  return (
    <div className={`rounded-xl border p-3 text-center transition-all ${
      ach.unlocked ? 'bg-dark-600 border-primary/30' : 'bg-dark-700 border-dark-400 opacity-50 grayscale'
    }`}>
      <div className="text-2xl mb-1">{ach.emoji}</div>
      <p className={`text-xs font-semibold ${ach.unlocked ? 'text-slate-200' : 'text-slate-500'}`}>{ach.label}</p>
      <p className="text-xs text-slate-600 mt-0.5">{ach.desc}</p>
      <p className={`text-xs mt-1 font-medium ${ach.unlocked ? 'text-primary-light' : 'text-slate-700'}`}>+{ach.xp} XP</p>
    </div>
  )
}

// ── Custom Tooltip for charts ─────────────────────────────────────────────────

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-dark-600 border border-dark-400 rounded-lg px-3 py-2 text-xs space-y-1 shadow-lg">
      <p className="text-slate-400 font-medium">{label}</p>
      {payload.map((p) => (
        <p key={p.dataKey} style={{ color: p.color }}>
          {p.name}: <span className="font-semibold">{p.value ?? '—'}{p.dataKey === 'accuracy_pct' ? '%' : ''}</span>
        </p>
      ))}
    </div>
  )
}

// ── Accuracy colour helper ────────────────────────────────────────────────────

function accuracyColor(pct) {
  if (pct == null) return 'text-slate-500'
  if (pct >= 80)  return 'text-emerald-400'
  if (pct >= 60)  return 'text-amber-400'
  return 'text-red-400'
}

// ── Tab: Overview ─────────────────────────────────────────────────────────────

function OverviewTab({ data, onGoalSave }) {
  const [editingGoal, setEditingGoal] = useState(false)
  const [goalInput, setGoalInput] = useState('')

  const {
    total_xp, level, xp_progress, xp_needed,
    daily_goal, current_streak, longest_streak,
    total_learned, total_sessions,
    by_frequency, daily_activity, today,
    achievements,
  } = data

  const todayPct = daily_goal > 0 ? Math.min(100, Math.round((today.words_studied / daily_goal) * 100)) : 0
  const unlockedCount = achievements.filter((a) => a.unlocked).length

  const saveGoal = async () => {
    const val = parseInt(goalInput, 10)
    if (!val || val < 1 || val > 200) return
    await onGoalSave(val)
    setEditingGoal(false)
  }

  return (
    <>
      {/* Level / XP / Streak row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="card text-center py-4 col-span-2 sm:col-span-1">
          <Star size={20} className="text-amber-400 mx-auto mb-1" />
          <p className="text-3xl font-bold text-slate-100">{level}</p>
          <p className="text-xs text-slate-500 mt-0.5">Level</p>
        </div>
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
        <div className="card text-center py-4">
          <Flame size={20} className={`mx-auto mb-1 ${current_streak > 0 ? 'text-orange-400' : 'text-slate-600'}`} />
          <p className="text-3xl font-bold text-slate-100">{current_streak}</p>
          <p className="text-xs text-slate-500 mt-0.5">Day streak</p>
          {longest_streak > 0 && <p className="text-xs text-slate-700 mt-1">Best: {longest_streak}</p>}
        </div>
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
            <button className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
              onClick={() => { setGoalInput(String(daily_goal)); setEditingGoal(true) }}>Edit</button>
          ) : (
            <div className="flex items-center gap-2">
              <input type="number" min={1} max={200} value={goalInput}
                onChange={(e) => setGoalInput(e.target.value)}
                className="input w-20 py-1 text-sm" autoFocus />
              <button className="btn-primary py-1 px-2 text-xs" onClick={saveGoal}>Save</button>
              <button className="btn-ghost py-1 px-2 text-xs" onClick={() => setEditingGoal(false)}>Cancel</button>
            </div>
          )}
        </div>
        <ProgressBar value={today.words_studied} max={daily_goal}
          colorClass={todayPct >= 100 ? 'bg-emerald-500' : 'bg-primary'} height="h-3" />
        <div className="flex items-center justify-between text-xs">
          <span className={todayPct >= 100 ? 'text-emerald-400 font-medium' : 'text-slate-400'}>
            {todayPct >= 100 ? `Goal reached! ${today.words_studied} words today` : `${today.words_studied} / ${daily_goal} words today`}
          </span>
          <span className="text-slate-600">{todayPct}%</span>
        </div>
      </div>

      {/* Words learned */}
      <div className="card space-y-4">
        <div className="flex items-center gap-2">
          <BookOpen size={16} className="text-primary-light" />
          <span className="text-sm font-semibold text-slate-200">Words Learned</span>
          <span className="ml-auto text-xs text-slate-500">{total_learned.toLocaleString()} / {TOTAL_WORDS.toLocaleString()} total</span>
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
                  <span className="text-slate-500">{info.learned} / {info.total} ({pct}%)</span>
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
          {achievements.map((ach) => <AchievementCard key={ach.id} ach={ach} />)}
        </div>
      </div>
    </>
  )
}

// ── Tab: Analytics ────────────────────────────────────────────────────────────

function AnalyticsTab() {
  const [period, setPeriod] = useState('weekly')
  const [trends, setTrends] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    getTrends(period)
      .then((r) => setTrends(r.data))
      .finally(() => setLoading(false))
  }, [period])

  const chartData = (trends || []).map((row) => ({
    label: period === 'weekly'
      ? `W${row.period.split('-W')[1]}`
      : row.period.slice(5),   // MM
    words: row.words,
    sessions: row.sessions,
    accuracy_pct: row.accuracy_pct,
  }))

  // Summary stats from the most recent two periods
  const latest  = trends?.[trends.length - 1]
  const previous = trends?.[trends.length - 2]
  const wordsDelta = (latest && previous && previous.words > 0)
    ? Math.round(((latest.words - previous.words) / previous.words) * 100)
    : null

  return (
    <div className="space-y-5">
      {/* Period toggle */}
      <div className="flex items-center gap-2">
        {['weekly', 'monthly'].map((p) => (
          <button key={p} onClick={() => setPeriod(p)}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
              period === p ? 'bg-primary/20 text-primary-light border border-primary/30' : 'text-slate-500 hover:text-slate-300'
            }`}>
            {p.charAt(0).toUpperCase() + p.slice(1)}
          </button>
        ))}
        {wordsDelta != null && (
          <span className={`ml-auto text-xs font-medium ${wordsDelta >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {wordsDelta >= 0 ? '+' : ''}{wordsDelta}% vs prev period
          </span>
        )}
      </div>

      {/* Chart */}
      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <BarChart2 size={15} className="text-primary-light" />
          <span className="text-sm font-semibold text-slate-200">Words Studied &amp; Accuracy</span>
        </div>
        {loading ? <Spinner /> : chartData.length === 0 ? (
          <p className="text-slate-500 text-sm text-center py-8">No data yet — complete some sessions first.</p>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={chartData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="label" tick={{ fill: '#64748b', fontSize: 11 }} />
              <YAxis yAxisId="left"  tick={{ fill: '#64748b', fontSize: 11 }} />
              <YAxis yAxisId="right" orientation="right" domain={[0, 100]}
                tick={{ fill: '#64748b', fontSize: 11 }} tickFormatter={(v) => `${v}%`} />
              <Tooltip content={<ChartTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11, color: '#94a3b8' }} />
              <Bar yAxisId="left" dataKey="words" name="Words" fill="#6366f1" radius={[3, 3, 0, 0]} />
              <Line yAxisId="right" type="monotone" dataKey="accuracy_pct" name="Accuracy"
                stroke="#34d399" strokeWidth={2} dot={{ r: 3, fill: '#34d399' }}
                connectNulls />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Session count chart */}
      {!loading && chartData.length > 0 && (
        <div className="card">
          <div className="flex items-center gap-2 mb-4">
            <Trophy size={15} className="text-amber-400" />
            <span className="text-sm font-semibold text-slate-200">Sessions per {period === 'weekly' ? 'Week' : 'Month'}</span>
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <ComposedChart data={chartData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="label" tick={{ fill: '#64748b', fontSize: 11 }} />
              <YAxis tick={{ fill: '#64748b', fontSize: 11 }} allowDecimals={false} />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="sessions" name="Sessions" fill="#f59e0b" radius={[3, 3, 0, 0]} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

// ── Tab: Words ────────────────────────────────────────────────────────────────

function WordsTab() {
  const [weakWords, setWeakWords] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getWeakWords()
      .then((r) => setWeakWords(r.data))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <Spinner />

  if (!weakWords || weakWords.length === 0) {
    return (
      <div className="card text-center py-12 space-y-2">
        <CheckCircle2 size={32} className="text-emerald-400 mx-auto" />
        <p className="text-slate-300 font-medium">No weak words detected</p>
        <p className="text-slate-500 text-sm">Words with 3+ attempts and accuracy below 60% appear here.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <AlertTriangle size={15} className="text-amber-400" />
        <span className="text-sm font-semibold text-slate-200">Weak Words</span>
        <span className="ml-1 text-xs text-slate-500">accuracy &lt; 60% with 3+ attempts</span>
        <span className="ml-auto text-xs bg-amber-500/15 text-amber-400 border border-amber-500/25 px-2 py-0.5 rounded-full">
          {weakWords.length} word{weakWords.length !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="card p-0 overflow-hidden divide-y divide-dark-400/50">
        {weakWords.map((w) => (
          <div key={w.id} className="flex items-center gap-3 px-4 py-3">
            {/* Accuracy ring indicator */}
            <div className={`w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold border-2 ${
              w.accuracy_pct < 30
                ? 'border-red-500/60 text-red-400 bg-red-500/10'
                : 'border-amber-500/60 text-amber-400 bg-amber-500/10'
            }`}>
              {w.accuracy_pct}%
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-slate-200 font-medium">{w.engWord}</span>
                <span className="text-slate-400 heb text-sm">{w.hebWord}</span>
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-slate-600 text-xs">{w.correct_count}/{w.attempt_count} correct</span>
                {w.last_attempt_date && (
                  <span className="text-slate-700 text-xs">· last {fmtDate(w.last_attempt_date)}</span>
                )}
              </div>
            </div>

            <DifficultyBadge difficulty={w.difficulty} />
          </div>
        ))}
      </div>

      <p className="text-xs text-slate-600 text-center">
        These words appear in study sessions automatically. Keep practicing them.
      </p>
    </div>
  )
}

// ── Tab: History ──────────────────────────────────────────────────────────────

function HistoryTab() {
  const [rows, setRows] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getDifficultyTracking()
      .then((r) => setRows(r.data))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <Spinner />

  if (!rows || rows.length === 0) {
    return (
      <p className="text-slate-500 text-sm text-center py-8">
        No history yet. Complete some study sessions to see data here.
      </p>
    )
  }

  return (
    <div className="card p-0 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-dark-400 bg-dark-700">
              <th className="text-left py-2.5 px-3 text-slate-400 font-medium">Date</th>
              <th className="text-right py-2.5 px-3 text-primary-light font-medium">Studied</th>
              <th className="text-right py-2.5 px-3 text-slate-400 font-medium">Accuracy</th>
              <th className="text-right py-2.5 px-3 text-slate-400 font-medium hidden sm:table-cell">Sessions</th>
              <th className="text-right py-2.5 px-3 text-slate-400 font-medium hidden sm:table-cell">
                <span className="flex items-center justify-end gap-1"><Clock size={12} /> Time</span>
              </th>
              <th className="text-right py-2.5 px-3 text-emerald-400 font-medium">Easy</th>
              <th className="text-right py-2.5 px-3 text-amber-400 font-medium">Med</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.date} className="border-b border-dark-500 hover:bg-dark-500/50 transition-colors">
                <td className="py-2 px-3 text-slate-300 whitespace-nowrap">{fmtDate(row.date)}</td>
                <td className="py-2 px-3 text-right font-medium text-primary-light">{row.words_studied}</td>
                <td className={`py-2 px-3 text-right font-medium ${accuracyColor(row.accuracy_pct)}`}>
                  {fmtPct(row.accuracy_pct)}
                </td>
                <td className="py-2 px-3 text-right text-slate-400 hidden sm:table-cell">{row.session_count || '—'}</td>
                <td className="py-2 px-3 text-right text-slate-400 hidden sm:table-cell">{fmtMins(row.total_duration_seconds)}</td>
                <td className="py-2 px-3 text-right text-emerald-400 font-medium">{row.easy || '—'}</td>
                <td className="py-2 px-3 text-right text-amber-400 font-medium">{row.medium || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Main Progress ─────────────────────────────────────────────────────────────

export default function Progress() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('overview')

  const load = useCallback(() => {
    setLoading(true)
    getProgress()
      .then((r) => setData(r.data))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  const handleGoalSave = async (val) => {
    const { patchDailyGoal: patch } = await import('../api/client')
    await patch(val)
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

  const TABS = [
    { id: 'overview',  label: 'Overview',  icon: TrendingUp    },
    { id: 'analytics', label: 'Analytics', icon: BarChart2      },
    { id: 'words',     label: 'Words',     icon: AlertTriangle  },
    { id: 'history',   label: 'History',   icon: TableProperties},
  ]

  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-slate-100">Progress</h1>
        <p className="text-slate-500 text-sm mt-1">Track your learning journey</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-dark-400 overflow-x-auto">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setActiveTab(id)}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px whitespace-nowrap ${
              activeTab === id
                ? 'border-primary text-primary-light'
                : 'border-transparent text-slate-500 hover:text-slate-300'
            }`}>
            <Icon size={13} />
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'overview'  && <OverviewTab data={data} onGoalSave={handleGoalSave} />}
      {activeTab === 'analytics' && <AnalyticsTab />}
      {activeTab === 'words'     && <WordsTab />}
      {activeTab === 'history'   && <HistoryTab />}
    </div>
  )
}
