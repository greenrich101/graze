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

function ServiceUnavailable() {
  return (
    <div className="service-unavailable">
      <h2>Service Unavailable</h2>
      <p>Unable to connect to the server. This may be due to maintenance or a network issue.</p>
      <button className="btn btn-primary" onClick={() => window.location.reload()}>
        Retry
      </button>
    </div>
  )
}

function ProtectedRoute({ children }) {
  const { user, loading, connectionError } = useAuth()

  if (loading) {
    return <div className="loading">Loading...</div>
  }

  if (connectionError) {
    return <ServiceUnavailable />
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
