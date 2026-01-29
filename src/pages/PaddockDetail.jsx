import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useProperty } from '../contexts/PropertyContext'
import MovementList from '../components/MovementList'

function PaddockDetail() {
  const { paddockName } = useParams()
  const decodedName = decodeURIComponent(paddockName)
  const { propertyId } = useProperty()
  const [paddock, setPaddock] = useState(null)
  const [movements, setMovements] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!propertyId) return
    fetchData()
  }, [decodedName, propertyId])

  const fetchData = async () => {
    setLoading(true)

    const { data: paddockData, error: paddockErr } = await supabase
      .from('paddocks')
      .select('*')
      .eq('name', decodedName)
      .eq('property_id', propertyId)
      .single()

    if (paddockErr) {
      setError('Paddock not found.')
      setLoading(false)
      return
    }

    setPaddock(paddockData)

    const { data: moveData } = await supabase
      .from('movements')
      .select('*, movement_requirements(*, requirement_types(name))')
      .eq('paddock_name', decodedName)
      .order('actual_move_in_date', { ascending: false })

    setMovements(moveData || [])
    setLoading(false)
  }

  if (loading) {
    return <div className="loading">Loading paddock...</div>
  }

  if (!paddock) {
    return <div className="error-message">{error || 'Paddock not found.'}</div>
  }

  // Current occupant (open movement)
  const currentMove = movements.find((m) => !m.actual_move_out_date)

  return (
    <div className="paddock-detail-page">
      <div className="page-header">
        <h2>{paddock.name}</h2>
      </div>

      <div className="detail-card">
        <h3>Info</h3>
        <div className="detail-grid">
          <div className="detail-item">
            <span className="detail-label">Size</span>
            <span className="detail-value">{paddock.area_acres} acres</span>
          </div>
          <div className="detail-item">
            <span className="detail-label">Current mob</span>
            <span className="detail-value">
              {currentMove ? (
                <Link to={`/mobs/${encodeURIComponent(currentMove.mob_name)}`}>
                  {currentMove.mob_name}
                </Link>
              ) : 'Empty'}
            </span>
          </div>
          {currentMove && (
            <div className="detail-item">
              <span className="detail-label">Since</span>
              <span className="detail-value">{currentMove.actual_move_in_date}</span>
            </div>
          )}
        </div>
      </div>

      <div className="detail-card">
        <h3>Movement History</h3>
        <MovementList movements={movements} showMob />
      </div>
    </div>
  )
}

export default PaddockDetail
