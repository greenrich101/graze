import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useProperty } from '../contexts/PropertyContext'

function RecordMovement() {
  const { mobName } = useParams()
  const decodedName = decodeURIComponent(mobName)
  const navigate = useNavigate()
  const { propertyId } = useProperty()

  const [paddocks, setPaddocks] = useState([])
  const [toPaddock, setToPaddock] = useState('')
  const [moveDate, setMoveDate] = useState(new Date().toISOString().split('T')[0])
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [currentPaddock, setCurrentPaddock] = useState(null)
  const [occupiedPaddocks, setOccupiedPaddocks] = useState(new Set())
  const [existingPlan, setExistingPlan] = useState(null)

  // Requirements state
  const [requirementTypes, setRequirementTypes] = useState([])
  const [selectedReqs, setSelectedReqs] = useState({}) // { requirement_type_id: { checked, notes } }

  // Health logging state
  const [healthTreatments, setHealthTreatments] = useState({}) // { treatment_type: { checked, notes } }
  const [healthCattleType, setHealthCattleType] = useState('')
  const [composition, setComposition] = useState([])

  useEffect(() => {
    if (!propertyId) return

    supabase
      .from('paddocks')
      .select('name')
      .eq('property_id', propertyId)
      .order('name')
      .then(({ data }) => setPaddocks(data || []))

    // Fetch active movements only (actual_move_in_date IS NOT NULL) — planned moves don't block
    supabase
      .from('movements')
      .select('paddock_name, mob_name, actual_move_in_date')
      .is('actual_move_out_date', null)
      .not('actual_move_in_date', 'is', null)
      .then(({ data }) => {
        const ownPaddock = data?.find((m) => m.mob_name === decodedName)?.paddock_name
        if (ownPaddock) setCurrentPaddock(ownPaddock)
        const occupied = new Set(
          (data || [])
            .filter((m) => m.mob_name !== decodedName)
            .map((m) => m.paddock_name)
        )
        setOccupiedPaddocks(occupied)
      })

    // Fetch existing planned movement to pre-fill form
    supabase
      .from('movements')
      .select('*, movement_requirements(*, requirement_types(name))')
      .eq('mob_name', decodedName)
      .is('actual_move_in_date', null)
      .single()
      .then(({ data }) => {
        if (data) {
          setExistingPlan(data)
          setToPaddock(data.paddock_name)
          setMoveDate(data.planned_move_in_date || new Date().toISOString().split('T')[0])
          setNotes(data.notes || '')
          // Pre-fill requirements
          const reqs = {}
          ;(data.movement_requirements || []).forEach((r) => {
            reqs[r.requirement_type_id] = { checked: true, notes: r.notes || '' }
          })
          setSelectedReqs(reqs)
        }
      })

    supabase
      .from('requirement_types')
      .select('*')
      .order('name')
      .then(({ data }) => setRequirementTypes(data || []))

    // Fetch mob composition for health logging
    supabase
      .rpc('get_mob_composition', { p_mob_name: decodedName })
      .then(({ data }) => setComposition(data || []))
  }, [propertyId, decodedName])

  // When destination paddock changes (and no existing plan pre-filling), load default requirements
  useEffect(() => {
    if (!toPaddock || existingPlan) return

    supabase
      .from('paddock_requirements')
      .select('requirement_type_id, notes')
      .eq('paddock_name', toPaddock)
      .then(({ data }) => {
        const defaults = {}
        ;(data || []).forEach((r) => {
          defaults[r.requirement_type_id] = { checked: true, notes: r.notes || '' }
        })
        setSelectedReqs(defaults)
      })
  }, [toPaddock])

  const toggleReq = (typeId) => {
    setSelectedReqs((prev) => {
      const existing = prev[typeId]
      if (existing?.checked) {
        const next = { ...prev }
        delete next[typeId]
        return next
      }
      return { ...prev, [typeId]: { checked: true, notes: '' } }
    })
  }

  const updateReqNotes = (typeId, notes) => {
    setSelectedReqs((prev) => ({
      ...prev,
      [typeId]: { ...prev[typeId], notes },
    }))
  }

  const toggleHealthTreatment = (treatment) => {
    setHealthTreatments((prev) => ({
      ...prev,
      [treatment]: {
        checked: !prev[treatment]?.checked,
        notes: prev[treatment]?.notes || '',
      },
    }))
  }

  const updateHealthTreatmentNotes = (treatment, notes) => {
    setHealthTreatments((prev) => ({
      ...prev,
      [treatment]: { ...prev[treatment], notes },
    }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!toPaddock) {
      setError('Select a destination paddock.')
      return
    }
    setLoading(true)
    setError('')

    const reqRows = Object.entries(selectedReqs)
      .filter(([, v]) => v.checked)
      .map(([typeId, v]) => ({
        requirement_type_id: typeId,
        notes: v.notes || null,
      }))

    const { data: rpcData, error: rpcErr } = await supabase.rpc('plan_movement', {
      p_mob_name: decodedName,
      p_to_paddock: toPaddock,
      p_planned_move_date: moveDate,
      p_notes: notes || null,
      p_requirements: reqRows,
    })

    if (rpcErr) {
      setError(rpcErr.message)
      setLoading(false)
      return
    }

    if (rpcData === null || rpcData === undefined) {
      setError('Movement was not saved. The plan_movement function may not exist — check that the SQL migration has been applied.')
      setLoading(false)
      return
    }

    // Log health treatments if any selected
    const selectedTreatments = Object.keys(healthTreatments).filter(
      (t) => healthTreatments[t].checked
    )

    for (const treatment of selectedTreatments) {
      const { notes } = healthTreatments[treatment]

      const { error: healthErr } = await supabase.rpc('log_health_treatment', {
        p_mob_name: decodedName,
        p_treatment_type: treatment,
        p_cattle_type: healthCattleType || null,
        p_treatment_date: moveDate,
        p_movement_id: rpcData,
        p_notes: notes || null,
      })

      if (healthErr) {
        console.error('Health treatment logging error:', healthErr)
        setError(`Failed to log ${treatment} treatment: ${healthErr.message}`)
        setLoading(false)
        return
      }
    }

    navigate(`/mobs/${encodeURIComponent(decodedName)}`)
  }

  const isEditing = !!existingPlan

  return (
    <div className="movement-page">
      <h2>{isEditing ? 'Edit Plan' : 'Plan Move'} — {decodedName}</h2>
      {currentPaddock && (
        <p className="current-paddock-info">Currently in <strong>{currentPaddock}</strong></p>
      )}

      {error && <div className="error-message">{error}</div>}

      <form className="movement-form" onSubmit={handleSubmit}>
        <div className="form-group">
          <label>Destination Paddock</label>
          <select value={toPaddock} onChange={(e) => setToPaddock(e.target.value)} required>
            <option value="">— Select paddock —</option>
            {paddocks.map((p) => {
              const occupied = occupiedPaddocks.has(p.name)
              return (
                <option key={p.name} value={p.name} disabled={occupied}>
                  {p.name}{occupied ? ' (occupied)' : ''}
                </option>
              )
            })}
          </select>
        </div>

        <div className="form-group">
          <label>Planned Move Date</label>
          <input type="date" value={moveDate} onChange={(e) => setMoveDate(e.target.value)} required />
        </div>

        <div className="form-group">
          <label>Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows="3"
            placeholder="Optional notes about this move"
          />
        </div>

        {toPaddock && (
          <div className="requirements-selector">
            <label>Paddock Requirements</label>
            {requirementTypes.length === 0 ? (
              <p className="muted">No requirement types configured</p>
            ) : (
              requirementTypes.map((type) => {
                const sel = selectedReqs[type.id]
                return (
                  <div key={type.id} className="req-check-row">
                    <label className="req-check-label">
                      <input
                        type="checkbox"
                        checked={!!sel?.checked}
                        onChange={() => toggleReq(type.id)}
                      />
                      {type.name}
                    </label>
                    {sel?.checked && (
                      <input
                        type="text"
                        className="req-notes-input"
                        placeholder="Notes (optional)"
                        value={sel.notes}
                        onChange={(e) => updateReqNotes(type.id, e.target.value)}
                      />
                    )}
                  </div>
                )
              })
            )}
          </div>
        )}

        {toPaddock && (
          <div className="form-group" style={{ marginTop: '1.5rem' }}>
            <label style={{ fontSize: '1rem', marginBottom: '0.75rem', display: 'block' }}>
              Health Logging (optional)
            </label>
            <div className="muted" style={{ marginBottom: '0.75rem', fontSize: '0.875rem' }}>
              Record treatments applied during this move. Treatments are logged per animal.
            </div>

            <div className="requirements-selector">
              {['5-in-1', 'B12', 'Fly', 'Lice', 'Worm', 'Anti-venom', 'Penicillin', 'Foot', 'Eye'].map((treatment) => {
                const checked = healthTreatments[treatment]?.checked || false
                return (
                  <div key={treatment} className="req-check-row">
                    <label className="req-check-label">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleHealthTreatment(treatment)}
                      />
                      {treatment}
                    </label>
                    {checked && (
                      <input
                        type="text"
                        className="req-notes-input"
                        placeholder="Notes (optional)"
                        value={healthTreatments[treatment]?.notes || ''}
                        onChange={(e) => updateHealthTreatmentNotes(treatment, e.target.value)}
                      />
                    )}
                  </div>
                )
              })}
            </div>

            {Object.values(healthTreatments).some(t => t.checked) && composition.length > 0 && (
              <div style={{ marginTop: '0.75rem' }}>
                <label style={{ fontSize: '0.875rem', display: 'block', marginBottom: '0.25rem' }}>
                  Apply to:
                </label>
                <select
                  value={healthCattleType}
                  onChange={(e) => setHealthCattleType(e.target.value)}
                  style={{ width: '200px' }}
                >
                  <option value="">All animals in mob</option>
                  {composition.map((c) => (
                    <option key={c.cattle_type} value={c.cattle_type}>
                      Only {c.cattle_type}s ({c.count} head)
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        )}

        <div className="form-actions">
          <button type="button" className="btn btn-secondary" onClick={() => navigate(-1)}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Saving...' : isEditing ? 'Update Plan' : 'Plan Move'}
          </button>
        </div>
      </form>
    </div>
  )
}

export default RecordMovement
