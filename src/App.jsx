import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './contexts/AuthContext'
import Login from './pages/Login'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Paddocks from './pages/Paddocks'
import PaddockDetail from './pages/PaddockDetail'
import Mobs from './pages/Mobs'
import MobDetail from './pages/MobDetail'
import MobHistory from './pages/MobHistory'
import RecordMovement from './pages/RecordMovement'
import SplitMob from './pages/SplitMob'
import MergeMob from './pages/MergeMob'

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()

  if (loading) {
    return <div className="loading">Loading...</div>
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  return children
}

function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="paddocks" element={<Paddocks />} />
        <Route path="paddocks/:paddockName" element={<PaddockDetail />} />
        <Route path="mobs" element={<Mobs />} />
        <Route path="mobs/:mobName" element={<MobDetail />} />
        <Route path="mobs/:mobName/move" element={<RecordMovement />} />
        <Route path="mobs/:mobName/split" element={<SplitMob />} />
        <Route path="mobs/:mobName/merge" element={<MergeMob />} />
        <Route path="mobs/:mobName/history" element={<MobHistory />} />
      </Route>
    </Routes>
  )
}

export default App
