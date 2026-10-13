import { useEffect, useRef, useState } from 'react'
import {
  Animated,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import * as Location from 'expo-location'
import * as Notifications from 'expo-notifications'
import { useTheme } from '@/theme/useTheme'
import { registerForPushNotifications } from '@/lib/push'
import { sanitizeUsername } from '@/lib/username'
import {
  FOOD_OPTIONS,
  UsernameTakenError,
  cityFromLocation,
  markOnboarded,
  saveCity,
  saveFoodLikes,
  saveNameAndUsername,
  type OnboardingAnswers,
} from '@/lib/onboarding'
import { Button } from './ui'
import { BadgeFan } from './BadgeFan'
import { EmailSignIn } from './EmailSignIn'

// First-launch wizard: welcome, location, notifications, city, food, name —
// then the root layout shows the paywall. Every question can be skipped, and
// a failed save never stops anyone getting through: the answers are
// personalisation, not a gate.

const STEPS = ['welcome', 'location', 'notifications', 'city', 'food', 'name'] as const
type Step = (typeof STEPS)[number]

// Brand yellow from the logo, icon and splash.
const HERO_BG = '#FFDE59'

const CITY_PICKS = [
  'London',
  'Manchester',
  'Birmingham',
  'Leeds',
  'Liverpool',
  'Bristol',
  'Sheffield',
  'Newcastle',
  'Nottingham',
  'Cardiff',
  'Belfast',
]

function suffix(): string {
  return String(Math.floor(100 + Math.random() * 900))
}

// Same shape as lib/username's generateUsername, with a stable number so the
// suggestion doesn't flicker on every keystroke.
function suggestUsername(name: string, num: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12) || 'foodie'
  return `${base}${num}`
}

