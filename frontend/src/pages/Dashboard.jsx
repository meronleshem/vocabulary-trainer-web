import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from 'recharts'
import { BookOpen, Brain, Trophy, Layers, ArrowRight, Flame, Zap, Target } from 'lucide-react'
import { getStats, getProgress } from '../api/client'
import StatsCard from '../components/StatsCard'
import DifficultyBadge from '../components/DifficultyBadge'

const DIFF_COLORS = {
  EASY: '#10b981',
  MEDIUM: '#f59e0b',
  HARD: '#ef4444',
  NEW_WORD: '#8b5cf6',
}

const DIFF_LABELS = {
  EASY: 'Easy',
  MEDIUM: 'Medium',
  HARD: 'Hard',
  NEW_WORD: 'New',
}

const FREQ_LEVELS = [
  { level: 1, label: 'Essential',   color: '#10b981' },
  { level: 2, label: 'Very Common', color: '#3b82f6' },
  { level: 3, label: 'Common',      color: '#f59e0b' },
  { level: 4, label: 'Useful',      color: '#f97316' },
  { level: 5, label: 'Rare',        color: '#ef4444' },
]

const CustomTooltip = ({ active, payload }) => {
  if (active && payload?.length) {
    return (
      <div className="bg-dark-500 border border-dark-400 rounded-lg px-3 py-2 text-sm">
        <p className="font-medium text-slate-200">{payload[0].name}</p>
        <p className="text-slate-400">{payload[0].value} words</p>
      </div>
    )
  }
  return null
}

