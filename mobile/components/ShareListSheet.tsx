import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '@/theme/useTheme'
import { Avatar, GroupedCard, RowIcon, SectionFooter, SectionHeader } from './ui'
import {
  getFollowList,
  inviteToList,
  removeListMember,
  shareUrl,
  updateListSharing,
} from '@/lib/data'
import { errorMessage } from '@/lib/errors'
import { displayName } from '@/lib/people'
import type { FollowRow, ListAccess, ListPerson } from '@/lib/types'

const ACCESS: { key: ListAccess; title: string; sub: string; icon: 'lock-closed' | 'people' | 'link'; color: string }[] = [
  { key: 'private', title: 'Private', sub: 'Only you', icon: 'lock-closed', color: '#8E8E93' },
  { key: 'invited', title: 'Invited people', sub: 'Only people you add', icon: 'people', color: '#0A84FF' },
  { key: 'link', title: 'Anyone with the link', sub: 'Can view, no sign-in needed', icon: 'link', color: '#047B42' },
]

export interface SharingState {
  access: ListAccess
  share_slug: string | null
  collaborators_can_add: boolean
}

// Owner-only sheet: who can open the list, its link, whether invited people
// can add places, and who's on it.
export function ShareListSheet({
  visible,
  listId,
  listName,
  me,
  sharing,
  people,
  onChange,
  onClose,
}: {
  visible: boolean
  listId: string
  listName: string
  me: string
  sharing: SharingState
  people: ListPerson[]
  onChange: () => void
  onClose: () => void
}) {
  const c = useTheme()
  const [state, setState] = useState(sharing)
  const [busy, setBusy] = useState(false)
  const [picking, setPicking] = useState(false)

  useEffect(() => {
    if (visible) setState(sharing)
  }, [visible, sharing])

  const apply = async (patch: Partial<SharingState>) => {
    const prev = state
    setState({ ...state, ...patch })
    setBusy(true)
    try {
      const next = await updateListSharing(listId, patch)
      setState(next)
      onChange()
    } catch (e) {
      setState(prev)
      Alert.alert('Couldn’t update sharing', errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const members = people.filter((p) => p.role !== 'owner')
  const roleLabel = (p: ListPerson) =>
    p.role === 'editor' && state.collaborators_can_add ? 'Can add' : 'Can view'
  const link = state.share_slug ? shareUrl(state.share_slug) : null

  const onRemove = (p: ListPerson) => {
    Alert.alert(`Remove ${displayName(p)}?`, 'They won’t see this list any more.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await removeListMember(listId, p.user_id)
            onChange()
          } catch (e) {
            Alert.alert('Couldn’t remove', errorMessage(e))
          }
        },
      },
    ])
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: c.bg }}>
        <View style={styles.nav}>
          <View style={{ width: 50 }}>{busy ? <ActivityIndicator size="small" color={c.meta} /> : null}</View>
          <Text style={[styles.title, { color: c.label }]} numberOfLines={1}>
            Share “{listName}”
          </Text>
          <Pressable onPress={onClose} hitSlop={10} style={{ width: 50, alignItems: 'flex-end' }}>
            <Text style={[styles.done, { color: c.tint }]}>Done</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={{ paddingTop: 12, paddingBottom: 40 }}>
          <SectionHeader>Who can open this list</SectionHeader>
          <GroupedCard inset={60}>
            {ACCESS.map((a) => (
              <Pressable
                key={a.key}
                style={styles.radio}
                onPress={() => a.key !== state.access && apply({ access: a.key })}
                accessibilityRole="radio"
                accessibilityState={{ checked: state.access === a.key }}
              >
                <RowIcon icon={a.icon} color={a.color} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.radioTitle, { color: c.label }]}>{a.title}</Text>
                  <Text style={[styles.radioSub, { color: c.meta }]}>{a.sub}</Text>
                </View>
                {state.access === a.key ? <Ionicons name="checkmark" size={20} color={c.tint} /> : null}
              </Pressable>
            ))}
          </GroupedCard>

          {state.access === 'private' ? (
            <SectionFooter>Private lists have no link and never appear on your profile.</SectionFooter>
          ) : (
            <>
              <View style={styles.linkCard}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[styles.linkLabel, { color: c.meta }]}>List link</Text>
                  <Text style={[styles.link, { color: c.label }]} numberOfLines={1}>
                    {link ? link.replace(/^https?:\/\//, '') : 'Creating link…'}
                  </Text>
                </View>
                <Pressable
                  disabled={!link}
                  onPress={() => link && Share.share({ message: `${listName} on Bitescore: ${link}`, url: link })}
                  style={[styles.pill, { backgroundColor: c.tintSoft }]}
                >
                  <Text style={[styles.pillText, { color: c.tint }]}>Share</Text>
                </Pressable>
              </View>

              <View style={styles.switchRow}>
                <Text style={[styles.switchText, { color: c.label }]}>Invited people can add places</Text>
                <Switch
                  value={state.collaborators_can_add}
                  onValueChange={(v) => apply({ collaborators_can_add: v })}
                  trackColor={{ true: c.switchOn, false: c.separator }}
                  thumbColor="#FFFFFF"
                />
              </View>

              <SectionHeader style={{ paddingTop: 24 }}>People</SectionHeader>
              <GroupedCard inset={62}>
                <View style={styles.person}>
                  <Avatar person={people.find((p) => p.role === 'owner') ?? { user_id: me }} size={34} />
                  <Text style={[styles.personName, { color: c.label }]}>You</Text>
                  <Text style={[styles.role, { color: c.meta }]}>Owner</Text>
                </View>
                {members.map((p) => (
                  <Pressable key={p.user_id} style={styles.person} onPress={() => onRemove(p)}>
                    <Avatar person={p} size={34} />
                    <Text style={[styles.personName, { color: c.label }]} numberOfLines={1}>
                      {displayName(p)}
                    </Text>
                    <Text style={[styles.role, { color: c.meta }]}>{roleLabel(p)}</Text>
                  </Pressable>
                ))}
                <Pressable style={styles.person} onPress={() => setPicking(true)}>
                  <View style={[styles.plus, { backgroundColor: c.bg }]}>
                    <Ionicons name="add" size={20} color={c.tint} />
                  </View>
                  <Text style={[styles.personName, { color: c.tint }]}>Invite people you follow</Text>
                </Pressable>
              </GroupedCard>
              <SectionFooter>Anyone with the link can also join. Tap someone to remove them.</SectionFooter>
            </>
          )}
        </ScrollView>
      </View>

      <InvitePicker
        visible={picking}
        me={me}
        exclude={new Set(people.map((p) => p.user_id))}
        onInvite={async (userId) => {
          await inviteToList(listId, userId)
          onChange()
        }}
        onClose={() => setPicking(false)}
      />
    </Modal>
  )
}

