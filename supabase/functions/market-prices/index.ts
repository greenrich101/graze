// Supabase Edge Function: market-prices
//
// Fetches actual saleyard auction results from public PDF reports:
//   Roma Store  — romasaleyards.com.au  (council summary report, Tuesdays)
//   Warwick     — sdrc.qld.gov.au       (AgriNous detailed report, Tuesdays)
//   Dalby       — raywhitelivestockdalby.com.au  (Ray White summary, Wednesdays)
//
// Also fetches the EYCI from MLA Statistics API.
// Caches in `market_cache` for CACHE_TTL_HOURS. Force refresh:
//   DELETE FROM market_cache WHERE key = 'market_prices';
//
// Deploy: supabase functions deploy market-prices

// These imports and globals are resolved by the Deno runtime at deploy time.
// The local TypeScript server doesn't know about them — ignore the red squiggles.
// @ts-ignore
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
// @ts-ignore
import { extractText } from 'npm:unpdf'

declare const Deno: {
  serve: (handler: (req: Request) => Response | Promise<Response>) => void
  env: { get: (key: string) => string | undefined }
}

const CACHE_KEY = 'market_prices'
const CACHE_TTL_HOURS = 6
const NUM_SALES = 5

const MLA_BASE = 'https://api-mlastatistics.mla.com.au'
const IND_EYCI = 0

// ─── Types ────────────────────────────────────────────────────────────────────

interface WeightCohort {
  category: 'steer' | 'heifer' | 'cow'
  weight_min: number
  weight_max: number | null  // null = open-ended (600+)
  avg_c_kg: number
  max_c_kg: number | null
  head: number | null
}

interface SaleResult {
  sale_date: string           // YYYY-MM-DD
  total_head: number | null
  cohorts: WeightCohort[]
}

interface MarketData {
  id: string
  label: string
  sales: SaleResult[]
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

function pad2(n: number): string { return String(n).padStart(2, '0') }

function dateStr(daysAgo = 0): string {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  return d.toISOString().slice(0, 10)
}

// Returns the last `count` UTC dates that fall on `dayOfWeek` (0=Sun…6=Sat),
// starting from yesterday (same-day PDFs aren't published yet).
function lastSaleDates(dayOfWeek: number, count: number): Date[] {
  const results: Date[] = []
  const d = new Date()
  d.setUTCHours(12, 0, 0, 0)
  d.setUTCDate(d.getUTCDate() - 1)
  for (let tries = 0; tries < 90 && results.length < count; tries++) {
    if (d.getUTCDay() === dayOfWeek) results.push(new Date(d))
    d.setUTCDate(d.getUTCDate() - 1)
  }
  return results
}

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
}

function parseDateWords(day: string, month: string, year: string): string | null {
  const m = MONTHS[month.toLowerCase()]
  if (!m) return null
  return `${year}-${pad2(m)}-${pad2(parseInt(day))}`
}

// ─── PDF helpers ──────────────────────────────────────────────────────────────

async function fetchPdf(url: string): Promise<string | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const buf = await res.arrayBuffer()
    const { text } = await extractText(new Uint8Array(buf), { mergePages: true })
    return text
  } catch {
    return null
  }
}

function parseNum(s: string): number {
  return parseFloat(s.replace(/,/g, ''))
}

// ─── URL builders ─────────────────────────────────────────────────────────────

function romaUrl(d: Date): string {
  const dd = pad2(d.getUTCDate())
  const mm = pad2(d.getUTCMonth() + 1)
  const yyyy = d.getUTCFullYear()
  return `https://www.romasaleyards.com.au/files/assets/salesyard/v/1/media/market-reports/${dd}${mm}${yyyy}-roma-store-summary-report.pdf`
}

function warwickUrl(d: Date): string {
  const dd = pad2(d.getUTCDate())
  const mm = pad2(d.getUTCMonth() + 1)
  const yyyy = d.getUTCFullYear()
  const name = `Warwick Cattle Sale ${dd}.${mm}.${yyyy} Market Report.pdf`
  return `https://www.sdrc.qld.gov.au/ArticleDocuments/1089/${encodeURIComponent(name)}.aspx`
}

