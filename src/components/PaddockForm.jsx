import { useState } from 'react'

function PaddockForm({ paddock, onSubmit, onCancel }) {
  const [name, setName] = useState(paddock?.name || '')
  const [areaAcres, setAreaAcres] = useState(paddock?.area_acres || '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    const paddockData = {
      name: name.trim(),
      area_acres: parseFloat(areaAcres),
    }

    if (paddock) {
      paddockData.originalName = paddock.name
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
          <label htmlFor="area_acres">Acres</label>
          <input
            id="area_acres"
            type="number"
            step="0.1"
            min="0"
            value={areaAcres}
            onChange={(e) => setAreaAcres(e.target.value)}
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
