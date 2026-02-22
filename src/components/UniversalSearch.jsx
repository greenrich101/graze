import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function UniversalSearch({ propertyId }) {
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState(null)
  const [selected, setSelected] = useState(null) // selected animal
  const [animalDetail, setAnimalDetail] = useState(null) // { currentPaddock, movements, treatments }
  const [loadingDetail, setLoadingDetail] = useState(false)

  const handleSearch = async (e) => {
    e.preventDefault()
    const q = query.trim()
    if (!q) return

    setSearching(true)
    setSelected(null)
    setAnimalDetail(null)

    // Get mob names and paddock names for property scoping
    const [{ data: mobs }, { data: paddocks }] = await Promise.all([
      supabase.from('mobs').select('name, description').eq('property_id', propertyId),
      supabase.from('paddocks').select('name').eq('property_id', propertyId),
    ])

    const mobNames = (mobs || []).map((m) => m.name)
    const paddockNames = (paddocks || []).map((p) => p.name)

    const queries = []

    // Animals
    if (mobNames.length > 0) {
      queries.push(
        supabase
          .from('animals')
          .select('id, mob_name, management_tag, nlis_tag, cattle_type, breed, status, description')
          .in('mob_name', mobNames)
          .or(`management_tag.ilike.%${q}%,nlis_tag.ilike.%${q}%,breed.ilike.%${q}%,description.ilike.%${q}%`)
          .limit(5)
      )
    } else {
      queries.push(Promise.resolve({ data: [] }))
    }

    // Mobs
    queries.push(
      supabase
        .from('mobs')
        .select('name, description')
        .eq('property_id', propertyId)
        .or(`name.ilike.%${q}%,description.ilike.%${q}%`)
        .limit(5)
    )

    // Paddocks
    queries.push(
      supabase
        .from('paddocks')
        .select('name')
        .eq('property_id', propertyId)
        .ilike('name', `%${q}%`)
        .limit(5)
    )

    // Movements (by notes)
    if (mobNames.length > 0) {
      queries.push(
        supabase
          .from('movements')
          .select('record_key, mob_name, paddock_name, actual_move_in_date, notes')
          .in('mob_name', mobNames)
          .ilike('notes', `%${q}%`)
          .not('notes', 'is', null)
          .order('actual_move_in_date', { ascending: false })
          .limit(5)
      )
    } else {
      queries.push(Promise.resolve({ data: [] }))
    }

    // Health events (by treatment_type or notes)
    if (mobNames.length > 0) {
      queries.push(
        supabase
          .from('health_events')
          .select('id, animal_id, mob_name, treatment_type, treatment_date, notes')
          .in('mob_name', mobNames)
          .or(`treatment_type.ilike.%${q}%,notes.ilike.%${q}%`)
          .order('treatment_date', { ascending: false })
          .limit(5)
      )
    } else {
      queries.push(Promise.resolve({ data: [] }))
    }

    // Pasture logs (by notes)
    if (paddockNames.length > 0) {
      queries.push(
        supabase
          .from('pasture_logs')
          .select('id, paddock_name, log_date, condition, notes')
          .in('paddock_name', paddockNames)
          .ilike('notes', `%${q}%`)
          .not('notes', 'is', null)
          .order('log_date', { ascending: false })
          .limit(5)
      )
    } else {
      queries.push(Promise.resolve({ data: [] }))
    }

    const [
      { data: animals },
      { data: mobResults },
      { data: paddockResults },
      { data: movements },
      { data: treatments },
      { data: pastureLogs },
    ] = await Promise.all(queries)

    setResults({
      animals: animals || [],
      mobs: mobResults || [],
      paddocks: paddockResults || [],
      movements: movements || [],
      treatments: treatments || [],
      pastureLogs: pastureLogs || [],
    })
    setSearching(false)
  }

  const handleSelectAnimal = async (animal) => {
    if (selected?.id === animal.id) {
      setSelected(null)
      setAnimalDetail(null)
      return
    }
    setSelected(animal)
    setLoadingDetail(true)
    setAnimalDetail(null)

    const [{ data: activeMove }, { data: movData }, { data: healthData }] = await Promise.all([
      supabase
        .from('movements')
        .select('paddock_name')
        .eq('mob_name', animal.mob_name)
        .not('actual_move_in_date', 'is', null)
        .is('actual_move_out_date', null)
        .single(),
      supabase
        .from('movements')
        .select('*')
        .eq('mob_name', animal.mob_name)
        .not('actual_move_in_date', 'is', null)
        .order('actual_move_in_date', { ascending: false })
        .limit(3),
      supabase
        .from('health_events')
        .select('*')
        .eq('animal_id', animal.id)
        .order('treatment_date', { ascending: false })
        .limit(3),
    ])

    setAnimalDetail({
      currentPaddock: activeMove?.paddock_name || null,
      movements: movData || [],
      treatments: healthData || [],
    })
    setLoadingDetail(false)
  }

  const handleClear = () => {
    setQuery('')
    setResults(null)
    setSelected(null)
    setAnimalDetail(null)
  }

  const hasResults = results && (
    results.animals.length > 0 ||
    results.mobs.length > 0 ||
    results.paddocks.length > 0 ||
    results.movements.length > 0 ||
    results.treatments.length > 0 ||
    results.pastureLogs.length > 0
  )

  return (
    <div className="detail-card" style={{ marginTop: '1rem' }}>
      <h3>Search</h3>
      <p className="muted" style={{ marginBottom: '0.75rem', fontSize: '0.875rem' }}>
        Search animals, mobs, paddocks, movements, treatments, and pasture logs.
      </p>

      <form onSubmit={handleSearch} style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', maxWidth: '480px' }}>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search everything…"
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
          {searching ? 'Searching…' : 'Search'}
        </button>
        {results && (
          <button type="button" className="btn btn-secondary" onClick={handleClear}>
            Clear
          </button>
        )}
      </form>

      {results && !searching && !hasResults && (
        <p className="muted">No results found for "{query}".</p>
      )}

      {hasResults && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

          {results.animals.length > 0 && (
            <section>
              <h4 className="search-group-heading">Animals</h4>
              <div className="search-result-list">
                {results.animals.map((animal) => (
                  <div key={animal.id}>
                    <button
                      className={`search-result-row${selected?.id === animal.id ? ' selected' : ''}`}
                      onClick={() => handleSelectAnimal(animal)}
                    >
                      <span className="search-result-primary">
                        {[animal.management_tag, animal.nlis_tag].filter(Boolean).join(' / ') || '(no tag)'}
                      </span>
                      <span className="search-result-secondary">
                        {[animal.cattle_type, animal.breed].filter(Boolean).join(', ')}
                        {' · '}
                        <Link
                          to={`/mobs/${encodeURIComponent(animal.mob_name)}`}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {animal.mob_name}
                        </Link>
                      </span>
                    </button>

                    {selected?.id === animal.id && (
                      <div className="animal-lookup-result" style={{ padding: '0.75rem', background: 'var(--gray-50)', borderRadius: '4px', marginTop: '0.25rem' }}>
                        {loadingDetail ? (
                          <p className="muted" style={{ fontSize: '0.875rem' }}>Loading…</p>
                        ) : animalDetail && (
                          <>
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
                                  <Link to={`/mobs/${encodeURIComponent(animal.mob_name)}`}>{animal.mob_name}</Link>
                                </span>
                              </div>
                              <div className="detail-item">
                                <span className="detail-label">Current Paddock</span>
                                <span className="detail-value">
                                  {animalDetail.currentPaddock ? (
                                    <Link to={`/paddocks/${encodeURIComponent(animalDetail.currentPaddock)}`}>
                                      {animalDetail.currentPaddock}
                                    </Link>
                                  ) : '—'}
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

                            <div style={{ marginTop: '1rem' }}>
                              <h4 style={{ fontSize: '0.85rem', color: 'var(--gray-600)', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: '0.5rem' }}>
                                Last 3 Moves
                              </h4>
                              {animalDetail.movements.length === 0 ? (
                                <p className="muted" style={{ fontSize: '0.875rem' }}>No movement history.</p>
                              ) : (
                                <div className="movement-list">
                                  {animalDetail.movements.map((m) => (
                                    <div key={m.record_key} className="movement-row">
                                      <div className="movement-row-content">
                                        <div className="movement-info">
                                          <Link to={`/paddocks/${encodeURIComponent(m.paddock_name)}`}>{m.paddock_name}</Link>
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

                            <div style={{ marginTop: '1rem' }}>
                              <h4 style={{ fontSize: '0.85rem', color: 'var(--gray-600)', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: '0.5rem' }}>
                                Last 3 Treatments
                              </h4>
                              {animalDetail.treatments.length === 0 ? (
                                <p className="muted" style={{ fontSize: '0.875rem' }}>No treatments recorded.</p>
                              ) : (
                                <div className="health-event-list">
                                  {animalDetail.treatments.map((t) => (
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
                          </>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {results.mobs.length > 0 && (
            <section>
              <h4 className="search-group-heading">Mobs</h4>
              <div className="search-result-list">
                {results.mobs.map((mob) => (
                  <Link
                    key={mob.name}
                    to={`/mobs/${encodeURIComponent(mob.name)}`}
                    className="search-result-row search-result-link"
                  >
                    <span className="search-result-primary">{mob.name}</span>
                    {mob.description && (
                      <span className="search-result-secondary">{mob.description}</span>
                    )}
                  </Link>
                ))}
              </div>
            </section>
          )}

          {results.paddocks.length > 0 && (
            <section>
              <h4 className="search-group-heading">Paddocks</h4>
              <div className="search-result-list">
                {results.paddocks.map((paddock) => (
                  <Link
                    key={paddock.name}
                    to={`/paddocks/${encodeURIComponent(paddock.name)}`}
                    className="search-result-row search-result-link"
                  >
                    <span className="search-result-primary">{paddock.name}</span>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {results.movements.length > 0 && (
            <section>
              <h4 className="search-group-heading">Movements</h4>
              <div className="search-result-list">
                {results.movements.map((m) => (
                  <Link
                    key={m.record_key}
                    to={`/mobs/${encodeURIComponent(m.mob_name)}/history`}
                    className="search-result-row search-result-link"
                  >
                    <span className="search-result-primary">{m.mob_name} → {m.paddock_name}</span>
                    <span className="search-result-secondary">
                      {m.actual_move_in_date
                        ? new Date(m.actual_move_in_date + 'T00:00').toLocaleDateString()
                        : ''}
                      {m.notes && ` · ${m.notes}`}
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {results.treatments.length > 0 && (
            <section>
              <h4 className="search-group-heading">Treatments</h4>
              <div className="search-result-list">
                {results.treatments.map((t) => (
                  <div key={t.id} className="search-result-row">
                    <span className="search-result-primary">{t.treatment_type}</span>
                    <span className="search-result-secondary">
                      {t.mob_name}
                      {t.treatment_date && ` · ${new Date(t.treatment_date + 'T00:00').toLocaleDateString()}`}
                      {t.notes && ` · ${t.notes}`}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {results.pastureLogs.length > 0 && (
            <section>
              <h4 className="search-group-heading">Pasture Logs</h4>
              <div className="search-result-list">
                {results.pastureLogs.map((log) => (
                  <Link
                    key={log.id}
                    to={`/paddocks/${encodeURIComponent(log.paddock_name)}`}
                    className="search-result-row search-result-link"
                  >
                    <span className="search-result-primary">{log.paddock_name}</span>
                    <span className="search-result-secondary">
                      {log.condition}
                      {log.log_date && ` · ${new Date(log.log_date + 'T00:00').toLocaleDateString()}`}
                      {log.notes && ` · ${log.notes}`}
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          )}

        </div>
      )}
    </div>
  )
}
