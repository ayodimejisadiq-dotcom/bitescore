// Typography — one family, Inter, bundled via @expo-google-fonts and loaded in
// app/_layout.tsx.
//
// This used to be two families: Bricolage Grotesque for every display role and
// DM Sans for body. Bricolage is a personality typeface — flared stems, wide
// quirky counters — and at the sizes this app uses it (34px place names, 44px
// hero numerals) the personality was doing the talking instead of the score.
// Inter is deliberately characterless: it was drawn for UI, so it stays out of
// the way and lets the colour system and the score tiles carry the brand.
//
// The role names are kept as-is so call sites don't move. `display*` is now a
// weight distinction rather than a family one — a single family across the
// whole app is the simpler system, and Inter's weight ramp is wide enough to
// carry the hierarchy on its own.

export const fonts = {
  display600: 'Inter_600SemiBold',
  display800: 'Inter_700Bold',
  body: 'Inter_400Regular',
  bodyMedium: 'Inter_500Medium',
  bodyBold: 'Inter_700Bold',
} as const
