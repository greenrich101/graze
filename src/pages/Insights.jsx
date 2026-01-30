import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useProperty } from '../contexts/PropertyContext'

const TIME_PERIODS = [
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
  { label: '6 months', days: 183 },
  { label: '1 year', days: 365 },
  { label: 'All time', days: null },
]

function Insights() {
  const { propertyId } = useProperty()
  const [movements, setMovements] = useState([])
  const [paddocks, setPaddocks] = useState([])
  const [mobs, setMobs] = useState([])
  const [loading, setLoading] = useState(true)
  const [periodDays, setPeriodDays] = useState(365)
  const [filterPaddock, setFilterPaddock] = useState('')
  const [filterMob, setFilterMob] = useState('')

  useEffect(() => {
    if (!propertyId) return
    fetchData()
  }, [propertyId])

  const fetchData = async () => {
    setLoading(true)

    const [movRes, padRes, mobRes] = await Promise.all([
      supabase
        .from('movements')
        .select('*')
        .not('actual_move_in_date', 'is', null)
        .order('actual_move_in_date', { ascending: false }),
      supabase
        .from('paddocks')
        .select('name')
        .eq('property_id', propertyId)
        .order('name'),
      supabase
        .from('mobs')
        .select('name')
        .eq('property_id', propertyId)
        .order('name'),
    ])

    setMovements(movRes.data || [])
    setPaddocks(padRes.data || [])
    setMobs(mobRes.data || [])
    setLoading(false)
  }

  const today = new Date()
  const todayStr = today.toISOString().slice(0, 10)

  const rangeStart = useMemo(() => {
    if (!periodDays) return null
    const d = new Date(today)
    d.setDate(d.getDate() - periodDays)
    return d.toISOString().slice(0, 10)
  }, [periodDays, todayStr])

  const filteredMovements = useMemo(() => {
    return movements.filter((m) => {
      if (filterPaddock && m.paddock_name !== filterPaddock) return false
      if (filterMob && m.mob_name !== filterMob) return false
      if (rangeStart) {
        const moveOut = m.actual_move_out_date || todayStr
        if (moveOut < rangeStart) return false
        const moveIn = m.actual_move_in_date
        if (moveIn > todayStr) return false
      }
      return true
    })
  }, [movements, filterPaddock, filterMob, rangeStart, todayStr])

  // 1. Paddock Grazing Days
  const grazingDays = useMemo(() => {
    const map = {}
    paddocks.forEach((p) => { map[p.name] = 0 })

    filteredMovements.forEach((m) => {
      let start = m.actual_move_in_date
      let end = m.actual_move_out_date || todayStr

      if (rangeStart && start < rangeStart) start = rangeStart
      if (end > todayStr) end = todayStr

      const days = Math.max(0, Math.ceil(
        (new Date(end + 'T00:00').getTime() - new Date(start + 'T00:00').getTime()) / 86400000
      ))
      map[m.paddock_name] = (map[m.paddock_name] || 0) + days
    })

    return Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .map(([name, days]) => ({ name, days }))
  }, [filteredMovements, paddocks, rangeStart, todayStr])

  // 2. Days Since Last Grazed
  const daysSinceGrazed = useMemo(() => {
    const lastOut = {}
    const currentlyGrazed = new Set()

    movements.forEach((m) => {
      if (filterPaddock && m.paddock_name !== filterPaddock) return
      if (filterMob && m.mob_name !== filterMob) return

      if (!m.actual_move_out_date) {
        currentlyGrazed.add(m.paddock_name)
      } else {
        if (!lastOut[m.paddock_name] || m.actual_move_out_date > lastOut[m.paddock_name]) {
          lastOut[m.paddock_name] = m.actual_move_out_date
        }
      }
    })

    return paddocks.map((p) => {
      if (currentlyGrazed.has(p.name)) {
        return { name: p.name, days: -1 }
      }
      if (lastOut[p.name]) {
        const days = Math.ceil(
          (today.getTime() - new Date(lastOut[p.name] + 'T00:00').getTime()) / 86400000
        )
        return { name: p.name, days }
      }
      return { name: p.name, days: null }
    }).sort((a, b) => {
      if (a.days === null) return 1
      if (b.days === null) return -1
      if (a.days === -1) return -1
      if (b.days === -1) return 1
      return b.days - a.days
    })
  }, [movements, paddocks, filterPaddock, filterMob, todayStr])

  // 3. Average Grazing Period by Mob
  const avgGrazingPeriod = useMemo(() => {
    const mobStays = {}

    filteredMovements.forEach((m) => {
      if (!m.actual_move_out_date) return
      const days = Math.max(1, Math.ceil(
        (new Date(m.actual_move_out_date + 'T00:00').getTime() -
         new Date(m.actual_move_in_date + 'T00:00').getTime()) / 86400000
      ))
      if (!mobStays[m.mob_name]) mobStays[m.mob_name] = []
      mobStays[m.mob_name].push(days)
    })

    return mobs
      .map((mob) => {
        const stays = mobStays[mob.name]
        if (!stays || stays.length === 0) return { name: mob.name, avg: null, count: 0 }
        const avg = stays.reduce((s, d) => s + d, 0) / stays.length
        return { name: mob.name, avg: Math.round(avg * 10) / 10, count: stays.length }
      })
      .sort((a, b) => {
        if (a.avg === null) return 1
        if (b.avg === null) return -1
        return b.avg - a.avg
      })
  }, [filteredMovements, mobs])

  // 4. Unused Paddocks (90+ days)
  const unusedPaddocks = useMemo(() => {
    return daysSinceGrazed.filter((p) => p.days === null || p.days >= 90)
  }, [daysSinceGrazed])

  // 5. Movement Count by Mob
  const movementCounts = useMemo(() => {
    const map = {}
    mobs.forEach((m) => { map[m.name] = 0 })

    filteredMovements.forEach((m) => {
      map[m.mob_name] = (map[m.mob_name] || 0) + 1
    })

    return Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }))
  }, [filteredMovements, mobs])

  if (loading) {
    return <div className="loading">Loading insights...</div>
  }

  return (
    <div className="insights-page">
      <h2>Insights</h2>

      <div className="insights-filters">
        <div className="filter-group">
          <label>Time period</label>
          <select
            value={periodDays ?? ''}
            onChange={(e) => setPeriodDays(e.target.value === '' ? null : Number(e.target.value))}
          >
            {TIME_PERIODS.map((p) => (
              <option key={p.label} value={p.days ?? ''}>{p.label}</option>
            ))}
          </select>
        </div>

        <div className="filter-group">
          <label>Paddock</label>
          <select value={filterPaddock} onChange={(e) => setFilterPaddock(e.target.value)}>
            <option value="">All paddocks</option>
            {paddocks.map((p) => (
              <option key={p.name} value={p.name}>{p.name}</option>
            ))}
          </select>
        </div>

        <div className="filter-group">
          <label>Mob</label>
          <select value={filterMob} onChange={(e) => setFilterMob(e.target.value)}>
            <option value="">All mobs</option>
            {mobs.map((m) => (
              <option key={m.name} value={m.name}>{m.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="insights-grid">
        {/* Paddock Grazing Days */}
        <div className="insight-card">
          <h3>Paddock Grazing Days</h3>
          <p className="insight-desc">Total days each paddock was grazed in the selected period</p>
          {grazingDays.length === 0 ? (
            <p className="muted">No paddocks found</p>
          ) : (
            <table className="insight-table">
              <thead>
                <tr><th>Paddock</th><th>Days</th></tr>
              </thead>
              <tbody>
                {grazingDays.map((row) => (
                  <tr key={row.name}>
                    <td>
                      <Link to={`/paddocks/${encodeURIComponent(row.name)}`}>{row.name}</Link>
                    </td>
                    <td>{row.days}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Days Since Last Grazed */}
        <div className="insight-card">
          <h3>Days Since Last Grazed</h3>
          <p className="insight-desc">How long since a mob left each paddock</p>
          {daysSinceGrazed.length === 0 ? (
            <p className="muted">No paddocks found</p>
          ) : (
            <table className="insight-table">
              <thead>
                <tr><th>Paddock</th><th>Days</th></tr>
              </thead>
              <tbody>
                {daysSinceGrazed.map((row) => (
                  <tr key={row.name} className={row.days !== null && row.days >= 90 ? 'insight-highlight' : ''}>
                    <td>
                      <Link to={`/paddocks/${encodeURIComponent(row.name)}`}>{row.name}</Link>
                    </td>
                    <td>
                      {row.days === -1 ? 'Currently grazed' : row.days === null ? 'Never grazed' : row.days}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Average Grazing Period by Mob */}
        <div className="insight-card">
          <h3>Average Grazing Period by Mob</h3>
          <p className="insight-desc">Mean days per stay for each mob (completed moves only)</p>
          {avgGrazingPeriod.length === 0 ? (
            <p className="muted">No mobs found</p>
          ) : (
            <table className="insight-table">
              <thead>
                <tr><th>Mob</th><th>Avg days</th><th>Stays</th></tr>
              </thead>
              <tbody>
                {avgGrazingPeriod.map((row) => (
                  <tr key={row.name}>
                    <td>
                      <Link to={`/mobs/${encodeURIComponent(row.name)}`}>{row.name}</Link>
                    </td>
                    <td>{row.avg !== null ? row.avg : '—'}</td>
                    <td>{row.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Unused Paddocks */}
        <div className="insight-card">
          <h3>Unused Paddocks</h3>
          <p className="insight-desc">Paddocks with no activity in 90+ days</p>
          {unusedPaddocks.length === 0 ? (
            <p className="muted">All paddocks used recently</p>
          ) : (
            <table className="insight-table">
              <thead>
                <tr><th>Paddock</th><th>Status</th></tr>
              </thead>
              <tbody>
                {unusedPaddocks.map((row) => (
                  <tr key={row.name} className="insight-highlight">
                    <td>
                      <Link to={`/paddocks/${encodeURIComponent(row.name)}`}>{row.name}</Link>
                    </td>
                    <td>{row.days === null ? 'Never grazed' : `${row.days} days idle`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Movement Count by Mob */}
        <div className="insight-card">
          <h3>Movement Count by Mob</h3>
          <p className="insight-desc">Number of moves per mob in the selected period</p>
          {movementCounts.length === 0 ? (
            <p className="muted">No mobs found</p>
          ) : (
            <table className="insight-table">
              <thead>
                <tr><th>Mob</th><th>Moves</th></tr>
              </thead>
              <tbody>
                {movementCounts.map((row) => (
                  <tr key={row.name}>
                    <td>
                      <Link to={`/mobs/${encodeURIComponent(row.name)}`}>{row.name}</Link>
                    </td>
                    <td>{row.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}

export default Insights
