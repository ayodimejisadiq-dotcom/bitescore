import { useEffect, useState } from 'react'
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
  Modal,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useTheme } from '@/theme/useTheme'
import { fonts } from '@/theme/type'
import { colorForRating, edgeForRating, NEUTRAL_RATING } from '@/theme/colors'
import { EdgeButton, tileEdge } from '@/components/ui'
import { SaveToListModal } from '@/components/SaveToListModal'
import { ReviewComposer } from '@/components/ReviewComposer'
import { PaywallGate } from '@/components/PaywallGate'
import { useSession } from '@/hooks/useSession'
import { getIsEntitled } from '@/lib/purchases'
import {
  BUSINESS_TYPE_LABEL,
  cuisineLabel,
  isNumericRating,
  ratingDescription,
  inspectionStatusLine,
} from '@/lib/fsa'
import {
  getRestaurant,
  getReviews,
  getMyReview,
  lookupPlaceData,
  reportReview,
  blockUser,
  isWatchingRestaurant,
  watchRestaurant,
  unwatchRestaurant,
} from '@/lib/data'
import { registerForPushAfterSave } from '@/lib/push'
import { recordCheck, recordReview } from '@/lib/game'
import type { OpeningHours, Restaurant, Review } from '@/lib/types'

// "Monday: 9 AM – 11 PM" → { day: "Monday", hours: "9 AM – 11 PM" }.
function splitHoursLine(line: string): { day: string; hours: string } {
  const idx = line.indexOf(':')
  if (idx === -1) return { day: line, hours: '' }
  return { day: line.slice(0, idx), hours: line.slice(idx + 1).trim() }
}

// Google weekday_text starts Monday; JS getDay() starts Sunday.
function todayIndex(): number {
  return (new Date().getDay() + 6) % 7
}

// Six-bar strip that places the score on the 0–5 scale — this is what makes
// the number legible to someone unfamiliar with the FSA scheme.
function ScaleStrip({ rating }: { rating: string }) {
  const value = isNumericRating(rating) ? Number(rating) : null
  return (
    <View style={{ marginTop: 16 }}>
      <View style={styles.scaleRow}>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <View
            key={i}
            style={[
              styles.scaleBar,
              i === value
                ? { height: 14, borderRadius: 5, backgroundColor: '#FFFDF7' }
                : { backgroundColor: 'rgba(255,255,255,0.28)' },
            ]}
          />
        ))}
      </View>
      <View style={styles.scaleLabels}>
        <Text style={styles.scaleLabel}>0 · urgent</Text>
        <Text style={styles.scaleLabel}>5 · very good</Text>
      </View>
    </View>
  )
}

