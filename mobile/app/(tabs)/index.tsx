import { memo, useCallback, useEffect, useRef, useState } from 'react'
import {
  View,
  Text,
  TextInput,
  FlatList,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Alert,
  Linking,
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import MapView, { Marker, type Region } from 'react-native-maps'
import * as Location from 'expo-location'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '@/theme/useTheme'
import { fonts } from '@/theme/type'
import { colorForRating, edgeForRating, NEUTRAL_RATING } from '@/theme/colors'
import { tileEdge } from '@/components/ui'
import { FilterChips } from '@/components/FilterChips'
import { useFilters } from '@/hooks/useFilters'
import { isNumericRating, BUSINESS_TYPE_LABEL } from '@/lib/fsa'
import { fetchPins, fetchClusters, searchRestaurants, type Bounds } from '@/lib/data'
import { isSupabaseConfigured } from '@/lib/supabase'
import { errorMessage } from '@/lib/errors'
import { RestaurantRow } from '@/components/RestaurantRow'
import type { BrowseFilters, RestaurantCluster, RestaurantPin, RestaurantNear } from '@/lib/types'

// Central London as a sensible default until we have the user's location.
const DEFAULT_REGION: Region = {
  latitude: 51.5116,
  longitude: -0.1226,
  latitudeDelta: 0.03,
  longitudeDelta: 0.03,
}

function regionToBounds(r: Region): Bounds {
  return {
    minLng: r.longitude - r.longitudeDelta / 2,
    maxLng: r.longitude + r.longitudeDelta / 2,
    minLat: r.latitude - r.latitudeDelta / 2,
    maxLat: r.latitude + r.latitudeDelta / 2,
  }
}

// Above this span, individual pins are both unreadable and far too much native
// work — a viewport this size covers tens of thousands of venues. We switch to
// server-computed cluster bubbles instead. Chosen to sit above the 0.2 delta a
// town-name search lands on, so that still shows real pins.
const MAX_PIN_DELTA = 0.6

// Score pin: rounded tile with a rotated-square pointer tail; 5s carry the
// gold ring so the best places pop in a cluster.
function ScorePin({ pin }: { pin: RestaurantPin }) {
  const fill = colorForRating(pin.rating_value)
  const numeric = isNumericRating(pin.rating_value)
  const isFive = pin.rating_value === '5'
  const size = isFive ? 38 : 34
  return (
    <View style={styles.pinWrap}>
      <View
        style={[
          styles.pinTile,
          {
            backgroundColor: fill,
            width: size,
            height: size,
            borderRadius: size * 0.35,
          },
          isFive ? { borderWidth: 2.5, borderColor: '#F1C34A' } : null,
        ]}
      >
        <Text style={[styles.pinText, { fontSize: size * 0.5 }]}>
          {numeric ? pin.rating_value : '–'}
        </Text>
      </View>
      <View style={[styles.pinTail, { backgroundColor: isFive ? '#F1C34A' : fill }]} />
    </View>
  )
}

// Memoised so that selecting a pin — or any other state change on this screen —
// doesn't reconcile every marker on the map. Only the id and the tracking flag
// can change what a marker renders.
const ScoreMarker = memo(
  function ScoreMarker({
    pin,
    tracking,
    onSelect,
  }: {
    pin: RestaurantPin
    tracking: boolean
    onSelect: (pin: RestaurantPin) => void
  }) {
    return (
      <Marker
        coordinate={{ latitude: pin.lat, longitude: pin.lng }}
        onPress={(e) => {
          e.stopPropagation()
          onSelect(pin)
        }}
        anchor={{ x: 0.5, y: 1 }}
        // The important one. react-native-maps defaults this to true, which
        // re-rasterises every custom marker view continuously, for every
        // marker, forever. With a screenful of pins that is enough native work
        // to run the app out of memory while panning. We only need it true
        // briefly, until each marker has drawn once.
        tracksViewChanges={tracking}
      >
        <ScorePin pin={pin} />
      </Marker>
    )
  },
  (a, b) => a.pin.id === b.pin.id && a.tracking === b.tracking,
)

// A cluster bubble sized by how many venues it covers, coloured by the best
// rating in it. Tapping zooms into that cell.
const ClusterMarker = memo(
  function ClusterMarker({
    cluster,
    tracking,
    onZoom,
  }: {
    cluster: RestaurantCluster
    tracking: boolean
    onZoom: (cluster: RestaurantCluster) => void
  }) {
    const size = cluster.n >= 1000 ? 60 : cluster.n >= 250 ? 52 : cluster.n >= 50 ? 46 : 40
    const fill = cluster.best_rating ? colorForRating(cluster.best_rating) : NEUTRAL_RATING
    const edge = cluster.best_rating ? edgeForRating(cluster.best_rating) : '#9A947F'
    const label = cluster.n >= 1000 ? `${Math.round(cluster.n / 100) / 10}k` : String(cluster.n)
    return (
      <Marker
        coordinate={{ latitude: cluster.lat, longitude: cluster.lng }}
        onPress={(e) => {
          e.stopPropagation()
          onZoom(cluster)
        }}
        tracksViewChanges={tracking}
      >
        <View
          style={[
            styles.cluster,
            { backgroundColor: fill, width: size, height: size, borderRadius: size / 2 },
            tileEdge(edge, 3),
          ]}
        >
          <Text style={[styles.clusterText, { fontSize: size * 0.32 }]}>{label}</Text>
        </View>
      </Marker>
    )
  },
  (a, b) =>
    a.cluster.lat === b.cluster.lat &&
    a.cluster.lng === b.cluster.lng &&
    a.cluster.n === b.cluster.n &&
    a.tracking === b.tracking,
)

export default function MapScreen() {
  const c = useTheme()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const mapRef = useRef<MapView | null>(null)
  const regionRef = useRef<Region>(DEFAULT_REGION)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [filters, setFilters, filtersLoaded] = useFilters()
  const [pins, setPins] = useState<RestaurantPin[]>([])
  const [selected, setSelected] = useState<RestaurantPin | null>(null)
  const [loading, setLoading] = useState(false)
  const [pinError, setPinError] = useState<string | null>(null)
  const [emptyHere, setEmptyHere] = useState(false)
  const [clusters, setClusters] = useState<RestaurantCluster[]>([])
  // Markers need to draw once before we can stop tracking view changes; see
  // ScoreMarker. Re-armed whenever the pin set changes.
  const [tracking, setTracking] = useState(true)
  const latestRequest = useRef(0)
  const [locating, setLocating] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<RestaurantNear[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async (region: Region, f: BrowseFilters) => {
    // Panning fast fires several of these, and they can return out of order.
    // Without a guard the map thrashes: a stale response replaces a newer one,
    // every marker is torn down and rebuilt, and the work compounds with each
    // pan. Only the newest request is allowed to write state.
    const requestId = ++latestRequest.current

    const clustered = region.latitudeDelta > MAX_PIN_DELTA
    setLoading(true)
    try {
      if (clustered) {
        const cells = await fetchClusters(regionToBounds(region), f)
        if (requestId !== latestRequest.current) return
        setPins([])
        setClusters(cells)
        setPinError(null)
        setEmptyHere(cells.length === 0)
        return
      }
      const next = await fetchPins(regionToBounds(region), f)
      if (requestId !== latestRequest.current) return
      setClusters([])
      setPins(next)
      setPinError(null)
      // An empty viewport is not an error — FSA coverage is patchy outside
      // ingested authorities — but say so, rather than showing a bare map
      // that's indistinguishable from a failed query.
      setEmptyHere(next.length === 0)
    } catch (e) {
      if (requestId !== latestRequest.current) return
      // Previously swallowed, which made a misconfigured build look identical
      // to an area with no venues. Surface it.
      setPinError(errorMessage(e))
    } finally {
      if (requestId === latestRequest.current) setLoading(false)
    }
  }, [])

  // Shared by first launch and the "my location" button, so both recentre and
  // reload pins the same way.
  const recenterOnUser = useCallback(
    async (opts: { promptIfDenied: boolean }) => {
      setLocating(true)
      try {
        let { status } = await Location.getForegroundPermissionsAsync()
        if (status !== 'granted') {
          ;({ status } = await Location.requestForegroundPermissionsAsync())
        }
        if (status !== 'granted') {
          if (opts.promptIfDenied) {
            Alert.alert(
              'Location access needed',
              'Turn on location access for Bitescore in Settings to centre the map on where you are.',
              [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Open Settings', onPress: () => Linking.openSettings() },
              ],
            )
          }
          load(regionRef.current, filters)
          return
        }
        const pos = await Location.getCurrentPositionAsync({})
        const region: Region = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          latitudeDelta: 0.03,
          longitudeDelta: 0.03,
        }
        regionRef.current = region
        mapRef.current?.animateToRegion(region, 500)
        load(region, filters)
      } catch {
        load(regionRef.current, filters)
      } finally {
        setLocating(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filters],
  )

  // On first launch, try to centre on the user without nagging if denied.
  // Waits for persisted filters to load first so this initial fetch already
  // reflects the user's last settings instead of firing once with defaults.
  useEffect(() => {
    if (!filtersLoaded) return
    recenterOnUser({ promptIfDenied: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersLoaded])

  const onSearchChange = (text: string) => {
    setSearchQuery(text)
    setSearchError(null)
    if (searchDebounce.current) clearTimeout(searchDebounce.current)
    if (!text.trim()) {
      setSearchResults([])
      return
    }
    searchDebounce.current = setTimeout(async () => {
      setSearchLoading(true)
      try {
        setSearchResults(await searchRestaurants(text, filters))
      } catch (e) {
        setSearchError(errorMessage(e))
        setSearchResults([])
      } finally {
        setSearchLoading(false)
      }
    }, 300)
  }

  // Give markers a moment to rasterise after the set changes, then stop
  // tracking view changes so they stop re-rendering natively on every frame.
  useEffect(() => {
    if (pins.length === 0 && clusters.length === 0) return
    setTracking(true)
    const t = setTimeout(() => setTracking(false), 600)
    return () => clearTimeout(t)
  }, [pins, clusters])

  const onSelectPin = useCallback((pin: RestaurantPin) => setSelected(pin), [])

  // Tapping a cluster dives into that cell rather than making the user pinch
  // their way down. Four-fold zoom keeps the tapped area comfortably in frame.
  const onZoomToCluster = useCallback((cluster: RestaurantCluster) => {
    const region: Region = {
      latitude: cluster.lat,
      longitude: cluster.lng,
      latitudeDelta: Math.max(regionRef.current.latitudeDelta / 4, 0.02),
      longitudeDelta: Math.max(regionRef.current.longitudeDelta / 4, 0.02),
    }
    regionRef.current = region
    mapRef.current?.animateToRegion(region, 400)
  }, [])

  const onRegionChangeComplete = (region: Region) => {
    regionRef.current = region
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(() => load(region, filters), 400)
  }

  const onFilters = (next: BrowseFilters) => {
    setFilters(next)
    load(regionRef.current, next)
  }

  const selectedCategory = selected
    ? (BUSINESS_TYPE_LABEL[selected.business_type] ?? selected.business_type)
    : null

  return (
    <View style={styles.root}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={DEFAULT_REGION}
        showsUserLocation
        onRegionChangeComplete={onRegionChangeComplete}
        onPress={() => setSelected(null)}
      >
        {pins.map((p) => (
          <ScoreMarker key={p.id} pin={p} tracking={tracking} onSelect={onSelectPin} />
        ))}
        {clusters.map((cl) => (
          <ClusterMarker
            key={`${cl.lng.toFixed(4)},${cl.lat.toFixed(4)}`}
            cluster={cl}
            tracking={tracking}
            onZoom={onZoomToCluster}
          />
        ))}
      </MapView>

      <SafeAreaView edges={['top']} style={styles.overlay} pointerEvents="box-none">
        <View style={[styles.search, { backgroundColor: c.card, borderColor: c.controlBorder }]}>
          <Ionicons name="search" size={19} color={c.primary} />
          <TextInput
            value={searchQuery}
            onChangeText={onSearchChange}
            placeholder="Search restaurants"
            placeholderTextColor={c.placeholder}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            style={[styles.searchInput, { color: c.text }]}
          />
          {searchLoading ? (
            <ActivityIndicator size="small" color={c.primary} />
          ) : searchQuery ? (
            <Pressable
              onPress={() => { setSearchQuery(''); setSearchResults([]) }}
              hitSlop={8}
            >
              <Ionicons name="close-circle" size={18} color={c.placeholder} />
            </Pressable>
          ) : null}
        </View>
        <FilterChips filters={filters} onChange={onFilters} />
        {searchQuery ? (
          searchError ? (
            <View style={[styles.errorBanner, { backgroundColor: c.card, borderColor: c.controlBorder }]}>
              <Text style={[styles.errorText, { color: c.subtext }]}>{searchError}</Text>
            </View>
          ) : (
            <FlatList
              data={searchResults}
              keyExtractor={(item) => item.id}
              style={[styles.resultsList, { backgroundColor: c.card, borderColor: c.controlBorder }]}
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={
                !searchLoading ? (
                  <Text style={[styles.noResults, { color: c.subtext }]}>No restaurants found</Text>
                ) : null
              }
              renderItem={({ item }) => (
                <RestaurantRow item={item} onPress={() => router.push(`/restaurant/${item.id}`)} />
              )}
            />
          )
        ) : loading ? (
          <View style={[styles.loading, { backgroundColor: c.card }]}>
            <ActivityIndicator size="small" color={c.primary} />
          </View>
        ) : !isSupabaseConfigured ? (
          <View style={[styles.statusBanner, { backgroundColor: c.text }]}>
            <Text style={styles.statusTitle}>Not connected</Text>
            <Text style={[styles.statusBody, { color: c.onDarkMuted }]}>
              This build shipped without its Supabase keys, so no ratings can load. Rebuild with
              a .env file present.
            </Text>
          </View>
        ) : pinError ? (
          <View style={[styles.statusBanner, { backgroundColor: c.text }]}>
            <Text style={styles.statusTitle}>Couldn't load ratings</Text>
            <Text style={[styles.statusBody, { color: c.onDarkMuted }]}>{pinError}</Text>
          </View>
        ) : emptyHere ? (
          <View style={[styles.statusBanner, { backgroundColor: c.card }]}>
            <Text style={[styles.statusTitle, { color: c.text }]}>Nothing rated here yet</Text>
            <Text style={[styles.statusBody, { color: c.mutedOnCard }]}>
              Try zooming out, or search by restaurant name above.
            </Text>
          </View>
        ) : null}
      </SafeAreaView>

      <Pressable
        onPress={() => recenterOnUser({ promptIfDenied: true })}
        style={[
          styles.locateBtn,
          {
            backgroundColor: c.card,
            borderColor: c.controlBorder,
            bottom: insets.bottom + (selected ? 96 : 20),
          },
        ]}
        hitSlop={8}
      >
        {locating ? (
          <ActivityIndicator size="small" color={c.primary} />
        ) : (
          <Ionicons name="locate" size={22} color={c.primary} />
        )}
      </Pressable>

      {selected ? (
        <Pressable
          onPress={() => router.push(`/restaurant/${selected.id}`)}
          style={[styles.preview, { backgroundColor: c.text, bottom: insets.bottom + 16 }]}
        >
          <View
            style={[
              styles.previewBadge,
              { backgroundColor: colorForRating(selected.rating_value) },
            ]}
          >
            <Text style={styles.previewBadgeText}>
              {isNumericRating(selected.rating_value) ? selected.rating_value : '–'}
            </Text>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.previewName} numberOfLines={1}>
              {selected.name}
            </Text>
            <Text style={[styles.previewMeta, { color: c.onDarkMuted }]} numberOfLines={1}>
              {selectedCategory}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color="#EFE8D8" />
        </Pressable>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 14,
    marginTop: 6,
    marginBottom: 11,
    paddingHorizontal: 15,
    height: 50,
    borderRadius: 17,
    borderWidth: 1.5,
    boxShadow: '0 6px 18px rgba(23,23,15,0.1)',
  },
  searchInput: { flex: 1, fontSize: 16, fontFamily: fonts.body, padding: 0 },
  errorBanner: {
    marginHorizontal: 14,
    marginBottom: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1.5,
  },
  errorText: { fontSize: 12.5, fontFamily: fonts.body, lineHeight: 18 },
  resultsList: {
    marginHorizontal: 14,
    marginBottom: 8,
    borderRadius: 16,
    borderWidth: 1.5,
    maxHeight: 340,
    overflow: 'hidden',
    boxShadow: '0 6px 18px rgba(23,23,15,0.12)',
  },
  noResults: { fontSize: 14, fontFamily: fonts.body, textAlign: 'center', padding: 20 },
  pinWrap: { alignItems: 'center' },
  pinTile: {
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 3px 8px rgba(4,45,26,0.35)',
  },
  pinText: { color: '#fff', fontFamily: fonts.display800 },
  cluster: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2.5,
    borderColor: 'rgba(255,253,247,0.9)',
  },
  clusterText: { color: '#fff', fontFamily: fonts.display800 },
  pinTail: {
    width: 9,
    height: 9,
    borderRadius: 2,
    marginTop: -6,
    transform: [{ rotate: '45deg' }],
  },
  loading: { alignSelf: 'center', marginTop: 8, padding: 8, borderRadius: 10 },
  statusBanner: {
    marginHorizontal: 14,
    marginTop: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 16,
    boxShadow: '0 6px 18px rgba(23,23,15,0.12)',
  },
  statusTitle: { color: '#fff', fontSize: 15, fontFamily: fonts.display600 },
  statusBody: { fontSize: 12.5, fontFamily: fonts.body, lineHeight: 18, marginTop: 3 },
  locateBtn: {
    position: 'absolute',
    right: 14,
    width: 44,
    height: 44,
    borderRadius: 15,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 4px 12px rgba(23,23,15,0.1)',
  },
  preview: {
    position: 'absolute',
    left: 14,
    right: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 19,
    paddingVertical: 12,
    paddingHorizontal: 14,
    boxShadow: '0 10px 26px rgba(23,23,15,0.28)',
  },
  previewBadge: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewBadgeText: { color: '#fff', fontFamily: fonts.display800, fontSize: 21 },
  previewName: { color: '#fff', fontSize: 16.5, fontFamily: fonts.display600 },
  previewMeta: { fontSize: 13, fontFamily: fonts.body, marginTop: 2 },
})
