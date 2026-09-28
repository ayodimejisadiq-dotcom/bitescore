import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Notifications from 'expo-notifications'

// "Did you visit …?" — a local notification scheduled two hours after the
// user taps Directions, cancelled if they log a visit there first. Local only:
// nothing is sent to the server, and it needs no push token.

const CATEGORY = 'visit-followup'
const RATE = 'rate'
const DIDNT_GO = 'didnt-go'
const STORE_KEY = 'bitescore.followups.v1' // restaurantId -> notification id
const DELAY_SECONDS = 2 * 60 * 60

let categoryReady: Promise<unknown> | null = null

export function setupFollowUpCategory(): Promise<unknown> {
  if (!categoryReady) {
    categoryReady = Notifications.setNotificationCategoryAsync(CATEGORY, [
      { identifier: RATE, buttonTitle: 'Yes, rate it', options: { opensAppToForeground: true } },
      { identifier: DIDNT_GO, buttonTitle: 'Didn’t go', options: { opensAppToForeground: false } },
    ]).catch(() => {})
  }
  return categoryReady
}

async function readStore(): Promise<Record<string, string>> {
  try {
    const raw = await AsyncStorage.getItem(STORE_KEY)
    return raw ? (JSON.parse(raw) as Record<string, string>) : {}
  } catch {
    return {}
  }
}

async function writeStore(map: Record<string, string>): Promise<void> {
  await AsyncStorage.setItem(STORE_KEY, JSON.stringify(map)).catch(() => {})
}

// Asks for notification permission only if it has never been decided —
// tapping Directions is a moment the reason is obvious. Never blocks.
async function canNotify(): Promise<boolean> {
  const { status } = await Notifications.getPermissionsAsync()
  if (status === 'granted') return true
  if (status === 'denied') return false
  const req = await Notifications.requestPermissionsAsync()
  return req.status === 'granted'
}

export async function scheduleDirectionsFollowUp(place: { id: string; name: string }): Promise<void> {
  try {
    if (!(await canNotify())) return
    await setupFollowUpCategory()
    await cancelDirectionsFollowUp(place.id)
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: `Did you visit ${place.name}?`,
        body: 'You got directions 2 hours ago. How was it?',
        categoryIdentifier: CATEGORY,
        data: { kind: CATEGORY, restaurantId: place.id },
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: DELAY_SECONDS },
    })
    const map = await readStore()
    map[place.id] = id
    await writeStore(map)
  } catch {
    // A missed reminder is not worth interrupting directions for.
  }
}

export async function cancelDirectionsFollowUp(restaurantId: string): Promise<void> {
  const map = await readStore()
  const id = map[restaurantId]
  if (!id) return
  await Notifications.cancelScheduledNotificationAsync(id).catch(() => {})
  delete map[restaurantId]
  await writeStore(map)
}

// Where a tapped notification should land, or null to stay put.
export function routeForNotification(response: Notifications.NotificationResponse): string | null {
  const data = response.notification.request.content.data as
    | { kind?: string; restaurantId?: unknown }
    | undefined
  const restaurantId = typeof data?.restaurantId === 'string' ? data.restaurantId : null
  if (!restaurantId) return null
  if (data?.kind === CATEGORY) {
    if (response.actionIdentifier === DIDNT_GO) return null
    return `/visit/${restaurantId}`
  }
  // Score-change pushes (server/api/cron/notify.ts) open the place.
  return `/restaurant/${restaurantId}`
}
