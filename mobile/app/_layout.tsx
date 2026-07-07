import { useEffect } from 'react'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { ensureSession } from '@/lib/auth'
import { useSession } from '@/hooks/useSession'
import { configurePurchases, loginPurchases } from '@/lib/purchases'

export default function RootLayout() {
  const { session } = useSession()

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
