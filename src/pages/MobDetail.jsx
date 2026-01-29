import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useProperty } from '../contexts/PropertyContext'

const CATTLE_TYPES = ['cow', 'calf', 'bull', 'steer', 'heifer', 'weaner', 'other']

function MobDetail() {
  const { mobName } = useParams()
  const decodedName = decodeURIComponent(mobName)
  const { propertyId } = useProperty()
  const [mob, setMob] = useState(null)
  const [composition, setComposition] = useState([])
  const [openMovement, setOpenMovement] = useState(null)
  const [activeRequirements, setActiveRequirements] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editingComp, setEditingComp] = useState(false)
  const [compDraft, setCompDraft] = useState({})

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

    // Fetch open movement
    const { data: moveData } = await supabase
      .from('movements')
      .select('*')
      .eq('mob_name', decodedName)
      .is('actual_move_out_date', null)
      .single()

    setOpenMovement(moveData || null)

    // Fetch active requirements if there's an open movement
    if (moveData) {
      const { data: reqData } = await supabase
        .from('movement_requirements')
        .select('*, requirement_types(name)')
        .eq('movement_record_key', moveData.record_key)

      setActiveRequirements(reqData || [])
    } else {
      setActiveRequirements([])
    }

    setLoading(false)
  }

  const headCount = composition.reduce((sum, c) => sum + c.count, 0)
  const daysGrazing = openMovement
    ? Math.floor((Date.now() - new Date(openMovement.actual_move_in_date).getTime()) / 86400000)
    : null

  const handleSaveComposition = async () => {
    setError('')
    // Delete existing, then insert non-zero entries
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
            Record Move
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
    </div>
  )
}

export default MobDetail
