import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Location from 'expo-location'
import { supabase } from './supabase'
import { fetchNear } from './data'
import { lastKnownCoords } from './location'
import { EMPTY_FILTERS, type RestaurantNear } from './types'

// First-launch wizard (components/Onboarding.tsx): permissions, a few
// questions, then the paywall. Finishing it is remembered on the device, so it
// shows once per install. Pro users never see it.

const DONE_KEY = 'bitescore.onboarded.v1'

export interface OnboardingAnswers {
  name: string
  city: string
}

export async function isOnboarded(): Promise<boolean> {
  return (await AsyncStorage.getItem(DONE_KEY)) !== null
}

// Stored with the answers so the paywall can greet someone by name after an
// app restart part-way through.
export async function markOnboarded(answers: OnboardingAnswers): Promise<void> {
  await AsyncStorage.setItem(DONE_KEY, JSON.stringify(answers))
}

export async function getOnboardingAnswers(): Promise<OnboardingAnswers | null> {
  try {
    const raw = await AsyncStorage.getItem(DONE_KEY)
    return raw ? (JSON.parse(raw) as OnboardingAnswers) : null
  } catch {
    return null
  }
}

// What someone likes eating. Stored on their profile (migration 0033) for
// personalising later; it does not filter the map.
export const FOOD_OPTIONS: { key: string; label: string; emoji: string }[] = [
  { key: 'cafe', label: 'Cafés & brunch', emoji: '☕️' },
  { key: 'takeaway', label: 'Takeaways', emoji: '🥡' },
  { key: 'pub', label: 'Pubs & bars', emoji: '🍺' },
  { key: 'fine_dining', label: 'Fine dining', emoji: '🍷' },
  { key: 'indian', label: 'Indian', emoji: '🍛' },
  { key: 'chinese', label: 'Chinese', emoji: '🥟' },
  { key: 'italian', label: 'Italian', emoji: '🍝' },
  { key: 'pizza', label: 'Pizza', emoji: '🍕' },
  { key: 'burgers', label: 'Burgers', emoji: '🍔' },
  { key: 'chicken', label: 'Chicken', emoji: '🍗' },
  { key: 'fish_chips', label: 'Fish & chips', emoji: '🐟' },
  { key: 'japanese', label: 'Japanese & sushi', emoji: '🍣' },
  { key: 'thai', label: 'Thai', emoji: '🍜' },
  { key: 'caribbean', label: 'Caribbean', emoji: '🌶️' },
  { key: 'african', label: 'African', emoji: '🍲' },
  { key: 'middle_eastern', label: 'Middle Eastern', emoji: '🥙' },
  { key: 'mexican', label: 'Mexican', emoji: '🌮' },
  { key: 'vegan', label: 'Vegan & veggie', emoji: '🥗' },
  { key: 'desserts', label: 'Desserts', emoji: '🍰' },
]

export async function saveFoodLikes(keys: string[]): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Not signed in')
  const { error } = await supabase.from('profiles').update({ food_likes: keys }).eq('user_id', user.id)
  if (error) throw error
}

// The town or city the phone is in, for pre-filling "Where are you based?".
// Only when location is already allowed; never prompts.
export async function cityFromLocation(): Promise<string | null> {
  try {
    const { status } = await Location.getForegroundPermissionsAsync()
    if (status !== 'granted') return null
    const pos =
      (await Location.getLastKnownPositionAsync({ maxAge: 10 * 60 * 1000 })) ??
      (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }))
    if (!pos) return null
    const [place] = await Location.reverseGeocodeAsync({
      latitude: pos.coords.latitude,
      longitude: pos.coords.longitude,
    })
    return place?.city || place?.subregion || place?.district || null
  } catch {
    return null
  }
}

export class UsernameTakenError extends Error {
  constructor(username: string) {
    super(`@${username} is taken. Try another.`)
  }
}

// Saves the name the app calls someone by (private, like first_name always
// was) and their public username. A generated username that collides is
// regenerated; one the person typed is reported as taken instead.
export async function saveNameAndUsername(
  firstName: string,
  username: string,
  regenerate: (() => string) | null,
): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Not signed in')
  let candidate = username
  for (let attempt = 0; attempt < 5; attempt++) {
    const { error } = await supabase
      .from('profiles')
      .update({ first_name: firstName.trim(), username: candidate })
      .eq('user_id', user.id)
    if (!error) return candidate
    if (error.code !== '23505') throw error
    if (!regenerate) throw new UsernameTakenError(candidate)
    candidate = regenerate()
  }
  throw new Error('Could not find a free username — please try another')
}

// Where someone's based. This is the same city shown on their profile.
export async function saveCity(city: string): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Not signed in')
  const { error } = await supabase
    .from('profiles')
    .update({ city: city.trim().slice(0, 60) || null })
    .eq('user_id', user.id)
  if (error) throw error
}

// One row per wizard step reached, for the drop-off funnel
// (onboarding_funnel(), migration 0033). Fire-and-forget: tracking never
// holds anyone up, and an offline first launch simply isn't counted.
export function logOnboardingEvent(step: string): void {
  supabase
    .from('onboarding_events')
    .insert({ step })
    .then(({ error }) => {
      if (error) console.warn('[bitescore] onboarding event', step, error.message)
    })
}

export interface NearbySnapshot {
  // "near you", or the city they typed when location is off.
  where: string
  total: number
  // restaurants_near returns at most 100 rows.
  capped: boolean
  // Scored 0–2, worst first.
  low: RestaurantNear[]
  // Nearest places scoring 5.
  best: RestaurantNear[]
}

const NEARBY_RADIUS_M = 1609 // a mile
const NEARBY_MAX = 100

// What's around them, for the reveal just before the paywall: from the
// phone's location if allowed, else from the city they typed. Null when
// neither gives a place to look.
export async function nearbySnapshot(city: string): Promise<NearbySnapshot | null> {
  let origin = await lastKnownCoords()
  let where = 'near you'
  if (!origin && city.trim()) {
    try {
      const [hit] = await Location.geocodeAsync(`${city.trim()}, United Kingdom`)
      if (hit) {
        origin = { lat: hit.latitude, lng: hit.longitude }
        where = `in ${city.trim()}`
      }
    } catch {
      // Geocoding unavailable; no reveal.
    }
  }
  if (!origin) return null
  const rows = await fetchNear(origin, NEARBY_RADIUS_M, EMPTY_FILTERS)
  const numeric = rows.filter((r) => r.rating_is_numeric)
  return {
    where,
    total: rows.length,
    capped: rows.length >= NEARBY_MAX,
    low: numeric
      .filter((r) => Number(r.rating_value) <= 2)
      .sort((a, b) => Number(a.rating_value) - Number(b.rating_value)),
    best: numeric.filter((r) => r.rating_value === '5').slice(0, 2),
  }
}
