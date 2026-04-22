import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Browse from './pages/Browse'
import Study from './pages/Study'
import Quiz from './pages/Quiz'
import FillQuiz from './pages/FillQuiz'
import Books from './pages/Books'
import StudySession from './pages/StudySession'
import Progress from './pages/Progress'
import SRSReview from './pages/SRSReview'

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/browse" element={<Browse />} />
        <Route path="/study" element={<Study />} />
        <Route path="/quiz" element={<Quiz />} />
        <Route path="/fill-quiz" element={<FillQuiz />} />
        <Route path="/books" element={<Books />} />
        <Route path="/study-session" element={<StudySession />} />
        <Route path="/progress" element={<Progress />} />
        <Route path="/srs" element={<SRSReview />} />
      </Routes>
    </Layout>
  )
}
