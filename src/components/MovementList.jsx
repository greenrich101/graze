import { Link } from 'react-router-dom'

function MovementList({ movements, showMob = false }) {
  if (!movements || movements.length === 0) {
    return <p className="muted">No movement history.</p>
  }

  return (
    <div className="movement-list">
      {movements.map((m) => {
        const isOpen = !m.actual_move_out_date
        return (
          <div key={m.record_key} className={`movement-row ${isOpen ? 'movement-open' : ''}`}>
            <div className="movement-dates">
              <span className="movement-date-in">{m.actual_move_in_date}</span>
              <span className="movement-arrow">&rarr;</span>
              <span className="movement-date-out">
                {m.actual_move_out_date || 'current'}
              </span>
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
            {m.notes && <p className="movement-notes">{m.notes}</p>}
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
        )
      })}
    </div>
  )
}

export default MovementList
