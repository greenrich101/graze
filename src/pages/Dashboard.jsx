import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useProperty } from '../contexts/PropertyContext'

function Dashboard() {
  const { propertyId } = useProperty()
  const [mobs, setMobs] = useState([])
  const [paddockCount, setPaddockCount] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!propertyId) return
    fetchDashboard()
  }, [propertyId])

  const fetchDashboard = async () => {
    setLoading(true)

    // Fetch mobs with composition
    const { data: mobsData, error: mobsErr } = await supabase
      .from('mobs')
      .select('*, mob_composition(*)')
      .eq('property_id', propertyId)
      .order('name')
    if (mobsErr) console.error('Mobs query failed:', mobsErr.message)

    // Fetch all open movements
    const { data: openMovements, error: movErr } = await supabase
      .from('movements')
      .select('*')
      .is('actual_move_out_date', null)
    if (movErr) console.error('Movements query failed:', movErr.message)

    // Fetch paddock count
    const { count, error: padErr } = await supabase
      .from('paddocks')
      .select('*', { count: 'exact', head: true })
      .eq('property_id', propertyId)
    if (padErr) console.error('Paddocks query failed:', padErr.message)

    setPaddockCount(count || 0)

    const movementMap = {}
    if (openMovements) {
      openMovements.forEach((m) => { movementMap[m.mob_name] = m })
    }

    const enriched = (mobsData || []).map((mob) => {
      const headCount = (mob.mob_composition || []).reduce((sum, c) => sum + c.count, 0)
      const openMove = movementMap[mob.name]
      const daysGrazing = openMove
        ? Math.floor((Date.now() - new Date(openMove.actual_move_in_date).getTime()) / 86400000)
        : null
      return {
        ...mob,
        headCount,
        currentPaddock: openMove?.paddock_name || null,
        daysGrazing,
        nextPaddock: mob.next_paddock_name || null,
        nextMoveDate: mob.next_move_date || null,
      }
    })

    setMobs(enriched)
    setLoading(false)
  }

  const totalHead = mobs.reduce((s, m) => s + m.headCount, 0)
  const paddocksInUse = new Set(mobs.filter((m) => m.currentPaddock).map((m) => m.currentPaddock)).size

  if (loading) {
    return <div className="loading">Loading dashboard...</div>
  }

  return (
    <div className="dashboard-page">
      <h2>Dashboard</h2>

      {/* Summary bar */}
      <div className="summary-bar">
        <div className="summary-item">
          <span className="summary-value">{totalHead}</span>
          <span className="summary-label">Total head</span>
        </div>
        <div className="summary-item">
          <span className="summary-value">{mobs.length}</span>
          <span className="summary-label">Mobs</span>
        </div>
        <div className="summary-item">
          <span className="summary-value">{paddocksInUse} / {paddockCount}</span>
          <span className="summary-label">Paddocks in use</span>
        </div>
      </div>

      {/* Mob cards */}
      {mobs.length === 0 ? (
        <p className="empty-state">No mobs yet. <Link to="/mobs">Add your first mob</Link>.</p>
      ) : (
        <div className="dashboard-grid">
          {mobs.map((mob) => (
            <div key={mob.name} className="dashboard-card">
              <div className="dashboard-card-header">
                <h3>
                  <Link to={`/mobs/${encodeURIComponent(mob.name)}`}>{mob.name}</Link>
                </h3>
                <span className="head-badge">{mob.headCount} hd</span>
              </div>

              <div className="dashboard-card-body">
                <div className="dashboard-stat">
                  <span className="detail-label">Current paddock</span>
                  <span className="detail-value">
                    {mob.currentPaddock ? (
                      <Link to={`/paddocks/${encodeURIComponent(mob.currentPaddock)}`}>
                        {mob.currentPaddock}
                      </Link>
                    ) : 'Not placed'}
                  </span>
                </div>

                {mob.daysGrazing !== null && (
                  <div className="dashboard-stat">
                    <span className="detail-label">Days grazing</span>
                    <span className="detail-value">{mob.daysGrazing}</span>
                  </div>
                )}

                <div className="dashboard-stat">
                  <span className="detail-label">Next paddock</span>
                  <span className="detail-value">
                    {mob.nextPaddock ? (
                      <Link to={`/paddocks/${encodeURIComponent(mob.nextPaddock)}`}>
                        {mob.nextPaddock}
                      </Link>
                    ) : '—'}
                  </span>
                </div>

                <div className="dashboard-stat">
                  <span className="detail-label">Next move date</span>
                  <span className="detail-value">
                    {mob.nextMoveDate
                      ? new Date(mob.nextMoveDate + 'T00:00').toLocaleDateString()
                      : '—'}
                  </span>
                </div>
              </div>

              <div className="dashboard-card-footer">
                <Link
                  to={`/mobs/${encodeURIComponent(mob.name)}/move`}
                  className="btn btn-primary btn-sm"
                >
                  Record Move
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default Dashboard
