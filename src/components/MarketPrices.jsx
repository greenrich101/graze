import { Component, useEffect, useState } from 'react'

class MarketErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { crashed: false } }
  static getDerivedStateFromError() { return { crashed: true } }
  componentDidCatch(e) { console.log('[MarketPrices] render error:', e) }
  render() {
    if (this.state.crashed) {
      return (
        <div className="detail-card">
          <h3>Markets</h3>
          <p className="muted">Markets data unavailable.</p>
        </div>
      )
    }
    return this.props.children
  }
}

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


function cohortLabel(c) {
  if (!c?.category) return 'Unknown'
  const name = c.category.charAt(0).toUpperCase() + c.category.slice(1) + 's'
  if (c.weight_max === null) return `${name} ${c.weight_min}kg+`
  return `${name} ${c.weight_min}–${c.weight_max}kg`
}

function SaleyardBlock({ saleyard }) {
  const sales = saleyard.sales ?? []
  if (sales.length === 0) {
    return (
      <div className="market-saleyard-block">
        <div className="market-section-label">{saleyard.label}</div>
        <p className="muted">No recent sale data.</p>
      </div>
    )
  }

  const latest = sales[0]

  // Rolling average across all available sales per cohort
  const avgMap = {}
  const countMap = {}
  sales.forEach(sale => {
    (sale.cohorts ?? []).forEach(c => {
      const key = `${c.category}:${c.weight_min}:${c.weight_max}`
      avgMap[key] = (avgMap[key] || 0) + c.avg_c_kg
      countMap[key] = (countMap[key] || 0) + 1
    })
  })

  return (
    <div className="market-saleyard-block">
      <div className="market-section-label">
        {saleyard.label}
        <span className="market-section-qualifier"> · {latest.sale_date}{latest.total_head ? ` · ${latest.total_head.toLocaleString()} head` : ''}</span>
      </div>
      <div className="market-saleyard-header">
        <span>Category</span>
        <span>Avg c/kg</span>
        <span>{sales.length > 1 ? `${sales.length}-sale avg` : '—'}</span>
      </div>
      {(latest.cohorts ?? []).map((c) => {
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
}

function MarketPricesInner() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/market-prices`, {
          headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
        })
        const json = await res.json().catch(() => null)
        console.log('[MarketPrices] response:', res.status, json)
        if (!res.ok || !json || typeof json !== 'object') {
          setError(`HTTP ${res.status}`)
          return
        }
        setData(json)
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

  if (!loading && (error || !data)) {
    return (
      <div className="detail-card">
        <h3>Markets</h3>
        <p className="muted">Markets data unavailable.</p>
      </div>
    )
  }

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

export default function MarketPrices() {
  return (
    <MarketErrorBoundary>
      <MarketPricesInner />
    </MarketErrorBoundary>
  )
}
