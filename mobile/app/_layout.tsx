import { useEffect } from 'react'
import { LogBox } from 'react-native'
import { Stack, useRouter } from 'expo-router'
import * as Notifications from 'expo-notifications'
import { StatusBar } from 'expo-status-bar'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { ensureSession } from '@/lib/auth'
import { useSession } from '@/hooks/useSession'
import { configurePurchases, loginPurchases } from '@/lib/purchases'
import { restaurantIdFromNotificationResponse } from '@/lib/push'

if (__DEV__) {
  // Supabase's own background token-refresh timer (runs every ~30s for the
  // life of the app) already catches its own failures and logs this as a
  // known-transient console.error — it retries on the next tick regardless.
  // Without this it pops a full-screen LogBox error on every blip in the
  // simulator's network, which isn't actionable from application code.
  LogBox.ignoreLogs(['Auto refresh tick failed with error'])
}

export default function RootLayout() {
  const { session } = useSession()
  const router = useRouter()

  // Deep-links a tapped score-change notification straight to that
  // restaurant's detail page — covers both the app already running
  // (foreground/background tap) and a cold start launched by the tap.
  useEffect(() => {
    Notifications.getLastNotificationResponseAsync().then((response) => {
      const restaurantId = response && restaurantIdFromNotificationResponse(response)
      if (restaurantId) router.push(`/restaurant/${restaurantId}`)
    })
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const restaurantId = restaurantIdFromNotificationResponse(response)
      if (restaurantId) router.push(`/restaurant/${restaurantId}`)
    })
    return () => sub.remove()
  }, [router])

  // Silently establishes an anonymous session on first launch, so lists,
  // saves, and reviews work immediately with no sign-in screen. Adding an
  // email later (Account tab) upgrades this same session in place.
  useEffect(() => {
    configurePurchases()
    ensureSession().catch(() => {
      // No network on first launch, etc. — screens that need a session
      // handle a still-null session gracefully; this gets retried
      // implicitly next time ensureSession runs (app relaunch).
    })
  }, [])

  // Links the RevenueCat customer to this Supabase user so Account's
  // "Manage subscription" (Customer Center) works. The paywall gate itself
  // is disabled for now — see PaywallGate.tsx / lib/purchases.ts to re-enable.
  useEffect(() => {
    if (!session) return
    loginPurchases(session.user.id)
  }, [session?.user.id])

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="restaurant/[id]" options={{ presentation: 'card' }} />
      </Stack>
    </GestureHandlerRootView>
  )
}
