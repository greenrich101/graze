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

const INDICATOR_ORDER = [
  'Restocker Steer', 'Feeder Steer', 'Heavy Steer',
  'Restocker Heifer', 'Feeder Heifer', 'Processor Cow',
]

function shortSaleyard(label) {
  if (!label) return ''
  return label.replace(/\s+Store$/, '')
}

function getLatestForIndicator(saleyard, label) {
  const sales = Array.isArray(saleyard?.sales) ? saleyard.sales : []
  for (const sale of sales) {
    const c = Array.isArray(sale?.cohorts) ? sale.cohorts.find(c => c?.indicator_label === label) : null
    if (c) return { value: c.avg_c_kg, date: sale.sale_date, head: c.head }
  }
  return null
}

function ComparisonHistory({ label, saleyards }) {
  const allDates = new Set()
  saleyards.forEach(sy => {
    const sales = Array.isArray(sy?.sales) ? sy.sales : []
    sales.forEach(s => {
      const has = Array.isArray(s?.cohorts) && s.cohorts.some(c => c?.indicator_label === label)
      if (has && s?.sale_date) allDates.add(s.sale_date)
    })
  })
  const dates = [...allDates].sort().reverse()
  if (dates.length === 0) return null

  return (
    <div className="market-compare-history">
      {dates.map(date => (
        <div key={date} className="market-compare-history-row" style={{ '--sy-cols': saleyards.length }}>
          <span className="market-compare-history-date">{date}</span>
          {saleyards.map(sy => {
            const sale = sy?.sales?.find(s => s?.sale_date === date)
            const c = sale?.cohorts?.find(c => c?.indicator_label === label)
            return (
              <span key={sy.id} className="market-compare-history-val">
                {c ? fmt(c.avg_c_kg) : '—'}
              </span>
            )
          })}
        </div>
      ))}
    </div>
  )
}

function ComparisonTable({ saleyards }) {
  const [expanded, setExpanded] = useState(null)

  if (!Array.isArray(saleyards) || saleyards.length === 0) return null

  const labelsPresent = new Set()
  saleyards.forEach(sy => {
    const latest = sy?.sales?.[0]
    if (!latest) return
    const cohorts = Array.isArray(latest.cohorts) ? latest.cohorts : []
    cohorts.forEach(c => { if (c?.indicator_label) labelsPresent.add(c.indicator_label) })
  })
  const labels = INDICATOR_ORDER.filter(l => labelsPresent.has(l))
  if (labels.length === 0) return null

  return (
    <div className="market-compare-block">
      <div className="market-section-label">
        Cross-saleyard comparison
        <span className="market-section-qualifier"> · tap a row to see history</span>
      </div>
      <div className="market-compare-header" style={{ '--sy-cols': saleyards.length }}>
        <span>Indicator</span>
        {saleyards.map(sy => <span key={sy.id}>{shortSaleyard(sy?.label)}</span>)}
      </div>
      {labels.map(label => {
        const values = saleyards.map(sy => getLatestForIndicator(sy, label))
        const nums = values.map(v => v?.value).filter(v => typeof v === 'number')
        const max = nums.length > 1 ? Math.max(...nums) : null
        const isOpen = expanded === label
        return (
          <div key={label} className="market-compare-group">
            <button
              type="button"
              className={`market-compare-row${isOpen ? ' open' : ''}`}
              style={{ '--sy-cols': saleyards.length }}
              onClick={() => setExpanded(isOpen ? null : label)}
              aria-expanded={isOpen}
            >
              <span className="market-cat-name">
                <span className="market-compare-caret" aria-hidden="true">{isOpen ? '▾' : '▸'}</span> {label}
              </span>
              {values.map((v, i) => (
                <span
                  key={saleyards[i].id}
                  className={`market-price${max !== null && v?.value === max ? ' market-best' : ''}`}
                >
                  {v ? fmt(v.value) : '—'}
                </span>
              ))}
            </button>
            {isOpen && <ComparisonHistory label={label} saleyards={saleyards} />}
          </div>
        )
      })}
    </div>
  )
}

function SaleyardBlock({ saleyard }) {
  try {
    const sales = Array.isArray(saleyard?.sales) ? saleyard.sales : []
    if (sales.length === 0) return null

    const latest = sales[0]
    const cohorts = Array.isArray(latest?.cohorts) ? latest.cohorts : []
    const anyHead = cohorts.some((c) => c?.head !== null && c?.head !== undefined)

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

          <ComparisonTable saleyards={saleyards} />

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