function InvitePicker({
  visible,
  me,
  exclude,
  onInvite,
  onClose,
}: {
  visible: boolean
  me: string
  exclude: Set<string>
  onInvite: (userId: string) => Promise<void>
  onClose: () => void
}) {
  const c = useTheme()
  const [rows, setRows] = useState<FollowRow[] | null>(null)
  const [invited, setInvited] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!visible) return
    setRows(null)
    setInvited(new Set())
    getFollowList(me, 'following').then(setRows).catch(() => setRows([]))
  }, [visible, me])

  const candidates = (rows ?? []).filter((r) => !exclude.has(r.user_id))

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: c.bg }}>
        <View style={styles.nav}>
          <View style={{ width: 50 }} />
          <Text style={[styles.title, { color: c.label }]}>Invite</Text>
          <Pressable onPress={onClose} hitSlop={10} style={{ width: 50, alignItems: 'flex-end' }}>
            <Text style={[styles.done, { color: c.tint }]}>Done</Text>
          </Pressable>
        </View>
        {rows === null ? (
          <ActivityIndicator color={c.meta} style={{ marginTop: 30 }} />
        ) : candidates.length === 0 ? (
          <Text style={[styles.empty, { color: c.meta }]}>
            {rows.length === 0
              ? 'Follow people to invite them here. Tap a reviewer’s name on any place to see their profile.'
              : 'Everyone you follow is already on this list.'}
          </Text>
        ) : (
          <ScrollView contentContainerStyle={{ paddingTop: 12 }}>
            <GroupedCard inset={72}>
              {candidates.map((p) => {
                const done = invited.has(p.user_id)
                return (
                  <View key={p.user_id} style={styles.person}>
                    <Avatar person={p} size={44} />
                    <Text style={[styles.personName, { color: c.label }]} numberOfLines={1}>
                      {displayName(p)}
                    </Text>
                    <Pressable
                      disabled={done}
                      onPress={async () => {
                        setInvited((s) => new Set(s).add(p.user_id))
                        try {
                          await onInvite(p.user_id)
                        } catch (e) {
                          setInvited((s) => {
                            const n = new Set(s)
                            n.delete(p.user_id)
                            return n
                          })
                          Alert.alert('Couldn’t invite', errorMessage(e))
                        }
                      }}
                      style={[styles.inviteBtn, { backgroundColor: done ? c.bg : c.tint }]}
                    >
                      <Text style={{ color: done ? c.label : '#fff', fontSize: 14, fontWeight: '600' }}>
                        {done ? 'Added' : 'Add'}
                      </Text>
                    </Pressable>
                  </View>
                )
              })}
            </GroupedCard>
          </ScrollView>
        )}
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  nav: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  title: { flex: 1, fontSize: 17, fontWeight: '600', textAlign: 'center' },
  done: { fontSize: 17, fontWeight: '600' },
  radio: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 10 },
  radioTitle: { fontSize: 17 },
  radioSub: { fontSize: 13 },
  linkCard: {
    marginTop: 24,
    marginHorizontal: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingLeft: 16,
    paddingRight: 12,
  },
  linkLabel: { fontSize: 13 },
  link: { fontSize: 16 },
  pill: { height: 34, paddingHorizontal: 16, borderRadius: 17, justifyContent: 'center' },
  pillText: { fontSize: 15, fontWeight: '600' },
  switchRow: {
    marginTop: 12,
    marginHorizontal: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  switchText: { flex: 1, fontSize: 17 },
  person: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
  personName: { flex: 1, fontSize: 17 },
  role: { fontSize: 15 },
  plus: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  inviteBtn: { minWidth: 80, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  empty: { fontSize: 15, lineHeight: 21, textAlign: 'center', paddingHorizontal: 40, marginTop: 40 },
})
