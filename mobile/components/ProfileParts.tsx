import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { useTheme } from '@/theme/useTheme'
import { ScoreBadge } from './ScoreBadge'
import { Avatar, Mosaic, SectionHeader } from './ui'
import { displayName, handle, TIERS, tierFor } from '@/lib/people'
import type { ProfileSummary, PublicList, UserReview } from '@/lib/types'

type IconName = keyof typeof Ionicons.glyphMap

export function ProfileHeader({ profile, sub }: { profile: ProfileSummary; sub: string }) {
  const c = useTheme()
  return (
    <View style={styles.header}>
      <Avatar person={profile} size={72} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[styles.name, { color: c.label }]} numberOfLines={1}>
          {displayName(profile)}
        </Text>
        <Text style={[styles.sub, { color: c.meta }]} numberOfLines={2}>
          {sub}
        </Text>
      </View>
    </View>
  )
}

export function profileSubline(p: ProfileSummary, extra: (string | null)[] = []): string {
  return [handle(p) || null, ...extra].filter(Boolean).join(' · ')
}

// Followers / Following / Reviews, each tappable.
export function StatsCard({ profile }: { profile: ProfileSummary }) {
  const c = useTheme()
  const router = useRouter()
  const cell = (n: number, label: string, onPress?: () => void, divider = false) => (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={[styles.stat, divider ? { borderLeftWidth: StyleSheet.hairlineWidth, borderRightWidth: StyleSheet.hairlineWidth, borderColor: c.separator } : null]}
    >
      <Text style={[styles.statNum, { color: c.label }]}>{n}</Text>
      <Text style={[styles.statLabel, { color: c.meta }]}>{label}</Text>
    </Pressable>
  )
  return (
    <View style={styles.statsCard}>
      {cell(profile.followers, 'Followers', () => router.push(`/follows/${profile.user_id}?tab=followers`))}
      {cell(profile.following, 'Following', () => router.push(`/follows/${profile.user_id}?tab=following`), true)}
      {cell(profile.reviews, 'Reviews')}
    </View>
  )
}

export function TierCard({ visits, mine }: { visits: number; mine: boolean }) {
  const c = useTheme()
  const tier = tierFor(visits)
  return (
    <View style={styles.tierCard}>
      <View style={styles.tierTop}>
        <View>
          <Text style={[styles.tierKicker, { color: c.meta }]}>{mine ? 'Your tier' : 'Tier'}</Text>
          <Text style={[styles.tierName, { color: c.tint }]}>{tier.name}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={[styles.tierCount, { color: c.label }]}>{visits}</Text>
          <Text style={[styles.tierKicker, { color: c.meta }]}>verified visit{visits === 1 ? '' : 's'}</Text>
        </View>
      </View>
      <View style={[styles.track, { backgroundColor: c.bg }]}>
        <View style={[styles.fill, { width: `${Math.round(tier.progress * 100)}%`, backgroundColor: c.tint }]} />
      </View>
      <View style={styles.tierFoot}>
        <Text style={[styles.tierSteps, { color: c.meta }]} numberOfLines={1}>
          {TIERS.map((t, i) => (
            <Text key={t.name} style={i === tier.index ? { color: c.label, fontWeight: '600' } : null}>
              {i > 0 ? ' · ' : ''}
              {t.name}
            </Text>
          ))}
        </Text>
        {tier.next ? <Text style={[styles.tierSteps, { color: c.meta }]}>{tier.toGo} to go</Text> : null}
      </View>
    </View>
  )
}

interface Badge {
  id: string
  title: string
  icon: IconName
  bg: string
  fg: string
  earned: boolean
  progress: string
}

// Badges from verified visits. The rate-based ones need 10 visits first so a
// single visit doesn't earn "100% independents".
export function badgesFor(p: ProfileSummary): Badge[] {
  const v = p.verified_visits
  const pct = p.independent_pct
  const avg = p.avg_score
  return [
    {
      id: 'indie',
      title: 'Indie Supporter',
      icon: 'storefront-outline',
      bg: '#E3F1E8',
      fg: '#047B42',
      earned: v >= 10 && (pct ?? 0) >= 60,
      progress: pct === null ? '60% independents' : `${pct}% independents`,
    },
    {
      id: 'spotless',
      title: 'Spotless Taste',
      icon: 'shield-checkmark-outline',
      bg: '#DCF5E3',
      fg: '#248A3D',
      earned: v >= 10 && (avg ?? 0) >= 4.8,
      progress: avg === null ? 'Avg score 4.8+' : `Avg score ${Number(avg).toFixed(1)}`,
    },
    {
      id: 'explorer',
      title: 'Explorer',
      icon: 'compass-outline',
      bg: '#DCE8FF',
      fg: '#2A5BB8',
      earned: p.authorities >= 10,
      progress: p.authorities >= 10 ? `${p.authorities} boroughs` : `${p.authorities} of 10 boroughs`,
    },
    {
      id: 'goat',
      title: 'Fast Food GOAT',
      icon: 'flash-outline',
      bg: '#FFF1C9',
      fg: '#8A6400',
      earned: p.chain_visits >= 50,
      progress: p.chain_visits >= 50 ? `${p.chain_visits} chain visits` : `${p.chain_visits} of 50 chain visits`,
    },
  ]
}

