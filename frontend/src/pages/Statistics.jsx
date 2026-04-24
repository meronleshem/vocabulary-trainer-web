import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import {
  BookOpen, Target, Clock, Flame, Award,
  Layers, Brain, CheckCircle2, AlertTriangle, Image,
} from 'lucide-react'
import {
  getStats, getProgress, getSRSStats,
  getStatsPerformance, getStatsVelocity, getStatsHabits,
  getStatsFreqDifficulty,
} from '../api/client'
import DifficultyBadge from '../components/DifficultyBadge'
import StatsCard from '../components/StatsCard'

const DIFF_COLORS  = { EASY: '#10b981', MEDIUM: '#f59e0b', HARD: '#ef4444', NEW_WORD: '#8b5cf6' }
const DIFF_LABELS  = { EASY: 'Easy', MEDIUM: 'Medium', HARD: 'Hard', NEW_WORD: 'New' }
const FREQ_LABELS  = { 1: 'Essential', 2: 'Very Common', 3: 'Common', 4: 'Useful', 5: 'Rare' }
const FREQ_COLORS  = { 1: '#10b981', 2: '#3b82f6', 3: '#f59e0b', 4: '#f97316', 5: '#ef4444' }
const SESSION_LABELS = {
  quiz: 'Quiz', fill_quiz: 'Fill-in-Blank',
  study: 'Flashcards', study_session: 'Study Session', srs: 'SRS Review',
}
const SESSION_COLORS = {
  quiz: '#6366f1', fill_quiz: '#f59e0b',
  study: '#10b981', study_session: '#3b82f6', srs: '#a855f7',
}

// ── Small helpers ─────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

function SectionTitle({ children }) {
  return <h2 className="text-base font-semibold text-slate-200 mb-4">{children}</h2>
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-dark-500 border border-dark-400 rounded-lg px-3 py-2 text-sm">
      {label && <p className="font-medium text-slate-200 mb-1">{label}</p>}
      {payload.map((p, i) => (
        <p key={i} className="text-slate-400">{p.name ?? p.dataKey}: <span className="text-slate-200 font-medium">{p.value}</span></p>
      ))}
    </div>
  )
}

function CoveragePill({ icon: Icon, label, value, total, color, invert = false }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0
  return (
    <div className="card flex items-center gap-3 p-4">
      <div className={`p-2 rounded-lg bg-dark-500 ${color}`}>
        <Icon size={16} />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-slate-500">{label}</p>
        <p className="text-sm font-semibold text-slate-200">
          {value.toLocaleString()}{' '}
          <span className={`font-normal text-xs ${invert && pct > 30 ? 'text-amber-400' : 'text-slate-500'}`}>
            ({pct}%)
          </span>
        </p>
      </div>
    </div>
  )
}

function SRSStageCard({ label, count, borderColor, dotColor, desc }) {
  return (
    <div className={`card border ${borderColor} p-4`}>
      <div className="flex items-center gap-2 mb-1">
        <span className={`w-2 h-2 rounded-full ${dotColor}`} />
        <span className="text-xs text-slate-400 font-medium">{label}</span>
      </div>
      <p className="text-2xl font-bold text-slate-100">{count.toLocaleString()}</p>
      <p className="text-xs text-slate-500 mt-0.5">{desc}</p>
    </div>
  )
}

