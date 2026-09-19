import { useEffect, useState } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'

const STORAGE_KEY = 'bitescore.searchHistory'
const MAX_ITEMS = 8

// Recent search queries typed into the Search tab, most-recent-first and
// persisted across launches so the search bar can offer them again. Kept
// local to this device (AsyncStorage): capped at MAX_ITEMS, de-duplicated
// case-insensitively (a repeat just moves back to the front), and blank
// queries are ignored. `loaded` tells callers when the persisted list has
// been read.
export interface SearchHistory {
  history: string[]
  loaded: boolean
  add: (query: string) => void
  remove: (query: string) => void
  clear: () => void
}

export function useSearchHistory(): SearchHistory {
  const [history, setHistory] = useState<string[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (raw) setHistory(JSON.parse(raw))
      })
      .catch(() => {
        // No persisted history yet, or it's corrupt — an empty list is fine.
      })
      .finally(() => setLoaded(true))
  }, [])

  // The list is tiny, so a full rewrite on each change is fine. Failures are
  // non-essential and never surfaced.
  const save = (next: string[]) => {
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {})
  }

  const add = (query: string) => {
    const q = query.trim()
    if (!q) return
    setHistory((prev) => {
      const next = [q, ...prev.filter((h) => h.toLowerCase() !== q.toLowerCase())].slice(
        0,
        MAX_ITEMS,
      )
      save(next)
      return next
    })
  }

  const remove = (query: string) => {
    setHistory((prev) => {
      const next = prev.filter((h) => h !== query)
      save(next)
      return next
    })
  }

  const clear = () => {
    setHistory([])
    save([])
  }

  return { history, loaded, add, remove, clear }
}
