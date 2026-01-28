import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './contexts/AuthContext'
import Login from './pages/Login'
import Paddocks from './pages/Paddocks'
import Layout from './components/Layout'

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
        <Route index element={<Navigate to="/paddocks" replace />} />
        <Route path="paddocks" element={<Paddocks />} />
      </Route>
    </Routes>
  )
}

export default App
