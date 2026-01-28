import { useState } from 'react'

function PaddockForm({ paddock, onSubmit, onCancel }) {
  const [name, setName] = useState(paddock?.name || '')
  const [acres, setAcres] = useState(paddock?.acres || '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    const paddockData = {
      name: name.trim(),
      acres: parseFloat(acres),
    }

    if (paddock?.id) {
      paddockData.id = paddock.id
    }

    const success = await onSubmit(paddockData)

    if (!success) {
      setLoading(false)
    }
  }

  return (
    <div className="paddock-form-container">
      <form onSubmit={handleSubmit} className="paddock-form">
        <h3>{paddock ? 'Edit Paddock' : 'New Paddock'}</h3>

        {error && <div className="error-message">{error}</div>}

        <div className="form-group">
          <label htmlFor="name">Name</label>
          <input
            id="name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>

        <div className="form-group">
          <label htmlFor="acres">Acres</label>
          <input
            id="acres"
            type="number"
            step="0.1"
            min="0"
            value={acres}
            onChange={(e) => setAcres(e.target.value)}
            required
          />
        </div>

        <div className="form-actions">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Saving...' : paddock ? 'Update' : 'Create'}
          </button>
        </div>
      </form>
    </div>
  )
}

export default PaddockForm
