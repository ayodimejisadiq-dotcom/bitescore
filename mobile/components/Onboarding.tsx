import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  ActivityIndicator,
  Animated,
  Image,
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
import { scoreFill } from '@/theme/colors'
import { registerForPushNotifications } from '@/lib/push'
import { sanitizeUsername } from '@/lib/username'
import { distanceLabel } from '@/lib/people'
import {
  FOOD_OPTIONS,
  UsernameTakenError,
  cityFromLocation,
  logOnboardingEvent,
  markOnboarded,
  nearbySnapshot,
  placeNames,
  saveCity,
  saveFoodLikes,
  saveNameAndUsername,
  usernameAvailable,
  type NearbySnapshot,
  type OnboardingAnswers,
  type TeaserPlace,
} from '@/lib/onboarding'
import { Button } from './ui'
import { ScoreBadge } from './ScoreBadge'
import { EmailSignIn } from './EmailSignIn'
import { PricingSheet } from './PricingSheet'
import { BENEFITS } from './PaywallGate'

// First-launch wizard (design: "Bitescore Onboarding v2"): welcome, location,
// notifications, city, food, name, then the nearby reveal with the pricing
// sheet pinned under it — the hard paywall. Permission steps move on whatever
// the person answers in the system prompt; a failed save never stops anyone:
// the answers are personalisation, not a gate.

const STEPS = ['welcome', 'location', 'notifications', 'city', 'food', 'name', 'nearby'] as const
type Step = (typeof STEPS)[number]

// Brand yellow from the logo, icon and splash.
const BRAND_YELLOW = '#FFDE59'
const WORDMARK = require('../assets/wordmark.png')
const WORDMARK_ASPECT = 718 / 117

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

// lib/username's generateUsername shape (first name, max 8, plus 3 digits),
// with the number held steady so the suggestion doesn't flicker as they type.
function suggestUsername(name: string, num: string): string {
  return `${name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || 'user'}${num}`
}

// "Takeaway/sandwich shop" -> "Takeaway"
function typeLabel(businessType: string): string {
  return businessType.split('/')[0]
}

