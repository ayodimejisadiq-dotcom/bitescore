import AsyncStorage from '@react-native-async-storage/async-storage'

// What the user last searched for, shown under the search bar when it's
// focused and empty. On this device only: nothing is sent to the server.

const STORE_KEY = 'bitescore.recentSearches.v1'
const MAX = 8

export async function getRecentSearches(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(STORE_KEY)
    const list = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(list) ? list.filter((s): s is string => typeof s === 'string') : []
  } catch {
    return []
  }
}

async function write(list: string[]): Promise<string[]> {
  await AsyncStorage.setItem(STORE_KEY, JSON.stringify(list)).catch(() => {})
  return list
}

// Newest first; searching the same thing again moves it back to the top
// rather than listing it twice ("Nandos" and "nandos" count as the same).
export async function addRecentSearch(query: string): Promise<string[]> {
  const q = query.trim().replace(/\s+/g, ' ')
  const list = await getRecentSearches()
  if (q.length < 2) return list
  const rest = list.filter((s) => s.toLowerCase() !== q.toLowerCase())
  return write([q, ...rest].slice(0, MAX))
}

export async function removeRecentSearch(query: string): Promise<string[]> {
  return write((await getRecentSearches()).filter((s) => s !== query))
}

export async function clearRecentSearches(): Promise<string[]> {
  return write([])
}
