import { useState, useEffect, useRef } from 'react'
import { X, Loader2, Plus, CheckCircle } from 'lucide-react'
import { lookupWord, createWord } from '../api/client'

const DEFAULT_GROUP = 'New Words'

export default function QuickAddModal({ books, onClose, onSaved }) {
  const [engWord, setEngWord] = useState('')
  const [groupName, setGroupName] = useState('')
  const [state, setState] = useState('idle') // idle | loading | error
  const [error, setError] = useState('')
  const [lastSaved, setLastSaved] = useState('')
  const inputRef = useRef(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  const allGroups = books.flatMap((b) => b.groups.map((g) => g.group_name))

  const handleAdd = async (e) => {
    e.preventDefault()
    const word = engWord.trim()
    if (!word) return

    setState('loading')
    setError('')
    setLastSaved('')

    try {
      const res = await lookupWord(word)
      const { hebWord, examples } = res.data

      if (!hebWord) {
        setState('error')
        setError(`No Hebrew translation found for "${word}".`)
        return
      }

      await createWord({
        engWord: word,
        hebWord,
        examples: examples || '',
        difficulty: 'NEW_WORD',
        group_name: groupName.trim() || DEFAULT_GROUP,
        image_url: '',
      })

      setLastSaved(word)
      setEngWord('')
      setState('idle')
      onSaved?.()
      inputRef.current?.focus()
    } catch (err) {
      setState('error')
      setError(err.response?.data?.detail || 'Could not reach the translation service.')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-dark-600 border border-dark-400 rounded-2xl w-full max-w-md shadow-2xl animate-slide-up">

        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-dark-400">
          <h2 className="text-lg font-semibold text-slate-100">Quick Add Word</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-200 transition-colors">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleAdd} className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">English Word</label>
            <input
              ref={inputRef}
              className="input"
              placeholder="e.g. remorse"
              value={engWord}
              onChange={(e) => { setEngWord(e.target.value); setState('idle'); setError('') }}
              disabled={state === 'loading'}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">
              Group <span className="text-slate-600">(default: New Words)</span>
            </label>
            <input
              className="input"
              list="qa-groups-list"
              placeholder="New Words"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              disabled={state === 'loading'}
            />
            <datalist id="qa-groups-list">
              {allGroups.map((g) => <option key={g} value={g} />)}
            </datalist>
          </div>

          {/* Status messages */}
          {state === 'loading' && (
            <div className="flex items-center gap-2 text-slate-400 text-sm">
              <Loader2 size={15} className="animate-spin" />
              Looking up translation and saving…
            </div>
          )}
          {state === 'error' && (
            <p className="text-red-400 text-sm">{error}</p>
          )}
          {lastSaved && state === 'idle' && (
            <div className="flex items-center gap-2 text-emerald-400 text-sm">
              <CheckCircle size={15} />
              <span><span className="font-medium">"{lastSaved}"</span> added successfully.</span>
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="btn-ghost flex-1">
              Close
            </button>
            <button
              type="submit"
              className="btn-primary flex-1 flex items-center justify-center gap-2"
              disabled={!engWord.trim() || state === 'loading'}
            >
              {state === 'loading'
                ? <><Loader2 size={15} className="animate-spin" /> Adding…</>
                : <><Plus size={15} /> Add Word</>
              }
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
