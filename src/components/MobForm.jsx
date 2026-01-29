import { useState } from 'react'

function MobForm({ mob, onSubmit, onCancel }) {
  const [name, setName] = useState(mob?.name || '')
  const [description, setDescription] = useState(mob?.description || '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    const payload = {
      name: name.trim(),
      description: description.trim() || null,
    }
    if (mob) payload.id = mob.id

    const success = await onSubmit(payload)
    if (!success) {
      setError('Failed to save mob.')
    }
    setLoading(false)
  }

  return (
    <div className="paddock-form-container">
      <form className="paddock-form" onSubmit={handleSubmit}>
        <h3>{mob ? 'Edit Mob' : 'New Mob'}</h3>
        {error && <div className="error-message">{error}</div>}
        <div className="form-group">
          <label>Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>
        <div className="form-group">
          <label>Description</label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className="form-actions">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Saving...' : mob ? 'Update' : 'Create'}
          </button>
        </div>
      </form>
    </div>
  )
}

export default MobForm