// Dalby URLs are unpredictable (S3 timestamp in path) — scrape the listing page.
async function dalbyPdfUrls(count: number): Promise<string[]> {
  try {
    const res = await fetch('https://raywhitelivestockdalby.com.au/market-reports')
    if (!res.ok) return []
    const html = await res.text()
    const matches = [
      ...html.matchAll(/href="(https:\/\/rw-media\.s3\.amazonaws\.com\/[^"]+Dalby-Cattle-Sale-Market-Report[^"]+\.pdf)"/gi)
    ]
    return matches.slice(0, count).map(m => m[1])
  } catch {
    return []
  }
}

// ─── Roma parser ──────────────────────────────────────────────────────────────
//
// unpdf produces flat space-separated text (no line breaks within a page).
// Table structure after "Maximum $ / head":
//   Steers to 200kg 422 472 656 897  (avg_c/kg  max_c/kg  avg_$/hd  max_$/hd)
//   200 – 280kg 529 592 1,307 1,551
//   Over 600kg 446 466 2,894 3,567
//   Heifers to 200kg 281 380 476 722
//   Cows 280 – 330kg 202 260 637 838
// Category keyword (Steers/Heifers/Cows) may appear only at first row of each group.
//
function parseRoma(text: string): SaleResult | null {
  const headMatch = text.match(/total of\s+([\d,]+)\s+head/i)
  const total_head = headMatch ? parseInt(headMatch[1].replace(/,/g, '')) : null

  const dateMatch = text.match(
    /(?:Monday|Tuesday|Wednesday|Thursday|Friday),?\s+(\d+)\s+(\w+)\s+(\d{4})/i
  )
  if (!dateMatch) return null
  const sale_date = parseDateWords(dateMatch[1], dateMatch[2], dateMatch[3])
  if (!sale_date) return null

  // Table starts after the last "$ / head" (column header row ends with it)
  const tableIdx = text.lastIndexOf('$ / head')
  if (tableIdx === -1) return null
  const tableText = text.slice(tableIdx + '$ / head'.length)

  // Split into sections by category keywords
  const SECTION_RE = /\b(Steers?|Heifers?|Cows?|Bulls?)\b/g
  const sections: Array<{ name: string; start: number }> = []
  let sm: RegExpExecArray | null
  while ((sm = SECTION_RE.exec(tableText)) !== null) {
    sections.push({ name: sm[1], start: sm.index })
  }

  const cohorts: WeightCohort[] = []

  // Weight range + avg c/kg + max c/kg
  // Forms: "to 200kg NNN NNN", "200 – 280kg NNN NNN", "Over 600kg NNN NNN"
  const WEIGHT_RE = /(?:to\s+(\d+)|(\d+)\s*[–\-]\s*(\d+)|[Oo]ver\s+(\d+))\s*kg\s+([\d,]+)\s+([\d,]+)/g

  for (let i = 0; i < sections.length; i++) {
    const { name, start } = sections[i]
    const end = i + 1 < sections.length ? sections[i + 1].start : tableText.length
    const catLower = name.toLowerCase()
    if (catLower.startsWith('bull')) continue
    const category: 'steer' | 'heifer' | 'cow' =
      catLower.startsWith('steer') ? 'steer' :
      catLower.startsWith('heifer') ? 'heifer' : 'cow'

    const sectionText = tableText.slice(start, end)
    WEIGHT_RE.lastIndex = 0
    let wm: RegExpExecArray | null
    while ((wm = WEIGHT_RE.exec(sectionText)) !== null) {
      let weight_min: number, weight_max: number | null
      if (wm[1]) { weight_min = 0; weight_max = parseInt(wm[1]) }
      else if (wm[4]) { weight_min = parseInt(wm[4]); weight_max = null }
      else { weight_min = parseInt(wm[2]); weight_max = parseInt(wm[3]) }

      const avg_c_kg = parseNum(wm[5])
      const max_c_kg = parseNum(wm[6])
      if (avg_c_kg < 50 || avg_c_kg > 1500) continue
      cohorts.push({ category, weight_min, weight_max, avg_c_kg, max_c_kg, head: null })
    }
  }

  return cohorts.length ? { sale_date, total_head, cohorts } : null
}

