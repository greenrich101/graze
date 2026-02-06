import { useState } from 'react'
import { supabase } from '../lib/supabase'

function AnimalCSVImport({ mobName, onSuccess }) {
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState([])
  const [errors, setErrors] = useState([])
  const [importing, setImporting] = useState(false)
  const [successCount, setSuccessCount] = useState(0)

  const downloadSample = () => {
    const sampleCSV = `cattle_type,nlis_tag,management_tag,breed,birth_date,description
cow,982000123456789,A101,Angus,2022-01-15,Black cow with white face
calf,,B202,Hereford,2024-06-20,
bull,982000987654321,C303,Charolais,2020-03-10,Breeding bull`

    const blob = new Blob([sampleCSV], { type: 'text/csv' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'sample-animals.csv'
    a.click()
    window.URL.revokeObjectURL(url)
  }

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0]
    if (!selectedFile) return

    setFile(selectedFile)
    const reader = new FileReader()

    reader.onload = (event) => {
      const text = event.target.result
      const rows = text.split('\n').filter((row) => row.trim())
      const headers = rows[0].split(',').map((h) => h.trim().toLowerCase())

      const parsed = rows.slice(1).map((row, index) => {
        const values = row.split(',').map((v) => v.trim())
        const obj = { rowNumber: index + 2 }
        headers.forEach((header, i) => {
          obj[header] = values[i] || ''
        })
        return obj
      })

      // Validate
      const validationErrors = []
      parsed.forEach((row) => {
        if (!row.cattle_type) {
          validationErrors.push(`Row ${row.rowNumber}: cattle_type is required`)
        } else if (!['cow', 'calf', 'bull', 'steer', 'heifer', 'weaner', 'other'].includes(row.cattle_type)) {
          validationErrors.push(`Row ${row.rowNumber}: invalid cattle_type "${row.cattle_type}"`)
        }
      })

      setErrors(validationErrors)
      setPreview(parsed.slice(0, 10)) // Show first 10 rows
    }

    reader.readAsText(selectedFile)
  }

  const handleImport = async () => {
    if (!file || errors.length > 0) return

    setImporting(true)
    setSuccessCount(0)

    const reader = new FileReader()
    reader.onload = async (event) => {
      const text = event.target.result
      const rows = text.split('\n').filter((row) => row.trim())
      const headers = rows[0].split(',').map((h) => h.trim().toLowerCase())

      const parsed = rows.slice(1).map((row) => {
        const values = row.split(',').map((v) => v.trim())
        const obj = {}
        headers.forEach((header, i) => {
          obj[header] = values[i] || ''
        })
        return obj
      })

      let count = 0
      for (const row of parsed) {
        const { error } = await supabase.rpc('add_animal', {
          p_mob_name: mobName,
          p_cattle_type: row.cattle_type,
          p_nlis_tag: row.nlis_tag || null,
          p_management_tag: row.management_tag || null,
          p_breed: row.breed || null,
          p_birth_date: row.birth_date || null,
          p_description: row.description || null,
        })

        if (!error) {
          count++
        }
      }

      setSuccessCount(count)
      setImporting(false)

      if (count === parsed.length) {
        setTimeout(() => {
          onSuccess()
        }, 1500)
      }
    }

    reader.readAsText(file)
  }

  return (
    <div className="csv-import-container">
      <h3>Import Animals from CSV</h3>
      <p className="muted" style={{ marginBottom: '1rem', fontSize: '0.875rem' }}>
        Upload a CSV file with columns: cattle_type (required), nlis_tag, management_tag, breed,
        birth_date, description
      </p>

      <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginBottom: '1rem' }}>
        <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
          <input type="file" accept=".csv" onChange={handleFileChange} />
        </div>
        <button className="btn btn-secondary btn-sm" onClick={downloadSample}>
          Download Sample
        </button>
      </div>

      {errors.length > 0 && (
        <div className="error-message">
          <strong>Validation Errors:</strong>
          <ul style={{ marginTop: '0.5rem', paddingLeft: '1.5rem' }}>
            {errors.map((err, i) => (
              <li key={i}>{err}</li>
            ))}
          </ul>
        </div>
      )}

      {preview.length > 0 && errors.length === 0 && (
        <div style={{ marginTop: '1rem' }}>
          <p style={{ fontWeight: 600, marginBottom: '0.5rem' }}>
            Preview (first 10 rows):
          </p>
          <table className="csv-preview-table">
            <thead>
              <tr>
                <th>Type</th>
                <th>NLIS Tag</th>
                <th>Mgmt Tag</th>
                <th>Breed</th>
                <th>Birth Date</th>
              </tr>
            </thead>
            <tbody>
              {preview.map((row, i) => (
                <tr key={i}>
                  <td>{row.cattle_type}</td>
                  <td>{row.nlis_tag || '—'}</td>
                  <td>{row.management_tag || '—'}</td>
                  <td>{row.breed || '—'}</td>
                  <td>{row.birth_date || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {successCount > 0 && (
        <div className="success-message">
          Successfully imported {successCount} animal(s)!
        </div>
      )}

      <div className="form-actions">
        <button
          className="btn btn-primary"
          onClick={handleImport}
          disabled={!file || errors.length > 0 || importing}
        >
          {importing ? 'Importing...' : 'Import'}
        </button>
      </div>
    </div>
  )
}

export default AnimalCSVImport
