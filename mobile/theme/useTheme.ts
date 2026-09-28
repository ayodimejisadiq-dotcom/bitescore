import { palette, type Palette } from './colors'

export type { Palette }

// One light appearance for now; dark mode is a later pass.
export function useTheme(): Palette {
  return palette
}
