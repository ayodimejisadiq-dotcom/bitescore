import { useCallback, useEffect, useRef, useState } from 'react'
import {
  View,
  Text,
  TextInput,
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
import { FilterChips } from '@/components/FilterChips'
import { colorForRating } from '@/theme/colors'
import { isNumericRating } from '@/lib/fsa'
import { fetchPins, type Bounds } from '@/lib/data'
import { EMPTY_FILTERS, type BrowseFilters, type RestaurantPin } from '@/lib/types'

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

// Rough UK-postcode-ish check (same heuristic used for restaurant search):
// short and contains a digit. Postcodes get a tight zoom; place names
// ("Manchester") get a wider, city-scale view.
function regionForQuery(query: string, lat: number, lng: number): Region {
  const isPostcodeish = /\d/.test(query) && query.trim().length <= 8
  const delta = isPostcodeish ? 0.03 : 0.2
  return { latitude: lat, longitude: lng, latitudeDelta: delta, longitudeDelta: delta }
}

export default function MapScreen() {
  const c = useTheme()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const mapRef = useRef<MapView | null>(null)
  const regionRef = useRef<Region>(DEFAULT_REGION)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [filters, setFilters] = useState<BrowseFilters>(EMPTY_FILTERS)
  const [pins, setPins] = useState<RestaurantPin[]>([])
  const [loading, setLoading] = useState(false)
  const [locating, setLocating] = useState(false)
  const [placeQuery, setPlaceQuery] = useState('')
  const [searchingPlace, setSearchingPlace] = useState(false)
  const [placeError, setPlaceError] = useState<string | null>(null)

  const load = useCallback(
    async (region: Region, f: BrowseFilters) => {
      setLoading(true)
      try {
        setPins(await fetchPins(regionToBounds(region), f))
      } catch {
        // Network/db errors leave the last pins in place; a toast comes later.
      } finally {
        setLoading(false)
      }
    },
    [],
  )

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
  useEffect(() => {
    recenterOnUser({ promptIfDenied: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Jump the map to a typed place name or postcode — distinct from the
  // Search tab, which looks up specific restaurants rather than locations.
  const onSearchPlace = async () => {
    const query = placeQuery.trim()
    if (!query) return
    Keyboard.dismiss()
    setSearchingPlace(true)
    setPlaceError(null)
    try {
      const results = await Location.geocodeAsync(query)
      if (!results.length) {
        setPlaceError('Couldn’t find that place. Try a different spelling or postcode.')
        return
      }
      const region = regionForQuery(query, results[0].latitude, results[0].longitude)
      regionRef.current = region
      mapRef.current?.animateToRegion(region, 500)
      load(region, filters)
    } catch {
      setPlaceError('Couldn’t search right now. Check your connection and try again.')
    } finally {
      setSearchingPlace(false)
    }
  }

  const onRegionChangeComplete = (region: Region) => {
    regionRef.current = region
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(() => load(region, filters), 400)
  }

  const onFilters = (next: BrowseFilters) => {
    setFilters(next)
    load(regionRef.current, next)
  }

  return (
    <View style={styles.root}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={DEFAULT_REGION}
        showsUserLocation
        onRegionChangeComplete={onRegionChangeComplete}
      >
        {pins.map((p) => (
          <Marker
            key={p.id}
            coordinate={{ latitude: p.lat, longitude: p.lng }}
            onPress={() => router.push(`/restaurant/${p.id}`)}
          >
            <View style={[styles.pin, { backgroundColor: colorForRating(p.rating_value) }]}>
              <Text style={styles.pinText}>
                {isNumericRating(p.rating_value) ? p.rating_value : '–'}
              </Text>
            </View>
          </Marker>
        ))}
      </MapView>

      <SafeAreaView edges={['top']} style={styles.overlay} pointerEvents="box-none">
        <View style={[styles.search, { backgroundColor: c.card, borderColor: c.border }]}>
          <Ionicons name="search" size={16} color={c.subtext} />
          <TextInput
            value={placeQuery}
            onChangeText={(t) => {
              setPlaceQuery(t)
              setPlaceError(null)
            }}
            onSubmitEditing={onSearchPlace}
            placeholder="Go to a town or postcode"
            placeholderTextColor={c.subtext}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            style={[styles.searchInput, { color: c.text }]}
          />
          {searchingPlace ? <ActivityIndicator size="small" color={c.primary} /> : null}
        </View>
        {placeError ? (
          <View style={[styles.errorBanner, { backgroundColor: c.card }]}>
            <Text style={[styles.errorText, { color: c.subtext }]}>{placeError}</Text>
          </View>
        ) : null}
        <FilterChips filters={filters} onChange={onFilters} />
        {loading ? (
          <View style={[styles.loading, { backgroundColor: c.card }]}>
            <ActivityIndicator size="small" color={c.primary} />
          </View>
        ) : null}
      </SafeAreaView>

      <Pressable
        onPress={() => recenterOnUser({ promptIfDenied: true })}
        style={[
          styles.locateBtn,
          { backgroundColor: c.card, borderColor: c.border, bottom: insets.bottom + 20 },
        ]}
        hitSlop={8}
      >
        {locating ? (
          <ActivityIndicator size="small" color={c.primary} />
        ) : (
          <Ionicons name="locate" size={22} color={c.primary} />
        )}
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    marginHorizontal: 14,
    marginTop: 6,
    marginBottom: 8,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  searchInput: { flex: 1, fontSize: 15, padding: 0 },
  errorBanner: {
    marginHorizontal: 14,
    marginBottom: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
  },
  errorText: { fontSize: 12.5, lineHeight: 18 },
  pin: {
    minWidth: 30,
    height: 30,
    borderRadius: 9,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.9)',
  },
  pinText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  loading: {
    alignSelf: 'center',
    marginTop: 8,
    padding: 8,
    borderRadius: 10,
  },
  locateBtn: {
    position: 'absolute',
    right: 16,
    width: 46,
    height: 46,
    borderRadius: 23,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
})
