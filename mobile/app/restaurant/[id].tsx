import { useCallback, useEffect, useState } from 'react'
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  Share,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { useTheme } from '@/theme/useTheme'
import { heroTextForRating, heroTintForRating } from '@/theme/colors'
import { ScoreBadge } from '@/components/ScoreBadge'
import {
  Avatar,
  AvatarStack,
  Button,
  GroupedCard,
  HeroIconButton,
  Row,
  SectionHeader,
} from '@/components/ui'
import { SaveToListModal } from '@/components/SaveToListModal'
import { ReviewComposer } from '@/components/ReviewComposer'
import { LogVisitSheet } from '@/components/LogVisitSheet'
import { DinerCheckCard } from '@/components/DinerCheckCard'
import { categoryOne } from '@/components/RestaurantRow'
import { isNumericRating, ratingDescription, FSA_ATTRIBUTION } from '@/lib/fsa'
import {
  blockReviewAuthor,
  currentUserId,
  fetchMyLists,
  follow,
  followingSet,
  getDinerCheck,
  getFollowedVisitors,
  getMyReview,
  getRestaurant,
  getReviews,
  listIdsContaining,
  lookupPlaceData,
  myVisitToday,
  reportReview,
  setDinerCheck,
  undoVisitToday,
  visitErrorMessage,
} from '@/lib/data'
import { hoursForDay, openLabel, openState, todayIndexMon0 } from '@/lib/hours'
import { lastKnownCoords } from '@/lib/location'
import { displayName, distanceLabel, joinNames, metersBetween, shortName, timeAgo } from '@/lib/people'
import { scheduleDirectionsFollowUp } from '@/lib/followups'
import type {
  DinerCheckSummary,
  ListSummary,
  OpeningHours,
  PersonCard,
  Restaurant,
  Review,
  Verdict,
} from '@/lib/types'

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

function monthYear(date: string | null): string | null {
  if (!date) return null
  return new Date(date).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
}

