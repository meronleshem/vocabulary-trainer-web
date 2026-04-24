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
import Statistics from './pages/Statistics'
import Roadmap from './pages/Roadmap'
import MissionQuiz from './pages/MissionQuiz'

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/roadmap" element={<Roadmap />} />
        <Route path="/mission/:missionId" element={<MissionQuiz />} />
        <Route path="/browse" element={<Browse />} />
        <Route path="/study" element={<Study />} />
        <Route path="/quiz" element={<Quiz />} />
        <Route path="/fill-quiz" element={<FillQuiz />} />
        <Route path="/books" element={<Books />} />
        <Route path="/study-session" element={<StudySession />} />
        <Route path="/progress" element={<Progress />} />
        <Route path="/srs" element={<SRSReview />} />
        <Route path="/statistics" element={<Statistics />} />
      </Routes>
    </Layout>
  )
}
