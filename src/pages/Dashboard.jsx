import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useProperty } from '../contexts/PropertyContext'
import GenerateReport from '../components/GenerateReport'

function Dashboard() {
  const { propertyId } = useProperty()
  const [mobs, setMobs] = useState([])
  const [paddockCount, setPaddockCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [executingMob, setExecutingMob] = useState(null) // mob name being executed
  const [executeDate, setExecuteDate] = useState(new Date().toISOString().split('T')[0])
  const [executing, setExecuting] = useState(false)

  useEffect(() => {
    if (!propertyId) return
    fetchDashboard()
  }, [propertyId])

  const fetchDashboard = async () => {
    setLoading(true)
    setError('')

    // Fetch mobs with composition
    const { data: mobsData, error: mobsErr } = await supabase
      .from('mobs')
      .select('*, mob_composition(*)')
      .eq('property_id', propertyId)
      .order('name')
    if (mobsErr) {
      console.error('Mobs query failed:', mobsErr.message)
      setError('Failed to load mobs: ' + mobsErr.message)
    }

    // Fetch active movements (actual_move_in_date IS NOT NULL, actual_move_out_date IS NULL)
    const { data: activeMovements, error: movErr } = await supabase
      .from('movements')
      .select('*')
      .not('actual_move_in_date', 'is', null)
      .is('actual_move_out_date', null)
    if (movErr) {
      console.error('Active movements query failed:', movErr.message)
      setError('Failed to load active movements: ' + movErr.message)
    }

    // Fetch planned movements (actual_move_in_date IS NULL)
    const { data: plannedMovements, error: planErr } = await supabase
      .from('movements')
      .select('*')
      .is('actual_move_in_date', null)
    if (planErr) {
      console.error('Planned movements query failed:', planErr.message)
      setError('Failed to load planned movements: ' + planErr.message)
    }

    // Fetch paddock count
    const { count, error: padErr } = await supabase
      .from('paddocks')
      .select('*', { count: 'exact', head: true })
      .eq('property_id', propertyId)
    if (padErr) {
      console.error('Paddocks query failed:', padErr.message)
      setError('Failed to load paddocks: ' + padErr.message)
    }

    setPaddockCount(count || 0)

    // Fetch alive animals grouped by mob for accurate counts
    const mobNames = (mobsData || []).map((m) => m.name)
    const { data: animalsData } = mobNames.length > 0
      ? await supabase
          .from('animals')
          .select('mob_name, cattle_type')
          .in('mob_name', mobNames)
          .eq('status', 'alive')
      : { data: [] }

    // Build per-mob animal counts
    const animalsByMob = {}
    ;(animalsData || []).forEach((a) => {
      if (!animalsByMob[a.mob_name]) animalsByMob[a.mob_name] = {}
      animalsByMob[a.mob_name][a.cattle_type] = (animalsByMob[a.mob_name][a.cattle_type] || 0) + 1
    })

    const activeMap = {}
    if (activeMovements) {
      activeMovements.forEach((m) => { activeMap[m.mob_name] = m })
    }

    const plannedMap = {}
    if (plannedMovements) {
      plannedMovements.forEach((m) => { plannedMap[m.mob_name] = m })
    }

    // Fetch requirements for both active and planned movements (active while movement is open)
    const reqMap = {}
    const allOpenKeys = [
      ...(activeMovements || []).map((m) => m.record_key),
      ...(plannedMovements || []).map((m) => m.record_key),
    ].filter(Boolean)
    if (allOpenKeys.length > 0) {
      const { data: reqData } = await supabase
        .from('movement_requirements')
        .select('*, requirement_types(name)')
        .in('movement_record_key', allOpenKeys)
      if (reqData) {
        reqData.forEach((r) => {
          if (!reqMap[r.movement_record_key]) reqMap[r.movement_record_key] = []
          reqMap[r.movement_record_key].push(r)
        })
      }
    }

    const enriched = (mobsData || []).map((mob) => {
      const mobAnimals = animalsByMob[mob.name]
      const hasAnimals = mobAnimals && Object.keys(mobAnimals).length > 0
      const headCount = hasAnimals
        ? Object.values(mobAnimals).reduce((sum, c) => sum + c, 0)
        : (mob.mob_composition || []).reduce((sum, c) => sum + c.count, 0)
      const derivedComposition = hasAnimals
        ? Object.entries(mobAnimals).map(([cattle_type, count]) => ({ cattle_type, count }))
        : (mob.mob_composition || [])
      const activeMove = activeMap[mob.name]
      const plannedMove = plannedMap[mob.name]
      const daysUntilMove = plannedMove?.planned_move_in_date
        ? Math.max(0, Math.ceil((new Date(plannedMove.planned_move_in_date + 'T00:00').getTime() - Date.now()) / 86400000))
        : null
      return {
        ...mob,
        headCount,
        derivedComposition,
        currentPaddock: activeMove?.paddock_name || null,
        daysUntilMove,
        nextPaddock: plannedMove?.paddock_name || null,
        nextMoveDate: plannedMove?.planned_move_in_date || null,
        hasPlannedMove: !!plannedMove,
        activeRequirements: reqMap[activeMove?.record_key] || reqMap[plannedMove?.record_key] || [],
      }
    })

    setMobs(enriched)
    setLoading(false)
  }

  const handleExecuteMove = async () => {
    if (!executingMob) return
    setExecuting(true)
    setError('')
    const { error: rpcErr } = await supabase.rpc('execute_movement', {
      p_mob_name: executingMob,
      p_move_date: executeDate,
    })
    if (rpcErr) {
      setError(rpcErr.message)
      setExecuting(false)
      return
    }
    setExecuting(false)
    setExecutingMob(null)
    fetchDashboard()
  }

  const totalHead = mobs.reduce((s, m) => s + m.headCount, 0)
  const paddocksInUse = new Set(mobs.filter((m) => m.currentPaddock).map((m) => m.currentPaddock)).size

  const totalsByType = {}
  mobs.forEach((mob) => {
    (mob.derivedComposition || []).forEach((c) => {
      totalsByType[c.cattle_type] = (totalsByType[c.cattle_type] || 0) + c.count
    })
  })
  const totalBreakdown = Object.entries(totalsByType)
    .filter(([, count]) => count > 0)
    .map(([type, count]) => `${count} ${type}${count !== 1 ? 's' : ''}`)
    .join(', ')

  if (loading) {
    return <div className="loading">Loading dashboard...</div>
  }

  return (
    <div className="dashboard-page">
      <h2>Dashboard</h2>

      {error && <div className="error-message">{error}</div>}

      {/* Summary bar */}
      <div className="summary-bar">
        <div className="summary-item">
          <span className="summary-value">{totalHead}</span>
          <span className="summary-label">Total head</span>
          {totalBreakdown && <span className="summary-breakdown">{totalBreakdown}</span>}
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
                <div style={{ textAlign: 'right' }}>
                  <span className="head-badge">{mob.headCount} hd</span>
                  {mob.derivedComposition && mob.derivedComposition.length > 0 && (
                    <div className="head-comp-line">
                      {mob.derivedComposition
                        .filter((c) => c.count > 0)
                        .map((c) => `${c.count} ${c.count !== 1 && c.cattle_type === 'calf' ? 'calves' : c.count !== 1 ? c.cattle_type + 's' : c.cattle_type}`)
                        .join(', ')}
                    </div>
                  )}
                </div>
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

                {mob.daysUntilMove !== null && (
                  <div className="dashboard-stat">
                    <span className="detail-label">Days until move</span>
                    <span className="detail-value">{mob.daysUntilMove === 0 ? 'Today' : mob.daysUntilMove}</span>
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

                <div className="dashboard-stat">
                  <span className="detail-label">Active requirements</span>
                  {mob.activeRequirements.length === 0 ? (
                    <span className="detail-value muted">None active</span>
                  ) : (
                    <div className="comp-summary">
                      {mob.activeRequirements.map((r) => (
                        <span key={r.id} className="comp-tag">
                          {r.requirement_types?.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="dashboard-card-footer">
                {mob.hasPlannedMove && executingMob !== mob.name && (
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => {
                      setExecuteDate(new Date().toISOString().split('T')[0])
                      setExecutingMob(mob.name)
                    }}
                  >
                    Execute Move
                  </button>
                )}
                {executingMob === mob.name && (
                  <div style={{ width: '100%', marginTop: '0.5rem' }}>
                    <div className="form-group" style={{ marginBottom: '0.5rem' }}>
                      <label style={{ fontSize: '0.85rem', marginBottom: '0.25rem' }}>Move Date</label>
                      <input
                        type="date"
                        value={executeDate}
                        onChange={(e) => setExecuteDate(e.target.value)}
                        style={{ width: '100%' }}
                        required
                      />
                      <p className="muted" style={{ fontSize: '0.75rem', marginTop: '0.25rem' }}>
                        Today for current moves, or past date for retrospective
                      </p>
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => setExecutingMob(null)}
                        disabled={executing}
                        style={{ flex: 1 }}
                      >
                        Cancel
                      </button>
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={handleExecuteMove}
                        disabled={executing}
                        style={{ flex: 1 }}
                      >
                        {executing ? 'Executing...' : 'Confirm'}
                      </button>
                    </div>
                  </div>
                )}
                {executingMob !== mob.name && (
                  <Link
                    to={`/mobs/${encodeURIComponent(mob.name)}/move`}
                    className="btn btn-secondary btn-sm"
                  >
                    {mob.hasPlannedMove ? 'Edit Plan' : 'Plan Move'}
                  </Link>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <GenerateReport propertyId={propertyId} />
    </div>
  )
}

export default Dashboard
