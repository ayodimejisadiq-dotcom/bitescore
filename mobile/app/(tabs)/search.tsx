import { useEffect, useRef, useState } from 'react'
import {
  View,
  Text,
  TextInput,
  FlatList,
  StyleSheet,
  ActivityIndicator,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import * as Location from 'expo-location'
import { useRouter } from 'expo-router'
import { useTheme } from '@/theme/useTheme'
import { RestaurantRow } from '@/components/RestaurantRow'
import { FilterChips } from '@/components/FilterChips'
import { useFilters } from '@/hooks/useFilters'
import { fetchNear, searchRestaurants } from '@/lib/data'
import { errorMessage } from '@/lib/errors'
import type { BrowseFilters, RestaurantNear } from '@/lib/types'

export default function SearchScreen() {
  const c = useTheme()
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<RestaurantNear[]>([])
  const [loading, setLoading] = useState(false)
  const [nearbyMode, setNearbyMode] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filters, setFilters, filtersLoaded] = useFilters()
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  const loadNearby = async (f: BrowseFilters) => {
    setLoading(true)
    setError(null)
    try {
      const { status } = await Location.requestForegroundPermissionsAsync()
      if (status !== 'granted') return
      const pos = await Location.getCurrentPositionAsync({})
      setResults(
        await fetchNear({ lng: pos.coords.longitude, lat: pos.coords.latitude }, 2000, f),
      )
    } catch (e) {
      // Location errors here are expected (permission not granted yet); only
      // surface database/network failures.
      if (e instanceof Error && !/location/i.test(e.message)) setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  // Empty query → show places near the user. Waits for persisted filters to
  // load first so this initial fetch already reflects the user's last
  // settings instead of firing once with defaults.
  useEffect(() => {
    if (!filtersLoaded) return
    loadNearby(filters)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersLoaded])

  const onChange = (text: string) => {
    setQuery(text)
    if (debounce.current) clearTimeout(debounce.current)
    if (!text.trim()) {
      setNearbyMode(true)
      return
    }
    setNearbyMode(false)
    debounce.current = setTimeout(async () => {
      setLoading(true)
      setError(null)
      try {
        setResults(await searchRestaurants(text, filters))
      } catch (e) {
        setError(errorMessage(e))
        setResults([])
      } finally {
        setLoading(false)
      }
    }, 300)
  }

  const onFiltersChange = (next: BrowseFilters) => {
    setFilters(next)
    if (nearbyMode) {
      loadNearby(next)
      return
    }
    const q = query.trim()
    if (!q) return
    setLoading(true)
    setError(null)
    searchRestaurants(q, next)
      .then(setResults)
      .catch((e) => {
        setError(errorMessage(e))
        setResults([])
      })
      .finally(() => setLoading(false))
  }

  return (
    <SafeAreaView edges={['top']} style={[styles.root, { backgroundColor: c.bg }]}>
      <View style={styles.head}>
        <TextInput
          value={query}
          onChangeText={onChange}
          placeholder="Search places or a postcode"
          placeholderTextColor={c.subtext}
          autoCapitalize="none"
          autoCorrect={false}
          style={[styles.input, { backgroundColor: c.card, color: c.text, borderColor: c.border }]}
        />
      </View>
      <FilterChips filters={filters} onChange={onFiltersChange} />
      {error ? (
        <View style={styles.errorBox}>
          <Text style={[styles.errorTitle, { color: c.text }]}>Couldn't load results</Text>
          <Text style={[styles.errorDetail, { color: c.subtext }]}>{error}</Text>
        </View>
      ) : loading ? (
        <ActivityIndicator style={{ marginTop: 24 }} color={c.primary} />
      ) : (
        <FlatList
          data={results}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={
            <Text style={[styles.section, { color: c.subtext }]}>
              {nearbyMode ? 'Near you' : `Results for “${query.trim()}”`}
            </Text>
          }
          ListEmptyComponent={
            <Text style={[styles.empty, { color: c.subtext }]}>
              {nearbyMode
                ? 'Turn on location, or search by name or postcode.'
                : 'No matches. Try a different spelling or a postcode.'}
            </Text>
          }
          renderItem={({ item }) => (
            <RestaurantRow item={item} onPress={() => router.push(`/restaurant/${item.id}`)} />
          )}
        />
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  head: { paddingHorizontal: 14, paddingTop: 6, paddingBottom: 8 },
  input: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  section: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
  },
  empty: { textAlign: 'center', marginTop: 40, paddingHorizontal: 40, fontSize: 15, lineHeight: 22 },
  errorBox: { marginTop: 40, paddingHorizontal: 32, alignItems: 'center', gap: 6 },
  errorTitle: { fontSize: 16, fontWeight: '700' },
  errorDetail: { fontSize: 13, textAlign: 'center', lineHeight: 19 },
})
