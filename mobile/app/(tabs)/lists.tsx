import { useCallback, useState } from 'react'
import {
  View,
  Text,
  TextInput,
  Pressable,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Modal,
  KeyboardAvoidingView,
  Platform,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useRouter, useFocusEffect } from 'expo-router'
import { useTheme } from '@/theme/useTheme'
import { fonts } from '@/theme/type'
import { useSession } from '@/hooks/useSession'
import { ensureSession } from '@/lib/auth'
import { ScoreBadge } from '@/components/ScoreBadge'
import { BadgeFan } from '@/components/BadgeFan'
import { EdgeButton, tileEdge } from '@/components/ui'
import { fetchMyLists, createList, renameList, deleteList } from '@/lib/data'
import { isNumericRating } from '@/lib/fsa'
import { errorMessage } from '@/lib/errors'
import type { ListWithItems } from '@/lib/types'

const SUGGESTED_NAMES = ['Friday takeaway', 'Date night', 'Coffee runs']

// Sorted mini score tiles for a list card; overflow collapses into "+N".
function ScoreMixStrip({ list, c }: { list: ListWithItems; c: ReturnType<typeof useTheme> }) {
  const ratings = list.items
    .map((r) => r.rating_value)
    .sort((a, b) => {
      const av = isNumericRating(a) ? Number(a) : -1
      const bv = isNumericRating(b) ? Number(b) : -1
      return bv - av
    })
  if (ratings.length === 0) return null
  const shown = ratings.slice(0, 5)
  const extra = ratings.length - shown.length
  return (
    <View style={styles.mixStrip}>
      {shown.map((r, i) => (
        <ScoreBadge key={i} rating={r} size={30} edge={false} />
      ))}
      {extra > 0 ? (
        <View style={[styles.mixMore, { backgroundColor: c.subtleFill }]}>
          <Text style={[styles.mixMoreText, { color: c.mutedOnCard }]}>+{extra}</Text>
        </View>
      ) : null}
    </View>
  )
}

