import { useState, useEffect } from 'react'
import { X } from 'lucide-react'
import { createWord, updateWord } from '../api/client'

const DIFFICULTIES = ['NEW_WORD', 'EASY', 'MEDIUM', 'HARD']

const EMPTY = {
  engWord: '',
  hebWord: '',
  examples: '',
  difficulty: 'NEW_WORD',
  group_name: '',
}

export default function WordModal({ word, groups, onClose, onSaved }) {
  const isEdit = Boolean(word)
  const [form, setForm] = useState(EMPTY)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (word) {
      setForm({
        engWord: word.engWord || '',
        hebWord: word.hebWord || '',
        examples: word.examples || '',
        difficulty: word.difficulty || 'NEW_WORD',
        group_name: word.group_name || '',
      })
    } else {
      setForm(EMPTY)
    }
  }, [word])

  const set = (key, val) => setForm((f) => ({ ...f, [key]: val }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.engWord.trim() || !form.hebWord.trim()) {
      setError('English and Hebrew words are required.')
      return
    }
    setLoading(true)
    setError('')
    try {
      if (isEdit) {
        await updateWord(word.id, form)
      } else {
        await createWord(form)
      }
      onSaved()
    } catch (err) {
      setError(err.response?.data?.detail || 'An error occurred.')
    } finally {
      setLoading(false)
    }
  }

  const groupOptions = [...new Set((groups || []).map((g) => g.group_name).filter(Boolean))]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-dark-600 border border-dark-400 rounded-2xl w-full max-w-lg shadow-2xl animate-slide-up">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-dark-400">
          <h2 className="text-lg font-semibold text-slate-100">
            {isEdit ? 'Edit Word' : 'Add Word'}
          </h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-200 transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">
                English Word <span className="text-red-400">*</span>
              </label>
              <input
                className="input"
                value={form.engWord}
                onChange={(e) => set('engWord', e.target.value)}
                placeholder="e.g. remorse"
                autoFocus
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">
                Hebrew Translation <span className="text-red-400">*</span>
              </label>
              <input
                className="input heb"
                value={form.hebWord}
                onChange={(e) => set('hebWord', e.target.value)}
                placeholder="תרגום"
                dir="rtl"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Examples</label>
            <textarea
              className="input resize-none"
              rows={3}
              value={form.examples}
              onChange={(e) => set('examples', e.target.value)}
              placeholder="Usage examples (one per line)"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Difficulty</label>
              <select
                className="input"
                value={form.difficulty}
                onChange={(e) => set('difficulty', e.target.value)}
              >
                {DIFFICULTIES.map((d) => (
                  <option key={d} value={d}>
                    {d === 'NEW_WORD' ? 'New Word' : d.charAt(0) + d.slice(1).toLowerCase()}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Group</label>
              <input
                className="input"
                list="groups-list"
                value={form.group_name}
                onChange={(e) => set('group_name', e.target.value)}
                placeholder="Book / chapter"
              />
              <datalist id="groups-list">
                {groupOptions.map((g) => (
                  <option key={g} value={g} />
                ))}
              </datalist>
            </div>
          </div>

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="btn-ghost flex-1">
              Cancel
            </button>
            <button type="submit" disabled={loading} className="btn-primary flex-1">
              {loading ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Word'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
