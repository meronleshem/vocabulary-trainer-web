import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  CheckCircle2, Lock, Play, Star, Zap, Trophy, ChevronRight, RefreshCw,
} from 'lucide-react'
import { getRoadmapState, getCurrentMission } from '../api/client'

const TYPE_META = {
  group:        { label: 'Group',              color: 'text-primary-light',  bg: 'bg-primary/15',     border: 'border-primary/30'     },
  checkpoint_3: { label: 'Mini Checkpoint',    color: 'text-amber-400',      bg: 'bg-amber-500/15',   border: 'border-amber-500/30'   },
  checkpoint_9: { label: 'Master Checkpoint',  color: 'text-purple-400',     bg: 'bg-purple-500/15',  border: 'border-purple-500/30'  },
}

function pct(score) {
  return Math.round((score || 0) * 100)
}

function MissionCard({ item, onStart }) {
  const meta = TYPE_META[item.type] || TYPE_META.group
  const { status, mission, group } = item

  const isCompleted = status === 'completed'
  const isActive    = status === 'active'
  const isLocked    = status === 'locked'

  let borderCls = 'border-dark-400'
  if (isActive)    borderCls = `${meta.border} shadow-lg shadow-primary/5`
  if (isCompleted) borderCls = 'border-emerald-500/20'
  if (isLocked)    borderCls = 'border-dark-500'

  const score = mission?.best_score ?? group?.best_score ?? 0
  const lastScore = mission?.last_attempt_score ?? group?.last_attempt_score
  const attempts = mission?.attempts_count ?? 0

  return (
    <div className={`card border ${borderCls} transition-all ${isLocked ? 'opacity-40' : ''}`}>
      <div className="flex items-start gap-4">
        {/* Status icon */}
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
          isCompleted ? 'bg-emerald-500/15' :
          isActive    ? meta.bg :
                        'bg-dark-500'
        }`}>
          {isCompleted ? <CheckCircle2 size={20} className="text-emerald-400" /> :
           isActive    ? <Play size={20} className={meta.color} /> :
                         <Lock size={20} className="text-slate-600" />}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${meta.bg} ${meta.color}`}>
              {meta.label}
            </span>
            {isCompleted && (
              <span className="text-xs text-emerald-400 font-medium">
                {pct(score)}%
              </span>
            )}
            {!isCompleted && attempts > 0 && lastScore !== null && lastScore !== undefined && (
              <span className="text-xs text-amber-400 font-medium">
                Last: {pct(lastScore)}%
              </span>
            )}
          </div>

          <p className="text-slate-200 font-semibold mt-1">{item.title}</p>

          <p className="text-xs text-slate-500 mt-0.5">{item.subtitle}</p>

          {isActive && !isCompleted && (
            <div className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
              <Star size={11} className={meta.color} />
              <span>Pass with ≥{item.requiredPct}% to complete</span>
            </div>
          )}
        </div>

        {/* CTA */}
        {isActive && (
          <button
            onClick={() => onStart(mission)}
            className="btn-primary flex-shrink-0 flex items-center gap-1.5 text-sm px-4 py-2"
          >
            {attempts > 0 ? <RefreshCw size={14} /> : <Play size={14} />}
            {attempts > 0 ? 'Retry' : 'Start'}
          </button>
        )}
        {isCompleted && (
          <CheckCircle2 size={22} className="text-emerald-400 flex-shrink-0 mt-1" />
        )}
      </div>
    </div>
  )
}

