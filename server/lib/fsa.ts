// Client for the FSA Food Hygiene Rating Scheme API (England, Wales & NI).
// Free, public, no key — but it requires the `x-api-version: 2` header.
// Docs: https://api.ratings.food.gov.uk/help

const FSA_BASE = 'https://api.ratings.food.gov.uk'
const HEADERS = {
  'x-api-version': '2',
  accept: 'application/json',
  'accept-language': 'en-GB',
}

// FSA BusinessType strings for "places you eat out". Everything else
// (retailers, schools, care homes, hospitals) is excluded from Bitescore.
export const DINING_BUSINESS_TYPES = new Set<string>([
  'Restaurant/Cafe/Canteen',
  'Takeaway/sandwich shop',
  'Pub/bar/nightclub',
  'Mobile caterer',
  'Hotel/bed & breakfast/guest house',
])

export interface FsaEstablishment {
  FHRSID: number
  BusinessName: string
  BusinessType: string
  BusinessTypeID: number
  AddressLine1?: string
  AddressLine2?: string
  AddressLine3?: string
  AddressLine4?: string
  PostCode?: string
  RatingValue: string
  RatingDate: string | null
  LocalAuthorityName: string
  geocode: { longitude: string | null; latitude: string | null } | null
}

// Shape sent to the ingest_upsert() Postgres function.
export interface RestaurantRow {
  fhrs_id: number
  name: string
  business_type: string
  business_type_id: number | null
  address: string | null
  postcode: string | null
  local_authority: string | null
  lng: number | null
  lat: number | null
  rating_value: string
  rating_date: string | null
  cuisine: string | null
}

async function fsaFetch<T>(path: string, attempt = 0): Promise<T> {
  try {
    const res = await fetch(`${FSA_BASE}${path}`, { headers: HEADERS })
    if (!res.ok) throw new Error(`FSA ${path} -> ${res.status}`)
    return (await res.json()) as T
  } catch (err) {
    // FSA occasionally rate-limits or blips; back off a few times.
    if (attempt >= 4) throw err
    await new Promise((r) => setTimeout(r, 500 * 2 ** attempt))
    return fsaFetch<T>(path, attempt + 1)
  }
}

export async function fetchAuthorities(): Promise<{ id: number; name: string }[]> {
  const data = await fsaFetch<{ authorities: { LocalAuthorityId: number; Name: string }[] }>(
    '/Authorities/basic',
  )
  return data.authorities.map((a) => ({ id: a.LocalAuthorityId, name: a.Name }))
}

export async function fetchEstablishmentsPage(
  authorityId: number,
  pageNumber: number,
  pageSize: number,
): Promise<{ establishments: FsaEstablishment[]; totalPages: number }> {
  const data = await fsaFetch<{
    establishments: FsaEstablishment[]
    meta: { totalPages: number }
  }>(`/Establishments?localAuthorityId=${authorityId}&pageNumber=${pageNumber}&pageSize=${pageSize}`)
  return { establishments: data.establishments ?? [], totalPages: data.meta?.totalPages ?? 1 }
}

export function isDining(businessType: string): boolean {
  return DINING_BUSINESS_TYPES.has(businessType)
}

// FSA has no field distinguishing restaurants from cafes — both share the
// single BusinessType "Restaurant/Cafe/Canteen". Split them ourselves with a
// best-effort name heuristic and store 'Restaurant' or 'Cafe' as our own
// business_type instead of FSA's raw string. Kept in sync with the identical
// heuristic in mobile/lib/fsa.ts (classifyRestaurantOrCafe).
const CAFE_KEYWORDS = /caf[eé]|coffee|tea\s*room|patisserie/i

function normalizedBusinessType(fsaType: string, name: string): string {
  if (fsaType !== 'Restaurant/Cafe/Canteen') return fsaType
  return CAFE_KEYWORDS.test(name) ? 'Cafe' : 'Restaurant'
}

// Cuisine v1: a best-effort name-keyword heuristic, same idea as the
// Restaurant/Cafe split above — FSA has no cuisine field at all, so this is
// the cheap layer that ships before a Google Places backfill can populate a
// real cuisine per venue. First matching pattern wins; most venues won't
// match anything, which just means "no cuisine filter shows this place" —
// still browsable everywhere else. Kept in sync with the identical list in
// mobile/lib/fsa.ts (classifyCuisine), and with migration 0021's one-time
// backfill of pre-existing rows.
const CUISINE_PATTERNS: [string, RegExp][] = [
  ['thai', /\bthai\b/i],
  ['chinese', /\bchinese\b/i],
  ['indian', /\bindian\b|\btandoori\b|\bbalti\b/i],
  ['italian', /\bitalian\b|\btrattoria\b/i],
  ['pizza', /\bpizzas?\b|\bpizzeria\b/i],
  ['burger', /\bburgers?\b/i],
  ['japanese', /\bsushi\b|\bjapanese\b|\bramen\b/i],
  ['mexican', /\bmexican\b|\btaqueria\b|\bburritos?\b/i],
  ['turkish', /\bturkish\b|\bkebabs?\b/i],
  ['fish_and_chips', /\bfish\s*(&|and)\s*chips?\b|\bchippy\b/i],
  ['greek', /\bgreek\b|\btaverna\b/i],
  ['caribbean', /\bcaribbean\b|\bjerk\b/i],
]

export function classifyCuisine(name: string): string | null {
  return CUISINE_PATTERNS.find(([, pattern]) => pattern.test(name))?.[0] ?? null
}

function num(s: string | null | undefined): number | null {
  if (s === null || s === undefined || s === '') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

export function toRow(e: FsaEstablishment): RestaurantRow {
  const address = [e.AddressLine1, e.AddressLine2, e.AddressLine3, e.AddressLine4]
    .map((l) => l?.trim())
    .filter(Boolean)
    .join(', ')

  const lat = num(e.geocode?.latitude ?? null)
  const lng = num(e.geocode?.longitude ?? null)

  return {
    fhrs_id: e.FHRSID,
    name: e.BusinessName,
    business_type: normalizedBusinessType(e.BusinessType, e.BusinessName),
    business_type_id: e.BusinessTypeID ?? null,
    address: address || null,
    postcode: e.PostCode?.trim() || null,
    local_authority: e.LocalAuthorityName ?? null,
    lng,
    lat,
    rating_value: (e.RatingValue ?? '').trim(),
    // FSA sends a meaningless sentinel date (e.g. 1900-01-01) for
    // non-numeric statuses like AwaitingInspection instead of leaving this
    // blank — only keep it for establishments that actually have a rating.
    rating_date: /^[0-5]$/.test((e.RatingValue ?? '').trim()) && e.RatingDate
      ? e.RatingDate.slice(0, 10)
      : null,
    cuisine: classifyCuisine(e.BusinessName),
  }
}
