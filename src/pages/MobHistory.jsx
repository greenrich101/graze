import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import MovementList from '../components/MovementList'

function MobHistory() {
  const { mobName } = useParams()
  const decodedName = decodeURIComponent(mobName)
  const [movements, setMovements] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase
      .from('movements')
      .select('*, movement_requirements(*, requirement_types(name))')
      .eq('mob_name', decodedName)
      .order('actual_move_in_date', { ascending: false })
      .then(({ data }) => {
        setMovements(data || [])
        setLoading(false)
      })
  }, [decodedName])

  if (loading) {
    return <div className="loading">Loading history...</div>
  }

  return (
    <div className="history-page">
      <div className="page-header">
        <h2>
          <Link to={`/mobs/${encodeURIComponent(decodedName)}`}>{decodedName}</Link> — History
        </h2>
      </div>
      <MovementList movements={movements} />
    </div>
  )
}

export default MobHistory
