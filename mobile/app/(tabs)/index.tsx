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
import { fonts } from '@/theme/type'
import { colorForRating, edgeForRating } from '@/theme/colors'
import { FilterChips } from '@/components/FilterChips'
import { useFilters } from '@/hooks/useFilters'
import { isNumericRating, BUSINESS_TYPE_LABEL } from '@/lib/fsa'
import { fetchPins, type Bounds } from '@/lib/data'
import type { BrowseFilters, RestaurantPin } from '@/lib/types'

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

// Score pin: rounded tile with a rotated-square pointer tail; 5s carry the
// gold ring so the best places pop in a cluster.
function ScorePin({ pin, selected }: { pin: RestaurantPin; selected: boolean }) {
  const fill = colorForRating(pin.rating_value)
  const numeric = isNumericRating(pin.rating_value)
  const isFive = pin.rating_value === '5'
  const size = selected ? 40 : isFive ? 38 : 34
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
  const [locating, setLocating] = useState(false)
  const [placeQuery, setPlaceQuery] = useState('')
  const [searchingPlace, setSearchingPlace] = useState(false)
  const [placeError, setPlaceError] = useState<string | null>(null)

  const load = useCallback(async (region: Region, f: BrowseFilters) => {
    setLoading(true)
    try {
      setPins(await fetchPins(regionToBounds(region), f))
    } catch {
      // Network/db errors leave the last pins in place; a toast comes later.
    } finally {
      setLoading(false)
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
          <Marker
            key={p.id}
            coordinate={{ latitude: p.lat, longitude: p.lng }}
            onPress={(e) => {
              e.stopPropagation()
              setSelected(p)
            }}
            anchor={{ x: 0.5, y: 1 }}
          >
            <ScorePin pin={p} selected={selected?.id === p.id} />
          </Marker>
        ))}
      </MapView>

      <SafeAreaView edges={['top']} style={styles.overlay} pointerEvents="box-none">
        <View style={[styles.search, { backgroundColor: c.card, borderColor: c.controlBorder }]}>
          <Ionicons name="search" size={19} color={c.primary} />
          <TextInput
            value={placeQuery}
            onChangeText={(t) => {
              setPlaceQuery(t)
              setPlaceError(null)
            }}
            onSubmitEditing={onSearchPlace}
            placeholder="Go to a town or postcode"
            placeholderTextColor={c.placeholder}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            style={[styles.searchInput, { color: c.text }]}
          />
          {searchingPlace ? <ActivityIndicator size="small" color={c.primary} /> : null}
        </View>
        {placeError ? (
          <View style={[styles.errorBanner, { backgroundColor: c.card, borderColor: c.controlBorder }]}>
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
  pinWrap: { alignItems: 'center' },
  pinTile: {
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 3px 8px rgba(4,45,26,0.35)',
  },
  pinText: { color: '#fff', fontFamily: fonts.display800 },
  pinTail: {
    width: 9,
    height: 9,
    borderRadius: 2,
    marginTop: -6,
    transform: [{ rotate: '45deg' }],
  },
  loading: { alignSelf: 'center', marginTop: 8, padding: 8, borderRadius: 10 },
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
