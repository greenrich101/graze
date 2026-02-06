import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useProperty } from '../contexts/PropertyContext'

const CATTLE_TYPES = ['cow', 'calf', 'bull', 'steer', 'heifer', 'weaner', 'other']

function AnimalEventLogger({ onEventLogged }) {
  const { propertyId } = useProperty()
  const [mobs, setMobs] = useState([])
  const [mobName, setMobName] = useState('')
  const [eventType, setEventType] = useState('sold')
  const [cattleType, setCattleType] = useState('')
  const [count, setCount] = useState('')
  const [eventDate, setEventDate] = useState(new Date().toISOString().split('T')[0])
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [availableTypes, setAvailableTypes] = useState([])

  // Fetch mobs on mount
  useEffect(() => {
    if (!propertyId) return
    const fetchMobs = async () => {
      const { data } = await supabase
        .from('mobs')
        .select('name, mob_composition(cattle_type, count)')
        .eq('property_id', propertyId)
        .order('name')
      setMobs(data || [])
    }
    fetchMobs()
  }, [propertyId])

  // Update available cattle types when mob selected
  useEffect(() => {
    if (!mobName) {
      setAvailableTypes([])
      setCattleType('')
      return
    }
    const selectedMob = mobs.find((m) => m.name === mobName)
    const types = (selectedMob?.mob_composition || [])
      .filter((c) => c.count > 0)
      .map((c) => ({ type: c.cattle_type, count: c.count }))
    setAvailableTypes(types)
    if (types.length > 0) {
      setCattleType(types[0].type)
    } else {
      setCattleType('')
    }
  }, [mobName, mobs])

  const maxCount = availableTypes.find((t) => t.type === cattleType)?.count || 0

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    // Validation
    if (!mobName || !cattleType || !count || count <= 0) {
      setError('All fields are required')
      return
    }

    if (parseInt(count) > maxCount) {
      setError(`Cannot log more than ${maxCount} ${cattleType}`)
      return
    }

    setLoading(true)

    // Call RPC function
    const { data, error: rpcErr } = await supabase.rpc('log_animal_event', {
      p_mob_name: mobName,
      p_event_type: eventType,
      p_cattle_type: cattleType,
      p_count: parseInt(count),
      p_event_date: eventDate,
      p_notes: notes || null,
    })

    if (rpcErr) {
      setError(rpcErr.message)
      setLoading(false)
      return
    }

    // Reset form
    setMobName('')
    setCattleType('')
    setCount('')
    setNotes('')
    setLoading(false)

    // Notify parent
    if (onEventLogged) {
      onEventLogged()
    }
  }

  return (
    <div className="detail-card">
      <h3>Log Animal Event</h3>
      <form onSubmit={handleSubmit}>
        {error && <div className="error-message">{error}</div>}

        <div className="form-group">
          <label>Event Type</label>
          <select value={eventType} onChange={(e) => setEventType(e.target.value)} required>
            <option value="sold">Sold</option>
            <option value="deceased">Deceased</option>
          </select>
        </div>

        <div className="form-group">
          <label>Mob</label>
          <select value={mobName} onChange={(e) => setMobName(e.target.value)} required>
            <option value="">— Select Mob —</option>
            {mobs.map((m) => (
              <option key={m.name} value={m.name}>
                {m.name}
              </option>
            ))}
          </select>
        </div>

        {availableTypes.length > 0 ? (
          <>
            <div className="form-group">
              <label>Cattle Type</label>
              <select value={cattleType} onChange={(e) => setCattleType(e.target.value)} required>
                {availableTypes.map((t) => (
                  <option key={t.type} value={t.type}>
                    {t.type} (available: {t.count})
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label>Count</label>
              <input
                type="number"
                min="1"
                max={maxCount}
                value={count}
                onChange={(e) => setCount(e.target.value)}
                required
              />
              {maxCount > 0 && (
                <p className="muted" style={{ fontSize: '0.85rem', marginTop: '0.25rem' }}>
                  Max: {maxCount}
                </p>
              )}
            </div>
          </>
        ) : mobName ? (
          <p className="muted">No animals in this mob</p>
        ) : null}

        <div className="form-group">
          <label>Date</label>
          <input
            type="date"
            value={eventDate}
            onChange={(e) => setEventDate(e.target.value)}
            required
          />
        </div>

        <div className="form-group">
          <label>Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows="2"
            placeholder="Optional notes"
          />
        </div>

        <div className="form-actions">
          <button
            type="submit"
            className="btn btn-primary"
            disabled={loading || !mobName || availableTypes.length === 0}
          >
            {loading ? 'Logging...' : `Log ${eventType === 'sold' ? 'Sale' : 'Death'}`}
          </button>
        </div>
      </form>
    </div>
  )
}

export default AnimalEventLogger
