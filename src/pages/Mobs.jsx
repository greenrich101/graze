import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useProperty } from '../contexts/PropertyContext'
import MobForm from '../components/MobForm'
import AnimalEventLogger from '../components/AnimalEventLogger'
import AnimalEventList from '../components/AnimalEventList'

function Mobs() {
  const { propertyId, role } = useProperty()
  const isHand = role === 'hand'
  const [mobs, setMobs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editingMob, setEditingMob] = useState(null)
  const [recentEvents, setRecentEvents] = useState([])

  useEffect(() => {
    fetchMobs()
  }, [propertyId])

  const fetchMobs = async () => {
    if (!propertyId) return
    setLoading(true)

    // Fetch mobs with their composition and open movement
    const { data, error } = await supabase
      .from('mobs')
      .select('*, mob_composition(*)')
      .eq('property_id', propertyId)
      .order('created_at', { ascending: false })

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    // Fetch active movements to get current paddock info
    const { data: openMovements } = await supabase
      .from('movements')
      .select('mob_name, paddock_name, actual_move_in_date')
      .not('actual_move_in_date', 'is', null)
      .is('actual_move_out_date', null)

    const movementMap = {}
    if (openMovements) {
      openMovements.forEach((m) => {
        movementMap[m.mob_name] = m
      })
    }

    const enriched = (data || []).map((mob) => {
      const headCount = (mob.mob_composition || []).reduce((sum, c) => sum + c.count, 0)
      const openMove = movementMap[mob.name]
      const daysGrazing = openMove
        ? Math.floor((Date.now() - new Date(openMove.actual_move_in_date).getTime()) / 86400000)
        : null
      return {
        ...mob,
        headCount,
        currentPaddock: openMove?.paddock_name || null,
        daysGrazing,
      }
    })

    setMobs(enriched)

    // Fetch recent animal events (last 10)
    const { data: eventsData } = await supabase
      .from('animal_events')
      .select('*')
      .in('mob_name', (data || []).map((m) => m.name))
      .order('event_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(10)

    setRecentEvents(eventsData || [])
    setLoading(false)
  }

  const handleCreate = async (mob) => {
    const { error } = await supabase
      .from('mobs')
      .insert([{
        name: mob.name,
        description: mob.description,
        property_id: propertyId,
      }])

    if (error) {
      setError(error.message)
      return false
    }

    setShowForm(false)
    fetchMobs()
    return true
  }

  const handleUpdate = async (mob) => {
    const oldName = mob.originalName || mob.name
    const nameChanging = mob.name !== oldName

    const { error } = await supabase
      .from('mobs')
      .update({
        name: mob.name,
        description: mob.description,
      })
      .eq('name', oldName)
      .eq('property_id', propertyId)

    if (error) {
      setError(error.message)
      return false
    }

    // Cascade name change to non-FK tables (mob_composition and movements use mob_name as plain text)
    if (nameChanging) {
      await supabase.from('mob_composition').update({ mob_name: mob.name }).eq('mob_name', oldName)
      await supabase.from('movements').update({ mob_name: mob.name }).eq('mob_name', oldName)
    }

    setEditingMob(null)
    fetchMobs()
    return true
  }

  const handleDelete = async (mob) => {
    if (!confirm(`Delete mob "${mob.name}"? This will also delete its composition and movement history.`)) {
      return
    }

    const { error } = await supabase.from('mobs').delete().eq('name', mob.name)
    if (error) {
      setError(error.message)
      return
    }

    setMobs(mobs.filter((m) => m.name !== mob.name))
  }

  const handleDeleteEvent = async (eventId) => {
    if (!confirm('Delete this event? This will NOT restore the animals to the mob.')) {
      return
    }
    const { error } = await supabase.from('animal_events').delete().eq('id', eventId)
    if (error) {
      setError(error.message)
      return
    }
    fetchMobs()
  }

  const handleUpdateEventNotes = async (eventId, notes) => {
    const { error } = await supabase
      .from('animal_events')
      .update({ notes: notes || null })
      .eq('id', eventId)
    if (error) {
      setError(error.message)
      return
    }
    fetchMobs()
  }

  if (loading) {
    return <div className="loading">Loading mobs...</div>
  }

  return (
    <div className="mobs-page">
      <div className="page-header">
        <h2>Mobs</h2>
        <button
          className="btn btn-primary"
          onClick={() => { setShowForm(true); setEditingMob(null) }}
        >
          Add Mob
        </button>
      </div>

      {error && <div className="error-message">{error}</div>}

      {(showForm || editingMob) && (
        <MobForm
          mob={editingMob}
          onSubmit={editingMob ? handleUpdate : handleCreate}
          onCancel={() => { setShowForm(false); setEditingMob(null) }}

        />
      )}

      {mobs.length === 0 ? (
        <p className="empty-state">No mobs yet. Add your first mob!</p>
      ) : (
        <div className="mob-list">
          {mobs.map((mob) => (
            <div key={mob.name} className="mob-card">
              <div className="mob-card-main">
                <h3><Link to={`/mobs/${encodeURIComponent(mob.name)}`}>{mob.name}</Link></h3>
                {mob.description && <p className="mob-description">{mob.description}</p>}
              </div>
              <div className="mob-card-stats">
                <span className="stat">
                  <strong>{mob.headCount}</strong> head
                </span>
                {mob.currentPaddock && (
                  <span className="stat">
                    <strong>{mob.currentPaddock}</strong>
                    {mob.daysGrazing !== null && ` · ${mob.daysGrazing}d`}
                  </span>
                )}
                {!mob.currentPaddock && <span className="stat muted">No paddock</span>}
              </div>
              <div className="mob-card-actions">
                <button className="btn btn-secondary" onClick={() => setEditingMob(mob)}>
                  Edit
                </button>
                <button className="btn btn-danger" onClick={() => handleDelete(mob)}>
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Animal Events Section */}
      <div className="animal-events-section" style={{ marginTop: '2rem' }}>
        <h2>Animal Events</h2>
        <AnimalEventLogger onEventLogged={fetchMobs} />

        <div className="detail-card" style={{ marginTop: '1.5rem' }}>
          <h3>Recent Events</h3>
          <AnimalEventList
            events={recentEvents}
            onDelete={handleDeleteEvent}
            onUpdateNotes={handleUpdateEventNotes}
          />
        </div>
      </div>
    </div>
  )
}

export default Mobs