// ─── AgriNous parser (Warwick) ────────────────────────────────────────────────
//
// unpdf produces flat space-separated text. Product sections are delimited by
// ALL-CAPS product names (e.g. "STEER FEEDER", "HEIFER", "COW") followed by "c/kg".
// Each section contains weight ranges "NNN-NNN" followed by 7 numbers:
//   head  min_c/kg  avg_c/kg  max_c/kg  min$/hd  avg$/hd  max$/hd
// "Total PRODUCT" ends each section.
//
function parseAgriNous(text: string, saleDate: string): SaleResult | null {
  const headMatch = text.match(/(\d[\d,]+)\s+head/i)
  const total_head = headMatch ? parseInt(headMatch[1].replace(/,/g, '')) : null

  // Aggregate by (category, weight_min, weight_max) — weighted avg across product types
  const agg: Record<string, { sumWeighted: number; maxCkg: number; head: number }> = {}

  // Find all product sections: "PRODUCT c/kg ... Total PRODUCT"
  // Product names: ALL-CAPS sequences (e.g. "STEER FEEDER", "COW", "HEIFER FEEDER")
  const PRODUCT_RE = /\b([A-Z]{2,}(?:\s+[A-Z&/]{2,})*)\s+c\/kg\b/g
  const productPositions: Array<{ name: string; dataStart: number }> = []
  let pm: RegExpExecArray | null
  while ((pm = PRODUCT_RE.exec(text)) !== null) {
    productPositions.push({ name: pm[1], dataStart: pm.index + pm[0].length })
  }

  // Weight range + 7 numbers (head, min, avg, max, min$, avg$, max$)
  const ROW_RE = /\b(\d{2,3})\s*[–\-]\s*(\d{2,3})\b\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)/g

  for (let i = 0; i < productPositions.length; i++) {
    const { name, dataStart } = productPositions[i]
    const dataEnd = i + 1 < productPositions.length
      ? productPositions[i + 1].dataStart - productPositions[i + 1].name.length - 5
      : text.length
    const category = agriNousCategory(name)
    if (!category) continue

    // Stop at "Total" row to avoid double-counting summary rows
    const sectionText = text.slice(dataStart, dataEnd)
    const totalIdx = sectionText.search(/\bTotal\b/i)
    const dataPart = totalIdx >= 0 ? sectionText.slice(0, totalIdx) : sectionText

    ROW_RE.lastIndex = 0
    let wm: RegExpExecArray | null
    while ((wm = ROW_RE.exec(dataPart)) !== null) {
      const weight_min = parseInt(wm[1])
      const weight_max = parseInt(wm[2])
      const head = parseNum(wm[3])
      // wm[4]=min, wm[5]=avg, wm[6]=max c/kg
      const avg_c_kg = parseNum(wm[5])
      const max_c_kg = parseNum(wm[6])
      if (avg_c_kg < 50 || avg_c_kg > 1500 || head <= 0) continue

      const key = `${category}:${weight_min}:${weight_max}`
      if (!agg[key]) agg[key] = { sumWeighted: 0, maxCkg: 0, head: 0 }
      agg[key].sumWeighted += avg_c_kg * head
      agg[key].maxCkg = Math.max(agg[key].maxCkg, max_c_kg)
      agg[key].head += head
    }
  }

  const cohorts: WeightCohort[] = Object.entries(agg).map(([key, v]) => {
    const [cat, minStr, maxStr] = key.split(':')
    return {
      category: cat as 'steer' | 'heifer' | 'cow',
      weight_min: parseInt(minStr),
      weight_max: parseInt(maxStr),
      avg_c_kg: Math.round((v.sumWeighted / v.head) * 10) / 10,
      max_c_kg: v.maxCkg,
      head: v.head,
    }
  })

  return cohorts.length ? { sale_date: saleDate, total_head, cohorts } : null
}