export function Onboarding({
  userId,
  identityFailed,
  onFinished,
}: {
  userId?: string
  identityFailed?: boolean
  // After a purchase or restore at the end of the wizard.
  onFinished: (answers: OnboardingAnswers) => void
}) {
  const c = useTheme()
  const insets = useSafeAreaInsets()
  const [stepIndex, setStepIndex] = useState(0)
  const step: Step = STEPS[stepIndex]
  const [busy, setBusy] = useState(false)
  const [signingIn, setSigningIn] = useState(false)

  const [city, setCity] = useState('')
  const [cityFromGps, setCityFromGps] = useState(false)
  const cityTouched = useRef(false)
  const [foods, setFoods] = useState<Set<string>>(new Set())
  const [name, setName] = useState('')
  const [num, setNum] = useState(suffix)
  const [customUsername, setCustomUsername] = useState<string | null>(null)
  const [taken, setTaken] = useState(false)
  const [nearby, setNearby] = useState<NearbySnapshot | 'loading' | null>('loading')
  const [unlocked, setUnlocked] = useState(false)
  const [names, setNames] = useState<Record<string, string>>({})

  const username = customUsername ?? suggestUsername(name, num)
  const cleanUsername = sanitizeUsername(username)
  const answers = (): OnboardingAnswers => ({ name: name.trim(), city: city.trim() })

  // Each step slides in from the right.
  const anim = useRef(new Animated.Value(1)).current
  useEffect(() => {
    anim.setValue(0)
    Animated.timing(anim, { toValue: 1, duration: 260, useNativeDriver: true }).start()
  }, [stepIndex, anim])

  useEffect(() => {
    logOnboardingEvent(step)
  }, [step])

  const next = () => setStepIndex((i) => Math.min(i + 1, STEPS.length - 1))
  const back = () => setStepIndex((i) => Math.max(i - 1, 0))

  const onLocation = async () => {
    setBusy(true)
    try {
      const { status } = await Location.requestForegroundPermissionsAsync()
      if (status === 'granted') {
        logOnboardingEvent('location_on')
        cityFromLocation().then((found) => {
          if (found && !cityTouched.current) {
            setCity(found)
            setCityFromGps(true)
          }
        })
      }
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
      if (result.ok) logOnboardingEvent('notifications_on')
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

  const editCity = (t: string) => {
    cityTouched.current = true
    setCityFromGps(false)
    setCity(t)
  }

  const toggleFood = (key: string) => {
    setFoods((prev) => {
      const s = new Set(prev)
      s.has(key) ? s.delete(key) : s.add(key)
      return s
    })
  }

  // Live "is it taken?" while they type, debounced.
  useEffect(() => {
    setTaken(false)
    if (step !== 'name' || cleanUsername.length < 3) return
    let live = true
    const t = setTimeout(() => {
      usernameAvailable(cleanUsername).then((ok) => live && setTaken(!ok))
    }, 400)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [cleanUsername, step])

  // Leaving the name step: saves the profile, then on to the reveal.
  const saveProfile = async () => {
    setBusy(true)
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
          cleanUsername,
          customUsername === null ? () => suggestUsername(name, suffix()) : null,
        )
      } catch (e) {
        if (e instanceof UsernameTakenError) {
          setTaken(true)
          return
        }
        // Offline or similar: they can set it later in Edit profile.
        console.warn('[bitescore] save name', e)
      }
      // Remembered now, so an app restart from here lands on the paywall
      // rather than the start of the wizard.
      markOnboarded(answers()).catch(() => {})
      next()
    } finally {
      setBusy(false)
    }
  }

  // The reveal: real scores around them, loaded on arrival.
  useEffect(() => {
    if (step !== 'nearby') return
    logOnboardingEvent('paywall')
    let live = true
    setNearby('loading')
    nearbySnapshot(city)
      .catch(() => null)
      .then((snap) => live && setNearby(snap && snap.total > 0 ? snap : null))
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step])

  // Bought or restored: unblur the locked names in place, then into the app.
  const onUnlocked = async () => {
    logOnboardingEvent('unlocked')
    const low = nearby && nearby !== 'loading' ? nearby.low : []
    if (!low.length) {
      onFinished(answers())
      return
    }
    setUnlocked(true)
    placeNames(low.map((p) => p.id))
      .then(setNames)
      .catch(() => {})
  }

  const fade = {
    opacity: anim,
    transform: [{ translateX: anim.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }],
  }

  if (step === 'welcome') {
    return (
      <View style={[styles.root, { backgroundColor: BRAND_YELLOW, paddingTop: insets.top }]}>
        <Animated.View style={[styles.welcome, fade]}>
          <BigBadgeFan />
          <Image
            source={WORDMARK}
            style={styles.wordmark}
            resizeMode="contain"
            accessibilityRole="image"
            accessibilityLabel="Bitescore"
          />
          <Text style={[styles.welcomeTitle, { color: c.label }]}>Know before you eat</Text>
          <Text style={[styles.welcomeBody, { color: c.label }]}>
            Official food hygiene ratings for every café, restaurant and takeaway in the UK.
          </Text>
        </Animated.View>
        <View style={[styles.welcomeFooter, { paddingBottom: insets.bottom + 8 }]}>
          <Button label="Get started" bg={c.label} fg={BRAND_YELLOW} onPress={next} />
          <Pressable onPress={() => setSigningIn(true)} style={styles.signInRow} accessibilityRole="button">
            <Text style={[styles.signInText, { color: c.label }]}>
              <Text style={{ opacity: 0.75 }}>Already have an account? </Text>
              <Text style={{ fontWeight: '700' }}>Sign in</Text>
            </Text>
          </Pressable>
        </View>
        <EmailSignIn visible={signingIn} onClose={() => setSigningIn(false)} />
      </View>
    )
  }

  const navRow = (
    <View style={[styles.nav, { marginTop: insets.top }]}>
      <Pressable onPress={back} accessibilityRole="button" accessibilityLabel="Back" style={styles.backBtn}>
        <Ionicons name="chevron-back" size={26} color={c.tint} />
      </Pressable>
      <View style={[styles.track, { backgroundColor: step === 'nearby' ? 'rgba(0,0,0,0.08)' : c.separator }]}>
        <View style={[styles.trackFill, { backgroundColor: c.tint, width: `${(stepIndex / 6) * 100}%` }]} />
      </View>
    </View>
  )

  if (step === 'nearby') {
    const snap = nearby === 'loading' ? null : nearby
    const good = !!snap && snap.lowCount === 0
    return (
      <View style={[styles.root, { backgroundColor: c.bg }]}>
        <View
          pointerEvents="none"
          style={[
            styles.glow,
            {
              experimental_backgroundImage: `linear-gradient(180deg, ${
                good ? c.tintSoft : '#FBE4DE'
              } 0%, ${c.bg} 100%)`,
            },
          ]}
        />
        {navRow}
        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.revealBody} showsVerticalScrollIndicator={false}>
          <Animated.View style={fade}>
            {nearby === 'loading' ? (
              <View style={styles.loading}>
                <ActivityIndicator color={c.tint} />
                <Text style={[styles.subtitle, { color: c.label2, textAlign: 'center' }]}>
                  Checking the places around you…
                </Text>
              </View>
            ) : snap && !good ? (
              <>
                <Text style={[styles.title, { color: c.label }]}>
                  <Text style={{ color: '#A8321A' }}>
                    {snap.lowCount} {snap.lowCount === 1 ? 'place' : 'places'}
                  </Text>{' '}
                  {snap.where} scored 2 or below
                </Text>
                <Text style={[styles.subtitle, { color: c.label2 }]}>
                  {unlocked
                    ? 'Here they are. You can see every place now.'
                    : `Out of ${snap.total} places within a mile. Would you know which ones?`}
                </Text>
                <View style={[styles.placeCard, styles.lockedCard, { backgroundColor: c.card }]}>
                  {snap.low.map((p, i) => (
                    <PlaceRow
                      key={p.id}
                      place={p}
                      first={i === 0}
                      glow
                      name={unlocked ? names[p.id] : undefined}
                      hiddenWidth={[150, 118, 172][i % 3]}
                      trailing={
                        unlocked ? null : <Ionicons name="lock-closed" size={18} color={c.chevron} />
                      }
                    />
                  ))}
                </View>
                <TopRated places={snap.best} />
              </>
            ) : snap ? (
              <>
                <View style={[styles.goodTile, { backgroundColor: scoreFill['5'] }]}>
                  <Ionicons name="shield-checkmark" size={32} color="#FFFFFF" />
                </View>
                <Text style={[styles.title, { color: scoreFill['5'], marginTop: 24 }]}>
                  Good news {snap.where}
                </Text>
                <Text style={[styles.subtitle, { color: c.label2 }]}>
                  None of the {snap.total} places within a mile scored below 3.
                </Text>
                <View style={{ height: 4 }} />
                <TopRated places={snap.best} />
              </>
            ) : (
              <>
                <Tile color={c.tint} icon="shield-checkmark" size={32} />
                <Text style={[styles.title, { color: c.label, marginTop: 24 }]}>
                  {name.trim() ? `${name.trim()}, your` : 'Your'} food guide is ready
                </Text>
                <Text style={[styles.subtitle, { color: c.label2 }]}>
                  Official hygiene ratings for every café, restaurant and takeaway in the UK.
                </Text>
                <View style={[styles.placeCard, { backgroundColor: c.card, marginTop: 24, paddingVertical: 4 }]}>
                  {BENEFITS.map((b, i) => (
                    <View
                      key={b.title}
                      style={[
                        styles.benefitRow,
                        i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.separator },
                      ]}
                    >
                      <Ionicons name={b.icon} size={20} color={c.tint} />
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.placeName, { color: c.label }]}>{b.title}</Text>
                        <Text style={[styles.placeMeta, { color: c.meta }]}>{b.body}</Text>
                      </View>
                    </View>
                  ))}
                </View>
              </>
            )}
          </Animated.View>
        </ScrollView>
        {unlocked ? (
          <View style={[styles.footer, { paddingBottom: Math.max(30, insets.bottom + 8) }]}>
            <Button label="Start exploring" onPress={() => onFinished(answers())} />
          </View>
        ) : (
          <PricingSheet userId={userId} identityFailed={identityFailed} onUnlocked={onUnlocked} ctaIcon="lock-open" />
        )}
      </View>
    )
  }

  let content: ReactNode
  let footer: ReactNode
  if (step === 'location') {
    content = (
      <>
        <Tile color={c.blue} icon="location" size={34} />
        <Text style={[styles.title, { color: c.label, marginTop: 24 }]}>Find clean places near you</Text>
        <Text style={[styles.subtitle, { color: c.label2 }]}>
          Turn on location to see hygiene scores for everywhere around you, and how far away they are.
        </Text>
        <MapPreview />
      </>
    )
    footer = <Button label="Turn on location" loading={busy} onPress={onLocation} />
  } else if (step === 'notifications') {
    content = (
      <>
        <Tile color={c.danger} icon="notifications" size={32} />
        <Text style={[styles.title, { color: c.label, marginTop: 24 }]}>Hear when a score drops</Text>
        <Text style={[styles.subtitle, { color: c.label2 }]}>
          We'll tell you if a place you've saved gets a new hygiene rating. No spam, ever.
        </Text>
        <MockNotification />
      </>
    )
    footer = <Button label="Turn on notifications" loading={busy} onPress={onNotifications} />
  } else if (step === 'city') {
    content = (
      <>
        <Text style={[styles.title, { color: c.label }]}>Where are you based?</Text>
        <Text style={[styles.subtitle, { color: c.label2 }]}>Your town or city. It shows on your profile.</Text>
        <View style={[styles.field, { backgroundColor: c.card, marginTop: 28 }]}>
          <TextInput
            value={city}
            onChangeText={editCity}
            placeholder="e.g. Manchester"
            placeholderTextColor={c.meta}
            autoCapitalize="words"
            autoCorrect={false}
            maxLength={60}
            returnKeyType="next"
            onSubmitEditing={() => city.trim() && next()}
            style={[styles.fieldInput, { color: c.label }]}
          />
          {city ? (
            <Pressable onPress={() => editCity('')} hitSlop={10} accessibilityLabel="Clear">
              <Ionicons name="close-circle" size={20} color={c.chevron} />
            </Pressable>
          ) : null}
        </View>
        {cityFromGps ? (
          <View style={styles.hintRow}>
            <Ionicons name="navigate" size={13} color={c.tint} />
            <Text style={[styles.hint, { color: c.meta }]}>Filled in from your location</Text>
          </View>
        ) : null}
        <View style={[styles.chips, { gap: 10, marginTop: 24 }]}>
          {CITY_PICKS.map((pick) => (
            <Chip
              key={pick}
              height={40}
              label={pick}
              active={city.trim().toLowerCase() === pick.toLowerCase()}
              onPress={() => editCity(pick)}
            />
          ))}
        </View>
      </>
    )
    footer = <Button label="Continue" disabled={!city.trim()} onPress={next} />
  } else if (step === 'food') {
    content = (
      <>
        <Text style={[styles.title, { color: c.label }]}>What do you like eating?</Text>
        <Text style={[styles.subtitle, { color: c.label2 }]}>Pick as many as you like.</Text>
        <View style={[styles.chips, { gap: 9, marginTop: 26 }]}>
          {FOOD_OPTIONS.map((o) => (
            <Chip
              key={o.key}
              height={42}
              emoji={o.emoji}
              label={o.label}
              active={foods.has(o.key)}
              onPress={() => toggleFood(o.key)}
            />
          ))}
        </View>
      </>
    )
    footer = (
      <Button
        label={foods.size ? `Continue · ${foods.size} picked` : 'Continue'}
        disabled={foods.size === 0}
        onPress={next}
      />
    )
  } else {
    content = (
      <>
        <Text style={[styles.title, { color: c.label }]}>What should we call you?</Text>
        <Text style={[styles.subtitle, { color: c.label2 }]}>
          Your first name stays private. Other people only see your username.
        </Text>
        <Text style={[styles.label, { color: c.meta, marginTop: 30 }]}>FIRST NAME</Text>
        <View style={[styles.field, { backgroundColor: c.card }]}>
          <TextInput
            value={name}
            onChangeText={(t) => {
              setName(t)
              setCustomUsername(null)
            }}
            placeholder="First name"
            placeholderTextColor={c.meta}
            autoCapitalize="words"
            autoComplete="given-name"
            textContentType="givenName"
            maxLength={40}
            autoFocus
            style={[styles.fieldInput, { color: c.label }]}
          />
        </View>
        <Text style={[styles.label, { color: c.meta, marginTop: 22 }]}>USERNAME</Text>
        <View
          style={[
            styles.field,
            { backgroundColor: c.card, paddingRight: 9 },
            taken && { borderWidth: 1.5, borderColor: c.danger },
          ]}
        >
          <Text style={[styles.at, { color: c.meta }]}>@</Text>
          <TextInput
            value={username}
            onChangeText={(t) => setCustomUsername(sanitizeUsername(t))}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={24}
            style={[styles.fieldInput, { color: c.label }]}
          />
          <Pressable
            onPress={() => {
              setCustomUsername(null)
              setNum(suffix())
            }}
            accessibilityRole="button"
            accessibilityLabel="Generate a username"
            style={({ pressed }) => [styles.shuffle, { backgroundColor: pressed ? '#D4E9DC' : c.tintSoft }]}
          >
            <Ionicons name="shuffle" size={20} color={c.tint} />
          </Pressable>
        </View>
        {taken ? (
          <View style={styles.hintRow}>
            <Ionicons name="alert-circle" size={15} color={c.danger} />
            <Text style={[styles.hint, { color: c.danger, fontWeight: '500' }]}>
              @{cleanUsername} is taken. Try another.
            </Text>
          </View>
        ) : (
          <Text style={[styles.hint, styles.hintAlone, { color: c.meta }]}>
            Tap shuffle for a new one, or type your own.
          </Text>
        )}
      </>
    )
    footer = (
      <Button
        label="Continue"
        disabled={!name.trim() || taken || cleanUsername.length < 3}
        loading={busy}
        onPress={saveProfile}
      />
    )
  }

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: c.bg }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {navRow}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Animated.View style={fade}>{content}</Animated.View>
      </ScrollView>
      <View style={[styles.footer, { paddingBottom: Math.max(30, insets.bottom + 8) }]}>{footer}</View>
    </KeyboardAvoidingView>
  )
}

