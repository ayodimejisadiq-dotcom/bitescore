import { useEffect, useState } from 'react'
import { View, Text, TextInput, Pressable, Modal, FlatList, ActivityIndicator, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { useTheme } from '@/theme/useTheme'
import { useSession } from '@/hooks/useSession'
import { fetchMyLists, createList, addToList, removeFromList, listIdsContaining } from '@/lib/data'
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
  const router = useRouter()
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
      if (wasChecked) await removeFromList(listId, restaurantId)
      else await addToList(listId, restaurantId)
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
    return (
      <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
        <Pressable style={styles.backdrop} onPress={onClose}>
          <View style={[styles.card, { backgroundColor: c.card }]}>
            <Text style={[styles.title, { color: c.text }]}>Sign in to save places</Text>
            <Text style={[styles.p, { color: c.subtext }]}>
              Create an account to add this to a list and get score-change alerts.
            </Text>
            <Pressable
              style={[styles.primaryBtn, { backgroundColor: c.primary }]}
              onPress={() => {
                onClose()
                router.push('/account')
              }}
            >
              <Text style={styles.primaryBtnText}>Go to Account</Text>
            </Pressable>
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
                <Text style={[styles.p, { color: c.subtext, marginVertical: 12 }]}>
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
              placeholderTextColor={c.subtext}
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
            <Text style={{ color: c.primary, fontSize: 15, fontWeight: '700' }}>Done</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' },
  card: { width: '85%', borderRadius: 18, padding: 18 },
  title: { fontSize: 17, fontWeight: '700', marginBottom: 6 },
  p: { fontSize: 14, lineHeight: 20 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  rowLabel: { fontSize: 15, fontWeight: '500' },
  newRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 },
  input: {
    flex: 1,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
  },
  primaryBtn: { marginTop: 14, paddingVertical: 13, borderRadius: 14, alignItems: 'center' },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  doneBtn: { alignItems: 'center', marginTop: 14, paddingVertical: 4 },
})
