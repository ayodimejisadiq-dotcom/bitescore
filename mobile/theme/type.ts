import type { TextStyle } from 'react-native'

// The iOS system font (SF Pro) throughout — no fontFamily is ever set, only
// size, weight and tracking, per the type scale in the design handoff.
export const type = {
  largeTitle: { fontSize: 34, fontWeight: '700', letterSpacing: -0.6 },
  heroName: { fontSize: 27, fontWeight: '700', letterSpacing: -0.5 },
  title2: { fontSize: 22, fontWeight: '700', letterSpacing: -0.3 },
  headline: { fontSize: 17, fontWeight: '600' },
  body: { fontSize: 17, fontWeight: '400' },
  callout: { fontSize: 16, fontWeight: '400' },
  subhead: { fontSize: 15, fontWeight: '400' },
  footnote: { fontSize: 14, fontWeight: '400' },
  caption: { fontSize: 13, fontWeight: '400' },
  caption2: { fontSize: 12, fontWeight: '400' },
} satisfies Record<string, TextStyle>
