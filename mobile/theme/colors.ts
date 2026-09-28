// Bitescore design system — the iOS-native redesign. White cards on the
// system grouped background, system greys, and one green accent. The FSA
// score scale is the only saturated colour; hero areas use a soft tint of it.

export const palette = {
  // Accent
  tint: '#047B42', // buttons, links, active tab
  tintPressed: '#035E33',
  tintSoft: '#E3F1E8', // soft green fill: follow pills, "+" button, visited state
  tintDisabled: '#A8CDB8',

  // Surfaces
  bg: '#F2F2F7', // system grouped background
  fill: '#E4E4EA', // search field, segmented control
  card: '#FFFFFF',

  // Text
  label: '#1C1C1E',
  label2: '#3C3C43', // secondary label
  meta: '#8E8E93', // tertiary label, section headers, placeholders

  // Lines & controls
  separator: '#E5E5EA',
  chevron: '#C7C7CC', // chevrons, inactive bits, "matches" bar
  tabBorder: '#D1D1D6',

  // Status
  success: '#248A3D',
  switchOn: '#34C759', // iOS switch, "cleaner" bar
  blue: '#0A84FF', // location
  danger: '#E24B29',
}

export type Palette = typeof palette

// FSA score scale. `fill` is the badge/pin colour.
export const scoreFill: Record<string, string> = {
  '5': '#046A38',
  '4': '#5EA632',
  '3': '#F2A31C',
  '2': '#EF7B22',
  '1': '#E24B29',
  '0': '#C0362C',
}

// Soft tint behind hero areas, and the darker tone used for text on it.
const heroTint: Record<string, string> = {
  '5': '#E3F1E8',
  '4': '#EAF3E1',
  '3': '#FCF0DA',
  '2': '#FDEBDD',
  '1': '#FBE4DE',
  '0': '#F8E1DF',
}

const heroText: Record<string, string> = {
  '5': '#046A38',
  '4': '#3F7A1E',
  '3': '#8A5A00',
  '2': '#A04A0E',
  '1': '#A8321A',
  '0': '#8E231C',
}

// Non-numeric ratings (Exempt, AwaitingInspection, …) render neutral.
export const NEUTRAL_RATING = '#AEAEB2'

export function colorForRating(rating: string): string {
  return scoreFill[rating] ?? NEUTRAL_RATING
}

// 3 is the one score light enough to need dark text.
export function textOnRating(rating: string): string {
  return rating === '3' ? '#1C1C1E' : '#FFFFFF'
}

export function heroTintForRating(rating: string): string {
  return heroTint[rating] ?? '#EFEFF4'
}

export function heroTextForRating(rating: string): string {
  return heroText[rating] ?? '#636366'
}

// Initials avatars until people upload photos. Picked by hashing the user id,
// so the same person is always the same colour.
const AVATAR_TINTS: { bg: string; fg: string }[] = [
  { bg: '#FFE1D1', fg: '#A0461C' },
  { bg: '#DCE8FF', fg: '#2A5BB8' },
  { bg: '#F1E3FF', fg: '#7A3DB8' },
  { bg: '#FFF1C9', fg: '#8A6400' },
  { bg: '#DDF3F0', fg: '#1E7A6E' },
  { bg: '#FFE0E6', fg: '#B0324F' },
]

export function avatarTint(id: string): { bg: string; fg: string } {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
  return AVATAR_TINTS[Math.abs(h) % AVATAR_TINTS.length]
}
