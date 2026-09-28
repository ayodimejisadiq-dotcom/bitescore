import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '@/theme/useTheme'
import { GroupedCard, Mosaic } from './ui'
import { useSession } from '@/hooks/useSession'
import { ensureSession } from '@/lib/auth'
import { fetchMyLists, createList, addToList, removeFromList, listIdsContaining } from '@/lib/data'
import { registerForPushAfterSave } from '@/lib/push'
import type { ListSummary } from '@/lib/types'

// Lists this person can put places in: their own, plus shared lists where
// collaborators are allowed to add.
export function canAddTo(l: ListSummary): boolean {
  return l.my_role === 'owner' || (l.my_role === 'editor' && l.collaborators_can_add && l.access !== 'private')
}

export function SaveToListModal({
  visible,
  restaurantId,
  onClose,
}: {
  visible: boolean
  restaurantId: string
  onClose: () => void
}) {
  const c = useTheme()
  const insets = useSafeAreaInsets()
  const { session } = useSession()
  const [lists, setLists] = useState<ListSummary[]>([])
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    if (!visible || !session) return
    ;(async () => {
      setLoading(true)
      try {
        const mine = (await fetchMyLists()).filter(canAddTo)
        setLists(mine)
        setChecked(await listIdsContaining(restaurantId, mine.map((l) => l.id)))
      } catch {
        /* leave empty; row taps will just no-op */
      } finally {
        setLoading(false)
      }
    })()
  }, [visible, session, restaurantId])

  const toggle = async (listId: string) => {
    const prev = checked
    const next = new Set(checked)
    const was = next.has(listId)
    was ? next.delete(listId) : next.add(listId)
    setChecked(next)
    try {
      if (was) {
        await removeFromList(listId, restaurantId)
      } else {
        await addToList(listId, restaurantId)
        // Saving is when score-change alerts make sense, so ask here.
        void registerForPushAfterSave()
      }
    } catch {
      setChecked(prev)
    }
  }

  const onCreate = async () => {
    if (!newName.trim()) return
    setCreating(true)
    try {
      const id = await createList(newName)
      await addToList(id, restaurantId)
      void registerForPushAfterSave()
      setNewName('')
      setLists((await fetchMyLists()).filter(canAddTo))
      setChecked((p) => new Set(p).add(id))
    } catch {
      /* keep the name so they can retry */
    } finally {
      setCreating(false)
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.grabber} />
          <View style={styles.head}>
            <Text style={[styles.title, { color: c.label }]}>Save to a list</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Text style={[styles.done, { color: c.tint }]}>Done</Text>
            </Pressable>
          </View>

          {!session ? (
            <Pressable onPress={() => ensureSession()} style={{ padding: 24 }}>
              <Text style={{ color: c.tint, fontSize: 16, textAlign: 'center' }}>Couldn’t connect. Tap to retry.</Text>
            </Pressable>
          ) : loading ? (
            <ActivityIndicator color={c.meta} style={{ marginVertical: 28 }} />
          ) : (
            <ScrollView style={{ maxHeight: 360 }} keyboardShouldPersistTaps="handled">
              {lists.length ? (
                <GroupedCard inset={78}>
                  {lists.map((l) => (
                    <Pressable key={l.id} style={styles.row} onPress={() => toggle(l.id)}>
                      <Mosaic ratings={l.mosaic} size={48} />
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.rowTitle, { color: c.label }]} numberOfLines={1}>
                          {l.name}
                        </Text>
                        <Text style={[styles.rowSub, { color: c.meta }]}>
                          {l.place_count} place{l.place_count === 1 ? '' : 's'}
                          {l.my_role !== 'owner' ? ' · Shared with you' : ''}
                        </Text>
                      </View>
                      <Ionicons
                        name={checked.has(l.id) ? 'checkmark-circle' : 'ellipse-outline'}
                        size={24}
                        color={checked.has(l.id) ? c.tint : c.chevron}
                      />
                    </Pressable>
                  ))}
                </GroupedCard>
              ) : null}
              <View style={[styles.newRow, { marginTop: lists.length ? 12 : 0 }]}>
                <TextInput
                  value={newName}
                  onChangeText={setNewName}
                  placeholder="New list"
                  placeholderTextColor={c.meta}
                  style={[styles.input, { color: c.label }]}
                  onSubmitEditing={onCreate}
                  returnKeyType="done"
                />
                <Pressable onPress={onCreate} disabled={creating || !newName.trim()} hitSlop={8}>
                  {creating ? (
                    <ActivityIndicator color={c.tint} />
                  ) : (
                    <Ionicons name="add-circle" size={30} color={newName.trim() ? c.tint : c.chevron} />
                  )}
                </Pressable>
              </View>
            </ScrollView>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { backgroundColor: '#F2F2F7', borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingTop: 8 },
  grabber: { width: 36, height: 5, borderRadius: 3, backgroundColor: '#C7C7CC', alignSelf: 'center', marginBottom: 6 },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  title: { fontSize: 20, fontWeight: '700', letterSpacing: -0.3 },
  done: { fontSize: 17, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 10 },
  rowTitle: { fontSize: 17, fontWeight: '600' },
  rowSub: { fontSize: 14, marginTop: 2 },
  newRow: {
    marginHorizontal: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingLeft: 16,
    paddingRight: 12,
    height: 52,
  },
  input: { flex: 1, fontSize: 17 },
})