// The paywall hero's badge fan, at welcome-screen size.
function BigBadgeFan() {
  return (
    <View style={styles.bigFan}>
      <View style={[styles.bigTile, { backgroundColor: scoreFill['4'], transform: [{ rotate: '-11deg' }] }]}>
        <Text style={styles.bigNum}>4</Text>
      </View>
      <View style={[styles.bigTile, styles.bigTileCenter, { backgroundColor: scoreFill['5'] }]}>
        <Text style={[styles.bigNum, { fontSize: 46 }]}>5</Text>
      </View>
      <View style={[styles.bigTile, { backgroundColor: scoreFill['3'], transform: [{ rotate: '10deg' }] }]}>
        <Text style={[styles.bigNum, { color: '#1C1C1E' }]}>3</Text>
      </View>
    </View>
  )
}

function Tile({ color, icon, size }: { color: string; icon: keyof typeof Ionicons.glyphMap; size: number }) {
  return (
    <View style={[styles.tile, { backgroundColor: color }]}>
      <Ionicons name={icon} size={size} color="#FFFFFF" />
    </View>
  )
}

// A drawn street map with score pins: no map tiles or location needed
// before permission is granted.
const PINS: { left: number; top: number; rating: string }[] = [
  { left: 40, top: 34, rating: '5' },
  { left: 226, top: 40, rating: '4' },
  { left: 290, top: 120, rating: '5' },
  { left: 66, top: 150, rating: '3' },
  { left: 200, top: 196, rating: '1' },
]

