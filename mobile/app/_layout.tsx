import { useCallback, useEffect, useMemo, useState } from 'react'
import { View, ActivityIndicator, LogBox, Linking, Alert, AppState } from 'react-native'
import { Stack, useRouter } from 'expo-router'
import * as Notifications from 'expo-notifications'
import * as Updates from 'expo-updates'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { ensureSession } from '@/lib/auth'
import { useSession } from '@/hooks/useSession'
import {
  configurePurchases,
  loginPurchases,
  getIsEntitled,
  readIsEntitled,
  onEntitlementChange,
} from '@/lib/purchases'
import { PaywallGate } from '@/components/PaywallGate'
import { routeForNotification, setupFollowUpCategory } from '@/lib/followups'
import { handleAuthRedirect } from '@/lib/authLink'
import { useTheme } from '@/theme/useTheme'
import { PlanContext, type PlanState } from '@/hooks/usePlan'
import { Onboarding } from '@/components/Onboarding'
import { getOnboardingAnswers, logOnboardingEvent, type OnboardingAnswers } from '@/lib/onboarding'

// Hold the native splash — the Bitescore logo — rather than letting it vanish
// the instant the first frame is ready. Claimed at module scope so it happens
// before the first render, and always released below.
SplashScreen.preventAutoHideAsync().catch(() => {})

// Long enough to register as branding, short enough not to feel like the app
// is slow to start. Startup work usually finishes well inside this, so in
// practice this is the splash duration rather than a floor under a longer wait.
const MIN_SPLASH_MS = 2000

// Show our own local reminders (and pushes) even while the app is open.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
})

if (__DEV__) {
  // Supabase's own background token-refresh timer (runs every ~30s for the
  // life of the app) already catches its own failures and logs this as a
  // known-transient console.error — it retries on the next tick regardless.
  // Without this it pops a full-screen LogBox error on every blip in the
  // simulator's network, which isn't actionable from application code.
  LogBox.ignoreLogs(['Auto refresh tick failed with error'])
}

// The personal touch at the top of the paywall, from the wizard's answers.
function readyNotice(answers: OnboardingAnswers | null): string | undefined {
  if (!answers || (!answers.name && !answers.city)) return undefined
  const guide = answers.city ? `Your ${answers.city} food guide is ready` : 'Your food guide is ready'
  return answers.name ? `${answers.name}, ${guide.charAt(0).toLowerCase()}${guide.slice(1)}` : guide
}