function agriNousCategory(product: string): 'steer' | 'heifer' | 'cow' | null {
  const p = product.toUpperCase()
  if (p.includes('STEER') || p.includes('BULLOCK')) return 'steer'
  if (p.includes('HEIFER')) return 'heifer'
  if (p === 'COW') return 'cow'
  return null
}

// ─── Dalby parser (Ray White summary table) ───────────────────────────────────
//
// unpdf produces flat space-separated text. Table header ends with "Change".
// Each row: Description  NNN-NNN kg  min_c - max_c  avg_c  ±change
// e.g. "Weaner Steers 200-280 kg 438 - 570 499 -36"
// Ordinal suffixes may be split: "11 th" → normalise before date parsing.
//
function parseDalby(text: string): SaleResult | null {
  const headMatch = text.match(/(\d[\d,]+)\s+head/i)
  const total_head = headMatch ? parseInt(headMatch[1].replace(/,/g, '')) : null

  // Normalise ordinal suffixes that unpdf may split: "11 th" → "11th"
  const normalised = text.replace(/(\d)\s+(st|nd|rd|th)\b/gi, '$1$2')

  const dateMatch = normalised.match(
    /(?:Monday|Tuesday|Wednesday|Thursday|Friday)\s+(\d+)(?:st|nd|rd|th)\s+(\w+)\s+(\d{4})/i
  )
  if (!dateMatch) return null
  const sale_date = parseDateWords(dateMatch[1], dateMatch[2], dateMatch[3])
  if (!sale_date) return null

  // Table begins after "Change" header word
  const tableIdx = text.indexOf('Change')
  if (tableIdx === -1) return null
  const tableText = text.slice(tableIdx + 'Change'.length)

  const cohorts: WeightCohort[] = []

  // Each data row: description text, weight range "NNN-NNN kg", range "min - max", avg, ±change
  // Capture: description, weight_min, weight_max, range_min_ckg, range_max_ckg, avg_ckg
  const ROW_RE = /([A-Za-z][A-Za-z\s]{3,30}?)\s+(\d{2,3})-(\d{2,3})\s*kg\s+(\d+)\s*-\s*(\d+)\s+([\d,]+)/g
  let match: RegExpExecArray | null
  while ((match = ROW_RE.exec(tableText)) !== null) {
    const desc = match[1].trim()
    const category = dalbyCategory(desc)
    if (!category) continue

    const weight_min = parseInt(match[2])
    const weight_max = parseInt(match[3])
    const max_c_kg = parseInt(match[5])   // top of c/kg range
    const avg_c_kg = parseNum(match[6])   // avg c/kg column
    if (avg_c_kg < 50 || avg_c_kg > 1500) continue
    cohorts.push({ category, weight_min, weight_max, avg_c_kg, max_c_kg, head: null })
  }

  return cohorts.length ? { sale_date, total_head, cohorts } : null
}

function dalbyCategory(desc: string): 'steer' | 'heifer' | 'cow' | null {
  const d = desc.toLowerCase()
  if (d.includes('steer') || d.includes('bullock')) return 'steer'
  if (d.includes('heifer')) return 'heifer'
  if (d.includes('cow')) return 'cow'
  return null
}

// ─── EYCI (MLA Statistics API — unchanged) ────────────────────────────────────

async function mlaFetch(path: string): Promise<Array<{ calendar_date: string; indicator_value: string }>> {
  const res = await fetch(`${MLA_BASE}${path}`)
  if (!res.ok) return []
  const json = await res.json() as { data?: unknown[] }
  return (json.data ?? []) as Array<{ calendar_date: string; indicator_value: string }>
}

