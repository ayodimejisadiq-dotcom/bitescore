import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '@/theme/useTheme'
import { RestaurantRow } from './RestaurantRow'
import { SearchField } from './ui'
import { addToList, searchRestaurants, visitErrorMessage } from '@/lib/data'
import { lastKnownCoords } from '@/lib/location'
import { searchErrorMessage } from '@/lib/errors'
import { EMPTY_FILTERS, type RestaurantNear } from '@/lib/types'

// "Add place" on a list: search, tap to add. Stays open for several adds.
export function AddPlaceSheet({
  visible,
  listId,
  existingIds,
  onClose,
}: {
  visible: boolean
  listId: string
  existingIds: Set<string>
  onClose: (changed: boolean) => void
}) {
  const c = useTheme()
  const insets = useSafeAreaInsets()
  const [q, setQ] = useState('')
  const [results, setResults] = useState<RestaurantNear[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [added, setAdded] = useState<Set<string>>(new Set())
  const origin = useRef<{ lat: number; lng: number } | null>(null)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!visible) return
    setQ('')
    setResults([])
    setAdded(new Set())
    lastKnownCoords().then((o) => (origin.current = o))
  }, [visible])

  const onChange = (text: string) => {
    setQ(text)
    setError(null)
    if (debounce.current) clearTimeout(debounce.current)
    if (!text.trim()) {
      setResults([])
      return
    }
    debounce.current = setTimeout(async () => {
      setLoading(true)
      try {
        setResults(await searchRestaurants(text, EMPTY_FILTERS, origin.current))
      } catch (e) {
        setError(searchErrorMessage(e))
      } finally {
        setLoading(false)
      }
    }, 300)
  }

  const add = async (id: string) => {
    setAdded((s) => new Set(s).add(id))
    try {
      await addToList(listId, id)
    } catch (e) {
      setAdded((s) => {
        const n = new Set(s)
        n.delete(id)
        return n
      })
      setError(visitErrorMessage(e))
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => onClose(added.size > 0)}>
      <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.nav}>
          <View style={{ width: 50 }} />
          <Text style={[styles.title, { color: c.label }]}>Add places</Text>
          <Pressable onPress={() => onClose(added.size > 0)} hitSlop={10}>
            <Text style={[styles.done, { color: c.tint }]}>Done</Text>
          </Pressable>
        </View>
        <SearchField
          value={q}
          onChangeText={onChange}
          placeholder="Restaurant, street or postcode"
          autoFocus
          style={{ marginHorizontal: 16, marginBottom: 12 }}
        />
        {error ? <Text style={[styles.msg, { color: c.label2 }]}>{error}</Text> : null}
        {loading ? <ActivityIndicator color={c.meta} style={{ marginTop: 20 }} /> : null}
        <FlatList
          data={results}
          keyExtractor={(r) => r.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
          style={styles.list}
          ItemSeparatorComponent={() => <View style={[styles.sep, { backgroundColor: c.separator }]} />}
          renderItem={({ item }) => {
            const inList = existingIds.has(item.id) || added.has(item.id)
            return (
              <View style={{ backgroundColor: '#fff' }}>
                <RestaurantRow
                  item={item}
                  onPress={() => !inList && add(item.id)}
                  right={
                    <Ionicons
                      name={inList ? 'checkmark-circle' : 'add-circle-outline'}
                      size={26}
                      color={inList ? c.tint : c.tint}
                    />
                  }
                />
              </View>
            )
          }}
        />
      </KeyboardAvoidingView>
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
  title: { fontSize: 17, fontWeight: '600' },
  done: { fontSize: 17, fontWeight: '600' },
  msg: { fontSize: 14, paddingHorizontal: 32, paddingBottom: 8 },
  list: { flexGrow: 0 },
  sep: { height: StyleSheet.hairlineWidth, marginLeft: 74 },
})
