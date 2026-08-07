import { Platform } from 'react-native'
import * as Notifications from 'expo-notifications'
import { supabase } from './supabase'
import { getNotificationPrefs } from './data'

// Registers this device for push and links the Expo push token to the signed-in
// user, so the server's score-change dispatcher can reach them. Call after
// sign-in and whenever notification settings are touched.
export async function registerForPushNotifications(): Promise<
  { ok: true } | { ok: false; reason: string }
> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, reason: 'not-signed-in' }

  const { status: existing } = await Notifications.getPermissionsAsync()
  let status = existing
  if (status !== 'granted') {
    const req = await Notifications.requestPermissionsAsync()
    status = req.status
  }
  if (status !== 'granted') return { ok: false, reason: 'permission-denied' }

  const tokenResponse = await Notifications.getExpoPushTokenAsync()
  const expoToken = tokenResponse.data

  const { error } = await supabase
    .from('push_tokens')
    .upsert(
      { user_id: user.id, expo_token: expoToken, platform: Platform.OS === 'ios' ? 'ios' : 'android' },
      { onConflict: 'user_id,expo_token' },
    )
  if (error) return { ok: false, reason: error.message }
  return { ok: true }
}

// Only prompt once per app session; permission state is sticky at the OS
// level, so repeating the round trip on every save buys nothing.
let registrationAttempted = false

// Registers for push the first time someone saves a place. That is the moment
// the value is self-evident ("we'll tell you if this place's score changes"),
// which is both kinder than prompting at launch and what Apple asks for.
//
// Previously registration ran only when the Account toggle was flipped — but
// that toggle already renders as on, so a user who never touched it never
// registered. Every account had the switch showing "on" and no token behind
// it, and no score-change notification could ever be delivered.
//
// Safe to call after any save: it respects the user's own preference, only
// prompts when permission is still undetermined (iOS suppresses the dialog
// once denied), and never surfaces its own failures — saving a place must not
// depend on notification setup succeeding.
export async function registerForPushAfterSave(): Promise<void> {
  if (registrationAttempted) return
  registrationAttempted = true
  try {
    if (!(await getNotificationPrefs())) return
    await registerForPushNotifications()
  } catch {
    // Non-essential to the save the user actually asked for.
  }
}

// Pulls the restaurant id back out of a tapped score-change notification
// (see server/api/cron/notify.ts, which sets data: { restaurantId }).
export function restaurantIdFromNotificationResponse(
  response: Notifications.NotificationResponse,
): string | null {
  const id = response.notification.request.content.data?.restaurantId
  return typeof id === 'string' ? id : null
}
