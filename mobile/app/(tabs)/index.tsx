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
  Keyboard,
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import MapView, { Marker, type Region } from 'react-native-maps'
import * as Location from 'expo-location'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '@/theme/useTheme'
import { colorForRating, textOnRating, NEUTRAL_RATING } from '@/theme/colors'
import { ScoreBadge } from '@/components/ScoreBadge'
import { FilterChips } from '@/components/FilterChips'
import { useFilters } from '@/hooks/useFilters'
import { useUserHeading } from '@/hooks/useUserHeading'
import { isNumericRating } from '@/lib/fsa'
import { fetchPins, fetchClusters, fetchNear, searchRestaurants, type Bounds } from '@/lib/data'
import { looksLikePostcode, postcodePoint, POSTCODE_SPAN, type PostcodePoint } from '@/lib/postcode'
import { isSupabaseConfigured } from '@/lib/supabase'
import { errorMessage, searchErrorMessage } from '@/lib/errors'
import { RestaurantRow, categoryOne } from '@/components/RestaurantRow'
import {
  addRecentSearch,
  clearRecentSearches,
  getRecentSearches,
  removeRecentSearch,
} from '@/lib/recentSearches'
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

const MODE_ICON: Record<LocateMode, 'navigate-outline' | 'navigate' | 'compass'> = {
  free: 'navigate-outline',
  follow: 'navigate',
  heading: 'compass',
}

// Compass readings arrive many times a second and each one is a camera
// animation. Below this many degrees of change the map would only jitter, and
// animations closer together than this many ms stack up into a laggy queue.
const CAMERA_MIN_DEGREES = 2
const CAMERA_MIN_INTERVAL_MS = 220