export function BadgesGrid({ profile }: { profile: ProfileSummary }) {
  const c = useTheme()
  return (
    <>
      <SectionHeader style={{ paddingTop: 24 }}>Badges</SectionHeader>
      <View style={styles.badgeGrid}>
        {badgesFor(profile).map((b) => (
          <View key={b.id} style={styles.badge}>
            <View style={[styles.badgeIcon, { backgroundColor: b.earned ? b.bg : c.bg }]}>
              <Ionicons name={b.icon} size={20} color={b.earned ? b.fg : '#AEAEB2'} />
            </View>
            <View>
              <Text style={[styles.badgeTitle, { color: b.earned ? c.label : c.meta }]}>{b.title}</Text>
              <Text style={[styles.badgeSub, { color: c.meta }]}>{b.progress}</Text>
            </View>
          </View>
        ))}
      </View>
    </>
  )
}

export function PublicListsCarousel({ lists }: { lists: PublicList[] }) {
  const c = useTheme()
  const router = useRouter()
  if (!lists.length) return null
  return (
    <>
      <SectionHeader style={{ paddingTop: 26 }}>Public lists</SectionHeader>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingHorizontal: 16 }}>
        {lists.map((l) => (
          <Pressable key={l.id} style={styles.listCard} onPress={() => router.push(`/list/${l.id}`)}>
            <Mosaic ratings={l.mosaic} size={140} radius={10} />
            <View style={{ paddingHorizontal: 4, paddingBottom: 4 }}>
              <Text style={[styles.listName, { color: c.label }]} numberOfLines={2}>
                {l.name}
              </Text>
              <Text style={[styles.badgeSub, { color: c.meta }]}>
                {l.place_count} place{l.place_count === 1 ? '' : 's'}
              </Text>
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </>
  )
}

export function ReviewsList({ reviews, title = 'Recent reviews' }: { reviews: UserReview[]; title?: string }) {
  const c = useTheme()
  const router = useRouter()
  if (!reviews.length) return null
  return (
    <>
      <SectionHeader style={{ paddingTop: 26 }}>{title}</SectionHeader>
      <View style={styles.reviewsCard}>
        {reviews.map((r, i) => (
          <Pressable
            key={r.id}
            onPress={() => router.push(`/restaurant/${r.restaurant_id}`)}
            style={styles.reviewRow}
          >
            <ScoreBadge rating={r.rating_value} size={44} />
            <View
              style={[
                styles.reviewBody,
                i < reviews.length - 1 ? { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.separator } : null,
              ]}
            >
              <Text style={[styles.listName, { color: c.label, fontSize: 17 }]} numberOfLines={1}>
                {r.restaurant_name}
              </Text>
              <Text style={[styles.reviewText, { color: c.meta }]} numberOfLines={1}>
                “{r.body}”
              </Text>
            </View>
          </Pressable>
        ))}
      </View>
    </>
  )
}

// Percentage ring from rotated segments — no SVG module in this build.
export function Ring({ pct, size = 84, stroke = 8 }: { pct: number; size?: number; stroke?: number }) {
  const c = useTheme()
  const segments = 72
  const filled = Math.round((Math.max(0, Math.min(100, pct)) / 100) * segments)
  const segW = Math.ceil((Math.PI * size) / segments) + 1
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {Array.from({ length: segments }, (_, i) => (
        <View
          key={i}
          style={{
            position: 'absolute',
            width: segW,
            height: size,
            alignItems: 'center',
            transform: [{ rotate: `${(i * 360) / segments}deg` }],
          }}
        >
          <View style={{ width: segW, height: stroke, backgroundColor: i < filled ? c.tint : c.tintSoft }} />
        </View>
      ))}
      <Text style={{ fontSize: 22, fontWeight: '700', letterSpacing: -0.4, color: c.label }}>{Math.round(pct)}%</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 20 },
  name: { fontSize: 24, fontWeight: '700', letterSpacing: -0.4 },
  sub: { fontSize: 15, marginTop: 1 },
  statsCard: {
    marginHorizontal: 16,
    marginTop: 20,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    flexDirection: 'row',
    paddingVertical: 14,
  },
  stat: { flex: 1, alignItems: 'center', gap: 2 },
  statNum: { fontSize: 20, fontWeight: '700' },
  statLabel: { fontSize: 13 },
  tierCard: { marginHorizontal: 16, marginTop: 16, backgroundColor: '#FFFFFF', borderRadius: 18, padding: 18, gap: 12 },
  tierTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tierKicker: { fontSize: 13, fontWeight: '500' },
  tierName: { fontSize: 28, fontWeight: '700', letterSpacing: -0.5 },
  tierCount: { fontSize: 28, fontWeight: '700', letterSpacing: -0.5 },
  track: { height: 8, borderRadius: 4, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 4 },
  tierFoot: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  tierSteps: { fontSize: 13, flexShrink: 1 },
  badgeGrid: { marginHorizontal: 16, flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  badge: { width: '48.5%', flexGrow: 1, flexBasis: '45%', backgroundColor: '#FFFFFF', borderRadius: 16, padding: 14, gap: 10 },
  badgeIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  badgeTitle: { fontSize: 15, fontWeight: '600' },
  badgeSub: { fontSize: 13 },
  listCard: { width: 160, backgroundColor: '#FFFFFF', borderRadius: 14, padding: 10, gap: 8 },
  listName: { fontSize: 15, fontWeight: '600' },
  reviewsCard: { marginHorizontal: 16, backgroundColor: '#FFFFFF', borderRadius: 14, overflow: 'hidden' },
  reviewRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingLeft: 16 },
  reviewBody: { flex: 1, paddingVertical: 12, paddingRight: 16, minWidth: 0 },
  reviewText: { fontSize: 14, marginTop: 2 },
})
