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
