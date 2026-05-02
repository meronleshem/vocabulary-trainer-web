import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
  paramsSerializer: { indexes: null },
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
export const getFillQuiz = (params) => api.get('/words/fill-quiz', { params })
export const getHardQuiz = (params) => api.get('/words/hard-quiz', { params })
export const checkHardAnswer = (word_id, user_answer, direction) =>
  api.post('/words/hard-quiz/check', { word_id, user_answer, direction })
export const getStudySession = (wordIds) => api.get('/study-session', { params: { word_ids: wordIds } })

// ── Word Frequency ────────────────────────────────────────────────────────────
export const getWordFrequency = (params) => api.get('/word-frequency', { params })

// ── Meta ─────────────────────────────────────────────────────────────────────
export const getStats = () => api.get('/stats')
export const getGroups = () => api.get('/groups')
export const getBooks = () => api.get('/books')
export const renameGroup = (oldName, newName) => api.put(`/groups/${encodeURIComponent(oldName)}`, { new_name: newName })

// ── Progress & Rewards ────────────────────────────────────────────────────────
export const getProgress = () => api.get('/progress')
export const recordAnswer = (word_id, correct) => api.post('/progress/record-answer', { word_id, correct })
export const recordSession = (session_type, word_ids = [], extras = {}) =>
  api.post('/progress/record-session', { session_type, word_ids, ...extras })
export const patchDailyGoal = (daily_goal) => api.patch('/progress/daily-goal', { daily_goal })
export const getDifficultyTracking = () => api.get('/progress/difficulty-tracking')
export const getWeakWords = () => api.get('/progress/weak-words')
export const getTrends = (period = 'weekly') => api.get('/progress/trends', { params: { period } })
export const getSessions = (limit) => api.get('/sessions', { params: limit ? { limit } : {} })

// ── Statistics ────────────────────────────────────────────────────────────────
export const getStatsFreqDifficulty      = () => api.get('/stats/freq-difficulty')
export const getStatsDifficultyTimeline  = () => api.get('/stats/difficulty-timeline')
export const getStatsPerformance    = () => api.get('/stats/performance')
export const getStatsVelocity    = () => api.get('/stats/velocity')
export const getStatsHabits      = () => api.get('/stats/habits')

// ── Roadmap ───────────────────────────────────────────────────────────────────
export const getRoadmapState        = ()            => api.get('/roadmap/state')
export const getCurrentMission      = ()            => api.get('/roadmap/current-mission')
export const getMissionQuiz         = (id, dir)     => api.get(`/roadmap/missions/${id}/quiz`, { params: { direction: dir } })
export const submitMissionAttempt   = (id, data)    => api.post(`/roadmap/missions/${id}/attempt`, data)
export const restartRoadmap         = ()            => api.post('/roadmap/restart')

export default api
