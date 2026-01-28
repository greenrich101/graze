import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import PaddockForm from '../components/PaddockForm'

function Paddocks() {
  const { user } = useAuth()
  const [paddocks, setPaddocks] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editingPaddock, setEditingPaddock] = useState(null)
  const [showForm, setShowForm] = useState(false)

  useEffect(() => {
    fetchPaddocks()
  }, [])

  const fetchPaddocks = async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('paddocks')
      .select('*')
      .order('created_at', { ascending: false })

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
      .insert([{ ...paddock, user_id: user.id }])
      .select()

    if (error) {
      setError(error.message)
      return false
    }

    setPaddocks([data[0], ...paddocks])
    setShowForm(false)
    return true
  }

  const handleUpdate = async (paddock) => {
    const { data, error } = await supabase
      .from('paddocks')
      .update({ name: paddock.name, acres: paddock.acres })
      .eq('id', paddock.id)
      .select()

    if (error) {
      setError(error.message)
      return false
    }

    setPaddocks(paddocks.map((p) => (p.id === paddock.id ? data[0] : p)))
    setEditingPaddock(null)
    return true
  }

  const handleDelete = async (id) => {
    if (!confirm('Are you sure you want to delete this paddock?')) {
      return
    }

    const { error } = await supabase
      .from('paddocks')
      .delete()
      .eq('id', id)

    if (error) {
      setError(error.message)
      return
    }

    setPaddocks(paddocks.filter((p) => p.id !== id))
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
            <div key={paddock.id} className="paddock-card">
              <div className="paddock-info">
                <h3>{paddock.name}</h3>
                <p>{paddock.acres} acres</p>
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
                  onClick={() => handleDelete(paddock.id)}
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
