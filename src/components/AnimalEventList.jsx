import { useState } from 'react'
import { Link } from 'react-router-dom'

function AnimalEventList({ events, onDelete, onUpdateNotes }) {
  const [editingNotes, setEditingNotes] = useState(null)
  const [notesDraft, setNotesDraft] = useState('')

  if (!events || events.length === 0) {
    return <p className="muted">No animal events logged yet.</p>
  }

  const startEditNotes = (event) => {
    setEditingNotes(event.id)
    setNotesDraft(event.notes || '')
  }

  const saveNotes = (eventId) => {
    onUpdateNotes(eventId, notesDraft)
    setEditingNotes(null)
  }

  return (
    <div className="movement-list">
      {events.map((event) => {
        const eventLabel = event.event_type === 'sold' ? 'Sold' : 'Deceased'
        const eventClass = event.event_type === 'sold' ? 'badge-executed' : 'badge-danger'

        return (
          <div key={event.id} className="movement-row">
            <div className="movement-row-content">
              <div className="movement-dates">
                <span className={`badge ${eventClass}`}>{eventLabel}</span>
                <span className="movement-date-in">{event.event_date}</span>
              </div>
              <div className="movement-info">
                <Link
                  to={`/mobs/${encodeURIComponent(event.mob_name)}`}
                  className="movement-mob"
                >
                  {event.mob_name}
                </Link>
                <span className="movement-paddock">
                  {event.count} {event.cattle_type}
                  {event.count !== 1 && event.cattle_type === 'calf' ? 'ves' : event.count !== 1 ? 's' : ''}
                </span>
              </div>
              {editingNotes === event.id ? (
                <div className="movement-notes-edit">
                  <input
                    type="text"
                    value={notesDraft}
                    onChange={(e) => setNotesDraft(e.target.value)}
                    placeholder="Add notes..."
                    autoFocus
                  />
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => saveNotes(event.id)}
                  >
                    Save
                  </button>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => setEditingNotes(null)}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                event.notes && <p className="movement-notes">{event.notes}</p>
              )}
            </div>
            {(onDelete || onUpdateNotes) && (
              <div className="movement-row-actions">
                {onUpdateNotes && editingNotes !== event.id && (
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => startEditNotes(event)}
                  >
                    {event.notes ? 'Edit Notes' : 'Add Notes'}
                  </button>
                )}
                {onDelete && (
                  <button
                    className="btn btn-danger btn-sm"
                    onClick={() => onDelete(event.id)}
                  >
                    Delete
                  </button>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export default AnimalEventList
