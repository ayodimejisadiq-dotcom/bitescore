import { useCallback, useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { useTheme } from '@/theme/useTheme'
import { Avatar, NavBar, SearchField, Segmented } from '@/components/ui'
import { currentUserId, follow, getFollowList, getProfileSummary, unfollow } from '@/lib/data'
import { displayName, handle } from '@/lib/people'
import type { FollowRow, ProfileSummary } from '@/lib/types'

type Tab = 'followers' | 'following'

export default function FollowsScreen() {
  const c = useTheme()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const params = useLocalSearchParams<{ id: string; tab?: string }>()
  const id = params.id
  const [tab, setTab] = useState<Tab>(params.tab === 'following' ? 'following' : 'followers')
  const [profile, setProfile] = useState<ProfileSummary | null>(null)
  const [me, setMe] = useState<string | null>(null)
  const [rows, setRows] = useState<Record<Tab, FollowRow[] | null>>({ followers: null, following: null })
  const [query, setQuery] = useState('')

  const load = useCallback(async () => {
    const [p, uid, followers, following] = await Promise.all([
      getProfileSummary(id),
      currentUserId(),
      getFollowList(id, 'followers'),
      getFollowList(id, 'following'),
    ]).catch(() => [null, null, [], []] as const)
    setProfile(p)
    setMe(uid)
    setRows({ followers: [...followers], following: [...following] })
  }, [id])

  useFocusEffect(
    useCallback(() => {
      load()
    }, [load]),
  )

  const list = rows[tab]
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (list ?? []).filter(
      (r) => !q || (r.username ?? '').toLowerCase().includes(q) || (r.public_name ?? '').toLowerCase().includes(q),
    )
  }, [list, query])

  const isMe = me === id

  const toggle = async (row: FollowRow) => {
    const next = !row.i_follow
    const patch = (arr: FollowRow[] | null) =>
      arr?.map((r) => (r.user_id === row.user_id ? { ...r, i_follow: next } : r)) ?? null
    setRows((s) => ({ followers: patch(s.followers), following: patch(s.following) }))
    // On your own lists, the Following count moves with you.
    if (isMe && profile) setProfile({ ...profile, following: profile.following + (next ? 1 : -1) })
    try {
      next ? await follow(row.user_id) : await unfollow(row.user_id)
    } catch {
      load()
    }
  }

  return (
    <SafeAreaView edges={['top']} style={[styles.root, { backgroundColor: c.bg }]}>
      <NavBar backLabel={isMe ? 'Profile' : 'Back'} title={profile ? displayName(profile) : undefined} />
      <View style={{ marginHorizontal: 16, marginTop: 8, marginBottom: 12 }}>
        <Segmented
          value={tab}
          onChange={(k) => setTab(k as Tab)}
          options={[
            { key: 'followers', label: `${profile?.followers ?? ''} Followers` },
            { key: 'following', label: `${profile?.following ?? ''} Following` },
          ]}
        />
      </View>
      <SearchField value={query} onChangeText={setQuery} placeholder="Search" autoCapitalize="none" style={{ marginHorizontal: 16, marginBottom: 16 }} />

      {list === null ? (
        <ActivityIndicator color={c.meta} style={{ marginTop: 30 }} />
      ) : filtered.length === 0 ? (
        <Text style={[styles.empty, { color: c.meta }]}>
          {query ? 'No one matches that.' : tab === 'followers' ? 'No followers yet.' : 'Not following anyone yet.'}
        </Text>
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 30 }} keyboardShouldPersistTaps="handled">
          <View style={styles.card}>
            {filtered.map((r, i) => {
              const sub = handle(r) + (tab === 'following' && r.follows_me && isMe ? ' · Follows you' : '')
              const label = r.i_follow ? 'Following' : r.follows_me ? 'Follow back' : 'Follow'
              return (
                <Pressable key={r.user_id} style={styles.row} onPress={() => router.push(`/user/${r.user_id}`)}>
                  <Avatar person={r} size={44} />
                  <View
                    style={[
                      styles.rowBody,
                      i < filtered.length - 1 ? { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.separator } : null,
                    ]}
                  >
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={[styles.name, { color: c.label }]} numberOfLines={1}>
                        {displayName(r)}
                      </Text>
                      {r.public_name ? <Text style={[styles.sub, { color: c.meta }]}>{sub}</Text> : null}
                    </View>
                    {r.user_id !== me ? (
                      <Pressable
                        onPress={() => toggle(r)}
                        style={[styles.btn, { backgroundColor: r.i_follow ? c.bg : c.tint }]}
                      >
                        <Text style={[styles.btnText, { color: r.i_follow ? c.label : '#FFFFFF' }]}>{label}</Text>
                      </Pressable>
                    ) : null}
                  </View>
                </Pressable>
              )
            })}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  card: { marginHorizontal: 16, backgroundColor: '#FFFFFF', borderRadius: 14, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: 16 },
  rowBody: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingRight: 16, minWidth: 0 },
  name: { fontSize: 16, fontWeight: '600' },
  sub: { fontSize: 14 },
  btn: { minWidth: 96, height: 32, borderRadius: 16, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' },
  btnText: { fontSize: 14, fontWeight: '600' },
  empty: { fontSize: 15, textAlign: 'center', marginTop: 30 },
})
