import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useProperty } from '../contexts/PropertyContext'
import MovementList from '../components/MovementList'

const CONDITION_OPTIONS = ['Poor', 'Fair', 'Good', 'Excellent']

function PaddockDetail() {
  const { paddockName } = useParams()
  const decodedName = decodeURIComponent(paddockName)
  const { propertyId } = useProperty()
  const [paddock, setPaddock] = useState(null)
  const [movements, setMovements] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Pasture log state
  const [pastureLogs, setPastureLogs] = useState([])
  const [logDate, setLogDate] = useState(new Date().toISOString().split('T')[0])
  const [logCondition, setLogCondition] = useState('Good')
  const [logNotes, setLogNotes] = useState('')
  const [logSaving, setLogSaving] = useState(false)

  useEffect(() => {
    if (!propertyId) return
    fetchData()
  }, [decodedName, propertyId])

  const fetchData = async () => {
    setLoading(true)

    const { data: paddockData, error: paddockErr } = await supabase
      .from('paddocks')
      .select('*')
      .eq('name', decodedName)
      .eq('property_id', propertyId)
      .single()

    if (paddockErr) {
      setError('Paddock not found.')
      setLoading(false)
      return
    }

    setPaddock(paddockData)

    const { data: moveData } = await supabase
      .from('movements')
      .select('*, movement_requirements(*, requirement_types(name))')
      .eq('paddock_name', decodedName)
      .order('actual_move_in_date', { ascending: false })

    setMovements(moveData || [])

    const { data: logData } = await supabase
      .from('pasture_logs')
      .select('*')
      .eq('paddock_name', decodedName)
      .eq('property_id', propertyId)
      .order('log_date', { ascending: false })

    setPastureLogs(logData || [])
    setLoading(false)
  }

  const [logError, setLogError] = useState('')

  const addPastureLog = async (e) => {
    e.preventDefault()
    setLogSaving(true)
    setLogError('')

    const { data, error: insertErr } = await supabase
      .from('pasture_logs')
      .insert({
        property_id: propertyId,
        paddock_name: decodedName,
        log_date: logDate,
        condition: logCondition,
        notes: logNotes || null,
      })
      .select()
      .single()

    if (insertErr) {
      setLogError(insertErr.message)
    } else if (data) {
      setPastureLogs((prev) => [data, ...prev].sort((a, b) => b.log_date.localeCompare(a.log_date)))
      setLogNotes('')
      setLogDate(new Date().toISOString().split('T')[0])
      setLogCondition('Good')
    }
    setLogSaving(false)
  }

  const deletePastureLog = async (id) => {
    const { error: delErr } = await supabase
      .from('pasture_logs')
      .delete()
      .eq('id', id)

    if (!delErr) {
      setPastureLogs((prev) => prev.filter((l) => l.id !== id))
    }
  }

  if (loading) {
    return <div className="loading">Loading paddock...</div>
  }

  if (!paddock) {
    return <div className="error-message">{error || 'Paddock not found.'}</div>
  }

  // Current occupant (open movement)
  const currentMove = movements.find((m) => !m.actual_move_out_date)

  return (
    <div className="paddock-detail-page">
      <div className="page-header">
        <h2>{paddock.name}</h2>
      </div>

      <div className="detail-card">
        <h3>Info</h3>
        <div className="detail-grid">
          <div className="detail-item">
            <span className="detail-label">Size</span>
            <span className="detail-value">{paddock.area_acres} acres</span>
          </div>
          <div className="detail-item">
            <span className="detail-label">Current mob</span>
            <span className="detail-value">
              {currentMove ? (
                <Link to={`/mobs/${encodeURIComponent(currentMove.mob_name)}`}>
                  {currentMove.mob_name}
                </Link>
              ) : 'Empty'}
            </span>
          </div>
          {currentMove && (
            <div className="detail-item">
              <span className="detail-label">Since</span>
              <span className="detail-value">{currentMove.actual_move_in_date}</span>
            </div>
          )}
        </div>
      </div>

      <div className="detail-card">
        <h3>Movement History</h3>
        <MovementList movements={movements} showMob />
      </div>

      <div className="detail-card">
        <h3>Pasture Log</h3>
        <form className="pasture-log-form" onSubmit={addPastureLog}>
          <input
            type="date"
            value={logDate}
            onChange={(e) => setLogDate(e.target.value)}
            required
          />
          <select
            value={logCondition}
            onChange={(e) => setLogCondition(e.target.value)}
          >
            {CONDITION_OPTIONS.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <input
            type="text"
            placeholder="Notes (optional)"
            value={logNotes}
            onChange={(e) => setLogNotes(e.target.value)}
          />
          <button type="submit" className="btn btn-primary btn-sm" disabled={logSaving}>
            Log Entry
          </button>
        </form>
        {logError && <p className="error-message" style={{ marginTop: '0.5rem' }}>{logError}</p>}

        {pastureLogs.length === 0 ? (
          <p className="muted" style={{ marginTop: '0.75rem' }}>No entries yet.</p>
        ) : (
          <table className="pasture-log-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Condition</th>
                <th>Notes</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pastureLogs.map((log) => (
                <tr key={log.id}>
                  <td>{log.log_date}</td>
                  <td>
                    <span className={`badge badge-condition-${log.condition.toLowerCase()}`}>
                      {log.condition}
                    </span>
                  </td>
                  <td>{log.notes || '—'}</td>
                  <td>
                    <button
                      className="btn btn-danger btn-sm"
                      onClick={() => deletePastureLog(log.id)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

export default PaddockDetail
