import { useCallback, useState } from 'react'
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Share, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useFocusEffect, useRouter } from 'expo-router'
import { useTheme } from '@/theme/useTheme'
import { useSession } from '@/hooks/useSession'
import { ensureSession } from '@/lib/auth'
import { Button, EmptyState, TAB_BAR_SPACE } from '@/components/ui'
import {
  BadgesGrid,
  ProfileHeader,
  profileSubline,
  PublicListsCarousel,
  ReviewsList,
  StatsCard,
  TierCard,
} from '@/components/ProfileParts'
import { getProfileSummary, getPublicLists, getUserReviews, profileUrl } from '@/lib/data'
import { displayName } from '@/lib/people'
import type { ProfileSummary, PublicList, UserReview } from '@/lib/types'

export default function ProfileScreen() {
  const c = useTheme()
  const router = useRouter()
  const { session, loading: sessionLoading } = useSession()
  const me = session?.user.id
  const [profile, setProfile] = useState<ProfileSummary | null>(null)
  const [lists, setLists] = useState<PublicList[]>([])
  const [reviews, setReviews] = useState<UserReview[]>([])
  const [failed, setFailed] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    if (!me) return
    try {
      const [p, l, r] = await Promise.all([getProfileSummary(me), getPublicLists(me), getUserReviews(me)])
      setProfile(p)
      setLists(l)
      setReviews(r.slice(0, 5))
      setFailed(false)
    } catch {
      setFailed(true)
    }
  }, [me])

  useFocusEffect(
    useCallback(() => {
      load()
    }, [load]),
  )

  const gear = (
    <View style={styles.topBar}>
      <Pressable onPress={() => router.push('/settings')} hitSlop={10} accessibilityRole="button" accessibilityLabel="Settings">
        <Ionicons name="settings-outline" size={24} color={c.tint} />
      </Pressable>
    </View>
  )

  if (sessionLoading || (!profile && !failed && session)) {
    return (
      <SafeAreaView edges={['top']} style={[styles.root, { backgroundColor: c.bg }]}>
        {gear}
        <ActivityIndicator color={c.meta} style={{ marginTop: 60 }} />
      </SafeAreaView>
    )
  }

  if (!session || !profile) {
    return (
      <SafeAreaView edges={['top']} style={[styles.root, { backgroundColor: c.bg }]}>
        {gear}
        <EmptyState
          icon="cloud-offline-outline"
          title="Couldn’t load your profile"
          body="Check your connection and try again."
          action={<Button label="Retry" onPress={() => (session ? load() : ensureSession())} />}
        />
      </SafeAreaView>
    )
  }

  const noName = !profile.public_name

  return (
    <SafeAreaView edges={['top']} style={[styles.root, { backgroundColor: c.bg }]}>
      {gear}
      <ScrollView
        contentContainerStyle={{ paddingBottom: TAB_BAR_SPACE }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true)
              await load()
              setRefreshing(false)
            }}
          />
        }
      >
        <ProfileHeader profile={profile} sub={profileSubline(profile, [profile.city])} />
        <StatsCard profile={profile} />
        <View style={styles.buttons}>
          <Button label="Edit profile" variant="secondary" size="small" fg={c.label} onPress={() => router.push('/edit-profile')} style={{ flex: 1 }} />
          <Button
            label="Share profile"
            variant="secondary"
            size="small"
            fg={c.label}
            onPress={() => {
              const url = profileUrl(profile.user_id)
              Share.share({ message: `${displayName(profile)} on Bitescore: ${url}`, url }).catch(() => {})
            }}
            style={{ flex: 1 }}
          />
        </View>

        {noName ? (
          <Pressable onPress={() => router.push('/edit-profile')} style={[styles.nudge, { backgroundColor: c.tintSoft }]}>
            <Ionicons name="person-circle-outline" size={22} color={c.tint} />
            <Text style={[styles.nudgeText, { color: c.tint }]}>
              Add a name so friends recognise you. It’s optional — without one you show as @{profile.username}.
            </Text>
          </Pressable>
        ) : null}

        <TierCard visits={profile.verified_visits} mine />
        <BadgesGrid profile={profile} />
        <PublicListsCarousel lists={lists} />
        <ReviewsList reviews={reviews} />
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  topBar: { height: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', paddingHorizontal: 18 },
  buttons: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingTop: 12 },
  nudge: {
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 14,
    padding: 14,
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
  },
  nudgeText: { flex: 1, fontSize: 14, lineHeight: 19 },
})
