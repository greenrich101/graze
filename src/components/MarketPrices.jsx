import { Component, useEffect, useState } from 'react'

// Set to true to show raw fetch response inside the Markets card (no DevTools needed)
const DEBUG = import.meta.env.VITE_MARKET_DEBUG === 'true'

class MarketErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { crashed: false, error: null } }
  static getDerivedStateFromError(e) { return { crashed: true, error: e } }
  render() {
    if (this.state.crashed) {
      return (
        <div className="detail-card">
          <h3>Markets</h3>
          <p className="muted">Markets temporarily unavailable.</p>
          {DEBUG && <pre style={{ fontSize: '0.7rem', whiteSpace: 'pre-wrap', marginTop: '0.5rem' }}>
            {this.state.error?.message}
          </pre>}
        </div>
      )
    }
    return this.props.children
  }
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

function fmt(value, decimals = 1) {
  try {
    if (value === null || value === undefined) return '—'
    const n = Number(value)
    if (isNaN(n)) return '—'
    return n.toFixed(decimals)
  } catch { return '—' }
}

function ChangeValue({ pct }) {
  try {
    if (pct === null || pct === undefined || isNaN(Number(pct))) return <span className="detail-value muted">—</span>
    const n = Number(pct)
    const cls = n > 0 ? 'market-change-up' : n < 0 ? 'market-change-down' : ''
    const sign = n > 0 ? '+' : ''
    return <span className={`detail-value ${cls}`}>{sign}{fmt(n)}%</span>
  } catch { return <span className="detail-value muted">—</span> }
}

function cohortLabel(c) {
  try {
    if (!c || !c.category) return 'Unknown'
    const name = c.category.charAt(0).toUpperCase() + c.category.slice(1) + 's'
    if (c.weight_max === null || c.weight_max === undefined) return `${name} ${c.weight_min}kg+`
    return `${name} ${c.weight_min}–${c.weight_max}kg`
  } catch { return 'Unknown' }
}

function SaleyardBlock({ saleyard }) {
  try {
    const sales = Array.isArray(saleyard?.sales) ? saleyard.sales : []
    if (sales.length === 0) {
      return (
        <div className="market-saleyard-block">
          <div className="market-section-label">{saleyard?.label ?? 'Saleyard'}</div>
          <p className="muted">No recent sale data.</p>
        </div>
      )
    }

    const latest = sales[0]
    const avgMap = {}
    const countMap = {}
    sales.forEach(sale => {
      const cohorts = Array.isArray(sale?.cohorts) ? sale.cohorts : []
      cohorts.forEach(c => {
        const key = `${c.category}:${c.weight_min}:${c.weight_max}`
        avgMap[key] = (avgMap[key] || 0) + (c.avg_c_kg || 0)
        countMap[key] = (countMap[key] || 0) + 1
      })
    })

    const cohorts = Array.isArray(latest?.cohorts) ? latest.cohorts : []

    return (
      <div className="market-saleyard-block">
        <div className="market-section-label">
          {saleyard?.label ?? 'Saleyard'}
          <span className="market-section-qualifier">
            {latest?.sale_date ? ` · ${latest.sale_date}` : ''}
            {latest?.total_head ? ` · ${Number(latest.total_head).toLocaleString()} head` : ''}
          </span>
        </div>
        <div className="market-saleyard-header">
          <span>Category</span>
          <span>Avg c/kg</span>
          <span>{sales.length > 1 ? `${sales.length}-sale avg` : '—'}</span>
        </div>
        {cohorts.map((c) => {
          const key = `${c.category}:${c.weight_min}:${c.weight_max}`
          const rollingAvg = countMap[key] > 1 ? avgMap[key] / countMap[key] : null
          return (
            <div key={key} className="market-saleyard-row">
              <span className="market-cat-name">{cohortLabel(c)}</span>
              <span className="market-price">{fmt(c.avg_c_kg)}</span>
              <span className="market-avg muted">{rollingAvg !== null ? fmt(rollingAvg) : '—'}</span>
            </div>
          )
        })}
      </div>
    )
  } catch {
    return (
      <div className="market-saleyard-block">
        <p className="muted">Saleyard data unavailable.</p>
      </div>
    )
  }
}

function MarketPricesInner() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [rawDebug, setRawDebug] = useState(null)

  useEffect(() => {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      setError('Missing configuration')
      setLoading(false)
      return
    }
    async function load() {
      try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/market-prices`, {
          headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
        })
        const text = await res.text().catch(() => '')
        if (DEBUG) setRawDebug({ status: res.status, body: text })
        let json = null
        try { json = JSON.parse(text) } catch { /* not json */ }
        if (!res.ok || !json || typeof json !== 'object') {
          setError(`HTTP ${res.status}`)
          setLoading(false)
          return
        }
        setData(json)
      } catch (e) {
        setError(e?.message ?? 'Unknown error')
        if (DEBUG) setRawDebug({ status: 'fetch failed', body: e?.message })
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  if (!loading && (error || !data)) {
    return (
      <div className="detail-card">
        <h3>Markets</h3>
        <p className="muted">Markets temporarily unavailable.</p>
        {DEBUG && rawDebug && (
          <pre style={{ fontSize: '0.7rem', whiteSpace: 'pre-wrap', marginTop: '0.5rem', background: '#f4f4f4', padding: '0.5rem', borderRadius: '4px' }}>
            {`Status: ${rawDebug.status}\n\n${rawDebug.body}`}
          </pre>
        )}
      </div>
    )
  }

  const fetchedDate = (() => {
    try {
      return data?.fetchedAt
        ? new Date(data.fetchedAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
        : null
    } catch { return null }
  })()

  const saleyards = Array.isArray(data?.saleyards) ? data.saleyards : []

  return (
    <div className="detail-card">
      <h3>Markets</h3>

      {loading && <p className="muted">Loading market prices…</p>}

      {data && (
        <>
          {fetchedDate && (
            <p className="muted" style={{ fontSize: '0.75rem', marginBottom: '0.75rem' }}>
              Updated {fetchedDate} · Source: MLA Statistics API · Prices ¢/kg
            </p>
          )}

          <div className="market-eyci-block">
            <div className="market-section-label">EYCI</div>
            {data.eyci && typeof data.eyci === 'object' ? (
              <>
                <div className="dashboard-stat">
                  <span className="detail-label">Current</span>
                  <span className="detail-value">{fmt(data.eyci.current)} {data.eyci.units ?? ''}</span>
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

          {saleyards.map((sy) => (
            <SaleyardBlock key={sy?.id ?? sy?.label} saleyard={sy} />
          ))}

          {DEBUG && rawDebug && (
            <pre style={{ fontSize: '0.7rem', whiteSpace: 'pre-wrap', marginTop: '1rem', background: '#f4f4f4', padding: '0.5rem', borderRadius: '4px' }}>
              {`Status: ${rawDebug.status}\n\n${rawDebug.body}`}
            </pre>
          )}
        </>
      )}
    </div>
  )
}

export default function MarketPrices() {
  return (
    <MarketErrorBoundary>
      <MarketPricesInner />
    </MarketErrorBoundary>
  )
}