function fullDate(date: string | null): string | null {
  if (!date) return null
  return new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function RestaurantDetail() {
  const c = useTheme()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { id } = useLocalSearchParams<{ id: string }>()

  const [place, setPlace] = useState<Restaurant | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [reviews, setReviews] = useState<Review[]>([])
  const [myReview, setMyReview] = useState<Review | null>(null)
  const [me, setMe] = useState<string | null>(null)
  const [following, setFollowing] = useState<Set<string>>(new Set())
  const [hours, setHours] = useState<OpeningHours | null>(null)
  const [google, setGoogle] = useState<{ rating: number | null; count: number | null }>({ rating: null, count: null })
  const [distance, setDistance] = useState<number | null>(null)
  const [visitors, setVisitors] = useState<{ total: number; people: PersonCard[] }>({ total: 0, people: [] })
  const [dinerCheck, setDinerCheckState] = useState<DinerCheckSummary | null>(null)
  const [visit, setVisit] = useState<{ id: string; verified: boolean; visited_at: string } | null>(null)
  const [savedIn, setSavedIn] = useState<ListSummary[]>([])
  const [showWeek, setShowWeek] = useState(false)

  const [saveOpen, setSaveOpen] = useState(false)
  const [composerOpen, setComposerOpen] = useState(false)
  const [logOpen, setLogOpen] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    setLoadError(false)
    ;(async () => {
      try {
        const [p, r, mine, uid] = await Promise.all([getRestaurant(id), getReviews(id), getMyReview(id), currentUserId()])
        setPlace(p)
        setReviews(r)
        setMyReview(mine)
        setMe(uid)
        setHours(p?.hours_cache ?? null)
        setGoogle({ rating: p?.google_rating ?? null, count: p?.google_rating_count ?? null })
        const authors = r.map((rv) => rv.user_id).filter((u): u is string => !!u && u !== uid)
        setFollowing(await followingSet(Array.from(new Set(authors))))
        if (p?.lat != null && p?.lng != null) {
          const here = await lastKnownCoords()
          if (here) setDistance(metersBetween(here, { lat: p.lat, lng: p.lng }))
        }
      } catch {
        setLoadError(true)
      } finally {
        setLoading(false)
      }
    })()
  }, [id])

  useEffect(load, [load])

  // Social bits refresh on focus: a vote or list change made elsewhere shows.
  const loadSocial = useCallback(async () => {
    const [dc, v, fv, lists] = await Promise.allSettled([
      getDinerCheck(id),
      myVisitToday(id),
      getFollowedVisitors(id),
      fetchMyLists(),
    ])
    if (dc.status === 'fulfilled') setDinerCheckState(dc.value)
    if (v.status === 'fulfilled') setVisit(v.value)
    if (fv.status === 'fulfilled') setVisitors(fv.value)
    if (lists.status === 'fulfilled') {
      const contains = await listIdsContaining(id, lists.value.map((l) => l.id)).catch(() => new Set<string>())
      setSavedIn(lists.value.filter((l) => contains.has(l.id)))
    }
  }, [id])

  useFocusEffect(
    useCallback(() => {
      loadSocial()
    }, [loadSocial]),
  )

  // Refreshes Google rating + hours in the background; the server skips the
  // Google call if its cache is still fresh, so this is cheap on every view.
  useEffect(() => {
    lookupPlaceData(id).then((result) => {
      if (!result) return
      setGoogle((g) => ({
        rating: result.googleRating ?? g.rating,
        count: result.googleRatingCount ?? g.count,
      }))
      if (result.hours) setHours(result.hours)
    })
  }, [id])

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: c.bg }]}>
        <ActivityIndicator color={c.meta} />
      </View>
    )
  }

  if (loadError || !place) {
    return (
      <View style={[styles.center, { backgroundColor: c.bg, paddingHorizontal: 32 }]}>
        <Text style={{ color: c.label2, fontSize: 16, textAlign: 'center' }}>
          {loadError ? 'Couldn’t load this place. Check your connection.' : 'This place couldn’t be found.'}
        </Text>
        {loadError ? <Button label="Retry" onPress={load} style={{ marginTop: 16, alignSelf: 'stretch' }} /> : null}
        <Button label="Back" variant="plain" onPress={() => router.back()} />
      </View>
    )
  }

  const numeric = isNumericRating(place.rating_value)
  const state = openState(hours?.weekday_text)
  const openText = openLabel(state)
  const meta = [categoryOne(place.business_type), distanceLabel(distance), openText]
    .filter(Boolean)
    .join(' · ')

  const onShare = () => {
    Share.share({
      message: `${place.name} has a food hygiene rating of ${place.rating_value}/5 on Bitescore`,
    }).catch(() => {})
  }

  const onDirections = () => {
    if (place.lat == null || place.lng == null) {
      Alert.alert('No location available', 'We don’t have coordinates for this place yet.')
      return
    }
    const { lat, lng } = place
    const label = encodeURIComponent(place.name)
    const appleUrl = `http://maps.apple.com/?daddr=${lat},${lng}&dirflg=w&q=${label}`
    const googleUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=walking`
    const go = (url: string) => {
      Linking.openURL(url)
      // "Did you visit …?" in two hours, unless they log a visit first.
      if (!visit) scheduleDirectionsFollowUp({ id: place.id, name: place.name })
    }
    if (Platform.OS === 'ios') {
      Alert.alert('Get directions', undefined, [
        { text: 'Apple Maps', onPress: () => go(appleUrl) },
        { text: 'Google Maps', onPress: () => go(googleUrl) },
        { text: 'Cancel', style: 'cancel' },
      ])
    } else {
      go(googleUrl)
    }
  }

  const onVisitButton = () => {
    if (!visit) {
      setLogOpen(true)
      return
    }
    Alert.alert('Undo today’s visit?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Undo',
        style: 'destructive',
        onPress: async () => {
          try {
            await undoVisitToday(visit.id)
            setVisit(null)
            const dc = await getDinerCheck(place.id)
            // A vote needs a verified visit behind it.
            if (!dc.can_vote && dc.my_verdict) {
              await setDinerCheck(place.id, null)
              setDinerCheckState(await getDinerCheck(place.id))
            } else {
              setDinerCheckState(dc)
            }
          } catch (e) {
            Alert.alert('Couldn’t undo', visitErrorMessage(e))
          }
        },
      },
    ])
  }

  const onVote = async (v: Verdict | null) => {
    if (!dinerCheck) return
    const prev = dinerCheck
    setDinerCheckState({ ...dinerCheck, my_verdict: v })
    try {
      await setDinerCheck(place.id, v)
      setDinerCheckState(await getDinerCheck(place.id))
    } catch (e) {
      setDinerCheckState(prev)
      Alert.alert('Couldn’t save your diner check', visitErrorMessage(e))
    }
  }

  const onFollow = async (userId: string) => {
    setFollowing((s) => new Set(s).add(userId))
    try {
      await follow(userId)
    } catch {
      setFollowing((s) => {
        const n = new Set(s)
        n.delete(userId)
        return n
      })
    }
  }

  const onReviewOptions = (review: Review) => {
    Alert.alert('Review options', undefined, [
      {
        text: 'Report review',
        onPress: async () => {
          try {
            const { alreadyReported } = await reportReview(review.id)
            Alert.alert(
              alreadyReported ? 'Already reported' : 'Reported',
              alreadyReported ? 'You already reported this review.' : 'Thanks — we’ll take a look.',
            )
          } catch {
            Alert.alert('Couldn’t report', 'Check your connection and try again.')
          }
        },
      },
      {
        text: 'Block this reviewer',
        style: 'destructive',
        onPress: async () => {
          try {
            await blockReviewAuthor(review.id)
            setReviews(await getReviews(place.id))
          } catch {
            Alert.alert('Couldn’t block', 'Check your connection and try again.')
          }
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ])
  }

  const visitedLabel = visit ? 'Visited today' : 'I’ve been here'
  const visitNote = visit
    ? visit.verified
      ? 'Verified by location · tap to undo'
      : 'Logged without proof · tap to undo'
    : distance !== null && distance <= 75
      ? `You're ${distanceLabel(distance)} away, so this visit will be verified`
      : 'Log it while you’re there to verify it'

  const savedPeople = savedIn.flatMap((l) => l.people).filter((p) => p.user_id !== me)
  const uniqueSavedPeople = Array.from(new Map(savedPeople.map((p) => [p.user_id, p])).values())

  return (
    <View style={[styles.root, { backgroundColor: c.bg }]}>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}>
        {/* Hero, in a soft tint of the score colour */}
        <View style={{ backgroundColor: heroTintForRating(place.rating_value), paddingTop: insets.top, paddingBottom: 22 }}>
          <View style={styles.heroNav}>
            <Text style={[styles.brand, { color: c.label }]} pointerEvents="none" accessibilityRole="header">
              Bitescore
            </Text>
            <HeroIconButton icon="chevron-back" label="Back" onPress={() => router.back()} />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <HeroIconButton
                icon={savedIn.length ? 'bookmark' : 'bookmark-outline'}
                label="Save to a list"
                onPress={() => setSaveOpen(true)}
              />
              <HeroIconButton icon="share-outline" label="Share" onPress={onShare} />
            </View>
          </View>
          <View style={styles.heroBody}>
            <ScoreBadge rating={place.rating_value} size={88} glow />
            <Text style={[styles.ratingWord, { color: heroTextForRating(place.rating_value) }]}>
              {ratingDescription(place.rating_value)}
            </Text>
            <View style={styles.fsaPill}>
              <Ionicons name="shield-checkmark" size={13} color={c.label2} />
              <Text style={[styles.fsaPillText, { color: c.label2 }]}>Official FSA hygiene rating</Text>
            </View>
            <Text style={[styles.name, { color: c.label }]}>{place.name}</Text>
            {meta ? <Text style={[styles.meta, { color: c.label2 }]}>{meta}</Text> : null}
            {visitors.total > 0 ? (
              <View style={styles.visitors}>
                <AvatarStack
                  people={visitors.people}
                  size={22}
                  ring={heroTintForRating(place.rating_value)}
                />
                <Text style={[styles.visitorsText, { color: c.label2 }]}>
                  {joinNames(visitors.people.map(shortName), visitors.total)}{' '}
                  {visitors.total === 1 ? 'has' : 'have'} been here
                </Text>
              </View>
            ) : null}
          </View>
        </View>

        {/* Actions */}
        <View style={styles.actions}>
          <Button
            label={visitedLabel}
            icon={visit ? 'checkmark' : 'add'}
            variant={visit ? 'soft' : 'primary'}
            onPress={onVisitButton}
            style={{ flex: 1 }}
          />
          <Button label="Directions" icon="navigate-outline" variant="secondary" onPress={onDirections} style={{ flex: 1 }} />
        </View>
        <Text style={[styles.visitNote, { color: c.meta }]}>{visitNote}</Text>

        {numeric && dinerCheck ? (
          <View style={{ marginTop: 16 }}>
            <DinerCheckCard summary={dinerCheck} inspected={monthYear(place.rating_date)} onVote={onVote} />
          </View>
        ) : null}

        {/* Facts */}
        <GroupedCard style={{ marginTop: 16 }}>
          <Row
            title="Last inspected"
            value={numeric ? (fullDate(place.rating_date) ?? '—') : 'Not yet inspected'}
          />
          <Row
            title="Hours"
            value={openText ?? 'Not available'}
            valueColor={state.kind === 'open' ? c.success : c.meta}
            chevron={!!hours?.weekday_text?.length}
            onPress={hours?.weekday_text?.length ? () => setShowWeek((s) => !s) : undefined}
          />
          {showWeek && hours?.weekday_text ? (
            <View style={styles.week}>
              {DAYS.map((day, i) => (
                <View key={day} style={styles.weekRow}>
                  <Text style={[styles.weekText, { color: c.label2 }, i === todayIndexMon0() ? styles.today : null]}>
                    {day}
                  </Text>
                  <Text style={[styles.weekText, { color: c.label2 }, i === todayIndexMon0() ? styles.today : null]}>
                    {hoursForDay(hours.weekday_text, i)}
                  </Text>
                </View>
              ))}
              <Text style={[styles.weekSource, { color: c.meta }]}>Hours via Google</Text>
            </View>
          ) : null}
          {google.rating !== null ? (
            <Row
              title="Google rating"
              value={`★ ${google.rating.toFixed(1)}${google.count ? ` · ${google.count}` : ''}`}
            />
          ) : null}
          <Row
            title="Saved in"
            value={savedIn.length ? savedIn.map((l) => l.name).join(', ') : 'Not saved'}
            right={uniqueSavedPeople.length ? <AvatarStack people={uniqueSavedPeople} size={22} /> : undefined}
            chevron
            onPress={() => setSaveOpen(true)}
          />
        </GroupedCard>

        {/* Reviews */}
        <View style={styles.reviewsHead}>
          <SectionHeader style={{ paddingHorizontal: 0, paddingBottom: 0 }}>Reviews</SectionHeader>
          <Pressable onPress={() => setComposerOpen(true)} hitSlop={8}>
            <Text style={[styles.writeLink, { color: c.tint }]}>{myReview ? 'Edit yours' : 'Write one'}</Text>
          </Pressable>
        </View>
        {reviews.length === 0 ? (
          <View style={styles.reviewCard}>
            <Text style={[styles.reviewBody, { color: c.label2 }]}>
              No reviews yet. Been here? Say how it was.
            </Text>
          </View>
        ) : (
          <View style={{ gap: 10 }}>
            {reviews.map((r) => {
              const isMine = r.user_id !== null && r.user_id === me
              const author = r.is_anonymous
                ? 'Anonymous'
                : displayName({ username: r.username ?? r.display_name_snapshot, public_name: r.public_name })
              const canOpen = !r.is_anonymous && r.user_id
              return (
                <View key={r.id} style={styles.reviewCard}>
                  <View style={styles.reviewHead}>
                    <Pressable
                      disabled={!canOpen}
                      onPress={() => canOpen && router.push(`/user/${r.user_id}`)}
                      style={styles.reviewWho}
                    >
                      {r.is_anonymous || !r.user_id ? (
                        <View style={[styles.anonAvatar, { backgroundColor: c.bg }]}>
                          <Ionicons name="person" size={16} color={c.chevron} />
                        </View>
                      ) : (
                        <Avatar person={{ user_id: r.user_id, username: r.username, public_name: r.public_name }} size={32} />
                      )}
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={[styles.reviewName, { color: c.label }]} numberOfLines={1}>
                          {isMine ? 'You' : author}
                        </Text>
                        <Text style={[styles.reviewWhen, { color: c.meta }]}>{timeAgo(r.created_at)}</Text>
                      </View>
                    </Pressable>
                    {canOpen && !isMine && !following.has(r.user_id!) ? (
                      <Pressable onPress={() => onFollow(r.user_id!)} style={[styles.followPill, { backgroundColor: c.tintSoft }]}>
                        <Text style={[styles.followPillText, { color: c.tint }]}>Follow</Text>
                      </Pressable>
                    ) : null}
                    {!isMine ? (
                      <Pressable onPress={() => onReviewOptions(r)} hitSlop={10} accessibilityLabel="Review options">
                        <Ionicons name="ellipsis-horizontal" size={18} color={c.meta} />
                      </Pressable>
                    ) : null}
                  </View>
                  <Text style={[styles.reviewBody, { color: c.label2 }]}>{r.body}</Text>
                </View>
              )
            })}
          </View>
        )}

        <Text style={[styles.attrib, { color: c.meta }]}>{FSA_ATTRIBUTION}</Text>
      </ScrollView>

      <SaveToListModal
        visible={saveOpen}
        restaurantId={place.id}
        onClose={() => {
          setSaveOpen(false)
          loadSocial()
        }}
      />

      <LogVisitSheet
        visible={logOpen}
        place={place}
        onClose={() => setLogOpen(false)}
        onLogged={async (v) => {
          setLogOpen(false)
          setVisit(v)
          setDinerCheckState(await getDinerCheck(place.id).catch(() => dinerCheck))
        }}
      />

      <ReviewComposer
        visible={composerOpen}
        restaurantId={place.id}
        existingReview={myReview}
        onClose={() => setComposerOpen(false)}
        onSaved={(review) => {
          setMyReview(review)
          setReviews((prev) => [review, ...prev.filter((r) => r.id !== review.id)])
          setComposerOpen(false)
        }}
        onDeleted={() => {
          setReviews((prev) => prev.filter((r) => r.id !== myReview?.id))
          setMyReview(null)
          setComposerOpen(false)
        }}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  heroNav: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  // Brand title centred across the whole bar, behind the buttons.
  brand: {
    position: 'absolute',
    left: 0,
    right: 0,
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '600',
  },
  heroBody: { alignItems: 'center', gap: 8, paddingTop: 4, paddingHorizontal: 20 },
  ratingWord: { fontSize: 15, fontWeight: '600' },
  fsaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 24,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.8)',
  },
  fsaPillText: { fontSize: 12, fontWeight: '600' },
  name: { fontSize: 27, fontWeight: '700', letterSpacing: -0.5, textAlign: 'center', marginTop: 2 },
  meta: { fontSize: 15, textAlign: 'center' },
  visitors: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  visitorsText: { fontSize: 14 },
  actions: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingTop: 16 },
  visitNote: { fontSize: 13, textAlign: 'center', marginTop: 8, paddingHorizontal: 24 },
  week: { paddingHorizontal: 16, paddingBottom: 12, gap: 4 },
  weekRow: { flexDirection: 'row', justifyContent: 'space-between' },
  weekText: { fontSize: 15 },
  today: { fontWeight: '600', color: '#1C1C1E' },
  weekSource: { fontSize: 12, marginTop: 4 },
  reviewsHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 32,
    paddingRight: 32,
    paddingTop: 24,
    paddingBottom: 8,
  },
  writeLink: { fontSize: 15, fontWeight: '600' },
  reviewCard: { marginHorizontal: 16, backgroundColor: '#FFFFFF', borderRadius: 14, padding: 14, paddingHorizontal: 16, gap: 8 },
  reviewHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  reviewWho: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  anonAvatar: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  reviewName: { fontSize: 15, fontWeight: '600' },
  reviewWhen: { fontSize: 13 },
  followPill: { height: 28, paddingHorizontal: 12, borderRadius: 14, justifyContent: 'center' },
  followPillText: { fontSize: 13, fontWeight: '600' },
  reviewBody: { fontSize: 15, lineHeight: 21 },
  attrib: { fontSize: 12, lineHeight: 17, paddingHorizontal: 32, marginTop: 24 },
})
