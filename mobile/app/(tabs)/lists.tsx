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
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useRouter, useFocusEffect } from 'expo-router'
import { useTheme } from '@/theme/useTheme'
import { useSession } from '@/hooks/useSession'
import { ScoreBadge } from '@/components/ScoreBadge'
import { fetchMyLists, createList, renameList, deleteList } from '@/lib/data'
import type { ListWithItems } from '@/lib/types'

export default function ListsScreen() {
  const c = useTheme()
  const router = useRouter()
  const { session, loading: sessionLoading } = useSession()
  const [lists, setLists] = useState<ListWithItems[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // null = closed. Editing an existing list carries its id/name to prefill.
  const [editing, setEditing] = useState<{ id: string | null; name: string } | null>(null)

  const load = useCallback(async () => {
    if (!session) return
    setLoading(true)
    setError(null)
    try {
      setLists(await fetchMyLists())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
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
      Alert.alert(editing.id ? 'Couldn’t rename' : 'Couldn’t create list', e instanceof Error ? e.message : String(e))
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
            Alert.alert('Couldn’t delete', e instanceof Error ? e.message : String(e))
          }
        },
      },
    ])
  }

  if (sessionLoading) {
    return (
      <View style={[styles.center, { backgroundColor: c.bg }]}>
        <ActivityIndicator color={c.primary} />
      </View>
    )
  }

  if (!session) {
    return (
      <SafeAreaView edges={['top']} style={[styles.root, { backgroundColor: c.bg }]}>
        <View style={styles.head}>
          <Text style={[styles.title, { color: c.text }]}>My Lists</Text>
        </View>
        <View style={styles.center}>
          <Ionicons name="bookmark-outline" size={40} color={c.subtext} />
          <Text style={[styles.h, { color: c.text }]}>Sign in to save places</Text>
          <Text style={[styles.p, { color: c.subtext }]}>
            Create lists like “Date night” or “Want to try”,{'\n'}and get alerted when a score changes.
          </Text>
          <Pressable
            onPress={() => router.push('/account')}
            style={[styles.signInBtn, { backgroundColor: c.primary }]}
          >
            <Text style={styles.signInBtnText}>Go to Account</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView edges={['top']} style={[styles.root, { backgroundColor: c.bg }]}>
      <View style={styles.headRow}>
        <Text style={[styles.title, { color: c.text }]}>My Lists</Text>
        <Pressable onPress={() => setEditing({ id: null, name: '' })} hitSlop={10}>
          <Ionicons name="add-circle" size={30} color={c.primary} />
        </Pressable>
      </View>

      {error ? (
        <View style={styles.center}>
          <Text style={[styles.h, { color: c.text }]}>Couldn't load your lists</Text>
          <Text style={[styles.p, { color: c.subtext }]}>{error}</Text>
        </View>
      ) : loading ? (
        <ActivityIndicator style={{ marginTop: 24 }} color={c.primary} />
      ) : lists.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="bookmark-outline" size={40} color={c.subtext} />
          <Text style={[styles.h, { color: c.text }]}>No lists yet</Text>
          <Text style={[styles.p, { color: c.subtext }]}>Tap + to create your first one.</Text>
        </View>
      ) : (
        <FlatList
          data={lists}
          keyExtractor={(l) => l.id}
          contentContainerStyle={{ paddingBottom: 40 }}
          renderItem={({ item }) => (
            <View style={[styles.listCard, { backgroundColor: c.card, borderColor: c.border }]}>
              <View style={styles.listHead}>
                <Text style={[styles.listName, { color: c.text }]}>{item.name}</Text>
                <View style={{ flexDirection: 'row', gap: 16 }}>
                  <Pressable onPress={() => setEditing({ id: item.id, name: item.name })} hitSlop={8}>
                    <Ionicons name="pencil" size={16} color={c.subtext} />
                  </Pressable>
                  <Pressable onPress={() => onDelete(item)} hitSlop={8}>
                    <Ionicons name="trash-outline" size={16} color={c.subtext} />
                  </Pressable>
                </View>
              </View>
              {item.items.length === 0 ? (
                <Text style={[styles.emptyList, { color: c.subtext }]}>No places saved yet.</Text>
              ) : (
                item.items.map((r) => (
                  <Pressable
                    key={r.id}
                    style={[styles.item, { borderTopColor: c.border }]}
                    onPress={() => router.push(`/restaurant/${r.id}`)}
                  >
                    <ScoreBadge rating={r.rating_value} size={34} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={[styles.itemName, { color: c.text }]} numberOfLines={1}>
                        {r.name}
                      </Text>
                      {r.address ? (
                        <Text style={[styles.itemSub, { color: c.subtext }]} numberOfLines={1}>
                          {r.address}
                        </Text>
                      ) : null}
                    </View>
                  </Pressable>
                ))
              )}
            </View>
          )}
        />
      )}

      <Modal visible={editing !== null} transparent animationType="fade" onRequestClose={() => setEditing(null)}>
        <View style={styles.backdrop}>
          <View style={[styles.modalCard, { backgroundColor: c.card }]}>
            <Text style={[styles.modalTitle, { color: c.text }]}>
              {editing?.id ? 'Rename list' : 'New list'}
            </Text>
            <TextInput
              value={editing?.name ?? ''}
              onChangeText={(name) => setEditing((prev) => (prev ? { ...prev, name } : prev))}
              placeholder="e.g. Date night"
              placeholderTextColor={c.subtext}
              autoFocus
              style={[styles.input, { backgroundColor: c.bg, color: c.text, borderColor: c.border }]}
              onSubmitEditing={onSaveEdit}
            />
            <View style={styles.modalRow}>
              <Pressable onPress={() => setEditing(null)} style={styles.modalBtn}>
                <Text style={{ color: c.subtext, fontSize: 15 }}>Cancel</Text>
              </Pressable>
              <Pressable onPress={onSaveEdit} style={styles.modalBtn} disabled={!editing?.name.trim()}>
                <Text style={{ color: c.primary, fontSize: 15, fontWeight: '700' }}>
                  {editing?.id ? 'Save' : 'Create'}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 40 },
  head: { paddingHorizontal: 20, paddingTop: 8 },
  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 4,
  },
  title: { fontSize: 30, fontWeight: '800', letterSpacing: -0.5 },
  h: { fontSize: 17, fontWeight: '700', marginTop: 6 },
  p: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
  signInBtn: { marginTop: 14, paddingHorizontal: 22, paddingVertical: 12, borderRadius: 14 },
  signInBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  listCard: {
    marginHorizontal: 16,
    marginTop: 14,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  listHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 15,
    paddingVertical: 13,
  },
  listName: { fontSize: 16, fontWeight: '700' },
  emptyList: { fontSize: 13, paddingHorizontal: 15, paddingBottom: 13 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingHorizontal: 15,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  itemName: { fontSize: 14, fontWeight: '600' },
  itemSub: { fontSize: 12, marginTop: 1 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' },
  modalCard: { width: '85%', borderRadius: 16, padding: 18, gap: 14 },
  modalTitle: { fontSize: 17, fontWeight: '700' },
  input: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 16,
  },
  modalRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 20 },
  modalBtn: { paddingVertical: 6, paddingHorizontal: 4 },
})
