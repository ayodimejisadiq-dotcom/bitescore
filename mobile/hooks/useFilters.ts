import { useEffect, useState } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { EMPTY_FILTERS, type BrowseFilters } from '@/lib/types'

const STORAGE_KEY = 'bitescore.filters'

// Rating/type/hide-awaiting-inspection filters, shared by the Map and Search
// tabs and persisted across launches — a choice made on one tab carries to
// the other and survives a relaunch. `loaded` tells callers when the
// persisted value (if any) has been read, so the first fetch of a screen can
// wait for it instead of firing once with defaults and again once real.
export function useFilters(): [BrowseFilters, (next: BrowseFilters) => void, boolean] {
  const [filters, setFiltersState] = useState<BrowseFilters>(EMPTY_FILTERS)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (raw) setFiltersState({ ...EMPTY_FILTERS, ...JSON.parse(raw) })
      })
      .catch(() => {
        // No persisted value yet, or it's corrupt — defaults are fine.
      })
      .finally(() => setLoaded(true))
  }, [])

  const setFilters = (next: BrowseFilters) => {
    setFiltersState(next)
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {})
  }

  return [filters, setFilters, loaded]
}
