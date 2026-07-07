import { useColorScheme } from 'react-native'
import { dark, light } from './colors'

export type Palette = typeof light

export function useTheme(): Palette {
  const scheme = useColorScheme()
  return scheme === 'dark' ? dark : light
}
