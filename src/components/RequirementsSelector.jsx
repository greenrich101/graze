import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

function RequirementsSelector({ selected, onChange }) {
  const [types, setTypes] = useState([])

  useEffect(() => {
    supabase
      .from('requirement_types')
      .select('*')
      .order('name')
      .then(({ data }) => setTypes(data || []))
  }, [])

  const toggle = (typeId) => {
    const existing = selected.find((r) => r.requirement_type_id === typeId)
    if (existing) {
      onChange(selected.filter((r) => r.requirement_type_id !== typeId))
    } else {
      onChange([...selected, { requirement_type_id: typeId, notes: '' }])
    }
  }

  const updateNotes = (typeId, notes) => {
    onChange(selected.map((r) => r.requirement_type_id === typeId ? { ...r, notes } : r))
  }

  return (
    <div className="requirements-selector">
      <label>Paddock Requirements</label>
      {types.map((type) => {
        const sel = selected.find((r) => r.requirement_type_id === type.id)
        return (
          <div key={type.id} className="req-check-row">
            <label className="req-check-label">
              <input
                type="checkbox"
                checked={!!sel}
                onChange={() => toggle(type.id)}
              />
              {type.name}
            </label>
            {sel && (
              <input
                type="text"
                className="req-notes-input"
                placeholder="Notes (optional)"
                value={sel.notes}
                onChange={(e) => updateNotes(type.id, e.target.value)}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

export default RequirementsSelector
