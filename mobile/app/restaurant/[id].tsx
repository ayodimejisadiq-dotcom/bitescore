import { useEffect, useState } from 'react'
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Alert,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useTheme } from '@/theme/useTheme'
import { ScoreBadge } from '@/components/ScoreBadge'
import { SaveToListModal } from '@/components/SaveToListModal'
import { FSA_ATTRIBUTION, BUSINESS_TYPE_LABEL, ratingDescription, inspectionStatusLine } from '@/lib/fsa'
import { getRestaurant, getReviews, lookupPlaceData } from '@/lib/data'
import type { OpeningHours, Restaurant, Review } from '@/lib/types'

export default function RestaurantDetail() {
  const c = useTheme()
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const [place, setPlace] = useState<Restaurant | null>(null)
  const [reviews, setReviews] = useState<Review[]>([])
  const [loading, setLoading] = useState(true)
  const [saveOpen, setSaveOpen] = useState(false)
  const [googleRating, setGoogleRating] = useState<number | null>(null)
  const [googleRatingCount, setGoogleRatingCount] = useState<number | null>(null)
  const [hours, setHours] = useState<OpeningHours | null>(null)

  useEffect(() => {
    ;(async () => {
      try {
        const [p, r] = await Promise.all([getRestaurant(id), getReviews(id)])
        setPlace(p)
        setReviews(r)
        setGoogleRating(p?.google_rating ?? null)
        setGoogleRatingCount(p?.google_rating_count ?? null)
        setHours(p?.hours_cache ?? null)
      } finally {
        setLoading(false)
      }
    })()
  }, [id])

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

  if (!place) {
    return (
      <View style={[styles.center, { backgroundColor: c.bg }]}>
        <Text style={{ color: c.subtext }}>This place couldn’t be found.</Text>
      </View>
    )
  }

  const hoursLines = hours?.weekday_text
  const openNow = hours?.open_now

  const onSubmitReview = () => {
    Alert.alert('Coming soon', 'Writing reviews arrives in the next update.')
  }

  return (
    <SafeAreaView edges={['top']} style={[styles.root, { backgroundColor: c.bg }]}>
      <Pressable style={styles.back} onPress={() => router.back()} hitSlop={12}>
        <Ionicons name="chevron-back" size={26} color={c.text} />
      </Pressable>

      <ScrollView contentContainerStyle={{ paddingBottom: 100 }}>
        <View style={styles.head}>
          <Text style={[styles.type, { color: c.primary }]}>
            {BUSINESS_TYPE_LABEL[place.business_type] ?? place.business_type}
          </Text>
          <Text style={[styles.name, { color: c.text }]}>{place.name}</Text>
          {place.address ? (
            <Text style={[styles.addr, { color: c.subtext }]}>
              {place.address}
              {place.postcode ? `, ${place.postcode}` : ''}
            </Text>
          ) : null}
        </View>

        <View style={[styles.scoreCard, { backgroundColor: c.card, borderColor: c.border }]}>
          <ScoreBadge rating={place.rating_value} size={66} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.rlabel, { color: c.text }]}>
              {ratingDescription(place.rating_value)}
            </Text>
            <Text style={[styles.rwhen, { color: c.subtext }]}>
              {inspectionStatusLine(place.rating_value, place.rating_date)}
            </Text>
          </View>
        </View>

        <View style={[styles.ratingsCard, { backgroundColor: c.card, borderColor: c.border }]}>
          <View style={styles.ratingsCol}>
            <Text style={[styles.k, { color: c.subtext }]}>Google rating</Text>
            {googleRating !== null ? (
              <View style={styles.ratingRow}>
                <Ionicons name="star" size={15} color="#F5A800" />
                <Text style={[styles.ratingValue, { color: c.text }]}>{googleRating.toFixed(1)}</Text>
                {googleRatingCount !== null ? (
                  <Text style={[styles.ratingCount, { color: c.subtext }]}>({googleRatingCount})</Text>
                ) : null}
              </View>
            ) : (
              <Text style={[styles.v, { color: c.subtext }]}>Not yet available</Text>
            )}
          </View>
          <View style={[styles.ratingsDivider, { backgroundColor: c.border }]} />
          <View style={styles.ratingsCol}>
            <Text style={[styles.k, { color: c.subtext }]}>Bitescore</Text>
            {reviews.length === 0 ? (
              <Pressable onPress={onSubmitReview}>
                <Text style={[styles.v, { color: c.primary }]}>Pending — submit the first review</Text>
              </Pressable>
            ) : (
              <Text style={[styles.v, { color: c.text }]}>
                {reviews.length} review{reviews.length === 1 ? '' : 's'}
              </Text>
            )}
          </View>
        </View>
        {googleRating !== null ? (
          <Text style={[styles.googleAttrib, { color: c.subtext }]}>Rating powered by Google</Text>
        ) : null}

        <View style={styles.infoRow}>
          <View style={[styles.infoCard, { backgroundColor: c.card, borderColor: c.border }]}>
            <Text style={[styles.k, { color: c.subtext }]}>Opening hours</Text>
            <Text style={[styles.v, { color: openNow ? c.primary : c.text }]}>
              {openNow === true ? 'Open now' : openNow === false ? 'Closed now' : 'Hours coming soon'}
            </Text>
          </View>
          <View style={[styles.infoCard, { backgroundColor: c.card, borderColor: c.border }]}>
            <Text style={[styles.k, { color: c.subtext }]}>Authority</Text>
            <Text style={[styles.v, { color: c.text }]} numberOfLines={1}>
              {place.local_authority ?? '—'}
            </Text>
          </View>
        </View>

        {hoursLines && hoursLines.length ? (
          <View style={[styles.hoursCard, { backgroundColor: c.card, borderColor: c.border }]}>
            {hoursLines.map((line) => (
              <Text key={line} style={[styles.hoursLine, { color: c.text }]}>
                {line}
              </Text>
            ))}
          </View>
        ) : null}

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: c.subtext }]}>Reviews</Text>
          {reviews.length === 0 ? (
            <Text style={[styles.noReviews, { color: c.subtext }]}>
              No reviews yet. Be the first to add one.
            </Text>
          ) : (
            reviews.map((r) => (
              <View key={r.id} style={[styles.rev, { borderTopColor: c.border }]}>
                <Text style={[styles.who, { color: c.text }]}>
                  {r.is_anonymous ? 'Anonymous' : r.display_name_snapshot ?? 'Someone'}
                </Text>
                <Text style={[styles.revText, { color: c.subtext }]}>{r.body}</Text>
              </View>
            ))
          )}
        </View>

        <Text style={[styles.attrib, { color: c.subtext }]}>{FSA_ATTRIBUTION}</Text>
      </ScrollView>

      <View style={[styles.ctaBar, { backgroundColor: c.bg, borderTopColor: c.border }]}>
        <Pressable style={[styles.cta, { backgroundColor: c.primary }]} onPress={() => setSaveOpen(true)}>
          <Ionicons name="bookmark-outline" size={18} color="#fff" />
          <Text style={styles.ctaText}>Add to a list</Text>
        </Pressable>
      </View>

      <SaveToListModal visible={saveOpen} restaurantId={id} onClose={() => setSaveOpen(false)} />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  back: { paddingHorizontal: 12, paddingVertical: 6 },
  head: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 12 },
  type: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8 },
  name: { fontSize: 26, fontWeight: '800', letterSpacing: -0.5, marginTop: 6, lineHeight: 30 },
  addr: { fontSize: 14, marginTop: 4 },
  scoreCard: {
    marginHorizontal: 20,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 15,
  },
  rlabel: { fontSize: 17, fontWeight: '800' },
  rwhen: { fontSize: 12.5, marginTop: 4, lineHeight: 17 },
  ratingsCard: {
    flexDirection: 'row',
    marginHorizontal: 20,
    marginTop: 10,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 12,
  },
  ratingsCol: { flex: 1, paddingHorizontal: 14, gap: 5 },
  ratingsDivider: { width: StyleSheet.hairlineWidth },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  ratingValue: { fontSize: 15, fontWeight: '700' },
  ratingCount: { fontSize: 12.5 },
  googleAttrib: { fontSize: 10.5, marginHorizontal: 20, marginTop: 5 },
  infoRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 20, marginTop: 12 },
  infoCard: { flex: 1, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, padding: 12 },
  k: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  v: { fontSize: 14, fontWeight: '600', marginTop: 5 },
  hoursCard: {
    marginHorizontal: 20,
    marginTop: 12,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    gap: 4,
  },
  hoursLine: { fontSize: 13.5 },
  section: { paddingHorizontal: 20, marginTop: 22 },
  sectionTitle: { fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8 },
  noReviews: { fontSize: 14, marginTop: 10, lineHeight: 20 },
  rev: { borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 12 },
  who: { fontSize: 14, fontWeight: '700' },
  revText: { fontSize: 14, marginTop: 3, lineHeight: 20 },
  attrib: { fontSize: 11, lineHeight: 16, paddingHorizontal: 20, marginTop: 26 },
  ctaBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 30,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 15,
    borderRadius: 15,
  },
  ctaText: { color: '#fff', fontWeight: '700', fontSize: 16 },
})