function MapPreview() {
  return (
    <View style={styles.map}>
      <View style={[styles.road, { left: -20, top: 70, width: 440, height: 14, transform: [{ rotate: '-8deg' }] }]} />
      <View style={[styles.road, { left: -20, top: 180, width: 440, height: 10, transform: [{ rotate: '4deg' }] }]} />
      <View style={[styles.road, { left: 120, top: -20, width: 12, height: 300, transform: [{ rotate: '12deg' }] }]} />
      <View style={[styles.road, { left: 260, top: -20, width: 9, height: 300, transform: [{ rotate: '-6deg' }] }]} />
      <View style={styles.park} />
      <View style={styles.halo} />
      <View style={styles.userDot} />
      {PINS.map((p) => (
        <View
          key={`${p.left}-${p.top}`}
          style={[styles.pin, { left: p.left, top: p.top, backgroundColor: scoreFill[p.rating] }]}
        >
          <Text style={[styles.pinNum, p.rating === '3' && { color: '#1C1C1E' }]}>{p.rating}</Text>
        </View>
      ))}
    </View>
  )
}

function MockNotification() {
  const c = useTheme()
  return (
    <View style={styles.notifWrap}>
      <View style={styles.notifGhost} />
      <View style={[styles.notif, { backgroundColor: c.card }]}>
        <View style={styles.notifIcon}>
          <Text style={styles.notifIconText}>B</Text>
        </View>
        <View style={{ flex: 1 }}>
          <View style={styles.notifHead}>
            <Text style={[styles.notifTitle, { color: c.label }]}>Score change</Text>
            <Text style={[styles.notifTime, { color: c.meta }]}>now</Text>
          </View>
          <Text style={[styles.notifBody, { color: c.label }]}>
            Golden Dragon dropped from 5 to 2 at its last inspection.
          </Text>
        </View>
      </View>
    </View>
  )
}

