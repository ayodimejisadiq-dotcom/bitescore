import { useEffect, useState } from 'react'
import { View, Text, TextInput, Pressable, Modal, FlatList, ActivityIndicator, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '@/theme/useTheme'
import { fonts } from '@/theme/type'
import { EdgeButton } from './ui'
import { useSession } from '@/hooks/useSession'
import { ensureSession } from '@/lib/auth'
import { fetchMyLists, createList, addToList, removeFromList, listIdsContaining } from '@/lib/data'
import { registerForPushAfterSave } from '@/lib/push'
import type { ListWithItems } from '@/lib/types'

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
  const { session } = useSession()
  const [lists, setLists] = useState<ListWithItems[]>([])
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    if (!visible || !session) return
    ;(async () => {
      setLoading(true)
      try {
        const [myLists, contains] = await Promise.all([fetchMyLists(), listIdsContaining(restaurantId)])
        setLists(myLists)
        setChecked(contains)
      } catch {
        /* leave empty; row taps will just no-op */
      } finally {
        setLoading(false)
      }
    })()
  }, [visible, session, restaurantId])

  const toggle = async (listId: string) => {
    const next = new Set(checked)
    const wasChecked = next.has(listId)
    wasChecked ? next.delete(listId) : next.add(listId)
    setChecked(next) // optimistic
    try {
      if (wasChecked) {
        await removeFromList(listId, restaurantId)
      } else {
        await addToList(listId, restaurantId)
        // Saving a place is what score-change alerts are for, so this is
        // where we ask for permission. Not awaited: the save is already done.
        void registerForPushAfterSave()
      }
    } catch {
      setChecked(checked) // revert on failure
    }
  }

  const onCreateAndAdd = async () => {
    if (!newName.trim()) return
    setCreating(true)
    try {
      const id = await createList(newName)
      await addToList(id, restaurantId)
      void registerForPushAfterSave()
      setNewName('')
      const myLists = await fetchMyLists()
      setLists(myLists)
      setChecked((prev) => new Set(prev).add(id))
    } catch {
      /* leave input as-is so the user can retry */
    } finally {
      setCreating(false)
    }
  }

  if (!session) {
    // Normally unreachable — the app signs in anonymously at launch. Only
    // shows if that failed (e.g. no network on first open).
    return (
      <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
        <Pressable style={styles.backdrop} onPress={onClose}>
          <View style={[styles.card, { backgroundColor: c.card }]}>
            <Text style={[styles.title, { color: c.text }]}>Couldn’t connect</Text>
            <Text style={[styles.p, { color: c.mutedOnCard }]}>Check your connection and try again.</Text>
            <EdgeButton
              color={c.primary}
              edgeColor={c.primaryDark}
              radius={16}
              onPress={() => ensureSession()}
              style={styles.primaryBtn}
            >
              <Text style={styles.primaryBtnText}>Retry</Text>
            </EdgeButton>
          </View>
        </Pressable>
      </Modal>
    )
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.card, { backgroundColor: c.card }]} onPress={() => {}}>
          <Text style={[styles.title, { color: c.text }]}>Save to a list</Text>
          {loading ? (
            <ActivityIndicator color={c.primary} style={{ marginVertical: 20 }} />
          ) : (
            <FlatList
              data={lists}
              keyExtractor={(l) => l.id}
              style={{ maxHeight: 260 }}
              ListEmptyComponent={
                <Text style={[styles.p, { color: c.mutedOnCard, marginVertical: 12 }]}>
                  No lists yet — create one below.
                </Text>
              }
              renderItem={({ item }) => (
                <Pressable style={styles.row} onPress={() => toggle(item.id)}>
                  <Text style={[styles.rowLabel, { color: c.text }]}>{item.name}</Text>
                  <Ionicons
                    name={checked.has(item.id) ? 'checkmark-circle' : 'ellipse-outline'}
                    size={22}
                    color={checked.has(item.id) ? c.primary : c.border}
                  />
                </Pressable>
              )}
            />
          )}

          <View style={styles.newRow}>
            <TextInput
              value={newName}
              onChangeText={setNewName}
              placeholder="New list name"
              placeholderTextColor={c.disabled}
              style={[styles.input, { backgroundColor: c.bg, color: c.text, borderColor: c.border }]}
              onSubmitEditing={onCreateAndAdd}
            />
            <Pressable onPress={onCreateAndAdd} disabled={creating || !newName.trim()} hitSlop={8}>
              {creating ? (
                <ActivityIndicator color={c.primary} />
              ) : (
                <Ionicons name="add-circle" size={30} color={c.primary} />
              )}
            </Pressable>
          </View>

          <Pressable onPress={onClose} style={styles.doneBtn}>
            <Text style={{ color: c.primary, fontSize: 16, fontFamily: fonts.display600 }}>Done</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(23,23,15,0.36)', alignItems: 'center', justifyContent: 'center' },
  card: { width: '85%', borderRadius: 24, padding: 20 },
  title: { fontSize: 21, fontFamily: fonts.display800, letterSpacing: -0.3, marginBottom: 6 },
  p: { fontSize: 14, fontFamily: fonts.body, lineHeight: 20 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  rowLabel: { fontSize: 15, fontFamily: fonts.bodyMedium },
  newRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 },
  input: {
    flex: 1,
    borderRadius: 16,
    borderWidth: 1.5,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
  },
  primaryBtn: { marginTop: 14, paddingVertical: 13, borderRadius: 16, alignItems: 'center' },
  primaryBtnText: { color: '#fff', fontFamily: fonts.display600, fontSize: 16 },
  doneBtn: { alignItems: 'center', marginTop: 14, paddingVertical: 4 },
})
