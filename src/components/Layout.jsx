import { Outlet, Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

function Layout() {
  const { user, signOut } = useAuth()

  const handleSignOut = async () => {
    await signOut()
  }

  return (
    <div className="app-layout">
      <header className="header">
        <div className="header-content">
          <h1 className="logo"><Link to="/">Graze</Link></h1>
          <nav className="nav">
            <Link to="/">Dashboard</Link>
            <Link to="/mobs">Mobs</Link>
            <Link to="/paddocks">Paddocks</Link>
          </nav>
          <div className="user-info">
            <span>{user?.email}</span>
            <button onClick={handleSignOut} className="btn btn-secondary">
              Logout
            </button>
          </div>
        </div>
      </header>
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  )
}

export default Layout
