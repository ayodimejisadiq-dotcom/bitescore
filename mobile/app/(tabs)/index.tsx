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
import { useUserHeading } from '@/hooks/useUserHeading'
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

// The locate button cycles through these, the way Apple and Google Maps do.
// `follow` keeps you centred with the map north-up; `heading` additionally
// turns the map to face the way you are, which is what makes "is the venue on
// my left or my right" answerable while standing on the pavement.
type LocateMode = 'free' | 'follow' | 'heading'

const NEXT_MODE: Record<LocateMode, LocateMode> = {
  free: 'follow',
  follow: 'heading',
  heading: 'free',
}

const MODE_ICON: Record<LocateMode, 'locate-outline' | 'locate' | 'navigate'> = {
  free: 'locate-outline',
  follow: 'locate',
  heading: 'navigate',
}

// Compass readings arrive many times a second and each one is a camera
// animation. Below this many degrees of change the map would only jitter, and
// animations closer together than this many ms stack up into a laggy queue.
const CAMERA_MIN_DEGREES = 2
const CAMERA_MIN_INTERVAL_MS = 220

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
  const [locationGranted, setLocationGranted] = useState(false)
  // Opens in heading mode: the app's job on launch is to orient you where you
  // are, and a north-up map makes you do that translation yourself. One drag
  // or one tap drops out of it for browsing.
  const [locateMode, setLocateMode] = useState<LocateMode>('heading')
  // Only subscribe to position and compass while a mode actually needs them —
  // the compass is not free, and most of the time the map is being browsed.
  const pose = useUserHeading(locationGranted && locateMode !== 'free')
  const lastCamera = useRef({ at: 0, heading: 0 })

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
        setLocationGranted(status === 'granted')
        if (status !== 'granted') {
          // Without location there is nothing to follow or face, and a filled
          // button would promise behaviour the map cannot deliver.
          setLocateMode('free')
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

  // Drives the camera in follow/heading mode. Rotating the whole map beats
  // drawing our own cone: the previous custom marker had to be rasterised by
  // the native map on every heading change, which flickered while spinning and
  // went blank between position updates. The camera has no such problem, and a
  // course-up map answers "which way am I facing" without a cone at all.
  useEffect(() => {
    if (!pose || locateMode === 'free') return

    const now = Date.now()
    const heading = locateMode === 'heading' ? pose.heading : 0
    const turned = Math.abs(((heading - lastCamera.current.heading + 540) % 360) - 180)
    if (now - lastCamera.current.at < CAMERA_MIN_INTERVAL_MS) return
    if (locateMode === 'heading' && turned < CAMERA_MIN_DEGREES) return

    lastCamera.current = { at: now, heading }
    mapRef.current?.animateCamera(
      { center: { latitude: pose.latitude, longitude: pose.longitude }, heading },
      { duration: 300 },
    )
  }, [pose, locateMode])

  // Leaving a mode has to also undo it: dropping straight to `free` from
  // heading would strand the map at whatever bearing it happened to be on, so
  // straighten it back to north-up on the way out.
  const onLocatePress = useCallback(() => {
    const next = NEXT_MODE[locateMode]
    setLocateMode(next)
    if (next === 'free' || next === 'follow') {
      mapRef.current?.animateCamera({ heading: 0 }, { duration: 300 })
    }
    if (next !== 'free') recenterOnUser({ promptIfDenied: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locateMode, recenterOnUser])

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
    const prev = regionRef.current
    regionRef.current = region

    // Rotating the map reports a region change on every frame of the turn, and
    // the viewport it covers has not meaningfully moved — without this,
    // heading mode would refetch pins continuously while you pivot on the
    // spot. Only a real pan or zoom is worth a request.
    const moved =
      Math.abs(region.latitude - prev.latitude) > prev.latitudeDelta / 20 ||
      Math.abs(region.longitude - prev.longitude) > prev.longitudeDelta / 20 ||
      Math.abs(region.latitudeDelta - prev.latitudeDelta) > prev.latitudeDelta / 20
    if (!moved) return

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
        // Dragging the map is a statement that you want to look somewhere
        // else, so it hands control back rather than fighting the camera.
        onPanDrag={() => setLocateMode((m) => (m === 'free' ? m : 'free'))}
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
        onPress={onLocatePress}
        accessibilityRole="button"
        accessibilityLabel={
          locateMode === 'free'
            ? 'Centre the map on my location'
            : locateMode === 'follow'
              ? 'Turn the map to face the way I am'
              : 'Stop following my location'
        }
        style={[
          styles.locateBtn,
          {
            // Filled while a mode is active, so the button reads as a state
            // rather than a one-shot action — you can tell at a glance whether
            // the map is about to move under you.
            backgroundColor: locateMode === 'free' ? c.card : c.primary,
            borderColor: locateMode === 'free' ? c.controlBorder : c.primary,
            bottom: insets.bottom + (selected ? 96 : 20),
          },
        ]}
        hitSlop={8}
      >
        {locating ? (
          <ActivityIndicator size="small" color={locateMode === 'free' ? c.primary : '#FFFFFF'} />
        ) : (
          <Ionicons
            name={MODE_ICON[locateMode]}
            size={22}
            color={locateMode === 'free' ? c.primary : '#FFFFFF'}
          />
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
