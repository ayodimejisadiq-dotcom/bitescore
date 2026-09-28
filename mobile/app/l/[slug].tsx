import { useEffect, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '@/theme/useTheme'
import { ScoreBadge } from '@/components/ScoreBadge'
import { Avatar, Button, EmptyState, Mosaic } from '@/components/ui'
import { getListBySlug, joinList } from '@/lib/data'
import { errorMessage } from '@/lib/errors'
import { displayName } from '@/lib/people'
import type { ListInvite } from '@/lib/types'

// Where bitescore://l/<slug> lands (the web page at /l/<slug> links here).
// Invited lists offer Join or View only; link lists open read-only.
export default function InviteLanding() {
  const c = useTheme()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { slug } = useLocalSearchParams<{ slug: string }>()
  const [invite, setInvite] = useState<ListInvite | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'missing'>('loading')
  const [busy, setBusy] = useState<'editor' | 'viewer' | null>(null)

  useEffect(() => {
    getListBySlug(slug)
      .then((inv) => {
        if (!inv) return setState('missing')
        // Already on it (or it's yours): skip the invite.
        if (inv.my_role === 'owner' || inv.my_role === 'editor' || inv.my_role === 'viewer') {
          router.replace(`/list/${inv.id}`)
          return
        }
        setInvite(inv)
        setState('ready')
      })
      .catch(() => setState('missing'))
  }, [slug, router])

  const close = () => (router.canGoBack() ? router.back() : router.replace('/lists'))

  const join = async (role: 'editor' | 'viewer') => {
    if (!invite) return
    setBusy(role)
    try {
      const id = await joinList(slug, role)
      router.replace(`/list/${id}`)
    } catch (e) {
      Alert.alert('Couldn’t join', errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  const header = (
    <View style={styles.nav}>
      <Pressable onPress={close} hitSlop={10} style={[styles.close, { backgroundColor: c.bg }]} accessibilityLabel="Close">
        <Ionicons name="close" size={18} color={c.meta} />
      </Pressable>
    </View>
  )

  if (state !== 'ready' || !invite) {
    return (
      <View style={[styles.root, { paddingTop: 12 }]}>
        {header}
        {state === 'loading' ? (
          <ActivityIndicator color={c.meta} style={{ marginTop: 60 }} />
        ) : (
          <EmptyState icon="link-outline" title="This link doesn’t work any more" body="The list may have been made private or deleted." />
        )}
      </View>
    )
  }

  const owner = invite.owner
  const ownerName = owner ? displayName(owner) : 'Someone'
  const invited = invite.access === 'invited'
  const extra = invite.place_count - invite.preview.length

  return (
    <View style={[styles.root, { paddingTop: 12, paddingBottom: insets.bottom + 12 }]}>
      {header}
      <View style={styles.body}>
        <Mosaic ratings={invite.mosaic} size={120} radius={32} gap={4} style={{ boxShadow: '0 14px 30px rgba(0,0,0,0.12)' }} />
        {owner ? (
          <View style={{ marginTop: -18 }}>
            <Avatar person={owner} size={40} ring="#FFFFFF" />
          </View>
        ) : null}
        <Text style={[styles.invitedBy, { color: c.meta }]}>
          {invited
            ? invite.collaborators_can_add
              ? `${ownerName} invited you to add places to`
              : `${ownerName} invited you to`
            : `${ownerName} shared`}
        </Text>
        <Text style={[styles.name, { color: c.label }]}>{invite.name}</Text>
        <Text style={[styles.counts, { color: c.label2 }]}>
          {invite.place_count} place{invite.place_count === 1 ? '' : 's'} · {invite.people_count}{' '}
          {invite.people_count === 1 ? 'person' : 'people'}
        </Text>

        {invite.preview.length ? (
          <View style={[styles.preview, { backgroundColor: c.bg }]}>
            {invite.preview.map((p, i) => (
              <View key={p.id} style={styles.previewRow}>
                <ScoreBadge rating={p.rating_value} size={36} />
                <View
                  style={[
                    styles.previewBody,
                    i < invite.preview.length - 1 ? { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E0E0E5' } : null,
                  ]}
                >
                  <Text style={[styles.previewName, { color: c.label }]} numberOfLines={1}>
                    {p.name}
                  </Text>
                  {i === invite.preview.length - 1 && extra > 0 ? (
                    <Text style={{ color: c.meta, fontSize: 14 }}>+{extra}</Text>
                  ) : null}
                </View>
              </View>
            ))}
          </View>
        ) : null}
      </View>

      <View style={styles.footer}>
        {invited ? (
          <>
            <Button label="Join list" onPress={() => join('editor')} loading={busy === 'editor'} />
            <Button label="View only" variant="plain" size="medium" onPress={() => join('viewer')} loading={busy === 'viewer'} />
          </>
        ) : (
          <>
            <Button label="Open list" onPress={() => router.replace(`/list/${invite.id}`)} />
            <Button label="Keep in my lists" variant="plain" size="medium" onPress={() => join('viewer')} loading={busy === 'viewer'} />
          </>
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFFFFF' },
  nav: { height: 44, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', paddingHorizontal: 16 },
  close: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, alignItems: 'center', paddingHorizontal: 28, paddingTop: 24 },
  invitedBy: { fontSize: 15, marginTop: 14, textAlign: 'center' },
  name: { fontSize: 30, fontWeight: '700', letterSpacing: -0.5, marginTop: 4, textAlign: 'center' },
  counts: { fontSize: 15, marginTop: 6 },
  preview: { alignSelf: 'stretch', marginTop: 28, borderRadius: 16, paddingVertical: 4 },
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: 14 },
  previewBody: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingRight: 14 },
  previewName: { flex: 1, fontSize: 16, fontWeight: '500' },
  footer: { paddingHorizontal: 20, gap: 6 },
})