export default function Dashboard() {
  const [stats, setStats] = useState(null)
  const [progress, setProgress] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([getStats(), getProgress()])
      .then(([s, p]) => { setStats(s.data); setProgress(p.data) })
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!stats) return <p className="text-slate-500">Failed to load stats.</p>

  const diffData = Object.entries(stats.by_difficulty || {}).map(([k, v]) => ({
    name: DIFF_LABELS[k] || k,
    value: v,
    key: k,
  }))

  const bookData = Object.entries(stats.by_book || {})
    .map(([book, d]) => {
      // support both old format (number) and new format (object with difficulty counts)
      const isNew = d && typeof d === 'object'
      return {
        book: book.replace(/^The /, ''),
        _total: isNew ? d.total : (d || 0),
        NEW_WORD: isNew ? (d.NEW_WORD || 0) : 0,
        EASY:     isNew ? (d.EASY     || 0) : 0,
        MEDIUM:   isNew ? (d.MEDIUM   || 0) : 0,
        HARD:     isNew ? (d.HARD     || 0) : 0,
      }
    })
    .sort((a, b) => b._total - a._total)
    .slice(0, 10)

  const mastered =
    (stats.by_difficulty?.EASY || 0) + (stats.by_difficulty?.MEDIUM || 0)
  const masteredPct = stats.total
    ? Math.round((mastered / stats.total) * 100)
    : 0

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-100">Dashboard</h1>
        <p className="text-slate-500 text-sm mt-1">Your vocabulary progress at a glance</p>
      </div>

      {/* Progress strip */}
      {progress && (
        <Link
          to="/progress"
          className="card border border-dark-400 hover:border-primary/40 transition-colors group"
        >
          <div className="flex flex-wrap items-center gap-4 sm:gap-8">
            {/* Streak */}
            <div className="flex items-center gap-2">
              <Flame size={18} className={progress.current_streak > 0 ? 'text-orange-400' : 'text-slate-600'} />
              <div>
                <p className="text-lg font-bold text-slate-100 leading-none">{progress.current_streak}</p>
                <p className="text-xs text-slate-500">day streak</p>
              </div>
            </div>
            {/* XP / Level */}
            <div className="flex items-center gap-2">
              <Zap size={18} className="text-primary-light" />
              <div>
                <p className="text-lg font-bold text-slate-100 leading-none">Level {progress.level}</p>
                <p className="text-xs text-slate-500">{progress.total_xp.toLocaleString()} XP</p>
              </div>
            </div>
            {/* Words learned */}
            <div className="flex items-center gap-2">
              <Trophy size={18} className="text-emerald-400" />
              <div>
                <p className="text-lg font-bold text-slate-100 leading-none">{progress.total_learned.toLocaleString()}</p>
                <p className="text-xs text-slate-500">words learned</p>
              </div>
            </div>
            {/* Daily goal */}
            <div className="flex-1 min-w-40">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-1.5">
                  <Target size={13} className="text-primary-light" />
                  <span className="text-xs text-slate-400">Today's goal</span>
                </div>
                <span className="text-xs text-slate-500">
                  {progress.today.words_studied} / {progress.daily_goal}
                </span>
              </div>
              <div className="h-1.5 bg-dark-400 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    progress.today.words_studied >= progress.daily_goal ? 'bg-emerald-500' : 'bg-primary'
                  }`}
                  style={{ width: `${Math.min(100, Math.round((progress.today.words_studied / progress.daily_goal) * 100))}%` }}
                />
              </div>
            </div>
            <ArrowRight size={14} className="text-slate-600 group-hover:text-slate-400 transition-colors ml-auto hidden sm:block" />
          </div>
        </Link>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard
          label="Total Words"
          value={stats.total.toLocaleString()}
          icon={Layers}
          color="text-primary-light"
        />
        <StatsCard
          label="New Words"
          value={(stats.by_difficulty?.NEW_WORD || 0).toLocaleString()}
          sub="Awaiting study"
          icon={BookOpen}
          color="text-violet-400"
        />
        <StatsCard
          label="Hard Words"
          value={(stats.by_difficulty?.HARD || 0).toLocaleString()}
          sub="Need more practice"
          icon={Brain}
          color="text-red-400"
        />
        <StatsCard
          label="Mastered"
          value={`${masteredPct}%`}
          sub={`${mastered} words`}
          icon={Trophy}
          color="text-emerald-400"
        />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Pie chart */}
        <div className="card">
          <h2 className="text-base font-semibold text-slate-200 mb-4">Words by Difficulty</h2>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={diffData}
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={85}
                  paddingAngle={3}
                  dataKey="value"
                >
                  {diffData.map((entry) => (
                    <Cell key={entry.key} fill={DIFF_COLORS[entry.key] || '#6366f1'} />
                  ))}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          {/* Legend */}
          <div className="flex flex-wrap gap-3 mt-2 justify-center">
            {diffData.map((d) => (
              <div key={d.key} className="flex items-center gap-1.5">
                <span
                  className="w-2.5 h-2.5 rounded-full"
                  style={{ background: DIFF_COLORS[d.key] }}
                />
                <span className="text-xs text-slate-400">
                  {d.name} ({d.value})
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Bar chart: top books stacked by difficulty */}
        <div className="card">
          <h2 className="text-base font-semibold text-slate-200 mb-4">Words per Book (Top 10)</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={bookData} layout="vertical" margin={{ left: 0, right: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a2d3e" horizontal={false} />
                <XAxis type="number" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis
                  type="category"
                  dataKey="book"
                  tick={{ fill: '#94a3b8', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  width={110}
                />
                <Tooltip
                  cursor={{ fill: '#2a2d3e' }}
                  contentStyle={{ background: '#1a1d27', border: '1px solid #2a2d3e', borderRadius: 8 }}
                  labelStyle={{ color: '#e2e8f0' }}
                  itemStyle={{ color: '#94a3b8' }}
                  formatter={(value, name) => [value, DIFF_LABELS[name] || name]}
                />
                <Bar dataKey="NEW_WORD" stackId="a" fill={DIFF_COLORS.NEW_WORD} name="NEW_WORD" />
                <Bar dataKey="EASY"     stackId="a" fill={DIFF_COLORS.EASY}     name="EASY" />
                <Bar dataKey="MEDIUM"   stackId="a" fill={DIFF_COLORS.MEDIUM}   name="MEDIUM" />
                <Bar dataKey="HARD"     stackId="a" fill={DIFF_COLORS.HARD}     name="HARD" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Frequency Breakdown */}
      <div className="card">
        <h2 className="text-base font-semibold text-slate-200 mb-3">Frequency Breakdown</h2>
        <div className="flex h-4 rounded-full overflow-hidden gap-0.5">
          {FREQ_LEVELS.map(({ level, color }) => {
            const count = stats.by_frequency?.[level] || 0
            if (!count) return null
            return (
              <div
                key={level ?? 'unknown'}
                style={{ width: `${(count / stats.total) * 100}%`, background: color }}
                title={`${FREQ_LEVELS.find(f => f.level === level)?.label}: ${count}`}
              />
            )
          })}
        </div>
        <div className="flex flex-wrap gap-4 mt-3">
          {FREQ_LEVELS.map(({ level, label, color }) => {
            const count = stats.by_frequency?.[level] || 0
            if (!count) return null
            return (
              <div key={level ?? 'unknown'} className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ background: color }} />
                <span className="text-xs text-slate-400">
                  {label}: {count} ({Math.round((count / stats.total) * 100)}%)
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Recent words */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-slate-200">Recently Added</h2>
          <Link
            to="/browse"
            className="text-xs text-primary-light hover:text-primary flex items-center gap-1 transition-colors"
          >
            View all <ArrowRight size={12} />
          </Link>
        </div>
        <div className="space-y-2">
          {(stats.recent || []).map((word) => (
            <div
              key={word.id}
              className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-dark-500 transition-colors"
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="font-medium text-slate-200 truncate">{word.engWord}</span>
                <span className="text-slate-500">→</span>
                <span className="text-slate-400 heb truncate">{word.hebWord}</span>
              </div>
              <div className="flex items-center gap-2 ml-3 flex-shrink-0">
                <span className="text-xs text-slate-600 hidden sm:block">
                  {word.group_name?.replace(/_/g, ' ')}
                </span>
                <DifficultyBadge difficulty={word.difficulty} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { to: '/study', label: 'Start Flashcards', desc: 'Study with flip cards', icon: Brain, color: 'border-primary/30 hover:border-primary/60' },
          { to: '/quiz', label: 'Take a Quiz', desc: 'Test your knowledge', icon: Trophy, color: 'border-amber-500/30 hover:border-amber-500/60' },
          { to: '/browse', label: 'Browse Words', desc: 'Search & manage', icon: BookOpen, color: 'border-emerald-500/30 hover:border-emerald-500/60' },
        ].map((a) => (
          <Link
            key={a.to}
            to={a.to}
            className={`card border-2 ${a.color} transition-colors group hover:bg-dark-500`}
          >
            <a.icon size={22} className="text-slate-400 group-hover:text-slate-200 transition-colors mb-2" />
            <p className="font-semibold text-slate-200">{a.label}</p>
            <p className="text-sm text-slate-500 mt-0.5">{a.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  )
}