export default function RestaurantDetail() {
  const c = useTheme()
  const router = useRouter()
  const { session } = useSession()
  const { id } = useLocalSearchParams<{ id: string }>()
  const [place, setPlace] = useState<Restaurant | null>(null)
  const [reviews, setReviews] = useState<Review[]>([])
  const [myReview, setMyReview] = useState<Review | null>(null)
  const [loading, setLoading] = useState(true)
  const [saveOpen, setSaveOpen] = useState(false)
  const [composerOpen, setComposerOpen] = useState(false)
  const [googleRating, setGoogleRating] = useState<number | null>(null)
  const [googleRatingCount, setGoogleRatingCount] = useState<number | null>(null)
  const [hours, setHours] = useState<OpeningHours | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [watching, setWatching] = useState(false)
  const [watchBusy, setWatchBusy] = useState(false)
  const [paywallOpen, setPaywallOpen] = useState(false)

  const load = () => {
    setLoading(true)
    setLoadError(false)
    ;(async () => {
      try {
        const [p, r, mine, isWatching] = await Promise.all([
          getRestaurant(id),
          getReviews(id),
          getMyReview(id),
          isWatchingRestaurant(id),
        ])
        setPlace(p)
        setReviews(r)
        setMyReview(mine)
        setGoogleRating(p?.google_rating ?? null)
        setGoogleRatingCount(p?.google_rating_count ?? null)
        setHours(p?.hours_cache ?? null)
        setWatching(isWatching)
        // Game layer: opening a place counts as a "check".
        if (p) recordCheck(p.id, p.rating_value)
      } catch {
        setLoadError(true)
      } finally {
        setLoading(false)
      }
    })()
  }

  useEffect(load, [id])

  // Turning the bell on is the paid action — flips the switch optimistically,
  // and enrolls for push the same way saving to a list does. Turning it off
  // never needs an entitlement check.
  const setWatchState = async (next: boolean) => {
    setWatchBusy(true)
    setWatching(next) // optimistic
    try {
      if (next) {
        await watchRestaurant(id)
        void registerForPushAfterSave()
      } else {
        await unwatchRestaurant(id)
      }
    } catch {
      setWatching(!next) // revert
      Alert.alert('Couldn’t update', 'Check your connection and try again.')
    } finally {
      setWatchBusy(false)
    }
  }

  const onToggleWatch = async () => {
    if (watchBusy) return
    if (watching) {
      setWatchState(false)
      return
    }
    setWatchBusy(true)
    const entitled = await getIsEntitled()
    setWatchBusy(false)
    if (!entitled) {
      setPaywallOpen(true)
      return
    }
    setWatchState(true)
  }

  // Fire-and-forget: refreshes Google rating + hours in the background (the
  // server no-ops if its own cache is still fresh, so this is cheap to call
  // on every view).
  useEffect(() => {
    lookupPlaceData(id).then((result) => {
      if (!result) return
      if (result.googleRating !== null) setGoogleRating(result.googleRating)
      if (result.googleRatingCount !== null) setGoogleRatingCount(result.googleRatingCount)
      if (result.hours) setHours(result.hours)
    })
  }, [id])

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: c.bg }]}>
        <ActivityIndicator color={c.primary} />
      </View>
    )
  }

  if (loadError || !place) {
    return (
      <View style={[styles.center, { backgroundColor: c.bg }]}>
        <Text style={{ color: c.subtext, fontFamily: fonts.body }}>
          {loadError ? 'Couldn’t load this place. Check your connection.' : 'This place couldn’t be found.'}
        </Text>
        {loadError ? (
          <EdgeButton
            color={c.primary}
            edgeColor={c.primaryDark}
            onPress={load}
            style={styles.retryBtn}
          >
            <Text style={styles.footerBtnTextOnGreen}>Retry</Text>
          </EdgeButton>
        ) : null}
      </View>
    )
  }

  const hoursLines = hours?.weekday_text
  const openNow = hours?.open_now
  const todayIdx = todayIndex()
  const todayHours = hoursLines?.length === 7 ? splitHoursLine(hoursLines[todayIdx]).hours : null

  const numeric = isNumericRating(place.rating_value)
  const heroFill = numeric ? colorForRating(place.rating_value) : NEUTRAL_RATING
  const heroEdge = numeric ? edgeForRating(place.rating_value) : '#9A947F'

  const onReportReview = (reviewId: string) => {
    Alert.alert('Report this review?', 'We’ll take a look and hide it if others agree.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Report',
        onPress: async () => {
          try {
            const { alreadyReported } = await reportReview(reviewId)
            Alert.alert(
              alreadyReported ? 'Already reported' : 'Reported',
              alreadyReported ? 'You already reported this review.' : 'Thanks — we’ll take a look.',
            )
          } catch {
            Alert.alert('Couldn’t report', 'Check your connection and try again.')
          }
        },
      },
    ])
  }

  const onBlockUser = (userId: string) => {
    Alert.alert('Block this reviewer?', 'You won’t see their reviews anymore.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Block',
        style: 'destructive',
        onPress: async () => {
          try {
            await blockUser(userId)
            setReviews(await getReviews(id))
          } catch {
            Alert.alert('Couldn’t block', 'Check your connection and try again.')
          }
        },
      },
    ])
  }

  const onReviewOptions = (review: Review) => {
    Alert.alert('Review options', undefined, [
      { text: 'Report review', onPress: () => onReportReview(review.id) },
      { text: 'Block this reviewer', style: 'destructive', onPress: () => onBlockUser(review.user_id) },
      { text: 'Cancel', style: 'cancel' },
    ])
  }

  const onShare = () => {
    Share.share({
      message: `${place.name} — hygiene rating ${place.rating_value}/5 on Bitescore`,
    }).catch(() => {})
  }

  const onGetDirections = () => {
    if (place.lat == null || place.lng == null) {
      Alert.alert('No location available', 'We don’t have coordinates for this place yet.')
      return
    }
    const { lat, lng } = place
    const label = encodeURIComponent(place.name)
    const appleUrl = `http://maps.apple.com/?daddr=${lat},${lng}&dirflg=w&q=${label}`
    const googleUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=walking`

    if (Platform.OS === 'ios') {
      Alert.alert('Get directions', undefined, [
        { text: 'Apple Maps', onPress: () => Linking.openURL(appleUrl) },
        { text: 'Google Maps', onPress: () => Linking.openURL(googleUrl) },
        { text: 'Cancel', style: 'cancel' },
      ])
    } else {
      Linking.openURL(googleUrl)
    }
  }

  const category = BUSINESS_TYPE_LABEL[place.business_type] ?? place.business_type
  const categoryOne =
    category.endsWith('s') && !category.includes('&') ? category.slice(0, -1) : category
  // "Thai Restaurant" reads better than a separate cuisine pill.
  const cuisine = cuisineLabel(place.cuisine)
  const categoryPillText = cuisine ? `${cuisine} ${categoryOne}` : categoryOne

  return (
    <SafeAreaView edges={['top']} style={[styles.root, { backgroundColor: c.bg }]}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 120 }}>
        <View style={styles.navRow}>
          <Pressable
            onPress={() => router.back()}
            style={[styles.navBtn, { backgroundColor: c.card, borderColor: c.controlBorder }]}
            hitSlop={8}
          >
            <Ionicons name="chevron-back" size={22} color={c.text} />
          </Pressable>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pressable
              onPress={onToggleWatch}
              disabled={watchBusy}
              style={[
                styles.navBtn,
                watching
                  ? { backgroundColor: c.primaryTint, borderColor: c.primary }
                  : { backgroundColor: c.card, borderColor: c.controlBorder },
              ]}
              hitSlop={8}
            >
              {watchBusy ? (
                <ActivityIndicator size="small" color={c.primary} />
              ) : (
                <Ionicons
                  name={watching ? 'notifications' : 'notifications-outline'}
                  size={20}
                  color={watching ? c.primary : c.text}
                />
              )}
            </Pressable>
            <Pressable
              onPress={() => setSaveOpen(true)}
              style={[styles.navBtn, { backgroundColor: c.card, borderColor: c.controlBorder }]}
              hitSlop={8}
            >
              <Ionicons name="bookmark-outline" size={20} color={c.text} />
            </Pressable>
            <Pressable
              onPress={onShare}
              style={[styles.navBtn, { backgroundColor: c.card, borderColor: c.controlBorder }]}
              hitSlop={8}
            >
              <Ionicons name="share-outline" size={20} color={c.text} />
            </Pressable>
          </View>
        </View>

        <View style={[styles.catPill, { backgroundColor: c.primaryTint }]}>
          <View style={[styles.catDot, { backgroundColor: c.primary }]} />
          <Text style={[styles.catText, { color: c.primary }]}>{categoryPillText.toUpperCase()}</Text>
        </View>
        <Text style={[styles.name, { color: c.text }]}>{place.name}</Text>
        {place.address ? (
          <Text style={[styles.addr, { color: c.subtext }]}>
            {place.address}
            {place.postcode ? `, ${place.postcode}` : ''}
          </Text>
        ) : null}

        {/* Score hero — the decision moment. Painted in the score's colour. */}
        <View style={[styles.hero, { backgroundColor: heroFill }, tileEdge(heroEdge, 5)]}>
          <View style={styles.heroTop}>
            <View style={styles.heroTile}>
              {numeric ? (
                <Text style={[styles.heroNum, { color: heroEdge }]}>{place.rating_value}</Text>
              ) : (
                <Ionicons name="hourglass-outline" size={32} color={heroEdge} />
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.heroWord}>{ratingDescription(place.rating_value)}</Text>
              <Text style={styles.heroMeta}>
                {inspectionStatusLine(place.rating_value, place.rating_date)}
              </Text>
            </View>
          </View>
          {numeric ? <ScaleStrip rating={place.rating_value} /> : null}
        </View>

        {/* Right now · Google · BiteScore */}
        <View style={styles.statRow}>
          <View style={[styles.statCard, { backgroundColor: c.card, borderColor: c.border }]}>
            <Text style={[styles.statK, { color: c.placeholder }]}>RIGHT NOW</Text>
            <View style={styles.statValueRow}>
              <View
                style={[
                  styles.openDot,
                  { backgroundColor: openNow === true ? '#5EA632' : c.disabled },
                ]}
              />
              <Text
                style={[
                  styles.statV,
                  { color: openNow === true ? c.openNow : c.mutedOnCard },
                ]}
              >
                {openNow === true ? 'Open' : openNow === false ? 'Closed' : '—'}
              </Text>
            </View>
            <Text style={[styles.statSub, { color: c.placeholder }]} numberOfLines={1}>
              {todayHours ?? 'hours coming soon'}
            </Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: c.card, borderColor: c.border }]}>
            <Text style={[styles.statK, { color: c.placeholder }]}>GOOGLE</Text>
            <View style={styles.statValueRow}>
              {googleRating !== null ? (
                <>
                  <Ionicons name="star" size={14} color={c.star} />
                  <Text style={[styles.statV, { color: c.text }]}>{googleRating.toFixed(1)}</Text>
                </>
              ) : (
                <Text style={[styles.statV, { color: c.mutedOnCard }]}>—</Text>
              )}
            </View>
            <Text style={[styles.statSub, { color: c.placeholder }]}>
              {googleRatingCount !== null ? `${googleRatingCount} reviews` : 'no data yet'}
            </Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: c.text }]}>
            <Text style={[styles.statK, { color: c.onDarkMuted }]}>BITESCORE</Text>
            <Text style={[styles.statV, { color: '#fff' }]}>
              {reviews.length === 0 ? 'Be first' : `${reviews.length}`}
            </Text>
            <Text style={[styles.statSub, { color: c.onDarkMuted }]}>
              {reviews.length === 0 ? 'no reviews yet' : `review${reviews.length === 1 ? '' : 's'}`}
            </Text>
          </View>
        </View>

        {hoursLines && hoursLines.length ? (
          <View style={[styles.hoursCard, { backgroundColor: c.card, borderColor: c.border }]}>
            <View style={styles.hoursHead}>
              <Text style={[styles.hoursTitle, { color: c.text }]}>Opening hours</Text>
              <Text style={[styles.hoursToday, { color: c.placeholder }]}>
                Today, {new Date().toLocaleDateString('en-GB', { weekday: 'long' })}
              </Text>
            </View>
            {hoursLines.map((line, i) => {
              const { day, hours: hrs } = splitHoursLine(line)
              const isToday = hoursLines.length === 7 && i === todayIdx
              const closed = /closed/i.test(hrs)
              return (
                <View
                  key={line}
                  style={[styles.hoursRow, isToday ? { backgroundColor: c.subtleFill, borderRadius: 8 } : null]}
                >
                  <Text
                    style={[
                      styles.hoursDay,
                      { color: isToday ? c.text : closed ? c.disabled : c.inkSecondary },
                      isToday ? { fontFamily: fonts.bodyBold } : null,
                    ]}
                  >
                    {day}
                  </Text>
                  <Text
                    style={[
                      styles.hoursVal,
                      { color: isToday ? c.text : closed ? c.disabled : c.inkSecondary },
                      isToday ? { fontFamily: fonts.bodyBold } : null,
                    ]}
                  >
                    {hrs}
                  </Text>
                </View>
              )
            })}
          </View>
        ) : null}

        {/* Reviews */}
        {reviews.length === 0 ? (
          <Pressable
            onPress={() => setComposerOpen(true)}
            style={[styles.reviewPrompt, { borderColor: '#D9C9A6' }]}
          >
            <View style={[styles.reviewPlus, { backgroundColor: c.accent }, tileEdge(c.accentDark)]}>
              <Ionicons name="add" size={24} color="#fff" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.reviewPromptTitle, { color: c.text }]}>
                Nobody's reviewed this yet
              </Text>
              <Text style={[styles.reviewPromptSub, { color: c.subtext }]}>
                Be the first — it takes about a minute.
              </Text>
            </View>
          </Pressable>
        ) : (
          <View style={[styles.reviewsCard, { backgroundColor: c.card, borderColor: c.border }]}>
            <View style={styles.reviewsHead}>
              <Text style={[styles.hoursTitle, { color: c.text }]}>Reviews</Text>
              <Pressable onPress={() => setComposerOpen(true)} hitSlop={8}>
                <Text style={[styles.writeReview, { color: c.primary }]}>
                  {myReview ? 'Edit yours' : 'Write one'}
                </Text>
              </Pressable>
            </View>
            {reviews.map((r, i) => (
              <View
                key={r.id}
                style={[styles.rev, i > 0 ? { borderTopWidth: 1.5, borderTopColor: c.rowBorder } : null]}
              >
                <View style={styles.revHeadRow}>
                  <Text style={[styles.who, { color: c.text }]}>
                    {r.is_anonymous ? 'Anonymous' : r.display_name_snapshot ?? 'Someone'}
                  </Text>
                  {r.id !== myReview?.id ? (
                    <Pressable onPress={() => onReviewOptions(r)} hitSlop={10}>
                      <Ionicons name="ellipsis-horizontal" size={16} color={c.mutedOnCard} />
                    </Pressable>
                  ) : null}
                </View>
                <Text style={[styles.revText, { color: c.inkSecondary }]}>{r.body}</Text>
              </View>
            ))}
          </View>
        )}

        <Text style={[styles.attrib, { color: c.legal }]}>
          Hygiene ratings © Crown copyright, Food Standards Agency, under the Open Government
          Licence. Ratings reflect the last inspection.
        </Text>
      </ScrollView>

      <View style={styles.footer}>
        <Pressable
          style={[styles.footerBtn, styles.footerOutline, { backgroundColor: c.card, borderColor: c.primary }]}
          onPress={onGetDirections}
        >
          <Ionicons name="navigate" size={18} color={c.primary} />
          <Text style={[styles.footerBtnText, { color: c.primary }]}>Directions</Text>
        </Pressable>
        <EdgeButton
          color={c.primary}
          edgeColor={c.primaryDark}
          edge={4}
          radius={18}
          onPress={() => setSaveOpen(true)}
          containerStyle={{ flex: 1 }}
          style={styles.footerBtnInner}
        >
          <Ionicons name="bookmark" size={18} color="#fff" />
          <Text style={styles.footerBtnTextOnGreen}>Save</Text>
        </EdgeButton>
      </View>

      <SaveToListModal visible={saveOpen} restaurantId={id} onClose={() => setSaveOpen(false)} />

      <Modal
        visible={paywallOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setPaywallOpen(false)}
      >
        <PaywallGate
          userId={session?.user.id}
          onClose={() => setPaywallOpen(false)}
          onUnlocked={() => {
            setPaywallOpen(false)
            setWatchState(true)
          }}
        />
      </Modal>

      <ReviewComposer
        visible={composerOpen}
        restaurantId={id}
        existingReview={myReview}
        onClose={() => setComposerOpen(false)}
        onSaved={(review) => {
          if (!myReview) recordReview() // game layer: first save only, edits don't recount
          setMyReview(review)
          setReviews((prev) => {
            const others = prev.filter((r) => r.id !== review.id)
            return [review, ...others].sort(
              (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
            )
          })
          setComposerOpen(false)
        }}
        onDeleted={() => {
          setReviews((prev) => prev.filter((r) => r.id !== myReview?.id))
          setMyReview(null)
          setComposerOpen(false)
        }}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  retryBtn: { marginTop: 10, paddingHorizontal: 24, paddingVertical: 13 },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
    marginBottom: 10,
  },
  navBtn: {
    width: 40,
    height: 40,
    borderRadius: 14,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  catPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingVertical: 5,
    paddingHorizontal: 11,
    borderRadius: 999,
    marginBottom: 9,
  },
  catDot: { width: 6, height: 6, borderRadius: 3 },
  catText: { fontSize: 11.5, fontFamily: fonts.display600, letterSpacing: 1.2 },
  name: { fontSize: 34, fontFamily: fonts.display800, letterSpacing: -0.7, lineHeight: 36 },
  addr: { fontSize: 15, fontFamily: fonts.body, marginTop: 5 },
  hero: { marginTop: 16, borderRadius: 24, padding: 18 },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  heroTile: {
    width: 76,
    height: 76,
    borderRadius: 24,
    backgroundColor: '#FFFDF7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroNum: { fontSize: 44, fontFamily: fonts.display800 },
  heroWord: { color: '#fff', fontSize: 26, fontFamily: fonts.display800 },
  heroMeta: {
    color: 'rgba(255,255,255,0.92)',
    fontSize: 13.5,
    fontFamily: fonts.body,
    marginTop: 4,
    lineHeight: 18,
  },
  scaleRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 5 },
  scaleBar: { flex: 1, height: 8, borderRadius: 4 },
  scaleLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  scaleLabel: { color: 'rgba(255,255,255,0.85)', fontSize: 11, fontFamily: fonts.bodyMedium },
  statRow: { flexDirection: 'row', gap: 9, marginTop: 12 },
  statCard: { flex: 1, borderRadius: 18, borderWidth: 1.5, paddingVertical: 12, paddingHorizontal: 13 },
  statK: { fontSize: 10.5, fontFamily: fonts.display600, letterSpacing: 0.8, marginBottom: 6 },
  statValueRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  openDot: { width: 8, height: 8, borderRadius: 4 },
  statV: { fontSize: 16, fontFamily: fonts.display600 },
  statSub: { fontSize: 12, fontFamily: fonts.body, marginTop: 3 },
  hoursCard: { marginTop: 12, borderRadius: 20, borderWidth: 1.5, paddingVertical: 15, paddingHorizontal: 16 },
  hoursHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  hoursTitle: { fontSize: 15.5, fontFamily: fonts.display600 },
  hoursToday: { fontSize: 12.5, fontFamily: fonts.body },
  hoursRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
    paddingHorizontal: 8,
    marginHorizontal: -8,
    marginBottom: 3,
  },
  hoursDay: { fontSize: 14, fontFamily: fonts.body },
  hoursVal: { fontSize: 14, fontFamily: fonts.body },
  reviewPrompt: {
    marginTop: 12,
    backgroundColor: '#F1E7D3',
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderRadius: 20,
    paddingVertical: 15,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
  },
  reviewPlus: {
    width: 44,
    height: 44,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reviewPromptTitle: { fontSize: 16, fontFamily: fonts.display600 },
  reviewPromptSub: { fontSize: 13, fontFamily: fonts.body, marginTop: 2 },
  reviewsCard: { marginTop: 12, borderRadius: 20, borderWidth: 1.5, paddingVertical: 15, paddingHorizontal: 16 },
  reviewsHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  writeReview: { fontSize: 13, fontFamily: fonts.display600 },
  rev: { paddingVertical: 12 },
  revHeadRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  who: { fontSize: 14.5, fontFamily: fonts.display600 },
  revText: { fontSize: 14, fontFamily: fonts.body, marginTop: 3, lineHeight: 20 },
  attrib: { fontSize: 11.5, fontFamily: fonts.body, lineHeight: 17, marginTop: 12 },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 26,
  },
  footerBtn: {
    flex: 1,
    height: 56,
    borderRadius: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  footerOutline: { borderWidth: 2 },
  footerBtnInner: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  footerBtnText: { fontSize: 16.5, fontFamily: fonts.display600 },
  footerBtnTextOnGreen: { color: '#fff', fontSize: 16.5, fontFamily: fonts.display600 },
})