function WordAccTable({ title, words, color }) {
  if (!words.length) return null
  return (
    <div className="card">
      <h3 className={`text-sm font-semibold mb-3 ${color}`}>{title}</h3>
      <div className="space-y-0">
        {words.map((w, i) => (
          <div key={i} className="flex items-center gap-3 py-2 border-b border-dark-400 last:border-0">
            <span className="text-xs text-slate-600 w-4 flex-shrink-0">{i + 1}</span>
            <span className="text-sm text-slate-200 flex-1 min-w-0 truncate">{w.engWord}</span>
            <span className="text-sm text-slate-400 heb flex-shrink-0">{w.hebWord}</span>
            <DifficultyBadge difficulty={w.difficulty} />
            <span className={`text-sm font-semibold flex-shrink-0 ${color}`}>{w.accuracy}%</span>
            <span className="text-xs text-slate-500 flex-shrink-0">{w.correct_count}/{w.attempt_count}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Statistics() {
  const [data, setData]     = useState(null)
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    Promise.all([
      getStats(),
      getProgress(),
      getSRSStats(),
      getStatsPerformance(),
      getStatsVelocity(),
      getStatsHabits(),
      getStatsFreqDifficulty(),
    ]).then(([statsR, progressR, srsR, perfR, velocityR, habitsR, matrixR]) => {
      setData({
        stats:    statsR.data,
        progress: progressR.data,
        srs:      srsR.data,
        perf:     perfR.data,
        velocity: velocityR.data,
        habits:   habitsR.data,
        matrix:   matrixR.data,
      })
    }).finally(() => setLoading(false))
  }, [])

  if (loading) return <Spinner />
  if (!data)   return <p className="text-slate-500">Failed to load statistics.</p>

  const { stats, progress, srs, perf, velocity, habits, matrix } = data

  // ── Derived values ──────────────────────────────────────────────────────────
  const totalCorrect  = perf.by_session_type.reduce((s, t) => s + (t.total_correct  || 0), 0)
  const totalAttempts = perf.by_session_type.reduce((s, t) => s + (t.total_attempts || 0), 0)
  const overallAcc    = totalAttempts > 0 ? Math.round((totalCorrect / totalAttempts) * 100) : null
  const learnedPct    = stats.total > 0 ? Math.round((progress.total_learned / stats.total) * 100) : 0

  const totalSecs = habits.total_seconds || 0
  const studyTime = totalSecs >= 3600
    ? `${(totalSecs / 3600).toFixed(1)}h`
    : totalSecs >= 60
      ? `${Math.round(totalSecs / 60)}m`
      : totalSecs > 0 ? `${totalSecs}s` : '—'

  // Difficulty donut
  const diffData = Object.entries(stats.by_difficulty || {}).map(([k, v]) => ({
    name: DIFF_LABELS[k] || k,
    value: v,
    key: k,
  }))

  // Frequency learned bars
  const freqData = [1, 2, 3, 4, 5].map(lvl => {
    const fd = progress.by_frequency?.[lvl] || { learned: 0, total: 0 }
    return {
      level:   lvl,
      label:   FREQ_LABELS[lvl],
      learned: fd.learned,
      total:   fd.total,
      pct:     fd.total > 0 ? Math.round((fd.learned / fd.total) * 100) : 0,
    }
  }).filter(d => d.total > 0)

  // Accuracy by difficulty (only where there are attempts)
  const diffAccData = (perf.by_difficulty || [])
    .filter(d => d.total_attempts > 0)
    .map(d => ({
      name:     DIFF_LABELS[d.difficulty] || d.difficulty,
      accuracy: Math.round((d.total_correct / d.total_attempts) * 100),
      key:      d.difficulty,
    }))
    .sort((a, b) => b.accuracy - a.accuracy)

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-100">Statistics</h1>
        <p className="text-slate-500 text-sm mt-1">Complete analytics for your vocabulary journey</p>
      </div>

      {/* ── 1. Hero KPIs ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <StatsCard
          label="Total Words"
          value={stats.total.toLocaleString()}
          icon={Layers}
          color="text-primary-light"
        />
        <StatsCard
          label="Learned"
          value={`${learnedPct}%`}
          sub={`${progress.total_learned.toLocaleString()} words`}
          icon={CheckCircle2}
          color="text-emerald-400"
        />
        <StatsCard
          label="Study Time"
          value={studyTime}
          sub={`${habits.days_active} active days`}
          icon={Clock}
          color="text-blue-400"
        />
        <StatsCard
          label="Accuracy"
          value={overallAcc != null ? `${overallAcc}%` : '—'}
          sub={`${totalAttempts.toLocaleString()} answers`}
          icon={Target}
          color="text-amber-400"
        />
        <StatsCard
          label="Best Streak"
          value={`${progress.longest_streak}d`}
          sub={`Current: ${progress.current_streak}d`}
          icon={Flame}
          color="text-rose-400"
        />
      </div>

      {/* ── 2. Vocabulary Breakdown ─────────────────────────────────────────── */}
      <div>
        <SectionTitle>Vocabulary Breakdown</SectionTitle>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Difficulty donut */}
          <div className="card">
            <h3 className="text-sm font-medium text-slate-400 mb-3">By Difficulty</h3>
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={diffData}
                    cx="50%" cy="50%"
                    innerRadius={50} outerRadius={76}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {diffData.map(e => (
                      <Cell key={e.key} fill={DIFF_COLORS[e.key] || '#6366f1'} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(v, name) => [v, name]}
                    contentStyle={{ background: '#1a1d27', border: '1px solid #2a2d3e', borderRadius: 8 }}
                    labelStyle={{ color: '#e2e8f0' }}
                    itemStyle={{ color: '#94a3b8' }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex flex-wrap gap-3 mt-2 justify-center">
              {diffData.map(d => (
                <div key={d.key} className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: DIFF_COLORS[d.key] }} />
                  <span className="text-xs text-slate-400">
                    {d.name} <span className="text-slate-300 font-medium">{d.value}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Frequency learned bars */}
          <div className="card">
            <h3 className="text-sm font-medium text-slate-400 mb-4">Learned by Frequency Level</h3>
            <div className="space-y-3.5">
              {freqData.map(f => (
                <div key={f.level}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs text-slate-300 font-medium">{f.label}</span>
                    <span className="text-xs text-slate-500">
                      {f.learned.toLocaleString()}/{f.total.toLocaleString()}{' '}
                      <span className="text-slate-300 font-medium">{f.pct}%</span>
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-dark-400 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{ width: `${f.pct}%`, background: FREQ_COLORS[f.level] }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Coverage pills */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4">
          <CoveragePill
            icon={BookOpen}
            label="Words with Examples"
            value={perf.words_with_examples}
            total={stats.total}
            color="text-blue-400"
          />
          <CoveragePill
            icon={Image}
            label="Words with Images"
            value={perf.words_with_images}
            total={stats.total}
            color="text-purple-400"
          />
          <CoveragePill
            icon={AlertTriangle}
            label="Never Attempted"
            value={perf.words_never_attempted}
            total={stats.total}
            color="text-amber-400"
            invert
          />
        </div>
      </div>

      {/* ── 3. SRS Health ───────────────────────────────────────────────────── */}
      <div>
        <SectionTitle>SRS Card Health</SectionTitle>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <SRSStageCard
            label="New"
            count={perf.srs_stages.new}
            borderColor="border-violet-500/30"
            dotColor="bg-violet-500"
            desc="Never reviewed"
          />
          <SRSStageCard
            label="Learning"
            count={perf.srs_stages.learning}
            borderColor="border-blue-500/30"
            dotColor="bg-blue-500"
            desc="Interval ≤ 7 days"
          />
          <SRSStageCard
            label="Young"
            count={perf.srs_stages.young}
            borderColor="border-amber-500/30"
            dotColor="bg-amber-500"
            desc="8–21 days"
          />
          <SRSStageCard
            label="Mature"
            count={perf.srs_stages.mature}
            borderColor="border-emerald-500/30"
            dotColor="bg-emerald-500"
            desc="21+ days"
          />
        </div>
        <div className="flex flex-wrap gap-6 mt-3 px-1">
          <span className="text-xs text-slate-500">
            Avg easiness:{' '}
            <span className="text-slate-300 font-medium">{perf.avg_easiness ?? '—'}</span>
            <span className="text-slate-600"> /5.0</span>
          </span>
          <span className="text-xs text-slate-500">
            Overdue:{' '}
            <span className={perf.overdue > 0 ? 'text-rose-400 font-medium' : 'text-slate-300 font-medium'}>
              {perf.overdue}
            </span>
          </span>
          <span className="text-xs text-slate-500">
            Due now:{' '}
            <span className={srs.due_now > 0 ? 'text-amber-400 font-medium' : 'text-slate-300 font-medium'}>
              {srs.due_now}
            </span>
          </span>
        </div>
      </div>

      {/* ── 4. Performance ──────────────────────────────────────────────────── */}
      <div>
        <SectionTitle>Performance</SectionTitle>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Accuracy by difficulty */}
          <div className="card">
            <h3 className="text-sm font-medium text-slate-400 mb-4">Accuracy by Difficulty</h3>
            {diffAccData.length > 0 ? (
              <div className="h-44">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={diffAccData} layout="vertical" margin={{ left: 0, right: 40 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#2a2d3e" horizontal={false} />
                    <XAxis
                      type="number" domain={[0, 100]}
                      tick={{ fill: '#64748b', fontSize: 11 }}
                      tickFormatter={v => `${v}%`}
                      axisLine={false} tickLine={false}
                    />
                    <YAxis
                      type="category" dataKey="name"
                      tick={{ fill: '#94a3b8', fontSize: 12 }}
                      axisLine={false} tickLine={false}
                      width={65}
                    />
                    <Tooltip
                      formatter={v => [`${v}%`, 'Accuracy']}
                      contentStyle={{ background: '#1a1d27', border: '1px solid #2a2d3e', borderRadius: 8 }}
                      labelStyle={{ color: '#e2e8f0' }}
                      itemStyle={{ color: '#94a3b8' }}
                    />
                    <Bar dataKey="accuracy" radius={[0, 4, 4, 0]}>
                      {diffAccData.map(d => (
                        <Cell key={d.key} fill={DIFF_COLORS[d.key] || '#6366f1'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="text-sm text-slate-500">No quiz data yet.</p>
            )}
          </div>

          {/* Accuracy by session type */}
          <div className="card">
            <h3 className="text-sm font-medium text-slate-400 mb-4">By Session Type</h3>
            {perf.by_session_type.length > 0 ? (
              <div className="space-y-1">
                {perf.by_session_type.map(s => {
                  const acc = s.total_attempts > 0
                    ? Math.round((s.total_correct / s.total_attempts) * 100)
                    : null
                  return (
                    <div
                      key={s.session_type}
                      className="flex items-center justify-between py-2 border-b border-dark-400 last:border-0"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className="w-2 h-2 rounded-full flex-shrink-0"
                          style={{ background: SESSION_COLORS[s.session_type] || '#6366f1' }}
                        />
                        <span className="text-sm text-slate-300">
                          {SESSION_LABELS[s.session_type] || s.session_type}
                        </span>
                      </div>
                      <div className="flex items-center gap-4 text-xs text-slate-400">
                        <span>{s.session_count} sessions</span>
                        {s.avg_duration > 0 && (
                          <span>{Math.round(s.avg_duration / 60)}m avg</span>
                        )}
                        {acc != null && (
                          <span className="font-semibold text-slate-200 w-10 text-right">{acc}%</span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className="text-sm text-slate-500">No sessions yet.</p>
            )}
          </div>
        </div>

        {/* Best / Worst words */}
        {(perf.best_words.length > 0 || perf.worst_words.length > 0) && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
            <WordAccTable title="Top 5 Best Words" words={perf.best_words} color="text-emerald-400" />
            <WordAccTable title="Top 5 Hardest Words" words={perf.worst_words} color="text-rose-400" />
          </div>
        )}
      </div>

      {/* ── 5. Learning Velocity ────────────────────────────────────────────── */}
      <div className="card">
        <div className="flex items-baseline gap-2 mb-4">
          <h2 className="text-base font-semibold text-slate-200">Learning Velocity</h2>
          <span className="text-slate-500 text-sm">words learned per week — last 12 weeks</span>
        </div>
        <div className="h-52">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={velocity} margin={{ left: -10, right: 10, top: 4 }}>
              <defs>
                <linearGradient id="learnGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#6366f1" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2d3e" />
              <XAxis
                dataKey="label"
                tick={{ fill: '#64748b', fontSize: 11 }}
                axisLine={false} tickLine={false}
              />
              <YAxis
                tick={{ fill: '#64748b', fontSize: 11 }}
                axisLine={false} tickLine={false}
                allowDecimals={false}
              />
              <Tooltip
                formatter={v => [v, 'Words learned']}
                contentStyle={{ background: '#1a1d27', border: '1px solid #2a2d3e', borderRadius: 8 }}
                labelStyle={{ color: '#e2e8f0' }}
                itemStyle={{ color: '#94a3b8' }}
              />
              <Area
                type="monotone"
                dataKey="learned"
                stroke="#6366f1"
                strokeWidth={2}
                fill="url(#learnGrad)"
                dot={{ fill: '#6366f1', r: 3 }}
                activeDot={{ r: 5 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── 6. Study Habits ─────────────────────────────────────────────────── */}
      <div>
        <SectionTitle>Study Habits</SectionTitle>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Day of week */}
          <div className="card">
            <h3 className="text-sm font-medium text-slate-400 mb-4">Sessions by Day of Week</h3>
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={habits.by_dow} margin={{ left: -10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2a2d3e" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fill: '#94a3b8', fontSize: 11 }}
                    axisLine={false} tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: '#64748b', fontSize: 11 }}
                    axisLine={false} tickLine={false}
                    allowDecimals={false}
                  />
                  <Tooltip
                    formatter={v => [v, 'Sessions']}
                    contentStyle={{ background: '#1a1d27', border: '1px solid #2a2d3e', borderRadius: 8 }}
                    labelStyle={{ color: '#e2e8f0' }}
                    itemStyle={{ color: '#94a3b8' }}
                  />
                  <Bar dataKey="sessions" fill="#6366f1" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Session breakdown summary */}
          <div className="card flex flex-col justify-between">
            <div>
              <h3 className="text-sm font-medium text-slate-400 mb-3">Session Breakdown</h3>
              <div className="space-y-2.5">
                {habits.by_dow.filter(d => d.sessions > 0).length === 0 && perf.by_session_type.length === 0 && (
                  <p className="text-sm text-slate-500">No sessions recorded yet.</p>
                )}
                {perf.by_session_type.map(s => {
                  const acc = s.total_attempts > 0
                    ? Math.round((s.total_correct / s.total_attempts) * 100)
                    : null
                  return (
                    <div key={s.session_type} className="flex items-center gap-3">
                      <span
                        className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{ background: SESSION_COLORS[s.session_type] || '#6366f1' }}
                      />
                      <span className="text-sm text-slate-300 flex-1">
                        {SESSION_LABELS[s.session_type] || s.session_type}
                      </span>
                      <span className="text-xs text-slate-500">{s.session_count}×</span>
                      {s.avg_duration > 0 && (
                        <span className="text-xs text-slate-500">{Math.round(s.avg_duration / 60)}m</span>
                      )}
                      {acc != null && (
                        <span className="text-xs font-semibold text-slate-300 w-9 text-right">{acc}%</span>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
            <div className="border-t border-dark-400 mt-4 pt-3 flex flex-wrap gap-5 text-xs text-slate-500">
              <span>
                Total time: <span className="text-slate-300 font-medium">{studyTime}</span>
              </span>
              <span>
                Sessions: <span className="text-slate-300 font-medium">{habits.total_sessions}</span>
              </span>
              <span>
                Active days: <span className="text-slate-300 font-medium">{habits.days_active}</span>
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ── 7. Frequency × Difficulty Matrix ────────────────────────────────── */}
      <div className="card overflow-x-auto">
        <div className="flex items-baseline gap-2 mb-4">
          <h2 className="text-base font-semibold text-slate-200">Frequency × Difficulty</h2>
          <span className="text-slate-500 text-sm">click any cell to browse matching words</span>
        </div>
        <table className="w-full text-sm border-collapse min-w-[520px]">
          <thead>
            <tr>
              <th className="text-left text-xs font-medium text-slate-500 pb-3 pr-4 w-28">Frequency</th>
              {[
                { key: 'NEW_WORD', label: 'New',    color: 'text-violet-400' },
                { key: 'EASY',     label: 'Easy',   color: 'text-emerald-400' },
                { key: 'MEDIUM',   label: 'Medium', color: 'text-amber-400' },
                { key: 'HARD',     label: 'Hard',   color: 'text-red-400' },
              ].map(col => (
                <th key={col.key} className={`text-center text-xs font-semibold pb-3 w-20 ${col.color}`}>
                  {col.label}
                </th>
              ))}
              <th className="text-center text-xs font-medium text-slate-500 pb-3 w-16">Total</th>
            </tr>
          </thead>
          <tbody>
            {matrix.map(row => {
              const colDefs = [
                { key: 'NEW_WORD', bg: 'hover:bg-violet-500/10',  border: 'border-violet-500/20'  },
                { key: 'EASY',     bg: 'hover:bg-emerald-500/10', border: 'border-emerald-500/20' },
                { key: 'MEDIUM',   bg: 'hover:bg-amber-500/10',   border: 'border-amber-500/20'   },
                { key: 'HARD',     bg: 'hover:bg-red-500/10',     border: 'border-red-500/20'     },
              ]
              return (
                <tr key={row.freq_level} className="border-t border-dark-400">
                  <td className="py-2.5 pr-4">
                    <div className="flex items-center gap-2">
                      <span
                        className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{ background: FREQ_COLORS[row.freq_level] }}
                      />
                      <span className="text-xs text-slate-300 font-medium">{row.label}</span>
                    </div>
                  </td>
                  {colDefs.map(col => (
                    <td key={col.key} className="text-center py-2.5">
                      {row[col.key] > 0 ? (
                        <button
                          onClick={() => {
                            const params = new URLSearchParams({
                              difficulty: col.key,
                              frequency_level: row.freq_level,
                            })
                            navigate(`/browse?${params.toString()}`)
                          }}
                          className={`w-14 py-1 rounded-md text-xs font-semibold text-slate-200 border ${col.border} ${col.bg} transition-colors`}
                        >
                          {row[col.key].toLocaleString()}
                        </button>
                      ) : (
                        <span className="text-xs text-slate-600">—</span>
                      )}
                    </td>
                  ))}
                  <td className="text-center py-2.5">
                    <span className="text-xs font-medium text-slate-400">{row.total.toLocaleString()}</span>
                  </td>
                </tr>
              )
            })}
            {/* Totals row */}
            <tr className="border-t-2 border-dark-300">
              <td className="py-2.5 pr-4 text-xs font-semibold text-slate-400">Total</td>
              {['NEW_WORD', 'EASY', 'MEDIUM', 'HARD'].map(key => (
                <td key={key} className="text-center py-2.5">
                  <span className="text-xs font-semibold text-slate-300">
                    {matrix.reduce((s, r) => s + (r[key] || 0), 0).toLocaleString()}
                  </span>
                </td>
              ))}
              <td className="text-center py-2.5">
                <span className="text-xs font-bold text-slate-200">{stats.total.toLocaleString()}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
