import { useEffect, useMemo, useRef, useState } from 'react'
import {
  View,
  Text,
  TextInput,
  FlatList,
  Pressable,
  StyleSheet,
  ActivityIndicator,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import * as Location from 'expo-location'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '@/theme/useTheme'
import { fonts } from '@/theme/type'
import { RestaurantRow } from '@/components/RestaurantRow'
import { FilterChips } from '@/components/FilterChips'
import { BadgeFan } from '@/components/BadgeFan'
import { useFilters } from '@/hooks/useFilters'
import { fetchNear, searchRestaurants } from '@/lib/data'
import { isNumericRating } from '@/lib/fsa'
import { errorMessage } from '@/lib/errors'
import type { BrowseFilters, RestaurantNear } from '@/lib/types'

type Sort = 'closest' | 'score'

export default function SearchScreen() {
  const c = useTheme()
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<RestaurantNear[]>([])
  const [loading, setLoading] = useState(false)
  const [nearbyMode, setNearbyMode] = useState(true)
  const [sort, setSort] = useState<Sort>('closest')
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

  // Local re-sort only — "closest" preserves the server's distance order.
  const sorted = useMemo(() => {
    if (sort === 'closest') return results
    return [...results].sort((a, b) => {
      const av = isNumericRating(a.rating_value) ? Number(a.rating_value) : -1
      const bv = isNumericRating(b.rating_value) ? Number(b.rating_value) : -1
      return bv - av
    })
  }, [results, sort])

  return (
    <SafeAreaView edges={['top']} style={[styles.root, { backgroundColor: c.bg }]}>
      <View style={styles.head}>
        <View style={[styles.search, { backgroundColor: c.card, borderColor: c.controlBorder }]}>
          <Ionicons name="search" size={19} color={c.primary} />
          <TextInput
            value={query}
            onChangeText={onChange}
            placeholder="Search places or a postcode"
            placeholderTextColor={c.placeholder}
            autoCapitalize="none"
            autoCorrect={false}
            style={[styles.input, { color: c.text }]}
          />
        </View>
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
          data={sorted}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingTop: 12, paddingBottom: 24 }}
          ListHeaderComponent={
            <View style={styles.sectionRow}>
              <Text style={[styles.section, { color: c.placeholder }]}>
                {nearbyMode ? 'NEAR YOU' : `RESULTS FOR “${query.trim().toUpperCase()}”`}
              </Text>
              <Pressable
                onPress={() => setSort(sort === 'closest' ? 'score' : 'closest')}
                hitSlop={8}
              >
                <Text style={[styles.sort, { color: c.primary }]}>
                  Sort: {sort === 'closest' ? 'closest' : 'score'}
                </Text>
              </Pressable>
            </View>
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <BadgeFan />
              <Text style={[styles.emptyTitle, { color: c.text }]}>Nothing here yet</Text>
              <Text style={[styles.emptyBody, { color: c.subtext }]}>
                {nearbyMode
                  ? 'Turn on location, or search by name or postcode.'
                  : 'No matches — try a different spelling or a wider area.'}
              </Text>
            </View>
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
  head: { paddingHorizontal: 14, paddingTop: 6, paddingBottom: 11 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 15,
    height: 50,
    borderRadius: 17,
    borderWidth: 1.5,
  },
  input: { flex: 1, fontSize: 16, fontFamily: fonts.body, padding: 0 },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  section: {
    fontSize: 11.5,
    fontFamily: fonts.display600,
    letterSpacing: 1.5,
  },
  sort: { fontSize: 12.5, fontFamily: fonts.bodyMedium },
  empty: { alignItems: 'center', marginTop: 48, paddingHorizontal: 40 },
  emptyTitle: { fontSize: 24, fontFamily: fonts.display800 },
  emptyBody: {
    fontSize: 15,
    fontFamily: fonts.body,
    textAlign: 'center',
    lineHeight: 23,
    marginTop: 8,
    maxWidth: 280,
  },
  errorBox: { marginTop: 40, paddingHorizontal: 32, alignItems: 'center', gap: 6 },
  errorTitle: { fontSize: 16, fontFamily: fonts.display600 },
  errorDetail: { fontSize: 13, fontFamily: fonts.body, textAlign: 'center', lineHeight: 19 },
})
