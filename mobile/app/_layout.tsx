import { useEffect, useState } from 'react'
import { View, ActivityIndicator, LogBox } from 'react-native'
import { Stack, useRouter } from 'expo-router'
import * as Notifications from 'expo-notifications'
import * as Updates from 'expo-updates'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import { useFonts } from 'expo-font'
import {
  BricolageGrotesque_600SemiBold,
  BricolageGrotesque_800ExtraBold,
} from '@expo-google-fonts/bricolage-grotesque'
import { DMSans_400Regular, DMSans_500Medium, DMSans_700Bold } from '@expo-google-fonts/dm-sans'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { ensureSession } from '@/lib/auth'
import { useSession } from '@/hooks/useSession'
import { configurePurchases, loginPurchases, getIsEntitled } from '@/lib/purchases'
import { PaywallGate } from '@/components/PaywallGate'
import { restaurantIdFromNotificationResponse } from '@/lib/push'
import { useTheme } from '@/theme/useTheme'

// Hold the native splash — the Bitescore logo — rather than letting it vanish
// the instant the first frame is ready. Claimed at module scope so it happens
// before the first render, and always released below.
SplashScreen.preventAutoHideAsync().catch(() => {})

// Long enough to register as branding, short enough not to feel like the app
// is slow to start. Startup work usually finishes well inside this, so in
// practice this is the splash duration rather than a floor under a longer wait.
const MIN_SPLASH_MS = 2000

if (__DEV__) {
  // Supabase's own background token-refresh timer (runs every ~30s for the
  // life of the app) already catches its own failures and logs this as a
  // known-transient console.error — it retries on the next tick regardless.
  // Without this it pops a full-screen LogBox error on every blip in the
  // simulator's network, which isn't actionable from application code.
  LogBox.ignoreLogs(['Auto refresh tick failed with error'])
}

export default function RootLayout() {
  const c = useTheme()
  const { session, loading: sessionLoading } = useSession()
  const [entitled, setEntitled] = useState<boolean | null>(null)
  const [identityFailed, setIdentityFailed] = useState(false)
  const router = useRouter()
  const [fontsLoaded] = useFonts({
    BricolageGrotesque_600SemiBold,
    BricolageGrotesque_800ExtraBold,
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_700Bold,
  })

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

  // Check for an OTA update on every launch and reload immediately if one is
  // available, so users don't need the two-launch cycle.
  useEffect(() => {
    if (__DEV__) return
    Updates.checkForUpdateAsync()
      .then(({ isAvailable }) => {
        if (!isAvailable) return
        return Updates.fetchUpdateAsync().then(() => Updates.reloadAsync())
      })
      .catch(() => {})
  }, [])

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

  // Links the RevenueCat customer to this Supabase user, then checks
  // entitlement — the whole app is gated behind the paywall until this
  // resolves true (see PaywallGate.tsx for the purchase/restore flow).
  useEffect(() => {
    if (!session) return
    ;(async () => {
      // Identity has to be established before the entitlement answer means
      // anything: RevenueCat persists the last app user id across launches, so
      // without a confirmed login this reports on whichever customer the SDK
      // was left on. Pass the result down so the paywall can distinguish
      // "you haven't bought this" from "we couldn't check".
      const identified = await loginPurchases(session.user.id)
      setIdentityFailed(!identified)
      setEntitled(await getIsEntitled())
    })()
  }, [session?.user.id])

  const [splashHeld, setSplashHeld] = useState(true)
  useEffect(() => {
    const t = setTimeout(() => setSplashHeld(false), MIN_SPLASH_MS)
    return () => clearTimeout(t)
  }, [])

  const stillChecking = !fontsLoaded || sessionLoading || (session && entitled === null)

  // Drop the splash only once the minimum has elapsed *and* there is something
  // real behind it — otherwise it would hand over to the spinner, which is a
  // worse first impression than holding the logo a moment longer.
  useEffect(() => {
    if (splashHeld || stillChecking) return
    SplashScreen.hideAsync().catch(() => {})
  }, [splashHeld, stillChecking])

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StatusBar style="auto" />
      {stillChecking ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: c.bg }}>
          <ActivityIndicator color={c.primary} />
        </View>
      ) : entitled === false ? (
        <PaywallGate
          userId={session?.user.id}
          identityFailed={identityFailed}
          onUnlocked={() => setEntitled(true)}
        />
      ) : (
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="restaurant/[id]" options={{ presentation: 'card' }} />
        </Stack>
      )}
    </GestureHandlerRootView>
  )
}
