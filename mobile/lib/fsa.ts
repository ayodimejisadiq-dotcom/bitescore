// FSA FHRS rating helpers + the dining venue types Bitescore includes.
// Kept framework-free so the server can share the same logic if needed.

// Venue types Bitescore shows in filters. FSA lumps restaurants and cafes into
// one BusinessType ("Restaurant/Cafe/Canteen") with no field distinguishing
// them, so we split it ourselves at ingestion time using a name-keyword
// heuristic (see isCafeName below) and store 'Restaurant' or 'Cafe' as our own
// business_type instead of FSA's raw string. Retailers, schools, care homes,
// hospitals etc. are deliberately excluded from Bitescore entirely.
export const DINING_BUSINESS_TYPES = [
  'Restaurant',
  'Cafe',
  'Takeaway/sandwich shop',
  'Pub/bar/nightclub',
  'Mobile caterer',
  'Hotel/bed & breakfast/guest house',
] as const

export type DiningBusinessType = (typeof DINING_BUSINESS_TYPES)[number]

// Short, friendly labels for filter chips.
export const BUSINESS_TYPE_LABEL: Record<string, string> = {
  Restaurant: 'Restaurants',
  Cafe: 'Cafes',
  'Takeaway/sandwich shop': 'Takeaways',
  'Pub/bar/nightclub': 'Pubs & bars',
  'Mobile caterer': 'Mobile caterers',
  'Hotel/bed & breakfast/guest house': 'Hotels & B&Bs',
}

// Keyword heuristic for splitting FSA's combined "Restaurant/Cafe/Canteen"
// category. Best-effort, not exact — a restaurant branded "The Ivy Cafe"
// will be classed as a cafe, and a cafe with no cafe-ish word in its name
// will be classed as a restaurant. Shared by ingestion (server) and any
// client-side reclassification.
const CAFE_KEYWORDS = /caf[eé]|coffee|tea\s*room|patisserie/i

export function classifyRestaurantOrCafe(name: string): 'Restaurant' | 'Cafe' {
  return CAFE_KEYWORDS.test(name) ? 'Cafe' : 'Restaurant'
}

const NUMERIC_RATINGS = new Set(['0', '1', '2', '3', '4', '5'])

export function isNumericRating(rating: string): boolean {
  return NUMERIC_RATINGS.has(rating)
}

// Human label for non-numeric FSA statuses.
export function ratingLabel(rating: string): string {
  if (isNumericRating(rating)) return `${rating} / 5`
  switch (rating) {
    case 'Exempt':
      return 'Exempt'
    case 'AwaitingInspection':
      return 'Awaiting inspection'
    case 'AwaitingPublication':
      return 'Awaiting publication'
    default:
      return rating
  }
}

// Accessible caption of what a numeric score means.
export function ratingDescription(rating: string): string {
  switch (rating) {
    case '5':
      return 'Very good'
    case '4':
      return 'Good'
    case '3':
      return 'Generally satisfactory'
    case '2':
      return 'Improvement necessary'
    case '1':
      return 'Major improvement necessary'
    case '0':
      return 'Urgent improvement necessary'
    default:
      return ratingLabel(rating)
  }
}

// Caption under the score badge. Non-numeric statuses never have a
// meaningful inspection date (FSA sends a placeholder sentinel date for
// these rather than leaving it blank), so those read as a status instead of
// "Last inspected [date]".
export function inspectionStatusLine(rating: string, ratingDate: string | null): string {
  if (isNumericRating(rating) && ratingDate) {
    const formatted = new Date(ratingDate).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })
    return `Last inspected ${formatted} · Food Standards Agency`
  }
  switch (rating) {
    case 'AwaitingInspection':
      return 'Registered — awaiting first inspection · Food Standards Agency'
    case 'AwaitingPublication':
      return 'Inspected — rating awaiting publication · Food Standards Agency'
    case 'Exempt':
      return 'Exempt from inspection · Food Standards Agency'
    default:
      return 'Food Standards Agency'
  }
}

// FSA data is a point-in-time snapshot — surfaced in the UI near every score.
export const FSA_ATTRIBUTION =
  'Food hygiene ratings © Crown copyright, Food Standards Agency, under the Open Government Licence. Ratings reflect the last inspection and may be out of date.'
