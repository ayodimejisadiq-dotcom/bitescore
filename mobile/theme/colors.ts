// Bitescore design system — "hygiene score foodmap" redesign. Warm cream
// surfaces, one saturated colour family (the FSA score scale), physical
// tile shadows. Tokens follow the design handoff spec.

export const brand = {
  primary: '#046A38',
  primaryDark: '#02522B',
  primaryTint: '#E4EEDC',
}

// FSA score scale — the only saturated colours in the app. `fill` is the
// badge/pin colour, `edge` the dark bottom-edge shadow that makes badges
// read as physical tiles.
export const scoreFill: Record<string, string> = {
  '5': '#046A38',
  '4': '#5EA632',
  '3': '#F2A31C',
  '2': '#EF7B22',
  '1': '#E24B29',
  '0': '#C0362C',
}

export const scoreEdge: Record<string, string> = {
  '5': '#02522B',
  '4': '#4A8626',
  '3': '#D18C0C',
  '2': '#CF6412',
  '1': '#C13A1C',
  '0': '#9E2A22',
}

// Non-numeric ratings (Exempt, AwaitingInspection, …) render neutral.
export const NEUTRAL_RATING = '#B4AE9A'

export function colorForRating(rating: string): string {
  return scoreFill[rating] ?? NEUTRAL_RATING
}

export function edgeForRating(rating: string): string {
  return scoreEdge[rating] ?? '#9A947F'
}

// Kept for compatibility with older call sites.
export const ratingColor = scoreFill

export const palette = {
  // Surfaces
  bg: '#F7F2E7', // canvas
  card: '#FFFDF7',
  border: '#E7DFCC', // card border
  rowBorder: '#EBE3D1', // list-row card border, slightly lighter
  controlBorder: '#E4DBC8', // search bar & filter chips
  dashedBorder: '#D9CFB5',
  dashedBorderDark: '#C9C0A9',
  subtleFill: '#F0EDE0', // secondary button, today-row pill, progress track
  lockedFill: '#EDE7D8',

  // Text
  text: '#17170F', // ink — also used as the dark-card fill
  inkSecondary: '#5B584B',
  subtext: '#7A7768', // muted, on canvas
  mutedOnCard: '#8B8775',
  placeholder: '#9D9884',
  disabled: '#B4AE9A',
  onDarkMuted: '#A9A594',
  legal: '#A29D8A',
  chipText: '#3F3D33',

  // Accents
  accent: '#E2552B', // ember — streak, "changed" flag, add-review CTA
  accentDark: '#C0431F',
  openNow: '#3F7C1F',
  goldRing: '#F1C34A',
  userDot: '#2C7BE5',
  star: '#F2A31C',

  ...brand,
}

export type Palette = typeof palette
