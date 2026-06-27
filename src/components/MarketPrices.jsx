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
    if (!c) return 'Unknown'
    if (c.indicator_label) return c.indicator_label
    if (!c.category) return 'Unknown'
    const name = c.category.charAt(0).toUpperCase() + c.category.slice(1) + 's'
    if (c.weight_max === null || c.weight_max === undefined) return `${name} ${c.weight_min}kg+`
    return `${name} ${c.weight_min}–${c.weight_max}kg`
  } catch { return 'Unknown' }
}

function cohortKey(c) {
  if (c?.indicator_label) return `ind:${c.indicator_label}`
  return `${c?.category}:${c?.weight_min}:${c?.weight_max}`
}

function Sparkline({ values, width = 160, height = 36, stroke = 'currentColor' }) {
  if (!Array.isArray(values) || values.length < 2) return null
  const finite = values.filter((v) => typeof v === 'number' && isFinite(v))
  if (finite.length < 2) return null
  const min = Math.min(...finite)
  const max = Math.max(...finite)
  const range = max - min || 1
  const stepX = width / (finite.length - 1)
  const pad = 2
  const h = height - pad * 2
  const pts = finite.map((v, i) => `${(i * stepX).toFixed(1)},${(pad + h - ((v - min) / range) * h).toFixed(1)}`).join(' ')
  const last = finite[finite.length - 1]
  const lastX = ((finite.length - 1) * stepX).toFixed(1)
  const lastY = (pad + h - ((last - min) / range) * h).toFixed(1)
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="market-sparkline" aria-hidden="true">
      <polyline points={pts} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lastX} cy={lastY} r="2.2" fill={stroke} />
    </svg>
  )
}

const SEASON_CATEGORY_ORDER = { steer: 0, heifer: 1, cow: 2 }
function sortSeasonRows(rows) {
  return [...(rows || [])].sort((a, b) => {
    const da = SEASON_CATEGORY_ORDER[a?.category] ?? 99
    const db = SEASON_CATEGORY_ORDER[b?.category] ?? 99
    return da - db
  })
}

function SeasonBlock({ season }) {
  const rows = sortSeasonRows(season)
  if (rows.length === 0) return null
  return (
    <div className="market-season-block">
      <div className="market-season-header">
        <span>Indicator</span>
        <span>Latest</span>
        <span>MTD</span>
        <span>YTD</span>
      </div>
      {rows.map((r) => (
        <div key={r.indicator_label} className="market-season-row">
          <span className="market-cat-name">{r.indicator_label}</span>
          <span className="market-price">{fmt(r.latest_c_kg)}</span>
          <span className="market-avg muted">{fmt(r.mtd_c_kg)}</span>
          <span className="market-avg muted">{fmt(r.ytd_c_kg)}</span>
        </div>
      ))}
    </div>
  )
}

function saleyardAvgSeries(sales) {
  // Return chronological list of avg-of-cohorts per sale (oldest → newest)
  if (!Array.isArray(sales)) return []
  return [...sales].reverse().map((s) => {
    const cohorts = Array.isArray(s?.cohorts) ? s.cohorts : []
    const nums = cohorts.map((c) => c?.avg_c_kg).filter((v) => typeof v === 'number' && !isNaN(v))
    if (nums.length === 0) return null
    return nums.reduce((a, b) => a + b, 0) / nums.length
  }).filter((v) => v !== null)
}

function SaleyardBlock({ saleyard }) {
  try {
    const sales = Array.isArray(saleyard?.sales) ? saleyard.sales : []
    const season = Array.isArray(saleyard?.season) ? saleyard.season : []
    if (sales.length === 0 && season.length === 0) return null

    const latest = sales[0]
    const cohorts = Array.isArray(latest?.cohorts) ? latest.cohorts : []
    const anyHead = cohorts.some((c) => c?.head !== null && c?.head !== undefined)
    const trendSeries = saleyardAvgSeries(sales)

    return (
      <div className="market-saleyard-block">
        <div className="market-saleyard-block-head">
          <div className="market-section-label">
            {saleyard?.label ?? 'Saleyard'}
            <span className="market-section-qualifier">
              {latest?.sale_date ? ` · ${latest.sale_date}` : ''}
              {latest?.total_head ? ` · ${Number(latest.total_head).toLocaleString()} head` : ''}
            </span>
          </div>
          {trendSeries.length >= 2 && (
            <Sparkline values={trendSeries} width={130} height={32} stroke="var(--primary)" />
          )}
        </div>

        {sales.length > 0 && (
          <>
            <div className="market-saleyard-header">
              <span>Weight band</span>
              <span>{anyHead ? 'Hd' : ''}</span>
              <span>Avg ¢/kg</span>
            </div>
            {cohorts.map((c) => {
              const key = cohortKey(c)
              return (
                <div key={key} className="market-saleyard-row">
                  <span className="market-cat-name">{cohortLabel(c)}</span>
                  <span className="market-head muted">{anyHead && c?.head ? Number(c.head).toLocaleString() : ''}</span>
                  <span className="market-price">{fmt(c.avg_c_kg)}</span>
                </div>
              )
            })}
          </>
        )}

        <SeasonBlock season={season} />
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
              Updated {fetchedDate} · Prices in ¢/kg liveweight
            </p>
          )}

          <div className="market-eyci-block">
            <div className="market-eyci-head">
              <div className="market-section-label">EYCI</div>
              {Array.isArray(data.eyci?.series) && data.eyci.series.length >= 2 && (
                <Sparkline values={data.eyci.series} width={170} height={40} stroke="var(--primary)" />
              )}
            </div>
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
                <div className="dashboard-stat">
                  <span className="detail-label">MTD avg</span>
                  <span className="detail-value">{fmt(data.eyci.mtd)}</span>
                </div>
                <div className="dashboard-stat">
                  <span className="detail-label">YTD avg</span>
                  <span className="detail-value">{fmt(data.eyci.ytd)}</span>
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