// Score pin: 34px rounded tile in the score colour with a white border.
function ScorePin({ pin }: { pin: RestaurantPin }) {
  const numeric = isNumericRating(pin.rating_value)
  return (
    <View style={[styles.pin, { backgroundColor: colorForRating(pin.rating_value) }]}>
      <Text style={[styles.pinText, { color: textOnRating(pin.rating_value) }]}>
        {numeric ? pin.rating_value : '–'}
      </Text>
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
        anchor={{ x: 0.5, y: 0.5 }}
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
          ]}
        >
          <Text
            style={[
              styles.clusterText,
              { fontSize: size * 0.32, color: cluster.best_rating ? textOnRating(cluster.best_rating) : '#fff' },
            ]}
          >
            {label}
          </Text>
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
  // Typing fires a search per pause, and they can finish out of order: only
  // the newest may write results, and starting one cancels the one before.
  const searchSeq = useRef(0)
  const searchAbort = useRef<AbortController | null>(null)
  const [searchFocused, setSearchFocused] = useState(false)
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [recentSearches, setRecentSearches] = useState<string[]>([])
  // Set when the search is a postcode: the map has moved there and the list
  // shows what's around it.
  const [postcodeHit, setPostcodeHit] = useState<PostcodePoint | null>(null)
  const [locationGranted, setLocationGranted] = useState(false)
  // Opens in heading mode: the app's job on launch is to orient you where you
  // are, and a north-up map makes you do that translation yourself. One drag
  // or one tap drops out of it for browsing.
  const [locateMode, setLocateMode] = useState<LocateMode>('heading')
  // Only subscribe to position and compass while a mode actually needs them —
  // the compass is not free, and most of the time the map is being browsed.
  const pose = useUserHeading(locationGranted && locateMode !== 'free')
  const lastCamera = useRef({ at: 0, heading: 0 })
  // Where search measures from. Seeded by the initial locate and refreshed by
  // the live pose when a follow mode is running, so results stay sorted around
  // where you are now rather than where you opened the app.
  const originRef = useRef<{ lng: number; lat: number } | null>(null)
  // The viewport the currently-displayed pins were fetched for. Movement is
  // judged against this rather than the last region event — see
  // onRegionChangeComplete.
  const loadedRegion = useRef<Region | null>(null)

  const load = useCallback(async (region: Region, f: BrowseFilters) => {
    // Panning fast fires several of these, and they can return out of order.
    // Without a guard the map thrashes: a stale response replaces a newer one,
    // every marker is torn down and rebuilt, and the work compounds with each
    // pan. Only the newest request is allowed to write state.
    const requestId = ++latestRequest.current
    loadedRegion.current = region

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
        originRef.current = { lng: pos.coords.longitude, lat: pos.coords.latitude }
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
    if (!pose) return
    originRef.current = { lng: pose.longitude, lat: pose.latitude }
    if (locateMode === 'free') return

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

  useEffect(() => {
    getRecentSearches().then(setRecentSearches)
  }, [])

  const cancelSearch = () => {
    searchSeq.current++
    searchAbort.current?.abort()
    searchAbort.current = null
    if (searchDebounce.current) clearTimeout(searchDebounce.current)
    setSearchLoading(false)
  }

  const runSearch = async (text: string, f: BrowseFilters = filters) => {
    cancelSearch()
    const id = searchSeq.current
    const abort = new AbortController()
    searchAbort.current = abort
    // A search the server hasn't answered in 8s won't be answered usefully;
    // give up on it so the retry (or the message) comes promptly.
    const timer = setTimeout(() => abort.abort(), 8000)
    setSearchLoading(true)
    try {
      // A postcode is a place, not a name: go there and list what's around it.
      // Postcodes with no restaurant registered at them (most homes) are
      // located by their sector, so they still land in the right streets.
      if (looksLikePostcode(text)) {
        const point = await postcodePoint(text).catch(() => null)
        if (id !== searchSeq.current) return
        if (point) {
          const span = POSTCODE_SPAN[point.level]
          const near = await fetchNear({ lng: point.lng, lat: point.lat }, span.radiusM, f)
          if (id !== searchSeq.current) return
          showPostcode(point, f)
          setPostcodeHit(point)
          setSearchResults(near)
          setSearchError(null)
          return
        }
      }
      setPostcodeHit(null)

      let results: RestaurantNear[]
      try {
        results = await searchRestaurants(text, f, originRef.current, abort.signal)
      } catch (first) {
        if (id !== searchSeq.current) return
        // One quiet retry: a dropped connection or a slow first query on a
        // cold server usually succeeds the second time.
        console.warn('[bitescore] search retry', first)
        const again = new AbortController()
        searchAbort.current = again
        clearTimeout(timer)
        setTimeout(() => again.abort(), 8000)
        results = await searchRestaurants(text, f, originRef.current, again.signal)
      }
      if (id !== searchSeq.current) return
      setSearchResults(results)
      setSearchError(null)
    } catch (e) {
      if (id !== searchSeq.current) return
      setSearchError(searchErrorMessage(e))
    } finally {
      clearTimeout(timer)
      if (id === searchSeq.current) setSearchLoading(false)
    }
  }

  // Moves the map onto a searched postcode and loads its pins. Drops out of
  // follow mode first, or the camera would snap straight back to the user.
  const showPostcode = (point: PostcodePoint, f: BrowseFilters) => {
    setLocateMode('free')
    const delta = POSTCODE_SPAN[point.level].delta
    const region: Region = {
      latitude: point.lat,
      longitude: point.lng,
      latitudeDelta: delta,
      longitudeDelta: delta,
    }
    regionRef.current = region
    mapRef.current?.animateToRegion(region, 500)
    load(region, f)
  }

  // Closes the list so the map, already moved there, is in view.
  const viewPostcodeOnMap = () => {
    if (searchQuery.trim()) rememberSearch(searchQuery)
    clearSearch()
    Keyboard.dismiss()
  }

  const onSearchChange = (text: string) => {
    setSearchQuery(text)
    setSearchError(null)
    if (!text.trim()) {
      cancelSearch()
      setSearchResults([])
      return
    }
    if (searchDebounce.current) clearTimeout(searchDebounce.current)
    // Previous results stay on screen until the new ones arrive, so the list
    // doesn't flash empty on every keystroke.
    searchDebounce.current = setTimeout(() => runSearch(text), 300)
  }

  const clearSearch = () => {
    cancelSearch()
    setSearchQuery('')
    setSearchResults([])
    setSearchError(null)
    setPostcodeHit(null)
  }

  const rememberSearch = (text: string) => {
    addRecentSearch(text).then(setRecentSearches)
  }

  const pickRecent = (text: string) => {
    setSearchQuery(text)
    setSearchError(null)
    setSearchResults([])
    runSearch(text)
    rememberSearch(text)
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

  const onRegionChangeComplete = (region: Region, details?: { isGesture?: boolean }) => {
    regionRef.current = region

    // Leaving a follow mode is about looking somewhere *else*, not about
    // looking closer. Pinching to zoom keeps you at the centre — which is
    // exactly what you do in a busy high street, zooming in before working out
    // which way to turn — so only a gesture that carries the centre away from
    // you hands control back.
    if (details?.isGesture && locateMode !== 'free' && originRef.current) {
      const strayed =
        Math.abs(region.latitude - originRef.current.lat) > region.latitudeDelta / 3 ||
        Math.abs(region.longitude - originRef.current.lng) > region.longitudeDelta / 3
      if (strayed) setLocateMode('free')
    }

    // Rotating the map reports a region change on every frame of the turn over
    // the same ground, so heading mode would otherwise refetch pins
    // continuously while you pivot on the spot.
    //
    // The comparison is against the region we last *fetched* for, not the
    // previous event. Measuring event-to-event meant a slow drag — dozens of
    // small changes, none individually past the threshold — never triggered a
    // fetch however far it travelled, and neither did walking in follow mode,
    // where the camera advances a step at a time. Pins simply stopped
    // appearing.
    const base = loadedRegion.current
    const moved =
      !base ||
      Math.abs(region.latitude - base.latitude) > base.latitudeDelta / 10 ||
      Math.abs(region.longitude - base.longitude) > base.longitudeDelta / 10 ||
      Math.abs(region.latitudeDelta - base.latitudeDelta) > base.latitudeDelta / 10
    if (!moved) return

    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(() => load(region, filters), 400)
  }

  const onFilters = (next: BrowseFilters) => {
    setFilters(next)
    load(regionRef.current, next)
    // Open search results follow the filters too, not just the map.
    if (searchQuery.trim()) runSearch(searchQuery, next)
  }

  // The tab bar floats over the map; controls sit just above it.
  const bottomInset = 50 + insets.bottom + 16

  return (
    <View style={styles.root}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={DEFAULT_REGION}
        showsUserLocation
        showsMyLocationButton={false}
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
        <View style={styles.search}>
          <Ionicons name="search" size={19} color={c.meta} />
          <TextInput
            value={searchQuery}
            onChangeText={onSearchChange}
            placeholder="Restaurant, town or postcode"
            placeholderTextColor={c.meta}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            onFocus={() => {
              if (blurTimer.current) clearTimeout(blurTimer.current)
              setSearchFocused(true)
            }}
            // Late, so a tap on a recent search lands before the list goes.
            onBlur={() => {
              blurTimer.current = setTimeout(() => setSearchFocused(false), 200)
            }}
            onSubmitEditing={() => {
              if (!searchQuery.trim()) return
              // A postcode's map move has already happened; Search shows it.
              if (postcodeHit) {
                viewPostcodeOnMap()
                return
              }
              runSearch(searchQuery)
              rememberSearch(searchQuery)
            }}
            style={[styles.searchInput, { color: c.label }]}
          />
          {searchLoading ? (
            <ActivityIndicator size="small" color={c.meta} />
          ) : searchQuery ? (
            <Pressable
              onPress={clearSearch}
              hitSlop={8}
              accessibilityLabel="Clear search"
            >
              <Ionicons name="close-circle" size={18} color={c.chevron} />
            </Pressable>
          ) : null}
        </View>
        <FilterChips filters={filters} onChange={onFilters} />
        {searchQuery ? (
          searchError ? (
            <Pressable
              style={styles.banner}
              onPress={() => runSearch(searchQuery)}
              accessibilityRole="button"
              accessibilityLabel="Try the search again"
            >
              <Text style={[styles.bannerBody, { color: c.label2 }]}>{searchError}</Text>
              <Text style={[styles.retry, { color: c.tint }]}>Try again</Text>
            </Pressable>
          ) : (
            <View style={styles.results}>
              <FlatList
                data={searchResults}
                keyExtractor={(item) => item.id}
                keyboardShouldPersistTaps="handled"
                ItemSeparatorComponent={() => <View style={styles.resultSep} />}
                ListHeaderComponent={
                  postcodeHit ? (
                    <Pressable
                      onPress={viewPostcodeOnMap}
                      style={({ pressed }) => [styles.postcodeRow, pressed && { backgroundColor: c.bg }]}
                      accessibilityRole="button"
                      accessibilityLabel={`Show ${postcodeHit.label} on the map`}
                    >
                      <Ionicons name="location" size={20} color={c.tint} />
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.postcodeTitle, { color: c.label }]}>
                          {postcodeHit.label}
                          {postcodeHit.area ? `, ${postcodeHit.area}` : ''}
                        </Text>
                        <Text style={[styles.postcodeSub, { color: c.meta }]}>
                          {searchResults.length ? 'Places nearby below' : 'No rated places nearby'}
                        </Text>
                      </View>
                      <Text style={[styles.postcodeLink, { color: c.tint }]}>Show map</Text>
                    </Pressable>
                  ) : null
                }
                ListEmptyComponent={
                  !searchLoading && !postcodeHit ? (
                    <Text style={[styles.noResults, { color: c.meta }]}>
                      No places found. New places can take a few weeks to appear after the council
                      registers them.
                    </Text>
                  ) : null
                }
                renderItem={({ item }) => (
                  <RestaurantRow
                    item={item}
                    onPress={() => {
                      rememberSearch(searchQuery)
                      router.push(`/restaurant/${item.id}`)
                    }}
                  />
                )}
              />
            </View>
          )
        ) : searchFocused && recentSearches.length > 0 ? (
          <View style={styles.results}>
            <View style={styles.recentHead}>
              <Text style={[styles.recentTitle, { color: c.label }]}>Recent</Text>
              <Pressable
                onPress={() => clearRecentSearches().then(setRecentSearches)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Clear recent searches"
              >
                <Text style={[styles.recentClear, { color: c.tint }]}>Clear</Text>
              </Pressable>
            </View>
            <FlatList
              data={recentSearches}
              keyExtractor={(item) => item}
              keyboardShouldPersistTaps="handled"
              ItemSeparatorComponent={() => <View style={styles.recentSep} />}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => pickRecent(item)}
                  style={({ pressed }) => [styles.recentRow, pressed && { backgroundColor: c.bg }]}
                  accessibilityRole="button"
                  accessibilityLabel={`Search for ${item}`}
                >
                  <Ionicons name="time-outline" size={18} color={c.meta} />
                  <Text style={[styles.recentText, { color: c.label }]} numberOfLines={1}>
                    {item}
                  </Text>
                  <Pressable
                    onPress={() => removeRecentSearch(item).then(setRecentSearches)}
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${item} from recent searches`}
                  >
                    <Ionicons name="close" size={16} color={c.chevron} />
                  </Pressable>
                </Pressable>
              )}
            />
          </View>
        ) : loading ? (
          <View style={styles.loading}>
            <ActivityIndicator size="small" color={c.meta} />
          </View>
        ) : !isSupabaseConfigured ? (
          <View style={styles.banner}>
            <Text style={[styles.bannerTitle, { color: c.label }]}>Not connected</Text>
            <Text style={[styles.bannerBody, { color: c.label2 }]}>
              This build shipped without its Supabase keys, so no ratings can load. Rebuild with
              a .env file present.
            </Text>
          </View>
        ) : pinError ? (
          <View style={styles.banner}>
            <Text style={[styles.bannerTitle, { color: c.label }]}>Couldn't load ratings</Text>
            <Text style={[styles.bannerBody, { color: c.label2 }]}>{pinError}</Text>
          </View>
        ) : emptyHere ? (
          <View style={styles.banner}>
            <Text style={[styles.bannerTitle, { color: c.label }]}>Nothing rated here yet</Text>
            <Text style={[styles.bannerBody, { color: c.label2 }]}>
              Try zooming out, or search by name or postcode above.
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
        style={[styles.locateBtn, { bottom: bottomInset + (selected ? 84 : 0) }]}
        hitSlop={8}
      >
        {locating ? (
          <ActivityIndicator size="small" color={c.blue} />
        ) : (
          <Ionicons name={MODE_ICON[locateMode]} size={21} color={c.blue} />
        )}
      </Pressable>

      {selected ? (
        <Pressable
          onPress={() => router.push(`/restaurant/${selected.id}`)}
          style={({ pressed }) => [styles.preview, { bottom: bottomInset, opacity: pressed ? 0.85 : 1 }]}
        >
          <ScoreBadge rating={selected.rating_value} size={44} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[styles.previewName, { color: c.label }]} numberOfLines={1}>
              {selected.name}
            </Text>
            <Text style={[styles.previewMeta, { color: c.meta }]} numberOfLines={1}>
              {categoryOne(selected.business_type)}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={c.chevron} />
        </Pressable>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, gap: 10 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 16,
    marginTop: 8,
    paddingHorizontal: 14,
    height: 48,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.94)',
    boxShadow: '0 4px 18px rgba(0,0,0,0.08)',
  },
  searchInput: { flex: 1, fontSize: 17, padding: 0 },
  results: {
    marginHorizontal: 16,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    maxHeight: 360,
    overflow: 'hidden',
    boxShadow: '0 6px 20px rgba(0,0,0,0.1)',
  },
  resultSep: { height: StyleSheet.hairlineWidth, backgroundColor: '#E5E5EA', marginLeft: 74 },
  noResults: { fontSize: 15, textAlign: 'center', padding: 20, lineHeight: 20 },
  postcodeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 58,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E5EA',
  },
  postcodeTitle: { fontSize: 16, fontWeight: '600' },
  postcodeSub: { fontSize: 13, marginTop: 1 },
  postcodeLink: { fontSize: 15, fontWeight: '600' },
  recentHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 6,
  },
  recentTitle: { fontSize: 15, fontWeight: '600' },
  recentClear: { fontSize: 15 },
  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 46,
    paddingHorizontal: 16,
  },
  recentText: { flex: 1, fontSize: 16 },
  recentSep: { height: StyleSheet.hairlineWidth, backgroundColor: '#E5E5EA', marginLeft: 46 },
  retry: { fontSize: 15, fontWeight: '600', marginTop: 6 },
  pin: {
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 2.5,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 3px 10px rgba(0,0,0,0.2)',
  },
  pinText: { fontSize: 17, fontWeight: '700' },
  cluster: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2.5,
    borderColor: '#FFFFFF',
    boxShadow: '0 3px 10px rgba(0,0,0,0.2)',
  },
  clusterText: { fontWeight: '700' },
  loading: {
    alignSelf: 'center',
    padding: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.94)',
  },
  banner: {
    marginHorizontal: 16,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    boxShadow: '0 6px 20px rgba(0,0,0,0.1)',
  },
  bannerTitle: { fontSize: 15, fontWeight: '600' },
  bannerBody: { fontSize: 14, lineHeight: 19, marginTop: 2 },
  locateBtn: {
    position: 'absolute',
    right: 16,
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.96)',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 4px 14px rgba(0,0,0,0.1)',
  },
  preview: {
    position: 'absolute',
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: '#FFFFFF',
    boxShadow: '0 8px 24px rgba(0,0,0,0.14)',
  },
  previewName: { fontSize: 17, fontWeight: '600' },
  previewMeta: { fontSize: 14, marginTop: 2 },
})
