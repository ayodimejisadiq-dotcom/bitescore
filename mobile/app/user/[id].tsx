import { useCallback, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { useTheme } from '@/theme/useTheme'
import { ScoreBadge } from '@/components/ScoreBadge'
import { Button, EmptyState, NavBar, SectionHeader } from '@/components/ui'
import {
  ProfileHeader,
  profileSubline,
  PublicListsCarousel,
  Ring,
  StatsCard,
} from '@/components/ProfileParts'
import {
  follow,
  getProfileSummary,
  getPublicLists,
  getTasteMatch,
  getUserReviews,
  profileUrl,
  unfollow,
} from '@/lib/data'
import { errorMessage } from '@/lib/errors'
import { displayName, tierFor } from '@/lib/people'
import type { ProfileSummary, PublicList, TasteMatch, UserReview, Verdict } from '@/lib/types'

// Taste match shows once you've both verified-visited this many places.
const MIN_SHARED = 5

function agreement(mine: Verdict | null, theirs: Verdict | null): { text: string; good: boolean } | null {
  if (!mine || !theirs) return null
  if (mine !== theirs) return { text: 'You differed', good: false }
  return mine === 'cleaner' ? { text: 'Both: cleaner now', good: true } : { text: 'Both: matches score', good: true }
}

export default function UserProfile() {
  const c = useTheme()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { id } = useLocalSearchParams<{ id: string }>()
  const [profile, setProfile] = useState<ProfileSummary | null>(null)
  const [missing, setMissing] = useState(false)
  const [taste, setTaste] = useState<TasteMatch | null>(null)
  const [lists, setLists] = useState<PublicList[]>([])
  const [reviews, setReviews] = useState<UserReview[]>([])
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const p = await getProfileSummary(id)
      if (!p) return setMissing(true)
      // Your own profile lives in the Profile tab.
      if (p.is_me) return router.replace('/profile')
      setProfile(p)
      const [t, l, r] = await Promise.all([getTasteMatch(id), getPublicLists(id), getUserReviews(id)])
      setTaste(t)
      setLists(l)
      setReviews(r)
    } catch {
      setMissing(true)
    }
  }, [id, router])

  useFocusEffect(
    useCallback(() => {
      load()
    }, [load]),
  )

  if (!profile) {
    return (
      <SafeAreaView edges={['top']} style={[styles.root, { backgroundColor: c.bg }]}>
        <NavBar backLabel="Back" />
        {missing ? (
          <EmptyState icon="person-outline" title="Profile not available" />
        ) : (
          <ActivityIndicator color={c.meta} style={{ marginTop: 60 }} />
        )}
      </SafeAreaView>
    )
  }

  const onFollow = async () => {
    const next = !profile.i_follow
    setProfile({ ...profile, i_follow: next, followers: profile.followers + (next ? 1 : -1) })
    setBusy(true)
    try {
      next ? await follow(profile.user_id) : await unfollow(profile.user_id)
    } catch (e) {
      setProfile(profile)
      Alert.alert('Couldn’t update', errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const tier = tierFor(profile.verified_visits)
  const sub = profileSubline(profile, [
    tier.name,
    `${profile.verified_visits} visit${profile.verified_visits === 1 ? '' : 's'}`,
  ])
  const pct = taste && taste.compared > 0 ? (taste.agreed / taste.compared) * 100 : null
  const latest = reviews[0]

  return (
    <SafeAreaView edges={['top']} style={[styles.root, { backgroundColor: c.bg }]}>
      <NavBar backLabel="Back" />
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}>
        <ProfileHeader profile={profile} sub={sub} />

        <View style={styles.buttons}>
          <Button
            label={profile.i_follow ? 'Following' : profile.follows_me ? 'Follow back' : 'Follow'}
            size="medium"
            variant={profile.i_follow ? 'secondary' : 'primary'}
            fg={profile.i_follow ? c.label : undefined}
            onPress={onFollow}
            disabled={busy}
            style={{ flex: 1 }}
          />
          <Pressable
            onPress={() => {
              const url = profileUrl(profile.user_id)
              Share.share({ message: `${displayName(profile)} on Bitescore: ${url}`, url }).catch(() => {})
            }}
            style={[styles.shareBtn, { backgroundColor: c.card }]}
            accessibilityLabel="Share profile"
          >
            <Ionicons name="share-outline" size={20} color={c.tint} />
          </Pressable>
        </View>

        <StatsCard profile={profile} />

        {taste && taste.shared >= MIN_SHARED && pct !== null ? (
          <View style={styles.tasteCard}>
            <Ring pct={pct} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.tasteTitle, { color: c.label }]}>Taste match</Text>
              <Text style={[styles.tasteBody, { color: c.label2 }]}>
                You've both been to {taste.shared} places and agreed on {taste.agreed} of the {taste.compared} you
                both checked.
              </Text>
            </View>
          </View>
        ) : taste && taste.shared > 0 ? (
          <View style={styles.tasteCard}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.tasteTitle, { color: c.label }]}>Taste match</Text>
              <Text style={[styles.tasteBody, { color: c.label2 }]}>
                Shows once you've both been to {MIN_SHARED} places. You're at {taste.shared}.
              </Text>
            </View>
          </View>
        ) : null}

        {taste && taste.places.length ? (
          <>
            <SectionHeader style={{ paddingTop: 22 }}>You've both been</SectionHeader>
            <View style={styles.card}>
              {taste.places.map((p, i) => {
                const a = agreement(p.mine, p.theirs)
                return (
                  <Pressable key={p.id} onPress={() => router.push(`/restaurant/${p.id}`)} style={styles.row}>
                    <ScoreBadge rating={p.rating_value} size={40} />
                    <View
                      style={[
                        styles.rowBody,
                        i < taste.places.length - 1 ? { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.separator } : null,
                      ]}
                    >
                      <Text style={[styles.rowTitle, { color: c.label }]} numberOfLines={2}>
                        {p.name}
                      </Text>
                      {a ? (
                        <Text style={[styles.agree, a.good ? { color: c.success, fontWeight: '500' } : { color: c.meta }]}>
                          {a.text}
                        </Text>
                      ) : null}
                    </View>
                  </Pressable>
                )
              })}
            </View>
          </>
        ) : null}

        {latest ? (
          <>
            <SectionHeader style={{ paddingTop: 22 }}>Latest review</SectionHeader>
            <Pressable onPress={() => router.push(`/restaurant/${latest.restaurant_id}`)} style={styles.reviewCard}>
              <Text style={[styles.reviewText, { color: c.label2 }]}>
                <Text style={{ color: c.label, fontWeight: '600' }}>{latest.restaurant_name}</Text> · {latest.body}
              </Text>
            </Pressable>
          </>
        ) : null}

        <PublicListsCarousel lists={lists} />
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  buttons: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingTop: 16 },
  shareBtn: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  tasteCard: {
    marginHorizontal: 16,
    marginTop: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
  },
  tasteTitle: { fontSize: 17, fontWeight: '600' },
  tasteBody: { fontSize: 14, lineHeight: 20, marginTop: 3 },
  card: { marginHorizontal: 16, backgroundColor: '#FFFFFF', borderRadius: 14, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingLeft: 16 },
  rowBody: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12, paddingRight: 16 },
  rowTitle: { flex: 1, fontSize: 16, fontWeight: '600' },
  agree: { fontSize: 13 },
  reviewCard: { marginHorizontal: 16, backgroundColor: '#FFFFFF', borderRadius: 14, padding: 14, paddingHorizontal: 16 },
  reviewText: { fontSize: 15, lineHeight: 21 },
})
