import { palette, type Palette } from './colors'

export type { Palette }

// The redesign defines a single warm light appearance — the cream canvas and
// score colours are the brand, so dark mode intentionally renders the same.
export function useTheme(): Palette {
  return palette
}