function getLatestAndPrior(
  rows: Array<{ calendar_date: string; indicator_value: string }>,
  daysAgo: number
): { latest: number | null; prior: number | null } {
  if (!rows.length) return { latest: null, prior: null }
  const sorted = [...rows].sort((a, b) => a.calendar_date.localeCompare(b.calendar_date))
  const latest = parseFloat(sorted[sorted.length - 1].indicator_value)
  const cutoff = dateStr(daysAgo)
  const priorRows = sorted.filter(r => r.calendar_date <= cutoff)
  const prior = priorRows.length ? parseFloat(priorRows[priorRows.length - 1].indicator_value) : null
  return { latest, prior }
}

function pct(current: number, prior: number | null): number | null {
  if (prior === null || prior === 0 || isNaN(prior)) return null
  return ((current - prior) / prior) * 100
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

  const debugMode = new URL(req.url).searchParams.has('debug')

  // Cache check
  if (!debugMode) {
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
  const from = dateStr(36)
  const to = dateStr(1)
  const eyciRows = await mlaFetch(`/report/5?fromDate=${from}&toDate=${to}&indicatorID=${IND_EYCI}`)
    .catch(() => [])

  const eyciCurrent = eyciRows.length
    ? parseFloat([...eyciRows].sort((a, b) => a.calendar_date.localeCompare(b.calendar_date)).at(-1)!.indicator_value)
    : null
  const { prior: eyci7d } = getLatestAndPrior(eyciRows, 7)
  const { prior: eyci4w } = getLatestAndPrior(eyciRows, 28)

  const eyci = eyciCurrent !== null ? {
    current: Math.round(eyciCurrent * 10) / 10,
    units: 'c/kg cwt',
    weekChangePct: eyci7d !== null ? Math.round(pct(eyciCurrent, eyci7d)! * 10) / 10 : null,
    trend4w: eyci4w !== null ? Math.round(pct(eyciCurrent, eyci4w)! * 10) / 10 : null,
  } : null

  // ── Saleyard PDFs ────────────────────────────────────────────────────────────
  const tuesdayDates = lastSaleDates(2, NUM_SALES)   // Roma + Warwick
  const dalbyUrls = await dalbyPdfUrls(NUM_SALES)

  const debugSamples: Record<string, string | null> = {}

  const [romaSales, warwickSales, dalbySales] = await Promise.all([
    Promise.all(tuesdayDates.map(async d => {
      const text = await fetchPdf(romaUrl(d))
      if (!text) return null
      if (debugMode && !debugSamples['roma']) debugSamples['roma'] = text.slice(0, 3000)
      return parseRoma(text)
    })),
    Promise.all(tuesdayDates.map(async d => {
      const iso = `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`
      const text = await fetchPdf(warwickUrl(d))
      if (!text) return null
      if (debugMode && !debugSamples['warwick']) debugSamples['warwick'] = text.slice(0, 3000)
      return parseAgriNous(text, iso)
    })),
    Promise.all(dalbyUrls.map(async url => {
      const text = await fetchPdf(url)
      if (!text) return null
      if (debugMode && !debugSamples['dalby']) debugSamples['dalby'] = text.slice(0, 3000)
      return parseDalby(text)
    })),
  ])

  if (debugMode) {
    return new Response(JSON.stringify(debugSamples, null, 2), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    })
  }

  const markets: MarketData[] = [
    { id: 'ROM', label: 'Roma Store', sales: romaSales.filter(Boolean) as SaleResult[] },
    { id: 'WAR', label: 'Warwick',    sales: warwickSales.filter(Boolean) as SaleResult[] },
    { id: 'DAL', label: 'Dalby',      sales: dalbySales.filter(Boolean) as SaleResult[] },
  ]

  const payload = { eyci, saleyards: markets, fetchedAt: new Date().toISOString() }

  await supabase
    .from('market_cache')
    .upsert({ key: CACHE_KEY, data: payload, fetched_at: new Date().toISOString() })

  return new Response(JSON.stringify(payload), {
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  })
})
