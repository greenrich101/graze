import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function AnimalLookup({ propertyId }) {
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [animal, setAnimal] = useState(null)
  const [movements, setMovements] = useState([])
  const [treatments, setTreatments] = useState([])
  const [searched, setSearched] = useState(false)

  const handleSearch = async (e) => {
    e.preventDefault()
    const q = query.trim()
    if (!q) return

    setSearching(true)
    setAnimal(null)
    setMovements([])
    setTreatments([])
    setSearched(true)

    // Get mob names for this property
    const { data: mobs } = await supabase
      .from('mobs')
      .select('name')
      .eq('property_id', propertyId)

    const mobNames = (mobs || []).map((m) => m.name)
    if (mobNames.length === 0) {
      setSearching(false)
      return
    }

    // Search by management_tag or nlis_tag
    const { data: animals } = await supabase
      .from('animals')
      .select('*')
      .in('mob_name', mobNames)
      .or(`management_tag.ilike.%${q}%,nlis_tag.ilike.%${q}%`)
      .limit(1)
      .single()

    if (!animals) {
      setSearching(false)
      return
    }

    setAnimal(animals)

    // Fetch last 3 movements for this animal's mob
    const { data: movData } = await supabase
      .from('movements')
      .select('*')
      .eq('mob_name', animals.mob_name)
      .not('actual_move_in_date', 'is', null)
      .order('actual_move_in_date', { ascending: false })
      .limit(3)

    setMovements(movData || [])

    // Fetch last 3 health treatments for this animal
    const { data: healthData } = await supabase
      .from('health_events')
      .select('*')
      .eq('animal_id', animals.id)
      .order('treatment_date', { ascending: false })
      .limit(3)

    setTreatments(healthData || [])
    setSearching(false)
  }

  const handleClear = () => {
    setQuery('')
    setAnimal(null)
    setMovements([])
    setTreatments([])
    setSearched(false)
  }

  return (
    <div className="detail-card" style={{ marginTop: '1rem' }}>
      <h3>Animal Lookup</h3>
      <p className="muted" style={{ marginBottom: '0.75rem', fontSize: '0.875rem' }}>
        Search by Management Tag or NLIS tag.
      </p>

      <form onSubmit={handleSearch} style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Enter Mgt Tag or NLIS..."
          style={{
            flex: 1,
            padding: '0.5rem',
            border: '1px solid var(--gray-300)',
            borderRadius: '4px',
            fontSize: '0.875rem',
            fontFamily: 'inherit',
          }}
        />
        <button type="submit" className="btn btn-primary" disabled={searching || !query.trim()}>
          {searching ? 'Searching...' : 'Search'}
        </button>
        {searched && (
          <button type="button" className="btn btn-secondary" onClick={handleClear}>
            Clear
          </button>
        )}
      </form>

      {searched && !searching && !animal && (
        <p className="muted">No animal found matching "{query}".</p>
      )}

      {animal && (
        <div className="animal-lookup-result">
          {/* Animal details */}
          <div className="animal-lookup-details">
            <div className="detail-grid">
              {animal.management_tag && (
                <div className="detail-item">
                  <span className="detail-label">Mgt Tag</span>
                  <span className="detail-value">{animal.management_tag}</span>
                </div>
              )}
              {animal.nlis_tag && (
                <div className="detail-item">
                  <span className="detail-label">NLIS</span>
                  <span className="detail-value">{animal.nlis_tag}</span>
                </div>
              )}
              <div className="detail-item">
                <span className="detail-label">Mob</span>
                <span className="detail-value">
                  <Link to={`/mobs/${encodeURIComponent(animal.mob_name)}`}>
                    {animal.mob_name}
                  </Link>
                </span>
              </div>
              <div className="detail-item">
                <span className="detail-label">Type</span>
                <span className="detail-value" style={{ textTransform: 'capitalize' }}>{animal.cattle_type}</span>
              </div>
              {animal.breed && (
                <div className="detail-item">
                  <span className="detail-label">Breed</span>
                  <span className="detail-value">{animal.breed}</span>
                </div>
              )}
              <div className="detail-item">
                <span className="detail-label">Status</span>
                <span className="detail-value" style={{ textTransform: 'capitalize' }}>{animal.status}</span>
              </div>
            </div>
          </div>

          {/* Last 3 Moves */}
          <div style={{ marginTop: '1rem' }}>
            <h4 style={{ fontSize: '0.85rem', color: 'var(--gray-600)', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: '0.5rem' }}>
              Last 3 Moves
            </h4>
            {movements.length === 0 ? (
              <p className="muted" style={{ fontSize: '0.875rem' }}>No movement history.</p>
            ) : (
              <div className="movement-list">
                {movements.map((m) => (
                  <div key={m.record_key} className="movement-row">
                    <div className="movement-row-content">
                      <div className="movement-info">
                        <Link to={`/paddocks/${encodeURIComponent(m.paddock_name)}`}>
                          {m.paddock_name}
                        </Link>
                      </div>
                      <div className="movement-dates">
                        <span className="movement-date-in">
                          {new Date(m.actual_move_in_date + 'T00:00').toLocaleDateString()}
                        </span>
                        {m.actual_move_out_date && (
                          <>
                            <span className="movement-arrow">&rarr;</span>
                            <span className="movement-date-out">
                              {new Date(m.actual_move_out_date + 'T00:00').toLocaleDateString()}
                            </span>
                          </>
                        )}
                        {!m.actual_move_out_date && (
                          <span className="badge badge-executed">Current</span>
                        )}
                      </div>
                      {m.notes && <div className="movement-notes">{m.notes}</div>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Last 3 Treatments */}
          <div style={{ marginTop: '1rem' }}>
            <h4 style={{ fontSize: '0.85rem', color: 'var(--gray-600)', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: '0.5rem' }}>
              Last 3 Treatments
            </h4>
            {treatments.length === 0 ? (
              <p className="muted" style={{ fontSize: '0.875rem' }}>No treatments recorded.</p>
            ) : (
              <div className="health-event-list">
                {treatments.map((t) => (
                  <div key={t.id} className="health-event-card">
                    <div className="health-event-header">
                      <span className="badge" style={{ background: '#d1ecf1', color: '#0c5460' }}>
                        {t.treatment_type}
                      </span>
                      <span className="health-event-date">
                        {new Date(t.treatment_date + 'T00:00').toLocaleDateString()}
                      </span>
                    </div>
                    {t.notes && <p className="health-event-notes">{t.notes}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
