import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
})

// ── Words ────────────────────────────────────────────────────────────────────
export const getWords = (params) => api.get('/words', { params })
export const getWord = (id) => api.get(`/words/${id}`)
export const createWord = (data) => api.post('/words', data)
export const updateWord = (id, data) => api.put(`/words/${id}`, data)
export const deleteWord = (id) => api.delete(`/words/${id}`)
export const patchDifficulty = (id, difficulty) =>
  api.patch(`/words/${id}/difficulty`, { difficulty })

export const lookupWord = (q) => api.get('/words/lookup', { params: { q } })

// ── Study & Quiz ─────────────────────────────────────────────────────────────
export const getStudyWords = (params) => api.get('/words/study', { params })
export const getQuiz = (params) => api.get('/words/quiz', { params })

// ── Meta ─────────────────────────────────────────────────────────────────────
export const getStats = () => api.get('/stats')
export const getGroups = () => api.get('/groups')
export const getBooks = () => api.get('/books')

export default api
