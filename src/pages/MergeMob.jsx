import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useProperty } from '../contexts/PropertyContext'

function MergeMob() {
  const { mobName } = useParams()
  const decodedName = decodeURIComponent(mobName)
  const navigate = useNavigate()
  const { propertyId } = useProperty()

  const [mobs, setMobs] = useState([])
  const [sourceMob, setSourceMob] = useState('')
  const [sourceComp, setSourceComp] = useState([])
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!propertyId) return

    supabase
      .from('mobs')
      .select('name')
      .eq('property_id', propertyId)
      .neq('name', decodedName)
      .order('name')
      .then(({ data }) => setMobs(data || []))
  }, [propertyId, decodedName])

  useEffect(() => {
    if (!sourceMob) {
      setSourceComp([])
      return
    }
    supabase
      .from('mob_composition')
      .select('*')
      .eq('mob_name', sourceMob)
      .then(({ data }) => setSourceComp(data || []))
  }, [sourceMob])

  const sourceHeadCount = sourceComp.reduce((s, c) => s + c.count, 0)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    if (!sourceMob) {
      setError('Select a mob to merge in.')
      return
    }

    if (sourceHeadCount === 0) {
      setError('Source mob has no head to merge.')
      return
    }

    setLoading(true)

    // Transfer composition from source to target (this mob)
    for (const c of sourceComp) {
      const { data: existing } = await supabase
        .from('mob_composition')
        .select('count')
        .eq('mob_name', decodedName)
        .eq('cattle_type', c.cattle_type)
        .single()

      if (existing) {
        await supabase
          .from('mob_composition')
          .update({ count: existing.count + c.count })
          .eq('mob_name', decodedName)
          .eq('cattle_type', c.cattle_type)
      } else {
        await supabase
          .from('mob_composition')
          .insert([{ mob_name: decodedName, cattle_type: c.cattle_type, count: c.count }])
      }
    }

    // Clear source mob composition
    await supabase.from('mob_composition').delete().eq('mob_name', sourceMob)

    // Close source mob's open movement if any
    await supabase
      .from('movements')
      .update({ actual_move_out_date: new Date().toISOString().split('T')[0] })
      .eq('mob_name', sourceMob)
      .is('actual_move_out_date', null)

    navigate(`/mobs/${encodeURIComponent(decodedName)}`)
  }

  return (
    <div className="movement-page">
      <h2>Merge into {decodedName}</h2>
      <p>Combine all head from another mob into <strong>{decodedName}</strong>.</p>

      {error && <div className="error-message">{error}</div>}

      <form className="movement-form" onSubmit={handleSubmit}>
        <div className="form-group">
          <label>Source mob (will be emptied)</label>
          <select value={sourceMob} onChange={(e) => setSourceMob(e.target.value)} required>
            <option value="">— Select mob —</option>
            {mobs.map((m) => (
              <option key={m.name} value={m.name}>{m.name}</option>
            ))}
          </select>
        </div>

        {sourceMob && (
          <div className="detail-card">
            <h3>Source composition ({sourceHeadCount} head)</h3>
            {sourceComp.length === 0 ? (
              <p className="muted">No composition data</p>
            ) : (
              <div className="comp-summary">
                {sourceComp.map((c) => (
                  <span key={c.cattle_type} className="comp-tag">
                    {c.count} {c.cattle_type}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

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
          <button type="submit" className="btn btn-primary" disabled={loading || !sourceMob}>
            {loading ? 'Merging...' : 'Merge'}
          </button>
        </div>
      </form>
    </div>
  )
}

export default MergeMob
