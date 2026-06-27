// Supabase Edge Function: market-prices
//
// Pulls everything from the MLA Statistics API (api-mlastatistics.mla.com.au):
//   EYCI            → /report/5  indicatorID=0
//   Saleyard prices → /report/6  one call per (saleyardID, indicatorID)
//
// Caches in `market_cache` for CACHE_TTL_HOURS. Force refresh:
//   DELETE FROM market_cache WHERE key = 'market_prices';
//
// Deploy: supabase functions deploy market-prices

// @ts-ignore — resolved by Deno at deploy time
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

declare const Deno: {
  serve: (handler: (req: Request) => Response | Promise<Response>) => void
  env: { get: (key: string) => string | undefined }
}

const CACHE_KEY = 'market_prices'
const CACHE_TTL_HOURS = 6
const NUM_SALES = 5
const SALEYARD_LOOKBACK_DAYS = 70   // ~10 weeks; covers >=5 weekly sales

const MLA_BASE = 'https://api-mlastatistics.mla.com.au'
const IND_EYCI = 0

// ─── Types ────────────────────────────────────────────────────────────────────

interface WeightCohort {
  category: 'steer' | 'heifer' | 'cow'
  weight_min: number               // 0 placeholder (MLA indicators aren't banded)
  weight_max: number | null
  avg_c_kg: number
  max_c_kg: number | null
  head: number | null
  indicator_label?: string         // e.g. "Heavy Steer" — shown in UI
}

interface SaleResult {
  sale_date: string                // YYYY-MM-DD
  total_head: number | null
  cohorts: WeightCohort[]
}

interface MarketData {
  id: string
  label: string
  sales: SaleResult[]
}

interface MlaRow {
  calendar_date: string
  indicator_value: string | number
  head_count?: number | null
}

// ─── Saleyard + indicator catalogue ───────────────────────────────────────────

const SALEYARDS: Array<{ id: string; label: string }> = [
  { id: 'ROM', label: 'Roma Store' },
  { id: 'WAR', label: 'Warwick' },
  { id: 'DAL', label: 'Dalby' },
]

