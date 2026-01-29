import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useProperty } from '../contexts/PropertyContext'
import MovementList from '../components/MovementList'

const CATTLE_TYPES = ['cow', 'calf', 'bull', 'steer', 'heifer', 'weaner', 'other']

function MobDetail() {
  const { mobName } = useParams()
  const decodedName = decodeURIComponent(mobName)
  const { propertyId } = useProperty()
  const [mob, setMob] = useState(null)
  const [composition, setComposition] = useState([])
  const [openMovement, setOpenMovement] = useState(null)
  const [plannedMovement, setPlannedMovement] = useState(null)
  const [activeRequirements, setActiveRequirements] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [recentMovements, setRecentMovements] = useState([])
  const [editingComp, setEditingComp] = useState(false)
  const [compDraft, setCompDraft] = useState({})
  const [executing, setExecuting] = useState(false)
  const [cancelling, setCancelling] = useState(false)

  useEffect(() => {
    fetchMob()
  }, [decodedName, propertyId])

  const fetchMob = async () => {
    if (!propertyId) return
    setLoading(true)

    const { data: mobData, error: mobErr } = await supabase
      .from('mobs')
      .select('*')
      .eq('name', decodedName)
      .eq('property_id', propertyId)
      .single()

    if (mobErr) {
      setError('Mob not found.')
      setLoading(false)
      return
    }

    setMob(mobData)

    // Fetch composition
    const { data: compData } = await supabase
      .from('mob_composition')
      .select('*')
      .eq('mob_name', decodedName)

    setComposition(compData || [])

    // Build draft from existing composition
    const draft = {}
    CATTLE_TYPES.forEach((t) => { draft[t] = 0 })
    ;(compData || []).forEach((c) => { draft[c.cattle_type] = c.count })
    setCompDraft(draft)

    // Fetch active movement (actual_move_in_date IS NOT NULL, actual_move_out_date IS NULL)
    const { data: activeData } = await supabase
      .from('movements')
      .select('*')
      .eq('mob_name', decodedName)
      .not('actual_move_in_date', 'is', null)
      .is('actual_move_out_date', null)
      .single()

    setOpenMovement(activeData || null)

    // Fetch planned movement (actual_move_in_date IS NULL)
    const { data: plannedData } = await supabase
      .from('movements')
      .select('*')
      .eq('mob_name', decodedName)
      .is('actual_move_in_date', null)
      .single()

    setPlannedMovement(plannedData || null)

    // Fetch active requirements if there's an open movement
    if (activeData) {
      const { data: reqData } = await supabase
        .from('movement_requirements')
        .select('*, requirement_types(name)')
        .eq('movement_record_key', activeData.record_key)

      setActiveRequirements(reqData || [])
    } else {
      setActiveRequirements([])
    }

    // Fetch recent movements (last 5)
    const { data: recentData } = await supabase
      .from('movements')
      .select('*, movement_requirements(*, requirement_types(name))')
      .eq('mob_name', decodedName)
      .order('created_at', { ascending: false })
      .limit(5)

    setRecentMovements(recentData || [])

    setLoading(false)
  }

  const headCount = composition.reduce((sum, c) => sum + c.count, 0)
  const daysGrazing = openMovement
    ? Math.floor((Date.now() - new Date(openMovement.actual_move_in_date).getTime()) / 86400000)
    : null

  const handleSaveComposition = async () => {
    setError('')
    await supabase.from('mob_composition').delete().eq('mob_name', decodedName)

    const rows = Object.entries(compDraft)
      .filter(([, count]) => count > 0)
      .map(([cattle_type, count]) => ({ mob_name: decodedName, cattle_type, count }))

    if (rows.length > 0) {
      const { error: insertErr } = await supabase.from('mob_composition').insert(rows)
      if (insertErr) {
        setError(insertErr.message)
        return
      }
    }

    setEditingComp(false)
    fetchMob()
  }

  const handleExecuteMove = async () => {
    setExecuting(true)
    setError('')
    const { error: rpcErr } = await supabase.rpc('execute_movement', {
      p_mob_name: decodedName,
    })
    if (rpcErr) {
      setError(rpcErr.message)
      setExecuting(false)
      return
    }
    setExecuting(false)
    fetchMob()
  }

  const handleDeleteMovement = async (recordKey) => {
    if (!confirm('Are you sure you want to delete this movement?')) return
    setError('')
    const { error: delErr } = await supabase
      .from('movements')
      .delete()
      .eq('record_key', recordKey)
    if (delErr) {
      setError(delErr.message)
      return
    }
    fetchMob()
  }

  const handleUpdateNotes = async (recordKey, notes) => {
    setError('')
    const { error: updErr } = await supabase
      .from('movements')
      .update({ notes: notes || null })
      .eq('record_key', recordKey)
    if (updErr) {
      setError(updErr.message)
      return
    }
    fetchMob()
  }

  const handleCancelPlan = async () => {
    setCancelling(true)
    setError('')
    const { error: delErr } = await supabase
      .from('movements')
      .delete()
      .eq('record_key', plannedMovement.record_key)
    if (delErr) {
      setError(delErr.message)
      setCancelling(false)
      return
    }
    setCancelling(false)
    fetchMob()
  }

  if (loading) {
    return <div className="loading">Loading mob...</div>
  }

  if (!mob) {
    return <div className="error-message">{error || 'Mob not found.'}</div>
  }

  return (
    <div className="mob-detail-page">
      <div className="page-header">
        <h2>{mob.name}</h2>
        <div className="page-header-actions">
          <Link to={`/mobs/${encodeURIComponent(mob.name)}/move`} className="btn btn-primary">
            {plannedMovement ? 'Edit Plan' : 'Plan Move'}
          </Link>
          <Link to={`/mobs/${encodeURIComponent(mob.name)}/split`} className="btn btn-secondary">
            Split
          </Link>
          <Link to={`/mobs/${encodeURIComponent(mob.name)}/merge`} className="btn btn-secondary">
            Merge
          </Link>
          <Link to={`/mobs/${encodeURIComponent(mob.name)}/history`} className="btn btn-secondary">
            History
          </Link>
        </div>
      </div>

      {error && <div className="error-message">{error}</div>}

      {mob.description && <p className="mob-description">{mob.description}</p>}

      {/* Status summary */}
      <div className="detail-card">
        <h3>Status</h3>
        <div className="detail-grid">
          <div className="detail-item">
            <span className="detail-label">Head count</span>
            <span className="detail-value">{headCount}</span>
          </div>
          <div className="detail-item">
            <span className="detail-label">Current paddock</span>
            <span className="detail-value">
              {openMovement ? (
                <Link to={`/paddocks/${encodeURIComponent(openMovement.paddock_name)}`}>
                  {openMovement.paddock_name}
                </Link>
              ) : '—'}
            </span>
          </div>
          <div className="detail-item">
            <span className="detail-label">Days grazing</span>
            <span className="detail-value">{daysGrazing !== null ? daysGrazing : '—'}</span>
          </div>
          {openMovement?.planned_move_out_date && (
            <div className="detail-item">
              <span className="detail-label">Planned move-out</span>
              <span className="detail-value">{openMovement.planned_move_out_date}</span>
            </div>
          )}
        </div>
      </div>

      {/* Planned move */}
      {plannedMovement && (
        <div className="detail-card">
          <h3>Planned Move</h3>
          <div className="detail-grid">
            <div className="detail-item">
              <span className="detail-label">Next paddock</span>
              <span className="detail-value">
                <Link to={`/paddocks/${encodeURIComponent(plannedMovement.paddock_name)}`}>
                  {plannedMovement.paddock_name}
                </Link>
              </span>
            </div>
            <div className="detail-item">
              <span className="detail-label">Planned date</span>
              <span className="detail-value">
                {plannedMovement.planned_move_in_date
                  ? new Date(plannedMovement.planned_move_in_date + 'T00:00').toLocaleDateString()
                  : '—'}
              </span>
            </div>
            {plannedMovement.notes && (
              <div className="detail-item">
                <span className="detail-label">Notes</span>
                <span className="detail-value">{plannedMovement.notes}</span>
              </div>
            )}
          </div>
          <div className="form-actions" style={{ marginTop: '0.75rem' }}>
            <button
              className="btn btn-primary"
              onClick={handleExecuteMove}
              disabled={executing}
            >
              {executing ? 'Executing...' : 'Execute Move'}
            </button>
            <button
              className="btn btn-secondary"
              onClick={handleCancelPlan}
              disabled={cancelling}
            >
              {cancelling ? 'Cancelling...' : 'Cancel Plan'}
            </button>
          </div>
        </div>
      )}

      {/* Active requirements */}
      <div className="detail-card">
        <h3>Active Requirements</h3>
        {activeRequirements.length === 0 ? (
          <p className="muted">None active</p>
        ) : (
          <ul className="requirements-list">
            {activeRequirements.map((r) => (
              <li key={r.id}>
                {r.requirement_types?.name}
                {r.notes && <span className="req-notes"> — {r.notes}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Composition */}
      <div className="detail-card">
        <div className="detail-card-header">
          <h3>Composition</h3>
          {!editingComp && (
            <button className="btn btn-secondary" onClick={() => setEditingComp(true)}>
              Edit
            </button>
          )}
        </div>
        {editingComp ? (
          <div>
            {CATTLE_TYPES.map((type) => (
              <div key={type} className="comp-row">
                <label>{type}</label>
                <input
                  type="number"
                  min="0"
                  value={compDraft[type] || 0}
                  onChange={(e) => setCompDraft({ ...compDraft, [type]: parseInt(e.target.value) || 0 })}
                />
              </div>
            ))}
            <div className="form-actions">
              <button className="btn btn-secondary" onClick={() => setEditingComp(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSaveComposition}>Save</button>
            </div>
          </div>
        ) : (
          <div>
            {composition.length === 0 ? (
              <p className="muted">No composition set</p>
            ) : (
              <div className="comp-summary">
                {composition.map((c) => (
                  <span key={c.cattle_type} className="comp-tag">
                    {c.count} {c.cattle_type}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Move Log */}
      <div className="detail-card">
        <div className="detail-card-header">
          <h3>Move Log</h3>
          <Link to={`/mobs/${encodeURIComponent(mob.name)}/history`} className="btn btn-secondary btn-sm">
            View all
          </Link>
        </div>
        <MovementList
          movements={recentMovements}
          onDelete={handleDeleteMovement}
          onUpdateNotes={handleUpdateNotes}
        />
      </div>
    </div>
  )
}

export default MobDetail