export default function ListsScreen() {
  const c = useTheme()
  const router = useRouter()
  const { session, loading: sessionLoading } = useSession()
  const [lists, setLists] = useState<ListWithItems[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  // null = closed. Editing an existing list carries its id/name to prefill.
  const [editing, setEditing] = useState<{ id: string | null; name: string } | null>(null)

  const load = useCallback(async () => {
    if (!session) return
    setLoading(true)
    setError(null)
    try {
      setLists(await fetchMyLists())
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setLoading(false)
    }
  }, [session])

  // Refetch every time this tab gains focus, so a save made from the detail
  // screen shows up immediately.
  useFocusEffect(
    useCallback(() => {
      load()
    }, [load]),
  )

  const createNamed = async (name: string) => {
    try {
      await createList(name)
      load()
    } catch (e) {
      Alert.alert('Couldn’t create list', errorMessage(e))
    }
  }

  const onSaveEdit = async () => {
    if (!editing || !editing.name.trim()) return
    try {
      if (editing.id) {
        await renameList(editing.id, editing.name)
      } else {
        await createList(editing.name)
      }
      setEditing(null)
      load()
    } catch (e) {
      Alert.alert(editing.id ? 'Couldn’t rename' : 'Couldn’t create list', errorMessage(e))
    }
  }

  const onDelete = (list: ListWithItems) => {
    Alert.alert('Delete this list?', `“${list.name}” and its saved places will be removed.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteList(list.id)
            load()
          } catch (e) {
            Alert.alert('Couldn’t delete', errorMessage(e))
          }
        },
      },
    ])
  }

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const savedCount = lists.reduce((n, l) => n + l.items.length, 0)
  const numericScores = lists.flatMap((l) =>
    l.items.filter((r) => isNumericRating(r.rating_value)).map((r) => Number(r.rating_value)),
  )
  const avgScore = numericScores.length
    ? (numericScores.reduce((a, b) => a + b, 0) / numericScores.length).toFixed(1)
    : null

  if (sessionLoading) {
    return (
      <View style={[styles.center, { backgroundColor: c.bg }]}>
        <ActivityIndicator color={c.primary} />
      </View>
    )
  }

  const header = (
    <View style={styles.headRow}>
      <Text style={[styles.title, { color: c.text }]}>My lists</Text>
      <EdgeButton
        color={c.primary}
        edgeColor={c.primaryDark}
        radius={15}
        onPress={() => setEditing({ id: null, name: '' })}
        style={styles.fab}
      >
        <Ionicons name="add" size={26} color="#fff" />
      </EdgeButton>
    </View>
  )

  if (!session) {
    // Normally unreachable — the app signs in anonymously at launch. Only
    // shows if that failed (e.g. no network on first open).
    return (
      <SafeAreaView edges={['top']} style={[styles.root, { backgroundColor: c.bg }]}>
        {header}
        <View style={styles.center}>
          <BadgeFan />
          <Text style={[styles.h, { color: c.text }]}>Couldn’t connect</Text>
          <Text style={[styles.p, { color: c.subtext }]}>Check your connection and try again.</Text>
          <EdgeButton
            color={c.primary}
            edgeColor={c.primaryDark}
            radius={15}
            onPress={() => ensureSession()}
            style={styles.retryBtn}
          >
            <Text style={styles.btnText}>Retry</Text>
          </EdgeButton>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView edges={['top']} style={[styles.root, { backgroundColor: c.bg }]}>
      {header}

      {error ? (
        <View style={styles.center}>
          <Text style={[styles.h, { color: c.text }]}>Couldn't load your lists</Text>
          <Text style={[styles.p, { color: c.subtext }]}>{error}</Text>
        </View>
      ) : loading ? (
        <ActivityIndicator style={{ marginTop: 24 }} color={c.primary} />
      ) : lists.length === 0 ? (
        <View style={styles.emptyWrap}>
          <BadgeFan />
          <Text style={[styles.emptyTitle, { color: c.text }]}>Start your first list</Text>
          <Text style={[styles.emptyBody, { color: c.subtext }]}>
            Keep the places you actually eat at in one spot, and we'll tell you if a score
            changes.
          </Text>
          <View style={styles.suggestRow}>
            {SUGGESTED_NAMES.map((name) => (
              <Pressable
                key={name}
                onPress={() => createNamed(name)}
                style={[styles.suggestPill, { backgroundColor: c.card, borderColor: c.controlBorder }]}
              >
                <Text style={[styles.suggestText, { color: c.chipText }]}>{name}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : (
        <FlatList
          data={lists}
          keyExtractor={(l) => l.id}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}
          ListHeaderComponent={
            <View style={styles.statRow}>
              <View style={[styles.statCard, { backgroundColor: c.text }]}>
                <Text style={styles.statNumDark}>{savedCount}</Text>
                <Text style={[styles.statLabel, { color: c.onDarkMuted }]}>places saved</Text>
              </View>
              <View style={[styles.statCard, { backgroundColor: c.accent }, tileEdge(c.accentDark)]}>
                <Text style={styles.statNumDark}>{avgScore ?? '–'}</Text>
                <Text style={[styles.statLabel, { color: 'rgba(255,255,255,0.85)' }]}>
                  average score
                </Text>
              </View>
            </View>
          }
          ListFooterComponent={
            <Pressable
              onPress={() => setEditing({ id: null, name: '' })}
              style={[styles.newSlot, { borderColor: c.dashedBorder }]}
            >
              <View style={[styles.newSlotTile, { backgroundColor: c.lockedFill }]}>
                <Ionicons name="add" size={20} color={c.placeholder} />
              </View>
              <Text style={[styles.newSlotText, { color: c.mutedOnCard }]}>New list</Text>
            </Pressable>
          }
          renderItem={({ item }) => {
            const isOpen = expanded.has(item.id)
            return (
              <Pressable
                onPress={() => toggleExpanded(item.id)}
                onLongPress={() =>
                  Alert.alert(item.name, undefined, [
                    { text: 'Rename', onPress: () => setEditing({ id: item.id, name: item.name }) },
                    { text: 'Delete', style: 'destructive', onPress: () => onDelete(item) },
                    { text: 'Cancel', style: 'cancel' },
                  ])
                }
                style={[styles.listCard, { backgroundColor: c.card, borderColor: c.rowBorder }]}
              >
                <View style={styles.listHead}>
                  <Text style={[styles.listName, { color: c.text }]}>{item.name}</Text>
                  <Ionicons name={isOpen ? 'chevron-up' : 'chevron-forward'} size={18} color={c.disabled} />
                </View>
                <Text style={[styles.listSub, { color: c.mutedOnCard }]}>
                  {item.items.length === 0
                    ? 'No places saved yet'
                    : `${item.items.length} place${item.items.length === 1 ? '' : 's'}`}
                </Text>
                <ScoreMixStrip list={item} c={c} />
                {isOpen
                  ? item.items.map((r) => (
                      <Pressable
                        key={r.id}
                        style={[styles.item, { borderTopColor: c.rowBorder }]}
                        onPress={() => router.push(`/restaurant/${r.id}`)}
                      >
                        <ScoreBadge rating={r.rating_value} size={34} edge={false} />
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={[styles.itemName, { color: c.text }]} numberOfLines={1}>
                            {r.name}
                          </Text>
                          {r.address ? (
                            <Text style={[styles.itemSub, { color: c.mutedOnCard }]} numberOfLines={1}>
                              {r.address}
                            </Text>
                          ) : null}
                        </View>
                        <Ionicons name="chevron-forward" size={15} color={c.disabled} />
                      </Pressable>
                    ))
                  : null}
              </Pressable>
            )
          }}
        />
      )}

      <Modal visible={editing !== null} transparent animationType="fade" onRequestClose={() => setEditing(null)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.backdrop}
        >
          <View style={[styles.modalCard, { backgroundColor: c.card }]}>
            <Text style={[styles.modalTitle, { color: c.text }]}>
              {editing?.id ? 'Rename your list' : 'Name your list'}
            </Text>
            <Text style={[styles.modalSub, { color: c.mutedOnCard }]}>
              You can rename it any time.
            </Text>
            <TextInput
              value={editing?.name ?? ''}
              onChangeText={(name) => setEditing((prev) => (prev ? { ...prev, name } : prev))}
              placeholder="e.g. Friday takeaway"
              placeholderTextColor={c.disabled}
              autoFocus
              style={[styles.input, { backgroundColor: '#FFFFFF', color: c.text, borderColor: c.primary }]}
              onSubmitEditing={onSaveEdit}
              returnKeyType="done"
            />
            <View style={styles.modalRow}>
              <Pressable
                onPress={() => setEditing(null)}
                style={[styles.modalBtn, { flex: 1, backgroundColor: c.subtleFill }]}
              >
                <Text style={[styles.modalBtnText, { color: c.inkSecondary }]}>Cancel</Text>
              </Pressable>
              <EdgeButton
                color={c.primary}
                edgeColor={c.primaryDark}
                edge={4}
                radius={16}
                disabled={!editing?.name.trim()}
                onPress={onSaveEdit}
                containerStyle={{ flex: 1.4 }}
                style={styles.modalBtn}
              >
                <Text style={[styles.modalBtnText, { color: '#fff' }]}>
                  {editing?.id ? 'Save' : 'Create list'}
                </Text>
              </EdgeButton>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 40 },
  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  title: { fontSize: 32, fontFamily: fonts.display800, letterSpacing: -0.6 },
  fab: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  h: { fontSize: 24, fontFamily: fonts.display800, marginTop: 6 },
  p: { fontSize: 14, fontFamily: fonts.body, textAlign: 'center', lineHeight: 20 },
  retryBtn: { marginTop: 14, paddingHorizontal: 24, paddingVertical: 13 },
  btnText: { color: '#fff', fontFamily: fonts.display600, fontSize: 16 },
  statRow: { flexDirection: 'row', gap: 9, marginBottom: 16 },
  statCard: { flex: 1, borderRadius: 18, paddingVertical: 12, paddingHorizontal: 13 },
  statNumDark: { color: '#fff', fontSize: 26, fontFamily: fonts.display800, lineHeight: 30 },
  statLabel: { fontSize: 12, fontFamily: fonts.body, marginTop: 2 },
  listCard: {
    borderRadius: 20,
    borderWidth: 1.5,
    padding: 15,
    marginBottom: 11,
  },
  listHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  listName: { fontSize: 19, fontFamily: fonts.display600 },
  listSub: { fontSize: 13, fontFamily: fonts.body, marginTop: 3 },
  mixStrip: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 12 },
  mixMore: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mixMoreText: { fontSize: 13, fontFamily: fonts.display600 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingVertical: 10,
    marginTop: 10,
    borderTopWidth: 1.5,
    paddingTop: 12,
  },
  itemName: { fontSize: 15, fontFamily: fonts.display600 },
  itemSub: { fontSize: 12.5, fontFamily: fonts.body, marginTop: 1 },
  newSlot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    borderRadius: 20,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    padding: 15,
  },
  newSlotTile: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  newSlotText: { fontSize: 16, fontFamily: fonts.display600 },
  emptyWrap: { alignItems: 'center', paddingHorizontal: 32, marginTop: 90 },
  emptyTitle: { fontSize: 24, fontFamily: fonts.display800 },
  emptyBody: {
    fontSize: 15,
    fontFamily: fonts.body,
    lineHeight: 23,
    textAlign: 'center',
    marginTop: 8,
    maxWidth: 300,
  },
  suggestRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    marginTop: 18,
  },
  suggestPill: {
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1.5,
  },
  suggestText: { fontSize: 14, fontFamily: fonts.display600 },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(23,23,15,0.36)',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    borderRadius: 24,
    padding: 20,
    boxShadow: '0 22px 50px rgba(23,23,15,0.34)',
  },
  modalTitle: { fontSize: 21, fontFamily: fonts.display800 },
  modalSub: { fontSize: 13.5, fontFamily: fonts.body, marginTop: 3 },
  input: {
    marginTop: 14,
    height: 52,
    borderRadius: 16,
    borderWidth: 2,
    paddingHorizontal: 15,
    fontSize: 16.5,
    fontFamily: fonts.body,
  },
  modalRow: { flexDirection: 'row', gap: 10, marginTop: 16 },
  modalBtn: {
    height: 50,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBtnText: { fontSize: 16, fontFamily: fonts.display600 },
})
