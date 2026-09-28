import * as Location from 'expo-location'

// Where the phone is, if the user has already allowed it — never prompts.
// Used for distances on screens that shouldn't ask for anything.
export async function lastKnownCoords(): Promise<{ lat: number; lng: number } | null> {
  try {
    const { status } = await Location.getForegroundPermissionsAsync()
    if (status !== 'granted') return null
    const pos =
      (await Location.getLastKnownPositionAsync({ maxAge: 5 * 60 * 1000 })) ??
      (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }))
    return pos ? { lat: pos.coords.latitude, lng: pos.coords.longitude } : null
  } catch {
    return null
  }
}

// A fresh, accurate fix for verifying a visit. Asks for "When In Use" if it
// hasn't been decided; returns null if refused.
export async function freshCoords(): Promise<{ lat: number; lng: number } | null> {
  try {
    let { status } = await Location.getForegroundPermissionsAsync()
    if (status !== 'granted') ({ status } = await Location.requestForegroundPermissionsAsync())
    if (status !== 'granted') return null
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })
    return { lat: pos.coords.latitude, lng: pos.coords.longitude }
  } catch {
    return null
  }
}

// Server-side limit in log_visit(); mirrored here only to label the option.
export const VERIFY_RADIUS_M = 75