export default function RootLayout() {
  const c = useTheme()
  const { session, loading: sessionLoading } = useSession()
  const [entitled, setEntitled] = useState<boolean | null>(null)
  const [identityFailed, setIdentityFailed] = useState(false)
  // There is no free plan: without Pro, a new install goes through the
  // onboarding wizard once, then the paywall. Null while still reading it.
  const [onboarding, setOnboarding] = useState<OnboardingAnswers | 'pending' | null>(null)
  const router = useRouter()

  useEffect(() => {
    getOnboardingAnswers()
      .then((answers) => setOnboarding(answers ?? 'pending'))
      .catch(() => setOnboarding('pending'))
  }, [])

  // Deep-links a tapped notification: a score-change push opens the place, a
  // "Did you visit …?" reminder opens "How was it?". Covers both the app
  // already running and a cold start launched by the tap.
  useEffect(() => {
    setupFollowUpCategory()
    Notifications.getLastNotificationResponseAsync().then((response) => {
      const route = response && routeForNotification(response)
      if (route) router.push(route)
    })
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const route = routeForNotification(response)
      if (route) router.push(route)
    })
    return () => sub.remove()
  }, [router])

  // Email sign-in / add-email links come back as bitescore://auth-callback
  // with the session in the URL. Handled here rather than in a route because
  // the paywall replaces the whole navigator for anyone not yet entitled —
  // exactly the person signing back in to recover their access.
  useEffect(() => {
    const handle = async (url: string | null) => {
      const result = await handleAuthRedirect(url)
      if (result) Alert.alert('Couldn’t sign in', result)
    }
    Linking.getInitialURL().then(handle)
    const sub = Linking.addEventListener('url', ({ url }) => handle(url))
    return () => sub.remove()
  }, [])

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

  // No session yet (first launch offline): keep trying, so the person isn't
  // stuck on a paywall that can't attach a purchase to an account.
  useEffect(() => {
    if (sessionLoading || session) return
    const t = setInterval(() => ensureSession().catch(() => {}), 5000)
    return () => clearInterval(t)
  }, [sessionLoading, session])

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

  // Launch isn't the only check: someone who cancels their free trial, or
  // whose plan lapses, while the app sits open or in the background is sent to
  // the paywall on their next return to it, not on some later cold start.
  // These only ever take access away; granting stays with launch and the
  // paywall's own purchase/restore.
  const recheckPro = useCallback(async () => {
    if ((await readIsEntitled()) === false) setEntitled(false)
  }, [])

  useEffect(() => {
    if (entitled !== true) return
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') recheckPro()
    })
    const stopListening = onEntitlementChange((now) => {
      if (!now) setEntitled(false)
    })
    return () => {
      appState.remove()
      stopListening()
    }
  }, [entitled, recheckPro])

  const plan = useMemo<PlanState>(
    () => ({
      isPro: entitled === true,
      unlockPro: () => setEntitled(true),
      recheckPro,
    }),
    [entitled, recheckPro],
  )

  const [splashHeld, setSplashHeld] = useState(true)
  useEffect(() => {
    const t = setTimeout(() => setSplashHeld(false), MIN_SPLASH_MS)
    return () => clearTimeout(t)
  }, [])

  const stillChecking = sessionLoading || onboarding === null || (session && entitled === null)
  // Not knowing counts as not entitled. With no session (offline first
  // launch) the entitlement can't be checked, and that used to fall through
  // to the whole app for free.
  const showPaywall = entitled !== true
  // Signing back in from the wizard's first screen re-reads the entitlement;
  // a returning Pro user then skips the rest of it.
  const showOnboarding = showPaywall && onboarding === 'pending'
  const answers = onboarding !== 'pending' ? onboarding : null
  const atPaywall = !stillChecking && showPaywall && !showOnboarding

  useEffect(() => {
    if (atPaywall) logOnboardingEvent('paywall')
  }, [atPaywall])

  // Drop the splash only once the minimum has elapsed *and* there is something
  // real behind it — otherwise it would hand over to the spinner, which is a
  // worse first impression than holding the logo a moment longer.
  useEffect(() => {
    if (splashHeld || stillChecking) return
    SplashScreen.hideAsync().catch(() => {})
  }, [splashHeld, stillChecking])

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StatusBar style="dark" />
      {stillChecking ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: c.bg }}>
          <ActivityIndicator color={c.tint} />
        </View>
      ) : showOnboarding ? (
        // Ends on its own reveal + pricing sheet; finishing means they bought
        // or restored.
        <Onboarding
          userId={session?.user.id}
          identityFailed={identityFailed}
          onFinished={(done) => {
            setOnboarding(done)
            setEntitled(true)
          }}
        />
      ) : showPaywall ? (
        <PaywallGate
          userId={session?.user.id}
          identityFailed={identityFailed}
          onUnlocked={() => {
            logOnboardingEvent('unlocked')
            setEntitled(true)
          }}
          notice={readyNotice(answers)}
        />
      ) : (
        <PlanContext.Provider value={plan}>
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg } }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="restaurant/[id]" />
            <Stack.Screen name="list/[id]" />
            <Stack.Screen name="user/[id]" />
            <Stack.Screen name="follows/[id]" />
            <Stack.Screen name="settings" />
            <Stack.Screen name="edit-profile" options={{ presentation: 'modal' }} />
            <Stack.Screen name="visit/[id]" options={{ presentation: 'modal' }} />
            <Stack.Screen name="l/[slug]" options={{ presentation: 'modal' }} />
            <Stack.Screen name="paywall" options={{ presentation: 'modal' }} />
          </Stack>
        </PlanContext.Provider>
      )}
    </GestureHandlerRootView>
  )
}
