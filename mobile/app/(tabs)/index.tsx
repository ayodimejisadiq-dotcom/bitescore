import { useCallback, useEffect, useRef, useState } from 'react'
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Alert, Linking } from 'react-native'
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
        <Pressable
          style={[styles.search, { backgroundColor: c.card, borderColor: c.border }]}
          onPress={() => router.push('/search')}
        >
          <Text style={{ color: c.subtext, fontSize: 15 }}>Search places or a postcode</Text>
        </Pressable>
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
    marginHorizontal: 14,
    marginTop: 6,
    marginBottom: 8,
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
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
