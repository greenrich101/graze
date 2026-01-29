import { useState, useRef } from 'react'

function CsvImport({ onImport, onCancel }) {
  const [rows, setRows] = useState([])
  const [errors, setErrors] = useState([])
  const [fileName, setFileName] = useState('')
  const fileRef = useRef()

  const parseFile = (file) => {
    setFileName(file.name)
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target.result
      const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '')

      if (lines.length < 2) {
        setErrors([{ line: 0, message: 'CSV must have a header row and at least one data row' }])
        setRows([])
        return
      }

      const parsed = []
      const errs = []

      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',').map((c) => c.trim())
        const name = cols[0] || ''
        const areaRaw = cols[1] || ''

        if (!name) {
          errs.push({ line: i + 1, message: 'Missing paddock name' })
          parsed.push({ name: '', area_acres: null, error: 'Missing paddock name' })
          continue
        }

        let area = null
        if (areaRaw !== '') {
          area = parseFloat(areaRaw)
          if (isNaN(area) || area < 0) {
            errs.push({ line: i + 1, message: `Invalid area: "${areaRaw}"` })
            parsed.push({ name, area_acres: null, error: `Invalid area: "${areaRaw}"` })
            continue
          }
        }

        parsed.push({ name, area_acres: area, error: null })
      }

      setRows(parsed)
      setErrors(errs)
    }
    reader.readAsText(file)
  }

  const handleFileChange = (e) => {
    const file = e.target.files[0]
    if (file) parseFile(file)
  }

  const validRows = rows.filter((r) => !r.error)

  const handleImport = () => {
    onImport(validRows.map(({ name, area_acres }) => ({ name, area_acres })))
  }

  return (
    <div className="csv-import-container">
      <h3>Import Paddocks from CSV</h3>
      <p className="muted" style={{ marginBottom: '1rem' }}>
        CSV format: <code>name,area_acres</code> (first row is a header)
      </p>

      <input
        ref={fileRef}
        type="file"
        accept=".csv"
        onChange={handleFileChange}
        style={{ marginBottom: '1rem' }}
      />

      {rows.length > 0 && (
        <>
          <p style={{ marginBottom: '0.5rem' }}>
            <strong>{fileName}</strong> — {validRows.length} valid row{validRows.length !== 1 ? 's' : ''}
            {errors.length > 0 && <>, {errors.length} error{errors.length !== 1 ? 's' : ''}</>}
          </p>
          <table className="csv-preview-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Name</th>
                <th>Area (acres)</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className={row.error ? 'csv-error-row' : ''}>
                  <td>{i + 1}</td>
                  <td>{row.name || '—'}</td>
                  <td>{row.area_acres != null ? row.area_acres : '—'}</td>
                  <td>{row.error || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <div className="form-actions">
        <button className="btn btn-secondary" onClick={onCancel}>
          Cancel
        </button>
        <button
          className="btn btn-primary"
          disabled={validRows.length === 0}
          onClick={handleImport}
        >
          Import {validRows.length > 0 ? `${validRows.length} Paddock${validRows.length !== 1 ? 's' : ''}` : ''}
        </button>
      </div>
    </div>
  )
}

export default CsvImport
