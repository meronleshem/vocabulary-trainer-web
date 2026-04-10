import { useState, useRef } from 'react'
import { X, Upload, FileText, CheckCircle, XCircle, Loader2, AlertTriangle } from 'lucide-react'
import { lookupWord, createWord } from '../api/client'

const CHUNK = 40 // words per group

export default function ImportModal({ books, onClose, onSaved }) {
  const [groupBase, setGroupBase] = useState('')
  const [words, setWords] = useState([])   // parsed from file
  const [fileName, setFileName] = useState('')
  const [phase, setPhase] = useState('setup') // setup | running | done
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [log, setLog] = useState([])       // {word, status: 'ok'|'skip'|'error', note}
  const fileRef = useRef(null)
  const abortRef = useRef(false)

  const allGroups = books.flatMap((b) => b.groups.map((g) => g.group_name))

  // ── File picker ──────────────────────────────────────────────────────────────
  const handleFile = (e) => {
    const file = e.target.files[0]
    if (!file) return
    setFileName(file.name)
    const reader = new FileReader()
    reader.onload = (ev) => {
      const lines = ev.target.result
        .split(/\r?\n/)
        .map((l) => l.trim().toLowerCase())
        .filter(Boolean)
      // deduplicate within the file itself
      const unique = [...new Set(lines)]
      setWords(unique)
    }
    reader.readAsText(file)
  }

  // ── Import runner ────────────────────────────────────────────────────────────
  const handleImport = async () => {
    if (!words.length || !groupBase.trim()) return
    abortRef.current = false
    setPhase('running')
    setLog([])
    setProgress({ done: 0, total: words.length })

    const base = groupBase.trim()

    for (let i = 0; i < words.length; i++) {
      if (abortRef.current) break
      const word = words[i]
      const chunkIdx = Math.floor(i / CHUNK) + 1
      const groupName = `${base} ${chunkIdx}`

      let entry = { word, status: 'ok', note: groupName }

      try {
        const res = await lookupWord(word)
        const { hebWord, examples } = res.data

        if (!hebWord) {
          entry = { word, status: 'error', note: 'No translation found' }
        } else {
          await createWord({
            engWord: word,
            hebWord,
            examples: examples || '',
            difficulty: 'NEW_WORD',
            group_name: groupName,
            image_url: '',
          })
        }
      } catch (err) {
        const status = err.response?.status
        if (status === 409) {
          entry = { word, status: 'skip', note: 'Already exists' }
        } else {
          entry = { word, status: 'error', note: err.response?.data?.detail || 'Request failed' }
        }
      }

      setLog((prev) => [...prev, entry])
      setProgress({ done: i + 1, total: words.length })
    }

    setPhase('done')
    onSaved?.()
  }

  const handleCancel = () => { abortRef.current = true }

  // ── Counts for summary ───────────────────────────────────────────────────────
  const counts = log.reduce(
    (acc, e) => { acc[e.status]++; return acc },
    { ok: 0, skip: 0, error: 0 }
  )

  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-dark-600 border border-dark-400 rounded-2xl w-full max-w-lg shadow-2xl animate-slide-up flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-dark-400 flex-shrink-0">
          <h2 className="text-lg font-semibold text-slate-100">Import Words from File</h2>
          <button
            onClick={onClose}
            disabled={phase === 'running'}
            className="text-slate-500 hover:text-slate-200 transition-colors disabled:opacity-30"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto flex-1">

          {/* ── Setup phase ── */}
          {phase === 'setup' && (
            <>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">
                  Base Group Name <span className="text-red-400">*</span>
                </label>
                <input
                  className="input"
                  list="import-groups-list"
                  placeholder='e.g. "Test" → will create Test 1, Test 2…'
                  value={groupBase}
                  onChange={(e) => setGroupBase(e.target.value)}
                  autoFocus
                />
                <datalist id="import-groups-list">
                  {/* strip trailing numbers so user picks the base name */}
                  {[...new Set(allGroups.map((g) => g.replace(/\s+\d+$/, '').trim()))].map((g) => (
                    <option key={g} value={g} />
                  ))}
                </datalist>
                <p className="text-xs text-slate-600 mt-1">
                  Every 40 words will go into a new sub-group: "{groupBase || 'Name'} 1", "{groupBase || 'Name'} 2"…
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Text File</label>
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="w-full border-2 border-dashed border-dark-400 hover:border-primary/50 rounded-xl py-8 flex flex-col items-center gap-2 text-slate-500 hover:text-slate-300 transition-colors"
                >
                  <Upload size={24} />
                  <span className="text-sm">{fileName || 'Click to choose a .txt file'}</span>
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".txt,text/plain"
                  className="hidden"
                  onChange={handleFile}
                />
              </div>

              {words.length > 0 && (
                <div className="flex items-center gap-2 text-sm text-slate-400 bg-dark-500/50 rounded-lg px-3 py-2">
                  <FileText size={15} className="text-primary-light flex-shrink-0" />
                  <span><span className="text-slate-200 font-medium">{words.length}</span> unique words found</span>
                  <span className="text-slate-600 ml-auto">
                    → {Math.ceil(words.length / CHUNK)} group{Math.ceil(words.length / CHUNK) !== 1 ? 's' : ''}
                  </span>
                </div>
              )}
            </>
          )}

          {/* ── Running / Done phase ── */}
          {(phase === 'running' || phase === 'done') && (
            <>
              {/* Progress bar */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs text-slate-400">
                  <span>{phase === 'running' ? 'Importing…' : 'Done'}</span>
                  <span>{progress.done} / {progress.total}</span>
                </div>
                <div className="h-2 bg-dark-400 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full transition-all duration-300"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>

              {/* Summary chips */}
              {phase === 'done' && (
                <div className="flex gap-3 text-sm">
                  <span className="flex items-center gap-1.5 text-emerald-400">
                    <CheckCircle size={14} /> {counts.ok} added
                  </span>
                  <span className="flex items-center gap-1.5 text-amber-400">
                    <AlertTriangle size={14} /> {counts.skip} skipped
                  </span>
                  <span className="flex items-center gap-1.5 text-red-400">
                    <XCircle size={14} /> {counts.error} failed
                  </span>
                </div>
              )}

              {/* Scrollable log */}
              <div className="border border-dark-400 rounded-xl overflow-hidden">
                <div className="max-h-56 overflow-y-auto">
                  {log.map((e, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-3 px-3 py-1.5 border-b border-dark-400/40 last:border-0 text-sm"
                    >
                      {e.status === 'ok'    && <CheckCircle  size={13} className="text-emerald-400 flex-shrink-0" />}
                      {e.status === 'skip'  && <AlertTriangle size={13} className="text-amber-400  flex-shrink-0" />}
                      {e.status === 'error' && <XCircle      size={13} className="text-red-400    flex-shrink-0" />}
                      <span className="text-slate-300 flex-1">{e.word}</span>
                      <span className="text-slate-600 text-xs">{e.note}</span>
                    </div>
                  ))}
                  {phase === 'running' && (
                    <div className="flex items-center gap-2 px-3 py-2 text-slate-500 text-sm">
                      <Loader2 size={13} className="animate-spin" />
                      Looking up next word…
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="p-5 border-t border-dark-400 flex gap-3 flex-shrink-0">
          {phase === 'setup' && (
            <>
              <button type="button" onClick={onClose} className="btn-ghost flex-1">Cancel</button>
              <button
                className="btn-primary flex-1 flex items-center justify-center gap-2"
                onClick={handleImport}
                disabled={!words.length || !groupBase.trim()}
              >
                <Upload size={15} /> Import {words.length ? `${words.length} Words` : ''}
              </button>
            </>
          )}
          {phase === 'running' && (
            <button className="btn-ghost flex-1" onClick={handleCancel}>
              Stop
            </button>
          )}
          {phase === 'done' && (
            <button className="btn-primary flex-1" onClick={onClose}>
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
