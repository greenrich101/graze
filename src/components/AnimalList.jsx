import { useState } from 'react'
import { supabase } from '../lib/supabase'

const CATTLE_TYPES = ['cow', 'calf', 'bull', 'steer', 'heifer', 'weaner', 'other']
const TREATMENT_TYPES = ['5-in-1', 'B12', 'Fly', 'Lice', 'Worm', 'Anti-venom', 'Penicillin', 'Foot', 'Eye']

function AnimalList({ animals, onRefresh, isHand }) {
  const [editingTag, setEditingTag] = useState(null)
  const [editingAnimal, setEditingAnimal] = useState(null)
  const [nlisTag, setNlisTag] = useState('')
  const [managementTag, setManagementTag] = useState('')
  const [editForm, setEditForm] = useState({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [loggingTreatment, setLoggingTreatment] = useState(null)
  const [treatmentForm, setTreatmentForm] = useState({
    selectedTreatments: {},
    treatment_date: new Date().toISOString().split('T')[0],
    notes: '',
  })

  const handleAddTag = async (animalId) => {
    setSaving(true)
    setError('')

    const { error: rpcErr } = await supabase.rpc('tag_animal', {
      p_animal_id: animalId,
      p_nlis_tag: nlisTag || null,
      p_management_tag: managementTag || null,
    })

    if (rpcErr) {
      setError(rpcErr.message)
      setSaving(false)
      return
    }

    setEditingTag(null)
    setNlisTag('')
    setManagementTag('')
    setSaving(false)
    onRefresh()
  }

  const startEdit = (animal) => {
    setEditingAnimal(animal.id)
    setEditForm({
      cattle_type: animal.cattle_type,
      nlis_tag: animal.nlis_tag || '',
      management_tag: animal.management_tag || '',
      breed: animal.breed || '',
      birth_date: animal.birth_date || '',
      description: animal.description || '',
    })
  }

  const cancelEdit = () => {
    setEditingAnimal(null)
    setEditForm({})
  }

  const handleEdit = async (animalId) => {
    setSaving(true)
    setError('')

    const { error: updateErr } = await supabase
      .from('animals')
      .update({
        cattle_type: editForm.cattle_type,
        nlis_tag: editForm.nlis_tag || null,
        management_tag: editForm.management_tag || null,
        breed: editForm.breed || null,
        birth_date: editForm.birth_date || null,
        description: editForm.description || null,
      })
      .eq('id', animalId)

    if (updateErr) {
      setError(updateErr.message)
      setSaving(false)
      return
    }

    const mobName = animals[0]?.mob_name
    if (mobName) await supabase.rpc('sync_mob_composition', { p_mob_name: mobName })

    setEditingAnimal(null)
    setEditForm({})
    setSaving(false)
    onRefresh()
  }

  const handleDelete = async (animalId) => {
    if (!confirm('Delete this animal? This cannot be undone.')) return

    const animal = animals.find((a) => a.id === animalId)
    const { error: deleteErr } = await supabase
      .from('animals')
      .delete()
      .eq('id', animalId)

    if (deleteErr) {
      setError(deleteErr.message)
      return
    }

    if (animal?.mob_name) await supabase.rpc('sync_mob_composition', { p_mob_name: animal.mob_name })

    onRefresh()
  }

  const startTreatmentLog = (animal) => {
    setLoggingTreatment(animal.id)
    setTreatmentForm({
      selectedTreatments: {},
      treatment_date: new Date().toISOString().split('T')[0],
      notes: '',
    })
  }

  const cancelTreatmentLog = () => {
    setLoggingTreatment(null)
    setTreatmentForm({
      selectedTreatments: {},
      treatment_date: new Date().toISOString().split('T')[0],
      notes: '',
    })
  }

  const toggleTreatment = (type) => {
    setTreatmentForm((prev) => ({
      ...prev,
      selectedTreatments: {
        ...prev.selectedTreatments,
        [type]: !prev.selectedTreatments[type],
      },
    }))
  }

  const handleLogTreatment = async (animalId) => {
    const selected = Object.entries(treatmentForm.selectedTreatments)
      .filter(([, checked]) => checked)
      .map(([type]) => type)

    if (selected.length === 0) {
      setError('Please select at least one treatment.')
      return
    }

    setSaving(true)
    setError('')

    for (const treatment of selected) {
      const { error: rpcErr } = await supabase.rpc('log_animal_treatment', {
        p_animal_id: animalId,
        p_treatment_type: treatment,
        p_treatment_date: treatmentForm.treatment_date,
        p_notes: treatmentForm.notes || null,
      })

      if (rpcErr) {
        setError(rpcErr.message)
        setSaving(false)
        return
      }
    }

    setLoggingTreatment(null)
    setTreatmentForm({
      selectedTreatments: {},
      treatment_date: new Date().toISOString().split('T')[0],
      notes: '',
    })
    setSaving(false)
    onRefresh()
  }

  const grouped = animals.reduce((acc, animal) => {
    if (!acc[animal.cattle_type]) {
      acc[animal.cattle_type] = { tagged: [], untagged: [] }
    }
    if (animal.nlis_tag || animal.management_tag) {
      acc[animal.cattle_type].tagged.push(animal)
    } else {
      acc[animal.cattle_type].untagged.push(animal)
    }
    return acc
  }, {})

  return (
    <div className="animal-list">
      {error && <div className="error-message">{error}</div>}
      {Object.entries(grouped).map(([type, { tagged, untagged }]) => (
        <div key={type} className="animal-type-group">
          <h4>{type} ({tagged.length + untagged.length})</h4>

          {tagged.length > 0 && (
            <div className="animal-subgroup">
              <div className="animal-subgroup-header">Tagged ({tagged.length})</div>
              <div className="animal-cards">
                {tagged.map((animal) => (
                  <div key={animal.id} className="animal-card">
                    {editingAnimal === animal.id ? (
                      <div className="animal-edit-form">
                        <div className="form-group" style={{ marginBottom: '0.5rem' }}>
                          <select
                            value={editForm.cattle_type}
                            onChange={(e) => setEditForm({ ...editForm, cattle_type: e.target.value })}
                            disabled={saving}
                          >
                            {CATTLE_TYPES.map((t) => (
                              <option key={t} value={t}>{t}</option>
                            ))}
                          </select>
                        </div>
                        <input
                          type="text"
                          placeholder="NLIS tag"
                          value={editForm.nlis_tag}
                          onChange={(e) => setEditForm({ ...editForm, nlis_tag: e.target.value })}
                          disabled={saving}
                          style={{ marginBottom: '0.35rem', padding: '0.35rem 0.5rem', fontSize: '0.8rem' }}
                        />
                        <input
                          type="text"
                          placeholder="Management tag"
                          value={editForm.management_tag}
                          onChange={(e) => setEditForm({ ...editForm, management_tag: e.target.value })}
                          disabled={saving}
                          style={{ marginBottom: '0.35rem', padding: '0.35rem 0.5rem', fontSize: '0.8rem' }}
                        />
                        <input
                          type="text"
                          placeholder="Breed"
                          value={editForm.breed}
                          onChange={(e) => setEditForm({ ...editForm, breed: e.target.value })}
                          disabled={saving}
                          style={{ marginBottom: '0.35rem', padding: '0.35rem 0.5rem', fontSize: '0.8rem' }}
                        />
                        <input
                          type="date"
                          value={editForm.birth_date}
                          onChange={(e) => setEditForm({ ...editForm, birth_date: e.target.value })}
                          disabled={saving}
                          style={{ marginBottom: '0.35rem', padding: '0.35rem 0.5rem', fontSize: '0.8rem' }}
                        />
                        <div className="form-actions">
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={cancelEdit}
                            disabled={saving}
                          >
                            Cancel
                          </button>
                          <button
                            className="btn btn-primary btn-sm"
                            onClick={() => handleEdit(animal.id)}
                            disabled={saving}
                          >
                            {saving ? 'Saving...' : 'Save'}
                          </button>
                        </div>
                      </div>
                    ) : loggingTreatment === animal.id ? (
                      <div className="animal-treatment-form">
                        <label style={{ fontSize: '0.85rem', display: 'block', marginBottom: '0.35rem' }}>
                          Treatments
                        </label>
                        <div className="requirements-selector">
                          {TREATMENT_TYPES.map((t) => (
                            <div key={t} className="req-check-row">
                              <label className="req-check-label">
                                <input
                                  type="checkbox"
                                  checked={!!treatmentForm.selectedTreatments[t]}
                                  onChange={() => toggleTreatment(t)}
                                  disabled={saving}
                                />
                                {t}
                              </label>
                            </div>
                          ))}
                        </div>
                        <div className="form-group" style={{ marginBottom: '0.5rem' }}>
                          <label style={{ fontSize: '0.85rem', display: 'block', marginBottom: '0.25rem' }}>
                            Treatment Date
                          </label>
                          <input
                            type="date"
                            value={treatmentForm.treatment_date}
                            onChange={(e) => setTreatmentForm({ ...treatmentForm, treatment_date: e.target.value })}
                            disabled={saving}
                            style={{ width: '100%', padding: '0.35rem 0.5rem', fontSize: '0.8rem' }}
                          />
                        </div>
                        <div className="form-group" style={{ marginBottom: '0.5rem' }}>
                          <label style={{ fontSize: '0.85rem', display: 'block', marginBottom: '0.25rem' }}>
                            Notes (optional)
                          </label>
                          <textarea
                            value={treatmentForm.notes}
                            onChange={(e) => setTreatmentForm({ ...treatmentForm, notes: e.target.value })}
                            disabled={saving}
                            rows="2"
                            style={{ width: '100%', padding: '0.35rem 0.5rem', fontSize: '0.8rem' }}
                            placeholder="Optional notes"
                          />
                        </div>
                        <div className="form-actions">
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={cancelTreatmentLog}
                            disabled={saving}
                          >
                            Cancel
                          </button>
                          <button
                            className="btn btn-primary btn-sm"
                            onClick={() => handleLogTreatment(animal.id)}
                            disabled={saving}
                          >
                            {saving ? 'Logging...' : 'Log Treatment'}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        {animal.management_tag && (
                          <div className="animal-tag mgmt">Mgt Tag: {animal.management_tag}</div>
                        )}
                        {animal.nlis_tag && (
                          <div className="animal-tag nlis">NLIS: {animal.nlis_tag}</div>
                        )}
                        {animal.breed && <div className="animal-detail">Breed: {animal.breed}</div>}
                        {animal.birth_date && (
                          <div className="animal-detail">
                            Born: {new Date(animal.birth_date).toLocaleDateString()}
                          </div>
                        )}
                        {animal.description && (
                          <div className="animal-detail">{animal.description}</div>
                        )}
                        {!isHand && (
                          <div className="animal-actions">
                            <button
                              className="btn btn-secondary btn-sm"
                              onClick={() => startEdit(animal)}
                            >
                              Edit
                            </button>
                            <button
                              className="btn btn-secondary btn-sm"
                              onClick={() => startTreatmentLog(animal)}
                            >
                              Log Treatment
                            </button>
                            <button
                              className="btn btn-danger btn-sm"
                              onClick={() => handleDelete(animal.id)}
                            >
                              Delete
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {untagged.length > 0 && (
            <div className="animal-subgroup">
              <div className="animal-subgroup-header">
                Untagged ({untagged.length})
              </div>
              <div className="animal-cards">
                {untagged.slice(0, 5).map((animal) => (
                  <div key={animal.id} className="animal-card untagged">
                    {editingAnimal === animal.id ? (
                      <div className="animal-edit-form">
                        <div className="form-group" style={{ marginBottom: '0.5rem' }}>
                          <select
                            value={editForm.cattle_type}
                            onChange={(e) => setEditForm({ ...editForm, cattle_type: e.target.value })}
                            disabled={saving}
                          >
                            {CATTLE_TYPES.map((t) => (
                              <option key={t} value={t}>{t}</option>
                            ))}
                          </select>
                        </div>
                        <input
                          type="text"
                          placeholder="NLIS tag"
                          value={editForm.nlis_tag}
                          onChange={(e) => setEditForm({ ...editForm, nlis_tag: e.target.value })}
                          disabled={saving}
                          style={{ marginBottom: '0.35rem', padding: '0.35rem 0.5rem', fontSize: '0.8rem' }}
                        />
                        <input
                          type="text"
                          placeholder="Management tag"
                          value={editForm.management_tag}
                          onChange={(e) => setEditForm({ ...editForm, management_tag: e.target.value })}
                          disabled={saving}
                          style={{ marginBottom: '0.35rem', padding: '0.35rem 0.5rem', fontSize: '0.8rem' }}
                        />
                        <input
                          type="text"
                          placeholder="Breed"
                          value={editForm.breed}
                          onChange={(e) => setEditForm({ ...editForm, breed: e.target.value })}
                          disabled={saving}
                          style={{ marginBottom: '0.35rem', padding: '0.35rem 0.5rem', fontSize: '0.8rem' }}
                        />
                        <input
                          type="date"
                          value={editForm.birth_date}
                          onChange={(e) => setEditForm({ ...editForm, birth_date: e.target.value })}
                          disabled={saving}
                          style={{ marginBottom: '0.35rem', padding: '0.35rem 0.5rem', fontSize: '0.8rem' }}
                        />
                        <div className="form-actions">
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={cancelEdit}
                            disabled={saving}
                          >
                            Cancel
                          </button>
                          <button
                            className="btn btn-primary btn-sm"
                            onClick={() => handleEdit(animal.id)}
                            disabled={saving}
                          >
                            {saving ? 'Saving...' : 'Save'}
                          </button>
                        </div>
                      </div>
                    ) : loggingTreatment === animal.id ? (
                      <div className="animal-treatment-form">
                        <label style={{ fontSize: '0.85rem', display: 'block', marginBottom: '0.35rem' }}>
                          Treatments
                        </label>
                        <div className="requirements-selector">
                          {TREATMENT_TYPES.map((t) => (
                            <div key={t} className="req-check-row">
                              <label className="req-check-label">
                                <input
                                  type="checkbox"
                                  checked={!!treatmentForm.selectedTreatments[t]}
                                  onChange={() => toggleTreatment(t)}
                                  disabled={saving}
                                />
                                {t}
                              </label>
                            </div>
                          ))}
                        </div>
                        <div className="form-group" style={{ marginBottom: '0.5rem' }}>
                          <label style={{ fontSize: '0.85rem', display: 'block', marginBottom: '0.25rem' }}>
                            Treatment Date
                          </label>
                          <input
                            type="date"
                            value={treatmentForm.treatment_date}
                            onChange={(e) => setTreatmentForm({ ...treatmentForm, treatment_date: e.target.value })}
                            disabled={saving}
                            style={{ width: '100%', padding: '0.35rem 0.5rem', fontSize: '0.8rem' }}
                          />
                        </div>
                        <div className="form-group" style={{ marginBottom: '0.5rem' }}>
                          <label style={{ fontSize: '0.85rem', display: 'block', marginBottom: '0.25rem' }}>
                            Notes (optional)
                          </label>
                          <textarea
                            value={treatmentForm.notes}
                            onChange={(e) => setTreatmentForm({ ...treatmentForm, notes: e.target.value })}
                            disabled={saving}
                            rows="2"
                            style={{ width: '100%', padding: '0.35rem 0.5rem', fontSize: '0.8rem' }}
                            placeholder="Optional notes"
                          />
                        </div>
                        <div className="form-actions">
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={cancelTreatmentLog}
                            disabled={saving}
                          >
                            Cancel
                          </button>
                          <button
                            className="btn btn-primary btn-sm"
                            onClick={() => handleLogTreatment(animal.id)}
                            disabled={saving}
                          >
                            {saving ? 'Logging...' : 'Log Treatment'}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        {animal.breed && <div className="animal-detail">Breed: {animal.breed}</div>}
                        {animal.birth_date && (
                          <div className="animal-detail">
                            Born: {new Date(animal.birth_date).toLocaleDateString()}
                          </div>
                        )}
                        {!isHand && (
                          <div className="animal-actions">
                            <button
                              className="btn btn-secondary btn-sm"
                              onClick={() => startEdit(animal)}
                            >
                              Edit
                            </button>
                            <button
                              className="btn btn-secondary btn-sm"
                              onClick={() => startTreatmentLog(animal)}
                            >
                              Log Treatment
                            </button>
                            <button
                              className="btn btn-danger btn-sm"
                              onClick={() => handleDelete(animal.id)}
                            >
                              Delete
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                ))}
                {untagged.length > 5 && (
                  <div className="animal-card muted">
                    + {untagged.length - 5} more untagged {type}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

export default AnimalList