function Chip({
  label,
  emoji,
  active,
  height,
  onPress,
}: {
  label: string
  emoji?: string
  active: boolean
  height: number
  onPress: () => void
}) {
  const c = useTheme()
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: active }}
      style={[
        styles.chip,
        {
          height,
          borderRadius: height / 2,
          paddingLeft: emoji ? 12 : 16,
          paddingRight: emoji ? 14 : 16,
          backgroundColor: active ? c.tintSoft : c.card,
          borderColor: active ? c.tint : c.separator,
        },
      ]}
    >
      {emoji ? <Text style={styles.chipEmoji}>{emoji}</Text> : null}
      <Text style={[styles.chipText, { color: active ? c.tint : c.label, fontWeight: active ? '600' : '400' }]}>
        {label}
      </Text>
    </Pressable>
  )
}

function PlaceRow({
  place,
  first,
  name,
  glow = false,
  hiddenWidth,
  trailing,
}: {
  place: TeaserPlace
  first: boolean
  name?: string
  glow?: boolean
  hiddenWidth?: number
  trailing: ReactNode
}) {
  const c = useTheme()
  return (
    <View style={styles.placeRow}>
      {!first ? <View style={[styles.rowSep, { backgroundColor: c.separator }]} /> : null}
      <ScoreBadge rating={place.rating_value} size={44} glow={glow} />
      <View style={{ flex: 1 }}>
        {name ? (
          <Text style={[styles.placeName, { color: c.label }]} numberOfLines={1}>
            {name}
          </Text>
        ) : (
          <View style={[styles.hiddenName, { width: hiddenWidth ?? 140 }]} />
        )}
        <Text style={[styles.placeMeta, { color: c.meta, marginTop: name ? 3 : 7 }]}>
          {[typeLabel(place.business_type), distanceLabel(place.distance_m)].filter(Boolean).join(' · ')}
        </Text>
      </View>
      {trailing}
    </View>
  )
}