export function Onboarding({ onDone }: { onDone: (answers: OnboardingAnswers) => void }) {
  const c = useTheme()
  const insets = useSafeAreaInsets()
  const [stepIndex, setStepIndex] = useState(0)
  const step: Step = STEPS[stepIndex]
  const [busy, setBusy] = useState(false)
  const [signingIn, setSigningIn] = useState(false)

  const [city, setCity] = useState('')
  const cityTouched = useRef(false)
  const [foods, setFoods] = useState<Set<string>>(new Set())
  const [name, setName] = useState('')
  const [num, setNum] = useState(suffix)
  const [customUsername, setCustomUsername] = useState<string | null>(null)
  const [nameError, setNameError] = useState<string | null>(null)

  const username = customUsername ?? suggestUsername(name, num)

  // Each step slides in from the right.
  const anim = useRef(new Animated.Value(1)).current
  useEffect(() => {
    anim.setValue(0)
    Animated.timing(anim, { toValue: 1, duration: 260, useNativeDriver: true }).start()
  }, [stepIndex, anim])

  const next = () => setStepIndex((i) => Math.min(i + 1, STEPS.length - 1))
  const back = () => setStepIndex((i) => Math.max(i - 1, 0))

  const prefillCity = () => {
    cityFromLocation().then((found) => {
      if (found && !cityTouched.current) setCity(found)
    })
  }

  const onLocation = async () => {
    setBusy(true)
    try {
      const { status } = await Location.requestForegroundPermissionsAsync()
      if (status === 'granted') prefillCity()
    } catch {
      // Carry on either way; the map asks again when it needs it.
    } finally {
      setBusy(false)
      next()
    }
  }

  const onNotifications = async () => {
    setBusy(true)
    try {
      const result = await registerForPushNotifications()
      // No session yet (offline first launch): still ask, so the token can
      // be registered on a later save.
      if (!result.ok && result.reason === 'not-signed-in') await Notifications.requestPermissionsAsync()
    } catch {
      // Not worth blocking onboarding over.
    } finally {
      setBusy(false)
      next()
    }
  }

  const toggleFood = (key: string) => {
    setFoods((prev) => {
      const s = new Set(prev)
      s.has(key) ? s.delete(key) : s.add(key)
      return s
    })
  }

  const finish = async () => {
    const clean = sanitizeUsername(username)
    if (clean.length < 3) {
      setNameError('Usernames need at least 3 letters or numbers.')
      return
    }
    setBusy(true)
    setNameError(null)
    try {
      await Promise.all([
        city.trim() ? saveCity(city).catch((e) => console.warn('[bitescore] save city', e)) : null,
        foods.size
          ? saveFoodLikes(Array.from(foods)).catch((e) => console.warn('[bitescore] save food likes', e))
          : null,
      ])
      try {
        await saveNameAndUsername(
          name,
          clean,
          customUsername === null ? () => suggestUsername(name, suffix()) : null,
        )
      } catch (e) {
        if (e instanceof UsernameTakenError) {
          setNameError(e.message)
          return
        }
        // Offline or similar: they can set it later in Edit profile.
        console.warn('[bitescore] save name', e)
      }
      const answers = { name: name.trim(), city: city.trim() }
      await markOnboarded(answers).catch(() => {})
      onDone(answers)
    } finally {
      setBusy(false)
    }
  }

  const fade = {
    opacity: anim,
    transform: [{ translateX: anim.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }],
  }

  if (step === 'welcome') {
    return (
      <View style={[styles.root, { backgroundColor: HERO_BG, paddingTop: insets.top, paddingBottom: insets.bottom + 16 }]}>
        <Animated.View style={[styles.welcome, fade]}>
          <BadgeFan />
          <Text style={[styles.brand, { color: c.label }]}>Bitescore</Text>
          <Text style={[styles.welcomeTitle, { color: c.label }]}>Know before you eat</Text>
          <Text style={[styles.welcomeBody, { color: c.label }]}>
            Official food hygiene ratings for every café, restaurant and takeaway in the UK.
          </Text>
        </Animated.View>
        <View style={styles.footer}>
          <Button label="Get started" bg={c.label} fg={HERO_BG} onPress={next} />
          <Pressable onPress={() => setSigningIn(true)} hitSlop={8} style={styles.secondary}>
            <Text style={[styles.secondaryText, { color: c.label }]}>
              Already have an account? <Text style={{ fontWeight: '700' }}>Sign in</Text>
            </Text>
          </Pressable>
        </View>
        <EmailSignIn visible={signingIn} onClose={() => setSigningIn(false)} />
      </View>
    )
  }

  const progress = stepIndex / (STEPS.length - 1)

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: c.bg }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={back} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back" style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={c.label} />
        </Pressable>
        <View style={[styles.track, { backgroundColor: c.fill }]}>
          <View style={[styles.trackFill, { backgroundColor: c.tint, width: `${progress * 100}%` }]} />
        </View>
        <View style={styles.backBtn} />
      </View>

      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Animated.View style={fade}>
          {step === 'location' ? (
            <>
              <Icon name="location" color={c.blue} />
              <Text style={[styles.title, { color: c.label }]}>Find clean places near you</Text>
              <Text style={[styles.subtitle, { color: c.label2 }]}>
                Turn on location to see hygiene scores for everywhere around you, and how far away
                they are.
              </Text>
            </>
          ) : step === 'notifications' ? (
            <>
              <Icon name="notifications" color={c.danger} />
              <Text style={[styles.title, { color: c.label }]}>Hear when a score drops</Text>
              <Text style={[styles.subtitle, { color: c.label2 }]}>
                We'll tell you if a place you've saved gets a new hygiene rating. No spam, ever.
              </Text>
              <View style={[styles.mockNote, { backgroundColor: c.card }]}>
                <View style={[styles.mockIcon, { backgroundColor: HERO_BG }]}>
                  <Text style={styles.mockIconText}>B</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.mockTitle, { color: c.label }]}>Score change</Text>
                  <Text style={[styles.mockBody, { color: c.label2 }]}>
                    Golden Dragon dropped from 5 to 2 at its last inspection.
                  </Text>
                </View>
              </View>
            </>
          ) : step === 'city' ? (
            <>
              <Text style={[styles.title, { color: c.label }]}>Where are you based?</Text>
              <Text style={[styles.subtitle, { color: c.label2 }]}>
                Your town or city. It shows on your profile.
              </Text>
              <TextInput
                value={city}
                onChangeText={(t) => {
                  cityTouched.current = true
                  setCity(t)
                }}
                placeholder="e.g. Manchester"
                placeholderTextColor={c.meta}
                autoCapitalize="words"
                autoCorrect={false}
                maxLength={60}
                returnKeyType="next"
                onSubmitEditing={next}
                style={[styles.input, { backgroundColor: c.card, color: c.label }]}
              />
              <View style={styles.chips}>
                {CITY_PICKS.map((pick) => (
                  <Chip
                    key={pick}
                    label={pick}
                    active={city.trim().toLowerCase() === pick.toLowerCase()}
                    onPress={() => {
                      cityTouched.current = true
                      setCity(pick)
                    }}
                  />
                ))}
              </View>
            </>
          ) : step === 'food' ? (
            <>
              <Text style={[styles.title, { color: c.label }]}>What do you like eating?</Text>
              <Text style={[styles.subtitle, { color: c.label2 }]}>Pick as many as you like.</Text>
              <View style={styles.chips}>
                {FOOD_OPTIONS.map((o) => (
                  <Chip
                    key={o.key}
                    label={`${o.emoji}  ${o.label}`}
                    active={foods.has(o.key)}
                    onPress={() => toggleFood(o.key)}
                  />
                ))}
              </View>
            </>
          ) : (
            <>
              <Text style={[styles.title, { color: c.label }]}>What should we call you?</Text>
              <Text style={[styles.subtitle, { color: c.label2 }]}>
                Your first name stays private. Other people only see your username.
              </Text>
              <TextInput
                value={name}
                onChangeText={(t) => {
                  setName(t)
                  setNameError(null)
                }}
                placeholder="First name"
                placeholderTextColor={c.meta}
                autoCapitalize="words"
                autoComplete="given-name"
                textContentType="givenName"
                maxLength={40}
                autoFocus
                style={[styles.input, { backgroundColor: c.card, color: c.label }]}
              />
              <Text style={[styles.label, { color: c.meta }]}>USERNAME</Text>
              <View style={[styles.usernameRow, { backgroundColor: c.card }]}>
                <Text style={[styles.at, { color: c.meta }]}>@</Text>
                <TextInput
                  value={username}
                  onChangeText={(t) => {
                    setCustomUsername(sanitizeUsername(t))
                    setNameError(null)
                  }}
                  autoCapitalize="none"
                  autoCorrect={false}
                  maxLength={24}
                  style={[styles.usernameInput, { color: c.label }]}
                />
                <Pressable
                  onPress={() => {
                    setCustomUsername(null)
                    setNum(suffix())
                    setNameError(null)
                  }}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Generate a username"
                  style={[styles.shuffle, { backgroundColor: c.tintSoft }]}
                >
                  <Ionicons name="shuffle" size={18} color={c.tint} />
                </Pressable>
              </View>
              {nameError ? (
                <Text style={[styles.error, { color: c.danger }]}>{nameError}</Text>
              ) : (
                <Text style={[styles.hint, { color: c.meta }]}>Tap shuffle for a new one, or type your own.</Text>
              )}
            </>
          )}
        </Animated.View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        {step === 'location' ? (
          <>
            <Button label="Turn on location" icon="location" loading={busy} onPress={onLocation} />
            <Skip onPress={next} />
          </>
        ) : step === 'notifications' ? (
          <>
            <Button label="Turn on notifications" icon="notifications" loading={busy} onPress={onNotifications} />
            <Skip onPress={next} />
          </>
        ) : step === 'city' ? (
          <>
            <Button label="Continue" disabled={!city.trim()} onPress={next} />
            <Skip onPress={next} />
          </>
        ) : step === 'food' ? (
          <>
            <Button
              label={foods.size ? `Continue · ${foods.size} picked` : 'Continue'}
              disabled={foods.size === 0}
              onPress={next}
            />
            <Skip onPress={next} />
          </>
        ) : (
          <Button label="Continue" disabled={!name.trim()} loading={busy} onPress={finish} />
        )}
      </View>
    </KeyboardAvoidingView>
  )
}

