import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '@/theme/useTheme'
import { ScoreBadge } from '@/components/ScoreBadge'
import { Button } from '@/components/ui'
import { AnonymousCheckbox } from '@/components/ReviewComposer'
import {
  getDinerCheck,
  getMyReview,
  getRestaurant,
  logVisit,
  myVisitToday,
  setDinerCheck,
  submitReview,
  visitErrorMessage,
} from '@/lib/data'
import { isNumericRating } from '@/lib/fsa'
import { lastKnownCoords, VERIFY_RADIUS_M } from '@/lib/location'
import { metersBetween } from '@/lib/people'
import { cancelDirectionsFollowUp } from '@/lib/followups'
import type { DinerCheckSummary, Restaurant, Verdict } from '@/lib/types'

function hhmm(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

// "How was it?" — reached from the "Did you visit …?" reminder. Logs the
// visit (verified if they're still there), the diner check and an optional
// review in one go.
export default function HowWasIt() {
  const c = useTheme()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { id } = useLocalSearchParams<{ id: string }>()

  const [place, setPlace] = useState<Restaurant | null>(null)
  const [visit, setVisit] = useState<{ id: string; verified: boolean; visited_at: string } | null>(null)
  const [summary, setSummary] = useState<DinerCheckSummary | null>(null)
  const [nearNow, setNearNow] = useState(false)
  const [verdict, setVerdict] = useState<Verdict | null>(null)
  const [body, setBody] = useState('')
  const [anonymous, setAnonymous] = useState(false)
  const [loading, setLoading] = useState(true)
  const [posting, setPosting] = useState(false)

  useEffect(() => {
    cancelDirectionsFollowUp(id)
    ;(async () => {
      try {
        const [p, v, s, mine] = await Promise.all([getRestaurant(id), myVisitToday(id), getDinerCheck(id), getMyReview(id)])
        setPlace(p)
        setVisit(v)
        setSummary(s)
        setVerdict(s.my_verdict)
        if (mine) {
          setBody(mine.body)
          setAnonymous(mine.is_anonymous)
        }
        if (p?.lat != null && p?.lng != null) {
          const here = await lastKnownCoords()
          if (here) setNearNow(metersBetween(here, { lat: p.lat, lng: p.lng }) <= VERIFY_RADIUS_M)
        }
      } catch {
        /* the retry below covers it */
      } finally {
        setLoading(false)
      }
    })()
  }, [id])

  const close = () => (router.canGoBack() ? router.back() : router.replace(`/restaurant/${id}`))

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: c.bg }]}>
        <ActivityIndicator color={c.meta} />
      </View>
    )
  }
  if (!place) {
    return (
      <View style={[styles.center, { backgroundColor: c.bg }]}>
        <Text style={{ color: c.label2, fontSize: 16 }}>Couldn’t load this place.</Text>
        <Button label="Close" variant="plain" onPress={close} />
      </View>
    )
  }

  const numeric = isNumericRating(place.rating_value)
  const verified = !!visit?.verified
  // Voting needs a verified visit — one already logged, or one we'll log on
  // Post because they're still at the venue.
  const canVote = numeric && (summary?.can_vote || verified || nearNow)
  const needsChoice = canVote && !verdict
  const cta = needsChoice ? 'Choose one to post' : 'Post'

  const onPost = async () => {
    setPosting(true)
    try {
      if (!visit?.verified) {
        const coords = nearNow ? await lastKnownCoords() : null
        const v = coords
          ? await logVisit(place.id, 'location', coords).catch(() => logVisit(place.id, 'none'))
          : visit ?? (await logVisit(place.id, 'none'))
        setVisit(v)
      }
      if (canVote && verdict !== (summary?.my_verdict ?? null)) {
        await setDinerCheck(place.id, verdict)
      }
      if (body.trim()) {
        await submitReview({ restaurantId: place.id, body: body.trim(), isAnonymous: anonymous })
      }
      close()
    } catch (e) {
      Alert.alert('Couldn’t post', visitErrorMessage(e))
    } finally {
      setPosting(false)
    }
  }

  const toggle = (v: Verdict, label: string) => {
    const on = verdict === v
    return (
      <Pressable
        onPress={() => setVerdict(on ? null : v)}
        disabled={!canVote}
        style={[styles.toggle, { backgroundColor: on ? c.tint : c.bg }]}
      >
        <Text style={[styles.toggleText, { color: on ? '#fff' : c.label }]}>{label}</Text>
      </Pressable>
    )
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.nav}>
        <Pressable onPress={close} hitSlop={10}>
          <Text style={[styles.navText, { color: c.tint }]}>Cancel</Text>
        </Pressable>
        <Text style={[styles.navTitle, { color: c.label }]}>How was it?</Text>
        <View style={{ width: 56 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 12, gap: 14 }} keyboardShouldPersistTaps="handled">
        <View style={[styles.card, styles.venue]}>
          <ScoreBadge rating={place.rating_value} size={48} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.venueName, { color: c.label }]} numberOfLines={1}>
              {place.name}
            </Text>
            {verified ? (
              <View style={styles.verifiedRow}>
                <Ionicons name="checkmark" size={15} color={c.success} />
                <Text style={[styles.verified, { color: c.success }]}>
                  Verified visit · arrived {hhmm(visit!.visited_at)}
                </Text>
              </View>
            ) : nearNow ? (
              <Text style={[styles.verified, { color: c.success }]}>You're here · this visit will be verified</Text>
            ) : (
              <Text style={[styles.unverified, { color: c.meta }]}>
                Not verified · logs as a visit without proof
              </Text>
            )}
          </View>
        </View>

        {numeric ? (
          <View style={[styles.card, { gap: 12, opacity: canVote ? 1 : 0.55 }]}>
            <Text style={[styles.cardTitle, { color: c.label }]}>How clean did it feel?</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {toggle('match', `Matches the ${place.rating_value}`)}
              {toggle('cleaner', 'Cleaner than rated')}
            </View>
            {!canVote ? (
              <Text style={[styles.hint, { color: c.meta }]}>
                Diner checks need a verified visit. Next time, tap “I’ve been here” while you’re there.
              </Text>
            ) : null}
          </View>
        ) : null}

        <View style={[styles.card, { gap: 10 }]}>
          <Text style={[styles.cardTitle, { color: c.label }]}>Anything to add?</Text>
          <TextInput
            value={body}
            onChangeText={setBody}
            placeholder="Food, service, cleanliness… (optional)"
            placeholderTextColor={c.meta}
            multiline
            maxLength={2000}
            style={[styles.input, { backgroundColor: c.bg, color: c.label }]}
          />
          <AnonymousCheckbox value={anonymous} onChange={setAnonymous} />
        </View>
      </ScrollView>

      <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: insets.bottom + 12 }}>
        <Button label={cta} onPress={onPost} disabled={needsChoice} loading={posting} />
      </View>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  nav: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  navText: { fontSize: 17 },
  navTitle: { fontSize: 17, fontWeight: '600' },
  card: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 16 },
  venue: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14 },
  venueName: { fontSize: 17, fontWeight: '600' },
  verifiedRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  verified: { fontSize: 14, fontWeight: '500' },
  unverified: { fontSize: 14, marginTop: 2 },
  cardTitle: { fontSize: 17, fontWeight: '600' },
  toggle: { flex: 1, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  toggleText: { fontSize: 15, fontWeight: '600' },
  hint: { fontSize: 13, lineHeight: 18 },
  input: { minHeight: 96, borderRadius: 12, padding: 12, fontSize: 16, textAlignVertical: 'top' },
})
