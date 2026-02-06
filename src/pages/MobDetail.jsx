import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useProperty } from '../contexts/PropertyContext'
import MovementList from '../components/MovementList'
import AnimalList from '../components/AnimalList'
import AddAnimalForm from '../components/AddAnimalForm'
import AnimalCSVImport from '../components/AnimalCSVImport'
import HealthEventList from '../components/HealthEventList'

const CATTLE_TYPES = ['cow', 'calf', 'bull', 'steer', 'heifer', 'weaner', 'other']

function MobDetail() {
  const { mobName } = useParams()
  const decodedName = decodeURIComponent(mobName)
  const { propertyId, role } = useProperty()
  const isHand = role === 'hand'
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
  const [showExecuteForm, setShowExecuteForm] = useState(false)
  const [executeDate, setExecuteDate] = useState(new Date().toISOString().split('T')[0])
  const [animals, setAnimals] = useState([])
  const [showAddAnimal, setShowAddAnimal] = useState(false)
  const [addMode, setAddMode] = useState('form') // 'form' or 'csv'
  const [healthEvents, setHealthEvents] = useState([])
  const [loadingHealth, setLoadingHealth] = useState(true)

  useEffect(() => {
    fetchMob()
    fetchHealthEvents()
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

    // Fetch requirements from planned movement only (requirements are prep tasks before a move)
    if (plannedData) {
      const { data: reqData } = await supabase
        .from('movement_requirements')
        .select('*, requirement_types(name)')
        .eq('movement_record_key', plannedData.record_key)

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

    // Fetch animals (individual tracking)
    const { data: animalsData } = await supabase
      .from('animals')
      .select('*')
      .eq('mob_name', decodedName)
      .eq('status', 'alive')
      .order('nlis_tag', { ascending: true, nullsFirst: false })

    setAnimals(animalsData || [])

    setLoading(false)
  }

  const fetchHealthEvents = async () => {
    setLoadingHealth(true)
    const { data, error } = await supabase.rpc('get_mob_health_history', {
      p_mob_name: decodedName,
      p_limit: 20,
    })

    if (error) {
      console.error('Error fetching health events:', error)
    } else {
      setHealthEvents(data || [])
    }
    setLoadingHealth(false)
  }

  // Calculate head count from animals table (new system) or fallback to composition (legacy)
  const headCount = animals.length > 0 ? animals.length : composition.reduce((sum, c) => sum + c.count, 0)
  const daysUntilMove = plannedMovement?.planned_move_in_date
    ? Math.max(0, Math.ceil((new Date(plannedMovement.planned_move_in_date + 'T00:00').getTime() - Date.now()) / 86400000))
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
      p_move_date: executeDate,
    })
    if (rpcErr) {
      setError(rpcErr.message)
      setExecuting(false)
      return
    }
    setExecuting(false)
    setShowExecuteForm(false)
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
          {!isHand && (
            <Link to={`/mobs/${encodeURIComponent(mob.name)}/split`} className="btn btn-secondary">
              Split
            </Link>
          )}
          {!isHand && (
            <Link to={`/mobs/${encodeURIComponent(mob.name)}/merge`} className="btn btn-secondary">
              Merge
            </Link>
          )}
          <Link to={`/mobs/${encodeURIComponent(mob.name)}/history`} className="btn btn-secondary">
            History
          </Link>
        </div>
      </div>

      {error && <div className="error-message">{error}</div>}

      {mob.description && <p className="mob-description">{mob.description}</p>}

      {/* Status summary with composition */}
      <div className="detail-card">
        <div className="detail-card-header">
          <h3>Status</h3>
          {!editingComp && !isHand && (
            <button className="btn btn-secondary btn-sm" onClick={() => setEditingComp(true)}>
              Edit Composition
            </button>
          )}
        </div>
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
            <span className="detail-label">Days until move</span>
            <span className="detail-value">{daysUntilMove !== null ? (daysUntilMove === 0 ? 'Today' : daysUntilMove) : '—'}</span>
          </div>
          {openMovement?.planned_move_out_date && (
            <div className="detail-item">
              <span className="detail-label">Planned move-out</span>
              <span className="detail-value">{openMovement.planned_move_out_date}</span>
            </div>
          )}
          <div className="detail-item">
            <span className="detail-label">Composition</span>
            {composition.length === 0 ? (
              <span className="detail-value muted">No composition set</span>
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
        </div>
        {editingComp && (
          <div style={{ marginTop: '0.75rem' }}>
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
        )}
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
          {!showExecuteForm ? (
            <div className="form-actions" style={{ marginTop: '0.75rem' }}>
              <button
                className="btn btn-primary"
                onClick={() => {
                  setExecuteDate(new Date().toISOString().split('T')[0])
                  setShowExecuteForm(true)
                }}
              >
                Execute Move
              </button>
              <button
                className="btn btn-secondary"
                onClick={handleCancelPlan}
                disabled={cancelling}
              >
                {cancelling ? 'Cancelling...' : 'Cancel Plan'}
              </button>
            </div>
          ) : (
            <div style={{ marginTop: '0.75rem' }}>
              <div className="form-group">
                <label>Move Date</label>
                <input
                  type="date"
                  value={executeDate}
                  onChange={(e) => setExecuteDate(e.target.value)}
                  required
                />
                <p className="muted" style={{ fontSize: '0.85rem', marginTop: '0.25rem' }}>
                  Use today for current moves, or select a past date for retrospective moves
                </p>
              </div>
              <div className="form-actions">
                <button
                  className="btn btn-secondary"
                  onClick={() => setShowExecuteForm(false)}
                  disabled={executing}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-primary"
                  onClick={handleExecuteMove}
                  disabled={executing}
                >
                  {executing ? 'Executing...' : 'Confirm Execute'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

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
          onDelete={isHand ? null : handleDeleteMovement}
          onUpdateNotes={isHand ? null : handleUpdateNotes}
        />
      </div>

      {/* Individual Animals */}
      <div className="detail-card">
        <div className="detail-card-header">
          <h3>Individual Animals</h3>
          {!isHand && (
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setShowAddAnimal(!showAddAnimal)}
            >
              {showAddAnimal ? 'Cancel' : 'Update Data'}
            </button>
          )}
        </div>
        {showAddAnimal && (
          <div>
            <div className="radio-group" style={{ marginBottom: '1rem' }}>
              <label>
                <input
                  type="radio"
                  value="form"
                  checked={addMode === 'form'}
                  onChange={(e) => setAddMode(e.target.value)}
                />
                Manual Entry
              </label>
              <label>
                <input
                  type="radio"
                  value="csv"
                  checked={addMode === 'csv'}
                  onChange={(e) => setAddMode(e.target.value)}
                />
                CSV Import
              </label>
            </div>
            {addMode === 'form' ? (
              <AddAnimalForm
                mobName={decodedName}
                onSuccess={() => {
                  setShowAddAnimal(false)
                  fetchMob()
                }}
              />
            ) : (
              <AnimalCSVImport
                mobName={decodedName}
                onSuccess={() => {
                  setShowAddAnimal(false)
                  fetchMob()
                }}
              />
            )}
          </div>
        )}
        {animals.length === 0 ? (
          <p className="muted">No animals added yet. Use "Add Animals" to get started.</p>
        ) : (
          <AnimalList animals={animals} onRefresh={fetchMob} isHand={isHand} />
        )}
      </div>

      {/* Health Log */}
      <div className="detail-card">
        <h3>Health Log</h3>
        {loadingHealth ? (
          <p className="muted">Loading health events...</p>
        ) : (
          <HealthEventList
            events={healthEvents}
            onUpdate={fetchHealthEvents}
            readOnly={isHand}
          />
        )}
      </div>
    </div>
  )
}

export default MobDetail