function Icon({ name, color }: { name: keyof typeof Ionicons.glyphMap; color: string }) {
  return (
    <View style={[styles.icon, { backgroundColor: color }]}>
      <Ionicons name={name} size={34} color="#FFFFFF" />
    </View>
  )
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const c = useTheme()
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: active }}
      style={[
        styles.chip,
        {
          backgroundColor: active ? c.tintSoft : c.card,
          borderColor: active ? c.tint : c.separator,
        },
      ]}
    >
      <Text style={[styles.chipText, { color: active ? c.tint : c.label }]}>{label}</Text>
    </Pressable>
  )
}

function Skip({ onPress }: { onPress: () => void }) {
  const c = useTheme()
  return (
    <Pressable onPress={onPress} hitSlop={8} style={styles.secondary} accessibilityRole="button">
      <Text style={[styles.secondaryText, { color: c.meta }]}>Not now</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  welcome: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  brand: { fontSize: 18, fontWeight: '800', letterSpacing: 0.5, marginBottom: 8 },
  welcomeTitle: { fontSize: 38, lineHeight: 42, fontWeight: '800', letterSpacing: -1.2, textAlign: 'center' },
  welcomeBody: { fontSize: 17, lineHeight: 24, textAlign: 'center', marginTop: 12, opacity: 0.75 },
  topBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, gap: 8 },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  track: { flex: 1, height: 6, borderRadius: 3, overflow: 'hidden' },
  trackFill: { height: 6, borderRadius: 3 },
  body: { paddingHorizontal: 24, paddingTop: 28, paddingBottom: 24 },
  icon: {
    width: 72,
    height: 72,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  title: { fontSize: 30, lineHeight: 35, fontWeight: '700', letterSpacing: -0.8 },
  subtitle: { fontSize: 17, lineHeight: 24, marginTop: 10 },
  mockNote: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
    borderRadius: 18,
    padding: 14,
    marginTop: 28,
    boxShadow: '0 6px 20px rgba(23, 23, 15, 0.08)',
  },
  mockIcon: { width: 38, height: 38, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  mockIconText: { fontSize: 20, fontWeight: '800', color: '#1C1C1E' },
  mockTitle: { fontSize: 15, fontWeight: '600' },
  mockBody: { fontSize: 14, lineHeight: 19, marginTop: 2 },
  input: { height: 54, borderRadius: 14, paddingHorizontal: 16, fontSize: 18, marginTop: 24 },
  label: { fontSize: 13, fontWeight: '600', letterSpacing: 0.4, marginTop: 24, marginBottom: 8, marginLeft: 4 },
  usernameRow: { flexDirection: 'row', alignItems: 'center', height: 54, borderRadius: 14, paddingLeft: 16, paddingRight: 8 },
  at: { fontSize: 18 },
  usernameInput: { flex: 1, minWidth: 0, fontSize: 18, height: 54, marginLeft: 2 },
  shuffle: { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  hint: { fontSize: 13, marginTop: 8, marginLeft: 4 },
  error: { fontSize: 13, fontWeight: '500', marginTop: 8, marginLeft: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 20 },
  chip: { borderWidth: 1.5, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 10 },
  chipText: { fontSize: 15, fontWeight: '600' },
  footer: { paddingHorizontal: 24, paddingTop: 8 },
  secondary: { alignItems: 'center', paddingTop: 16, paddingBottom: 4 },
  secondaryText: { fontSize: 15, fontWeight: '500' },
})