const SALEYARD_INDICATORS: Array<{
  id: number
  label: string
  category: 'steer' | 'heifer' | 'cow'
}> = [
  { id: 2,  label: 'Restocker Steer',  category: 'steer'  },
  { id: 3,  label: 'Feeder Steer',     category: 'steer'  },
  { id: 4,  label: 'Heavy Steer',      category: 'steer'  },
  { id: 12, label: 'Restocker Heifer', category: 'heifer' },
  { id: 17, label: 'Feeder Heifer',    category: 'heifer' },
  { id: 13, label: 'Processor Cow',    category: 'cow'    },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function dateStr(daysAgo = 0): string {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  return d.toISOString().slice(0, 10)
}

async function mlaFetch(path: string): Promise<MlaRow[]> {
  const res = await fetch(`${MLA_BASE}${path}`)
  if (!res.ok) return []
  const json = await res.json() as { data?: MlaRow[] }
  return json.data ?? []
}

function getLatestAndPrior(
  rows: MlaRow[],
  daysAgo: number,
): { latest: number | null; prior: number | null } {
  if (!rows.length) return { latest: null, prior: null }
  const sorted = [...rows].sort((a, b) => a.calendar_date.localeCompare(b.calendar_date))
  const latest = parseFloat(String(sorted[sorted.length - 1].indicator_value))
  const cutoff = dateStr(daysAgo)
  const priorRows = sorted.filter(r => r.calendar_date <= cutoff)
  const prior = priorRows.length ? parseFloat(String(priorRows[priorRows.length - 1].indicator_value)) : null
  return { latest, prior }
}

function pct(current: number, prior: number | null): number | null {
  if (prior === null || prior === 0 || isNaN(prior)) return null
  return ((current - prior) / prior) * 100
}

// MLA forward-fills indicator values across non-sale days. Collapse runs of
// identical (value, head) pairs to find the actual sale events.
function collapseSeries(rows: MlaRow[]): Map<string, { value: number; head: number | null }> {
  const out = new Map<string, { value: number; head: number | null }>()
  const sorted = [...rows].sort((a, b) => a.calendar_date.localeCompare(b.calendar_date))
  let last = ''
  for (const r of sorted) {
    const value = parseFloat(String(r.indicator_value))
    if (isNaN(value)) continue
    const head = r.head_count !== null && r.head_count !== undefined ? Number(r.head_count) : null
    const key = `${value}|${head}`
    if (key !== last) {
      out.set(r.calendar_date, { value, head })
      last = key
    }
  }
  return out
}

// ─── Saleyard fetcher ─────────────────────────────────────────────────────────

async function fetchSaleyardSales(saleyardID: string): Promise<SaleResult[]> {
  const from = dateStr(SALEYARD_LOOKBACK_DAYS)
  const to = dateStr(1)

  const perIndicator = await Promise.all(
    SALEYARD_INDICATORS.map(async ind => {
      const rows = await mlaFetch(
        `/report/6?fromDate=${from}&toDate=${to}&indicatorID=${ind.id}&saleyardID=${saleyardID}`,
      ).catch(() => [])
      return { ind, events: collapseSeries(rows) }
    }),
  )

  // Union of all dates where any indicator had a new sale event
  const allDates = new Set<string>()
  for (const { events } of perIndicator) for (const d of events.keys()) allDates.add(d)
  const sortedDates = [...allDates].sort().reverse().slice(0, NUM_SALES)

  return sortedDates.map(date => {
    const cohorts: WeightCohort[] = []
    let totalHead = 0
    let anyHead = false
    for (const { ind, events } of perIndicator) {
      const cell = events.get(date)
      if (!cell) continue
      cohorts.push({
        category: ind.category,
        weight_min: 0,
        weight_max: null,
        avg_c_kg: Math.round(cell.value * 10) / 10,
        max_c_kg: null,
        head: cell.head,
        indicator_label: ind.label,
      })
      if (cell.head !== null) { totalHead += cell.head; anyHead = true }
    }
    return { sale_date: date, total_head: anyHead ? totalHead : null, cohorts }
  })
}

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'apikey, authorization, content-type',
      },
    })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const reqUrl = new URL(req.url)
  const debugMode = reqUrl.searchParams.has('debug')
  const refreshMode = reqUrl.searchParams.has('refresh')

  if (!debugMode && !refreshMode) {
    const { data: cached } = await supabase
      .from('market_cache')
      .select('data, fetched_at')
      .eq('key', CACHE_KEY)
      .maybeSingle()

    if (cached) {
      const ageHours = (Date.now() - new Date(cached.fetched_at).getTime()) / 3_600_000
      if (ageHours < CACHE_TTL_HOURS) {
        return new Response(JSON.stringify(cached.data), {
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        })
      }
    }
  }

  // ── EYCI ────────────────────────────────────────────────────────────────────
  const eyciFrom = dateStr(36)
  const eyciTo = dateStr(1)
  const eyciRows = await mlaFetch(
    `/report/5?fromDate=${eyciFrom}&toDate=${eyciTo}&indicatorID=${IND_EYCI}`,
  ).catch(() => [])

  const eyciCurrent = eyciRows.length
    ? parseFloat(String([...eyciRows].sort((a, b) => a.calendar_date.localeCompare(b.calendar_date)).at(-1)!.indicator_value))
    : null
  const { prior: eyci7d } = getLatestAndPrior(eyciRows, 7)
  const { prior: eyci4w } = getLatestAndPrior(eyciRows, 28)

  const eyci = eyciCurrent !== null ? {
    current: Math.round(eyciCurrent * 10) / 10,
    units: 'c/kg cwt',
    weekChangePct: eyci7d !== null ? Math.round(pct(eyciCurrent, eyci7d)! * 10) / 10 : null,
    trend4w: eyci4w !== null ? Math.round(pct(eyciCurrent, eyci4w)! * 10) / 10 : null,
  } : null

  // ── Saleyards (all from MLA /report/6) ──────────────────────────────────────
  const saleyardResults = await Promise.all(
    SALEYARDS.map(async sy => ({
      ...sy,
      sales: await fetchSaleyardSales(sy.id).catch(() => [] as SaleResult[]),
    })),
  )

  const markets: MarketData[] = saleyardResults.map(sy => ({
    id: sy.id,
    label: sy.label,
    sales: sy.sales,
  }))

  const payload = { eyci, saleyards: markets, fetchedAt: new Date().toISOString() }

  await supabase
    .from('market_cache')
    .upsert({ key: CACHE_KEY, data: payload, fetched_at: new Date().toISOString() })

  return new Response(JSON.stringify(payload), {
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  })
})
