import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useProperty } from '../contexts/PropertyContext'
import PaddockForm from '../components/PaddockForm'

function Paddocks() {
  const { propertyId } = useProperty()
  const [paddocks, setPaddocks] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editingPaddock, setEditingPaddock] = useState(null)
  const [showForm, setShowForm] = useState(false)

  useEffect(() => {
    fetchPaddocks()
  }, [propertyId])

  const fetchPaddocks = async () => {
    if (!propertyId) return
    setLoading(true)
    const { data, error } = await supabase
      .from('paddocks')
      .select('*')
      .eq('property_id', propertyId)
      .order('name')

    if (error) {
      setError(error.message)
    } else {
      setPaddocks(data || [])
    }
    setLoading(false)
  }

  const handleCreate = async (paddock) => {
    const { data, error } = await supabase
      .from('paddocks')
      .insert([{ name: paddock.name, area_acres: paddock.area_acres, property_id: propertyId }])
      .select()

    if (error) {
      setError(error.message)
      return false
    }

    setPaddocks([...paddocks, data[0]].sort((a, b) => a.name.localeCompare(b.name)))
    setShowForm(false)
    return true
  }

  const handleUpdate = async (paddock) => {
    const { data, error } = await supabase
      .from('paddocks')
      .update({ name: paddock.name, area_acres: paddock.area_acres })
      .eq('name', paddock.originalName)
      .select()

    if (error) {
      setError(error.message)
      return false
    }

    setPaddocks(
      paddocks.map((p) => (p.name === paddock.originalName ? data[0] : p))
        .sort((a, b) => a.name.localeCompare(b.name))
    )
    setEditingPaddock(null)
    return true
  }

  const handleDelete = async (name) => {
    if (!confirm('Are you sure you want to delete this paddock?')) {
      return
    }

    const { error } = await supabase
      .from('paddocks')
      .delete()
      .eq('name', name)

    if (error) {
      setError(error.message)
      return
    }

    setPaddocks(paddocks.filter((p) => p.name !== name))
  }

  if (loading) {
    return <div className="loading">Loading paddocks...</div>
  }

  return (
    <div className="paddocks-page">
      <div className="page-header">
        <h2>Paddocks</h2>
        <button
          className="btn btn-primary"
          onClick={() => {
            setShowForm(true)
            setEditingPaddock(null)
          }}
        >
          Add Paddock
        </button>
      </div>

      {error && <div className="error-message">{error}</div>}

      {(showForm || editingPaddock) && (
        <PaddockForm
          paddock={editingPaddock}
          onSubmit={editingPaddock ? handleUpdate : handleCreate}
          onCancel={() => {
            setShowForm(false)
            setEditingPaddock(null)
          }}
        />
      )}

      {paddocks.length === 0 ? (
        <p className="empty-state">No paddocks yet. Add your first paddock!</p>
      ) : (
        <div className="paddocks-list">
          {paddocks.map((paddock) => (
            <div key={paddock.name} className="paddock-card">
              <div className="paddock-info">
                <h3><Link to={`/paddocks/${encodeURIComponent(paddock.name)}`}>{paddock.name}</Link></h3>
                <p>{paddock.area_acres} acres</p>
              </div>
              <div className="paddock-actions">
                <button
                  className="btn btn-secondary"
                  onClick={() => setEditingPaddock(paddock)}
                >
                  Edit
                </button>
                <button
                  className="btn btn-danger"
                  onClick={() => handleDelete(paddock.name)}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default Paddocks
