// Bitescore palette — clean, Apple-esque. Light/dark aware values live in
// useTheme(); these are the brand + semantic constants.

export const brand = {
  // Fresh green, evokes hygiene/health.
  primary: '#0A7C4A',
  primaryDark: '#065C36',
  primaryTint: '#E6F4EC',
}

// Official FSA-style rating colours (green = good, red = poor). Used for the
// score badge and map pins so ratings read instantly.
export const ratingColor: Record<string, string> = {
  '5': '#0E8A43',
  '4': '#5BB318',
  '3': '#F5A800',
  '2': '#F27900',
  '1': '#E4572E',
  '0': '#C1121F',
}

// Non-numeric ratings render neutral.
export const NEUTRAL_RATING = '#8E8E93'

export function colorForRating(rating: string): string {
  return ratingColor[rating] ?? NEUTRAL_RATING
}

// Grey-to-green scale for the minimum-rating filter control (distinct from the
// FSA red→green badge scale above — this one just shows "how strict" the
// filter is, muted at 0 rising to full brand green at 5).
const FILTER_GREY = { r: 0xb8, g: 0xbd, b: 0xba }
const FILTER_GREEN = { r: 0x0a, g: 0x7c, b: 0x4a } // brand.primary

export function greyToGreen(step: number, max = 5): string {
  const t = Math.max(0, Math.min(1, step / max))
  const r = Math.round(FILTER_GREY.r + (FILTER_GREEN.r - FILTER_GREY.r) * t)
  const g = Math.round(FILTER_GREY.g + (FILTER_GREEN.g - FILTER_GREY.g) * t)
  const b = Math.round(FILTER_GREY.b + (FILTER_GREEN.b - FILTER_GREY.b) * t)
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

export const light = {
  bg: '#FFFFFF',
  card: '#F2F2F7',
  text: '#1C1C1E',
  subtext: '#6E6E73',
  border: '#E5E5EA',
  ...brand,
}

export const dark = {
  bg: '#000000',
  card: '#1C1C1E',
  text: '#FFFFFF',
  subtext: '#98989F',
  border: '#2C2C2E',
  ...brand,
}