function buildSequence(groups, missions, currentMission) {
  const seq = []

  for (let i = 0; i < groups.length; i++) {
    const group   = groups[i]
    const groupNum = i + 1

    const gMission = missions.find(
      (m) => m.mission_type === 'group' && m.related_group_ids.includes(group.id)
    )

    let status = 'locked'
    if (group.is_completed) status = 'completed'
    else if (gMission && currentMission?.id === gMission.id) status = 'active'
    else if (!gMission && currentMission?.mission_type === 'group' &&
             currentMission?.related_group_ids?.includes(group.id)) status = 'active'

    seq.push({
      key:         `group-${group.id}`,
      type:        'group',
      title:       `Group ${groupNum}: ${group.group_name.replace(/_/g, ' ')}`,
      subtitle:    `${group.word_count} words · 95% to pass`,
      requiredPct: 95,
      status,
      mission:     gMission,
      group,
    })

    if (groupNum % 3 === 0) {
      const last3  = groups.slice(i - 2, i + 1).map((g) => g.id)
      const cMiss  = missions.find(
        (m) => m.mission_type === 'checkpoint_3' && last3.every((id) => m.related_group_ids.includes(id))
      )
      let cStatus  = 'locked'
      if (cMiss?.is_completed) cStatus = 'completed'
      else if (cMiss && currentMission?.id === cMiss.id) cStatus = 'active'

      seq.push({
        key:         `cp3-${groupNum}`,
        type:        'checkpoint_3',
        title:       `Mini Checkpoint: Groups ${groupNum - 2}–${groupNum}`,
        subtitle:    '40 random words · 90% to pass',
        requiredPct: 90,
        status:      cStatus,
        mission:     cMiss || null,
        group:       null,
      })

      if (groupNum % 9 === 0) {
        const allIds = groups.slice(0, i + 1).map((g) => g.id)
        const mMiss  = missions.find(
          (m) => m.mission_type === 'checkpoint_9' && m.related_group_ids.length === allIds.length
        )
        let mStatus  = 'locked'
        if (mMiss?.is_completed) mStatus = 'completed'
        else if (mMiss && currentMission?.id === mMiss.id) mStatus = 'active'

        seq.push({
          key:         `cp9-${groupNum}`,
          type:        'checkpoint_9',
          title:       `Master Checkpoint: Groups 1–${groupNum}`,
          subtitle:    '100 random words · 90% to pass',
          requiredPct: 90,
          status:      mStatus,
          mission:     mMiss || null,
          group:       null,
        })
      }
    }
  }

  return seq
}

export default function Roadmap() {
  const [state, setState]   = useState(null)
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  const load = () => {
    setLoading(true)
    getCurrentMission()
      .then(() => getRoadmapState())
      .then((r) => setState(r.data))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const handleStart = (mission) => {
    navigate(`/mission/${mission.id}`)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!state) return <p className="text-slate-500">Failed to load roadmap.</p>

  const sequence  = buildSequence(state.groups, state.missions, state.current_mission)
  const totalGroups     = state.groups.length
  const completedGroups = state.groups.filter((g) => g.is_completed).length
  const progressPct     = totalGroups ? Math.round((completedGroups / totalGroups) * 100) : 0

  const currentItem = sequence.find((s) => s.status === 'active')

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
          <Trophy size={22} className="text-amber-400" />
          Learning Roadmap
        </h1>
        <p className="text-slate-500 text-sm mt-1">
          Complete groups and checkpoint quizzes to advance
        </p>
      </div>

      {/* Overall progress */}
      <div className="card">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-slate-300">Overall Progress</span>
          <span className="text-sm text-slate-400">{completedGroups} / {totalGroups} groups</span>
        </div>
        <div className="h-2.5 bg-dark-500 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-primary to-primary-light rounded-full transition-all duration-500"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <p className="text-xs text-slate-500 mt-1.5">{progressPct}% complete</p>
      </div>

      {/* Current mission highlight */}
      {currentItem && (
        <div className="card border-2 border-primary/30 bg-primary/5">
          <div className="flex items-center gap-2 mb-3">
            <Zap size={16} className="text-primary-light" />
            <span className="text-xs font-semibold text-primary-light uppercase tracking-wide">Current Mission</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="font-semibold text-slate-100">{currentItem.title}</p>
              <p className="text-xs text-slate-500 mt-0.5">{currentItem.subtitle}</p>
            </div>
            <button
              onClick={() => handleStart(currentItem.mission)}
              className="btn-primary flex items-center gap-1.5 flex-shrink-0"
            >
              {(currentItem.mission?.attempts_count ?? 0) > 0 ? <RefreshCw size={14} /> : <Play size={14} />}
              {(currentItem.mission?.attempts_count ?? 0) > 0 ? 'Retry' : 'Start'}
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}

      {!currentItem && completedGroups === totalGroups && (
        <div className="card border border-emerald-500/30 bg-emerald-500/5 text-center py-8">
          <Trophy size={40} className="text-amber-400 mx-auto mb-3" />
          <p className="text-lg font-bold text-slate-100">Roadmap Complete!</p>
          <p className="text-slate-400 text-sm mt-1">You've mastered all groups and checkpoints.</p>
        </div>
      )}

      {/* Mission sequence */}
      <div className="space-y-3">
        {sequence.map((item, idx) => (
          <div key={item.key} className="relative">
            {/* Connector line */}
            {idx < sequence.length - 1 && (
              <div className="absolute left-9 top-full w-0.5 h-3 bg-dark-400 z-0" />
            )}
            <MissionCard item={item} onStart={handleStart} />
          </div>
        ))}
      </div>
    </div>
  )
}
