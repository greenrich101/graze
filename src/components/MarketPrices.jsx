import { useEffect, useState } from 'react'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

function fmt(value, decimals = 1) {
  if (value === null || value === undefined) return '—'
  return Number(value).toFixed(decimals)
}


function ChangeValue({ pct }) {
  if (pct === null || pct === undefined || isNaN(pct)) return <span className="detail-value muted">—</span>
  const cls = pct > 0 ? 'market-change-up' : pct < 0 ? 'market-change-down' : ''
  const sign = pct > 0 ? '+' : ''
  return <span className={`detail-value ${cls}`}>{sign}{fmt(pct)}%</span>
}

function fmtHead(value) {
  if (value === null || value === undefined) return '—'
  return Number(value).toLocaleString()
}

function SaleyardBlock({ saleyard }) {
  return (
    <div className="market-saleyard-block">
      <div className="market-section-label">{saleyard.label} <span className="market-section-qualifier">national indicator, {saleyard.label.split(' ')[0]}-weighted</span></div>
      <div className="market-saleyard-header">
        <span>Category</span>
        <span>Current ({saleyard.units})</span>
        <span>4wk avg</span>
        <span>Head contrib.</span>
      </div>
      {saleyard.categories.map((cat) => (
        <div key={cat.label} className="market-saleyard-row">
          <span className="market-cat-name">{cat.label}</span>
          <span className="market-price">{fmt(cat.currentWeek)}</span>
          <span className="market-avg muted">{fmt(cat.avg4w)}</span>
          <span className="market-head muted">{fmtHead(cat.headThisWeek)}</span>
        </div>
      ))}
    </div>
  )
}

export default function MarketPrices() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/market-prices`, {
          headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        setData(await res.json())
      } catch (e) {
        setError(e.message)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const fetchedDate = data?.fetchedAt
    ? new Date(data.fetchedAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
    : null

  return (
    <div className="detail-card">
      <h3>Markets</h3>

      {loading && <p className="muted">Loading market prices…</p>}

      {error && (
        <p className="muted" style={{ color: 'var(--danger)' }}>
          Unable to load market data. ({error})
        </p>
      )}

      {data && (
        <>
          {fetchedDate && (
            <p className="muted" style={{ fontSize: '0.75rem', marginBottom: '0.75rem' }}>
              Updated {fetchedDate} · Source: MLA Statistics API · Prices ¢/kg
            </p>
          )}

          {/* EYCI */}
          <div className="market-eyci-block">
            <div className="market-section-label">EYCI</div>
            {data.eyci ? (
              <>
                <div className="dashboard-stat">
                  <span className="detail-label">Current</span>
                  <span className="detail-value">{fmt(data.eyci.current)} {data.eyci.units}</span>
                </div>
                <div className="dashboard-stat">
                  <span className="detail-label">Week change</span>
                  <ChangeValue pct={data.eyci.weekChangePct} />
                </div>
                <div className="dashboard-stat">
                  <span className="detail-label">4-week change</span>
                  <ChangeValue pct={data.eyci.trend4w} />
                </div>
              </>
            ) : (
              <p className="muted">No EYCI data available.</p>
            )}
          </div>

          {/* Saleyard tables */}
          {(data.saleyards || []).map((sy) => (
            <SaleyardBlock key={sy.id} saleyard={sy} />
          ))}
        </>
      )}
    </div>
  )
}
