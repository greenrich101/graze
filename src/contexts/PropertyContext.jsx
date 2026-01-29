import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './AuthContext'

const PropertyContext = createContext({})

export function PropertyProvider({ children }) {
  const { user } = useAuth()
  const [propertyId, setPropertyId] = useState(null)
  const [propertyName, setPropertyName] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) {
      setPropertyId(null)
      setPropertyName('')
      setLoading(false)
      return
    }
    resolveProperty()
  }, [user])

  const resolveProperty = async () => {
    setLoading(true)

    // Check for existing membership
    const { data: memberships, error: fetchErr } = await supabase
      .from('user_properties')
      .select('property_id, properties(id, name)')
      .eq('user_id', user.id)
      .limit(1)

    if (fetchErr) {
      console.error('Failed to fetch property:', fetchErr.message)
      setLoading(false)
      return
    }

    if (memberships && memberships.length > 0) {
      const prop = memberships[0].properties
      setPropertyId(prop.id)
      setPropertyName(prop.name)
      setLoading(false)
      return
    }

    // No property — auto-create one
    const { data: newProp, error: createErr } = await supabase
      .from('properties')
      .insert([{ name: 'My Property' }])
      .select()
      .single()

    if (createErr) {
      console.error('Failed to create property:', createErr.message)
      setLoading(false)
      return
    }

    const { error: linkErr } = await supabase
      .from('user_properties')
      .insert([{ user_id: user.id, property_id: newProp.id }])

    if (linkErr) {
      console.error('Failed to link property:', linkErr.message)
      setLoading(false)
      return
    }

    setPropertyId(newProp.id)
    setPropertyName(newProp.name)
    setLoading(false)
  }

  const value = { propertyId, propertyName, loading }

  return (
    <PropertyContext.Provider value={value}>
      {children}
    </PropertyContext.Provider>
  )
}

export function useProperty() {
  const context = useContext(PropertyContext)
  if (context === undefined) {
    throw new Error('useProperty must be used within a PropertyProvider')
  }
  return context
}
