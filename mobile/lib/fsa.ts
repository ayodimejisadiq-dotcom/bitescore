// FSA FHRS rating helpers + the dining venue types Bitescore includes.
// Kept framework-free so the server can share the same logic if needed.

// FSA BusinessType strings for "places you eat out". Retailers, schools, care
// homes, hospitals etc. are deliberately excluded from Bitescore.
export const DINING_BUSINESS_TYPES = [
  'Restaurant/Cafe/Canteen',
  'Takeaway/sandwich shop',
  'Pub/bar/nightclub',
  'Mobile caterer',
  'Hotel/bed & breakfast/guest house',
] as const

export type DiningBusinessType = (typeof DINING_BUSINESS_TYPES)[number]

// Short, friendly labels for filter chips.
export const BUSINESS_TYPE_LABEL: Record<string, string> = {
  'Restaurant/Cafe/Canteen': 'Restaurants & cafes',
  'Takeaway/sandwich shop': 'Takeaways',
  'Pub/bar/nightclub': 'Pubs & bars',
  'Mobile caterer': 'Mobile caterers',
  'Hotel/bed & breakfast/guest house': 'Hotels & B&Bs',
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

// FSA data is a point-in-time snapshot — surfaced in the UI near every score.
export const FSA_ATTRIBUTION =
  'Food hygiene ratings © Crown copyright, Food Standards Agency, under the Open Government Licence. Ratings reflect the last inspection and may be out of date.'
