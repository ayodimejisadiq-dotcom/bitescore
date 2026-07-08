import { Platform } from 'react-native'
import * as Notifications from 'expo-notifications'
import { supabase } from './supabase'

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

// Pulls the restaurant id back out of a tapped score-change notification
// (see server/api/cron/notify.ts, which sets data: { restaurantId }).
export function restaurantIdFromNotificationResponse(
  response: Notifications.NotificationResponse,
): string | null {
  const id = response.notification.request.content.data?.restaurantId
  return typeof id === 'string' ? id : null
}
