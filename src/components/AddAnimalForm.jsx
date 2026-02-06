import { useState } from 'react'
import { supabase } from '../lib/supabase'

const CATTLE_TYPES = ['cow', 'calf', 'bull', 'steer', 'heifer', 'weaner', 'other']

function AddAnimalForm({ mobName, onSuccess }) {
  const [mode, setMode] = useState('bulk') // 'bulk' or 'tagged'
  const [cattleType, setCattleType] = useState('cow')
  const [count, setCount] = useState(1)
  const [nlisTag, setNlisTag] = useState('')
  const [managementTag, setManagementTag] = useState('')
  const [breed, setBreed] = useState('')
  const [birthDate, setBirthDate] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)
    setError('')

    if (mode === 'bulk') {
      const { error: rpcErr } = await supabase.rpc('add_animals_bulk', {
        p_mob_name: mobName,
        p_cattle_type: cattleType,
        p_count: count,
        p_breed: breed || null,
        p_birth_date: birthDate || null,
        p_description: description || null,
      })

      if (rpcErr) {
        setError(rpcErr.message)
        setSaving(false)
        return
      }
    } else {
      const { error: rpcErr } = await supabase.rpc('add_animal', {
        p_mob_name: mobName,
        p_cattle_type: cattleType,
        p_nlis_tag: nlisTag || null,
        p_management_tag: managementTag || null,
        p_breed: breed || null,
        p_birth_date: birthDate || null,
        p_description: description || null,
      })

      if (rpcErr) {
        setError(rpcErr.message)
        setSaving(false)
        return
      }
    }

    // Reset form
    setCount(1)
    setNlisTag('')
    setManagementTag('')
    setBreed('')
    setBirthDate('')
    setDescription('')
    setSaving(false)
    onSuccess()
  }

  return (
    <form onSubmit={handleSubmit} className="add-animal-form">
      {error && <div className="error-message">{error}</div>}

      <div className="form-group">
        <label>Add Type</label>
        <div className="radio-group">
          <label>
            <input
              type="radio"
              value="bulk"
              checked={mode === 'bulk'}
              onChange={(e) => setMode(e.target.value)}
            />
            Bulk (untagged)
          </label>
          <label>
            <input
              type="radio"
              value="tagged"
              checked={mode === 'tagged'}
              onChange={(e) => setMode(e.target.value)}
            />
            Individual (with tags)
          </label>
        </div>
      </div>

      <div className="form-group">
        <label>Cattle Type *</label>
        <select value={cattleType} onChange={(e) => setCattleType(e.target.value)} required>
          {CATTLE_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
      </div>

      {mode === 'bulk' ? (
        <div className="form-group">
          <label>Count *</label>
          <input
            type="number"
            min="1"
            value={count}
            onChange={(e) => setCount(parseInt(e.target.value) || 1)}
            required
          />
        </div>
      ) : (
        <>
          <div className="form-group">
            <label>NLIS Tag</label>
            <input
              type="text"
              value={nlisTag}
              onChange={(e) => setNlisTag(e.target.value)}
              placeholder="e.g., 982000123456789"
            />
          </div>
          <div className="form-group">
            <label>Management Tag</label>
            <input
              type="text"
              value={managementTag}
              onChange={(e) => setManagementTag(e.target.value)}
              placeholder="e.g., A123"
            />
          </div>
        </>
      )}

      <div className="form-group">
        <label>Breed</label>
        <input
          type="text"
          value={breed}
          onChange={(e) => setBreed(e.target.value)}
          placeholder="e.g., Angus"
        />
      </div>

      <div className="form-group">
        <label>Birth Date</label>
        <input
          type="date"
          value={birthDate}
          onChange={(e) => setBirthDate(e.target.value)}
        />
      </div>

      <div className="form-group">
        <label>Description</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows="2"
          placeholder="Optional notes"
        />
      </div>

      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? 'Adding...' : mode === 'bulk' ? `Add ${count} Animal(s)` : 'Add Animal'}
        </button>
      </div>
    </form>
  )
}

export default AddAnimalForm
