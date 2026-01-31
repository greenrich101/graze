import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useProperty } from '../contexts/PropertyContext'

const CATTLE_TYPES = ['cow', 'calf', 'bull', 'steer', 'heifer', 'weaner', 'other']

function SplitMob() {
  const { mobName } = useParams()
  const decodedName = decodeURIComponent(mobName)
  const navigate = useNavigate()
  const { propertyId } = useProperty()

  const [composition, setComposition] = useState([])
  const [mobs, setMobs] = useState([])
  const [targetMob, setTargetMob] = useState('')
  const [newMobName, setNewMobName] = useState('')
  const [splitCounts, setSplitCounts] = useState({})
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [createNew, setCreateNew] = useState(false)

  useEffect(() => {
    if (!propertyId) return

    supabase
      .from('mob_composition')
      .select('*')
      .eq('mob_name', decodedName)
      .then(({ data }) => {
        setComposition(data || [])
        const draft = {}
        ;(data || []).forEach((c) => { draft[c.cattle_type] = 0 })
        setSplitCounts(draft)
      })

    supabase
      .from('mobs')
      .select('name')
      .eq('property_id', propertyId)
      .neq('name', decodedName)
      .order('name')
      .then(({ data }) => setMobs(data || []))
  }, [propertyId, decodedName])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    const totalSplit = Object.values(splitCounts).reduce((s, v) => s + v, 0)
    if (totalSplit === 0) {
      setError('Select at least one head to split off.')
      return
    }

    // Validate counts don't exceed source
    for (const c of composition) {
      if ((splitCounts[c.cattle_type] || 0) > c.count) {
        setError(`Cannot split more ${c.cattle_type} than available (${c.count}).`)
        return
      }
    }

    let targetName = targetMob
    if (createNew) {
      if (!newMobName.trim()) {
        setError('Enter a name for the new mob.')
        return
      }
      targetName = newMobName.trim()
    }
    if (!targetName) {
      setError('Select or create a target mob.')
      return
    }

    setLoading(true)

    // If creating a new mob, insert it first
    if (createNew) {
      const { error: createErr } = await supabase
        .from('mobs')
        .insert([{ name: targetName, property_id: propertyId }])

      if (createErr) {
        setError(createErr.message)
        setLoading(false)
        return
      }
    }

    // Update source mob composition (subtract split counts)
    for (const c of composition) {
      const splitAmt = splitCounts[c.cattle_type] || 0
      if (splitAmt > 0) {
        const newCount = c.count - splitAmt
        if (newCount > 0) {
          await supabase
            .from('mob_composition')
            .update({ count: newCount })
            .eq('mob_name', decodedName)
            .eq('cattle_type', c.cattle_type)
        } else {
          await supabase
            .from('mob_composition')
            .delete()
            .eq('mob_name', decodedName)
            .eq('cattle_type', c.cattle_type)
        }
      }
    }

    // Add to target mob composition (upsert)
    for (const [type, count] of Object.entries(splitCounts)) {
      if (count > 0) {
        const { data: existing } = await supabase
          .from('mob_composition')
          .select('count')
          .eq('mob_name', targetName)
          .eq('cattle_type', type)
          .single()

        if (existing) {
          await supabase
            .from('mob_composition')
            .update({ count: existing.count + count })
            .eq('mob_name', targetName)
            .eq('cattle_type', type)
        } else {
          await supabase
            .from('mob_composition')
            .insert([{ mob_name: targetName, cattle_type: type, count }])
        }
      }
    }

    // Record split movement on source mob
    const sourceMove = await supabase
      .from('movements')
      .select('paddock_name')
      .eq('mob_name', decodedName)
      .is('actual_move_out_date', null)
      .single()

    const paddock = sourceMove.data?.paddock_name
    if (paddock) {
      // Insert a closed movement note for the split (don't disrupt open movements)
      // We just log it as a note on the source mob's movement
    }

    navigate(`/mobs/${encodeURIComponent(decodedName)}`)
  }

  return (
    <div className="movement-page">
      <h2>Split — {decodedName}</h2>
      <p>Draft head from <strong>{decodedName}</strong> into another mob.</p>

      {error && <div className="error-message">{error}</div>}

      <form className="movement-form" onSubmit={handleSubmit}>
        <div className="detail-card">
          <h3>Head to split off</h3>
          {composition.length === 0 ? (
            <p className="muted">No composition set on this mob.</p>
          ) : (
            composition.map((c) => (
              <div key={c.cattle_type} className="comp-row">
                <label>{c.cattle_type} (available: {c.count})</label>
                <input
                  type="number"
                  min="0"
                  max={c.count}
                  value={splitCounts[c.cattle_type] || 0}
                  onChange={(e) => setSplitCounts({ ...splitCounts, [c.cattle_type]: parseInt(e.target.value) || 0 })}
                />
              </div>
            ))
          )}
        </div>

        <div className="detail-card">
          <h3>Target mob</h3>
          <div className="form-group">
            <label>
              <input
                type="radio"
                checked={!createNew}
                onChange={() => setCreateNew(false)}
              /> Existing mob
            </label>
            {!createNew && (
              <select value={targetMob} onChange={(e) => setTargetMob(e.target.value)} style={{ marginTop: '0.5rem' }}>
                <option value="">— Select —</option>
                {mobs.map((m) => (
                  <option key={m.name} value={m.name}>{m.name}</option>
                ))}
              </select>
            )}
          </div>
          <div className="form-group">
            <label>
              <input
                type="radio"
                checked={createNew}
                onChange={() => setCreateNew(true)}
              /> Create new mob
            </label>
            {createNew && (
              <input
                type="text"
                value={newMobName}
                onChange={(e) => setNewMobName(e.target.value)}
                placeholder="New mob name"
                style={{ marginTop: '0.5rem' }}
              />
            )}
          </div>
        </div>

        <div className="form-group">
          <label>Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows="2"
            placeholder="Optional"
          />
        </div>

        <div className="form-actions">
          <button type="button" className="btn btn-secondary" onClick={() => navigate(-1)}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={loading || composition.length === 0}>
            {loading ? 'Splitting...' : 'Split'}
          </button>
        </div>
      </form>
    </div>
  )
}

export default SplitMob
