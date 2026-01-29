import { useState } from 'react'
import { Link } from 'react-router-dom'

function MovementList({ movements, showMob = false, onDelete, onUpdateNotes }) {
  const [editingNotes, setEditingNotes] = useState(null)
  const [notesDraft, setNotesDraft] = useState('')

  if (!movements || movements.length === 0) {
    return <p className="muted">No movement history.</p>
  }

  const startEditNotes = (m) => {
    setEditingNotes(m.record_key)
    setNotesDraft(m.notes || '')
  }

  const saveNotes = (recordKey) => {
    onUpdateNotes(recordKey, notesDraft)
    setEditingNotes(null)
  }

  return (
    <div className="movement-list">
      {movements.map((m) => {
        const isPlanned = !m.actual_move_in_date
        const isActive = m.actual_move_in_date && !m.actual_move_out_date
        const isExecuted = !!m.actual_move_in_date
        return (
          <div key={m.record_key} className={`movement-row ${isActive ? 'movement-open' : ''} ${isPlanned ? 'movement-planned' : ''}`}>
            <div className="movement-row-content">
              <div className="movement-dates">
                {isPlanned ? (
                  <>
                    <span className="badge badge-planned">Planned</span>
                    <span className="movement-date-in">
                      {m.planned_move_in_date || '—'}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="badge badge-executed">Executed</span>
                    <span className="movement-date-in">{m.actual_move_in_date}</span>
                    <span className="movement-arrow">&rarr;</span>
                    <span className="movement-date-out">
                      {m.actual_move_out_date || 'current'}
                    </span>
                  </>
                )}
              </div>
              <div className="movement-info">
                {showMob && (
                  <Link to={`/mobs/${encodeURIComponent(m.mob_name)}`} className="movement-mob">
                    {m.mob_name}
                  </Link>
                )}
                <Link to={`/paddocks/${encodeURIComponent(m.paddock_name)}`} className="movement-paddock">
                  {m.paddock_name}
                </Link>
                {m.planned_graze_days && (
                  <span className="movement-planned">({m.planned_graze_days}d planned)</span>
                )}
              </div>
              {editingNotes === m.record_key ? (
                <div className="movement-notes-edit">
                  <input
                    type="text"
                    value={notesDraft}
                    onChange={(e) => setNotesDraft(e.target.value)}
                    placeholder="Add notes..."
                    autoFocus
                  />
                  <button className="btn btn-primary btn-sm" onClick={() => saveNotes(m.record_key)}>
                    Save
                  </button>
                  <button className="btn btn-secondary btn-sm" onClick={() => setEditingNotes(null)}>
                    Cancel
                  </button>
                </div>
              ) : (
                m.notes && <p className="movement-notes">{m.notes}</p>
              )}
              {m.movement_requirements && m.movement_requirements.length > 0 && (
                <div className="movement-reqs">
                  {m.movement_requirements.map((r) => (
                    <span key={r.id} className="comp-tag">
                      {r.requirement_types?.name}
                    </span>
                  ))}
                </div>
              )}
            </div>
            {(onDelete || onUpdateNotes) && (
              <div className="movement-row-actions">
                {onUpdateNotes && isExecuted && editingNotes !== m.record_key && (
                  <button className="btn btn-secondary btn-sm" onClick={() => startEditNotes(m)}>
                    {m.notes ? 'Edit Notes' : 'Add Notes'}
                  </button>
                )}
                {onDelete && (
                  <button className="btn btn-danger btn-sm" onClick={() => onDelete(m.record_key)}>
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

export default MovementList