function TopRated({ places }: { places: NearbySnapshot['best'] }) {
  const c = useTheme()
  if (!places.length) return null
  return (
    <>
      <Text style={[styles.label, { color: c.meta, marginTop: 26, marginLeft: 16 }]}>TOP RATED NEARBY</Text>
      <View style={[styles.placeCard, { backgroundColor: c.card }]}>
        {places.map((p, i) => (
          <PlaceRow
            key={p.id}
            place={p}
            first={i === 0}
            name={p.name}
            trailing={<Ionicons name="chevron-forward" size={18} color={c.chevron} />}
          />
        ))}
      </View>
    </>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },

  // Welcome
  welcome: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  bigFan: { flexDirection: 'row', alignItems: 'flex-end', gap: 4, height: 130, marginBottom: 36 },
  bigTile: {
    width: 74,
    height: 94,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 10px 24px rgba(0, 0, 0, 0.16)',
  },
  bigTileCenter: {
    width: 80,
    height: 100,
    borderRadius: 24,
    marginBottom: 22,
    zIndex: 1,
    boxShadow: '0 14px 30px rgba(0, 0, 0, 0.2)',
  },
  bigNum: { fontSize: 42, fontWeight: '700', color: '#FFFFFF' },
  wordmark: { width: 210, height: 210 / WORDMARK_ASPECT, marginBottom: 18 },
  welcomeTitle: { fontSize: 38, lineHeight: 42, fontWeight: '700', letterSpacing: -1, textAlign: 'center' },
  welcomeBody: {
    fontSize: 17,
    lineHeight: 24,
    fontWeight: '500',
    textAlign: 'center',
    marginTop: 12,
    opacity: 0.75,
  },
  welcomeFooter: { paddingHorizontal: 24 },
  signInRow: { height: 44, alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  signInText: { fontSize: 15 },

  // Shell
  nav: { height: 44, flexDirection: 'row', alignItems: 'center', paddingLeft: 6, paddingRight: 24, gap: 10 },
  backBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  track: { flex: 1, height: 4, borderRadius: 2, overflow: 'hidden' },
  trackFill: { height: 4, borderRadius: 2 },
  body: { paddingHorizontal: 24, paddingTop: 20, paddingBottom: 24 },
  title: { fontSize: 34, lineHeight: 40, fontWeight: '700', letterSpacing: -0.6 },
  subtitle: { fontSize: 17, lineHeight: 23, marginTop: 10 },
  footer: { paddingHorizontal: 24, paddingTop: 8 },
  tile: { width: 64, height: 64, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },

  // Fields & chips
  label: { fontSize: 13, letterSpacing: 0.3, marginBottom: 8, marginLeft: 4 },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 58,
    borderRadius: 14,
    paddingHorizontal: 16,
    boxShadow: '0 1px 2px rgba(0, 0, 0, 0.04)',
  },
  fieldInput: { flex: 1, minWidth: 0, height: 58, fontSize: 20, fontWeight: '500' },
  at: { fontSize: 20, fontWeight: '500', marginRight: 1 },
  shuffle: { width: 40, height: 40, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  hintRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 8, marginLeft: 4 },
  hint: { fontSize: 13 },
  hintAlone: { marginTop: 8, marginLeft: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 7, borderWidth: 1.5 },
  chipEmoji: { fontSize: 18 },
  chipText: { fontSize: 16 },

  // Location map preview
  map: {
    marginTop: 28,
    height: 250,
    borderRadius: 20,
    backgroundColor: '#E9EDE8',
    overflow: 'hidden',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.06)',
  },
  road: { position: 'absolute', backgroundColor: '#FFFFFF' },
  park: {
    position: 'absolute',
    left: 150,
    top: 96,
    width: 100,
    height: 70,
    borderRadius: 18,
    backgroundColor: '#D5E6CF',
  },
  halo: {
    position: 'absolute',
    left: 131,
    top: 79,
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(10, 132, 255, 0.14)',
  },
  userDot: {
    position: 'absolute',
    left: 162,
    top: 110,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#0A84FF',
    borderWidth: 3,
    borderColor: '#FFFFFF',
    boxShadow: '0 2px 6px rgba(0, 0, 0, 0.2)',
  },
  pin: {
    position: 'absolute',
    width: 32,
    height: 32,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 3px 8px rgba(0, 0, 0, 0.18)',
  },
  pinNum: { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },

  // Notification mock
  notifWrap: { marginTop: 44 },
  notifGhost: {
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: -12,
    height: 60,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.6)',
  },
  notif: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 22,
    paddingVertical: 14,
    paddingHorizontal: 16,
    boxShadow: '0 10px 30px rgba(0, 0, 0, 0.10)',
  },
  notifIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: BRAND_YELLOW,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notifIconText: { fontSize: 24, fontWeight: '800', color: '#1C1C1E' },
  notifHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  notifTitle: { fontSize: 15, fontWeight: '600' },
  notifTime: { fontSize: 13 },
  notifBody: { fontSize: 15, lineHeight: 20, marginTop: 1 },

  // Reveal
  glow: { position: 'absolute', top: 0, left: 0, right: 0, height: 360 },
  revealBody: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 24 },
  loading: { alignItems: 'center', paddingTop: 80, gap: 4 },
  placeCard: { borderRadius: 16 },
  lockedCard: { marginTop: 18, boxShadow: '0 8px 28px rgba(168, 50, 26, 0.10)' },
  placeRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 16 },
  rowSep: { position: 'absolute', top: 0, left: 72, right: 0, height: StyleSheet.hairlineWidth },
  hiddenName: { height: 14, borderRadius: 7, backgroundColor: '#D1D1D6' },
  placeName: { fontSize: 16, fontWeight: '600' },
  placeMeta: { fontSize: 13 },
  goodTile: {
    width: 64,
    height: 64,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 10px 24px rgba(4, 106, 56, 0.33)',
  },
  benefitRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 12, paddingHorizontal: 16 },
})
