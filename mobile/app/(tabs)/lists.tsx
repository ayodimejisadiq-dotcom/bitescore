import { useCallback, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { Swipeable } from 'react-native-gesture-handler'
import { useFocusEffect, useRouter } from 'expo-router'
import { useTheme } from '@/theme/useTheme'
import { useSession } from '@/hooks/useSession'
import { ensureSession } from '@/lib/auth'
import {
  AvatarStack,
  Button,
  EmptyState,
  Mosaic,
  SearchField,
  SectionHeader,
  TAB_BAR_SPACE,
} from '@/components/ui'
import { NameListDialog } from '@/components/NameListDialog'
import { createList, deleteList, fetchMyLists, leaveList, renameList } from '@/lib/data'
import { errorMessage } from '@/lib/errors'
import { shortName, joinNames } from '@/lib/people'
import type { ListSummary } from '@/lib/types'

const SUGGESTED_NAMES = ['Weekend brunch', 'Date night', 'Want to try']

type IconName = keyof typeof Ionicons.glyphMap

// Access at a glance: people / link / lock, plus who it's with.
function metaFor(l: ListSummary, me: string | undefined): { icon: IconName | null; text: string } {
  const places = `${l.place_count} place${l.place_count === 1 ? '' : 's'}`
  if (l.my_role !== 'owner') return { icon: null, text: `${places} · Shared with you` }
  if (l.access === 'link') return { icon: 'link', text: `${places} · Anyone with link` }
  if (l.access === 'invited') {
    const others = l.people.filter((p) => p.user_id !== me)
    return {
      icon: 'people-outline',
      text: others.length ? `${places} · with ${joinNames(others.slice(0, 2).map(shortName), others.length)}` : `${places} · Invite only`,
    }
  }
  return { icon: 'lock-closed-outline', text: places }
}

export default function ListsScreen() {
  const c = useTheme()
  const router = useRouter()
  const { session, loading: sessionLoading } = useSession()
  const me = session?.user.id
  const [lists, setLists] = useState<ListSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [query, setQuery] = useState('')
  const [naming, setNaming] = useState<{ id: string | null; name: string } | null>(null)
  const openSwipe = useRef<Swipeable | null>(null)

  const load = useCallback(async () => {
    if (!session) return
    try {
      setLists(await fetchMyLists())
      setError(null)
    } catch (e) {
      setError(errorMessage(e))
    }
  }, [session])

  // Refetch on focus so saves made elsewhere show up immediately.
  useFocusEffect(
    useCallback(() => {
      load()
    }, [load]),
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (lists ?? []).filter((l) => !q || l.name.toLowerCase().includes(q))
  }, [lists, query])
  const shared = filtered.filter((l) => l.access !== 'private' || l.my_role !== 'owner')
  const privateLists = filtered.filter((l) => l.access === 'private' && l.my_role === 'owner')

  const onCreate = async (name: string) => {
    try {
      const id = await createList(name)
      await load()
      router.push(`/list/${id}`)
    } catch (e) {
      Alert.alert('Couldn’t create list', errorMessage(e))
    }
  }

  const onNamed = async (name: string) => {
    const target = naming
    setNaming(null)
    if (!target) return
    if (!target.id) return onCreate(name)
    try {
      await renameList(target.id, name)
      load()
    } catch (e) {
      Alert.alert('Couldn’t rename', errorMessage(e))
    }
  }

  const onDelete = (l: ListSummary) => {
    Alert.alert(`Delete “${l.name}”?`, 'Its saved places will be removed for everyone on it.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteList(l.id)
            load()
          } catch (e) {
            Alert.alert('Couldn’t delete', errorMessage(e))
          }
        },
      },
    ])
  }

  const onLeave = (l: ListSummary) => {
    Alert.alert(`Leave “${l.name}”?`, 'You can rejoin from the link.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Leave',
        style: 'destructive',
        onPress: async () => {
          try {
            await leaveList(l.id)
            load()
          } catch (e) {
            Alert.alert('Couldn’t leave', errorMessage(e))
          }
        },
      },
    ])
  }

  const renderRow = (l: ListSummary, last: boolean) => {
    const meta = metaFor(l, me)
    const others = l.people.filter((p) => p.user_id !== me)
    const actions = () => (
      <View style={{ flexDirection: 'row' }}>
        {l.my_role === 'owner' ? (
          <>
            <Pressable
              style={[styles.swipeBtn, { backgroundColor: c.chevron }]}
              onPress={() => {
                openSwipe.current?.close()
                setNaming({ id: l.id, name: l.name })
              }}
            >
              <Text style={styles.swipeText}>Rename</Text>
            </Pressable>
            <Pressable
              style={[styles.swipeBtn, { backgroundColor: c.danger }]}
              onPress={() => {
                openSwipe.current?.close()
                onDelete(l)
              }}
            >
              <Text style={styles.swipeText}>Delete</Text>
            </Pressable>
          </>
        ) : (
          <Pressable
            style={[styles.swipeBtn, { backgroundColor: c.danger }]}
            onPress={() => {
              openSwipe.current?.close()
              onLeave(l)
            }}
          >
            <Text style={styles.swipeText}>Leave</Text>
          </Pressable>
        )}
      </View>
    )
    return (
      <Swipeable
        key={l.id}
        renderRightActions={actions}
        overshootRight={false}
        onSwipeableOpen={(_, swipeable) => {
          if (openSwipe.current && openSwipe.current !== swipeable) openSwipe.current.close()
          openSwipe.current = swipeable
        }}
      >
        <Pressable
          onPress={() => router.push(`/list/${l.id}`)}
          style={({ pressed }) => [styles.row, { backgroundColor: pressed ? '#EBEBEF' : c.card }]}
        >
          <Mosaic ratings={l.mosaic} size={48} />
          <View style={[styles.rowBody, !last ? { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.separator } : null]}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[styles.rowTitle, { color: c.label }]} numberOfLines={1}>
                {l.name}
              </Text>
              <View style={styles.metaRow}>
                {meta.icon ? <Ionicons name={meta.icon} size={13} color={c.meta} /> : null}
                <Text style={[styles.meta, { color: c.meta }]} numberOfLines={1}>
                  {meta.text}
                </Text>
              </View>
            </View>
            {l.access !== 'private' && others.length ? <AvatarStack people={others} size={26} /> : null}
          </View>
        </Pressable>
      </Swipeable>
    )
  }

  const section = (title: string, rows: ListSummary[]) =>
    rows.length ? (
      <View style={{ marginBottom: 24 }}>
        <SectionHeader>{title}</SectionHeader>
        <View style={styles.card}>{rows.map((l, i) => renderRow(l, i === rows.length - 1))}</View>
      </View>
    ) : null

  if (sessionLoading) {
    return (
      <View style={[styles.center, { backgroundColor: c.bg }]}>
        <ActivityIndicator color={c.meta} />
      </View>
    )
  }

  return (
    <SafeAreaView edges={['top']} style={[styles.root, { backgroundColor: c.bg }]}>
      <View style={styles.topBar}>
        <Pressable
          onPress={() => setNaming({ id: null, name: '' })}
          style={[styles.plus, { backgroundColor: c.tintSoft }]}
          accessibilityRole="button"
          accessibilityLabel="New list"
          hitSlop={6}
        >
          <Ionicons name="add" size={22} color={c.tint} />
        </Pressable>
      </View>
      <ScrollView
        contentContainerStyle={{ paddingBottom: TAB_BAR_SPACE }}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true)
              await load()
              setRefreshing(false)
            }}
          />
        }
      >
        <Text style={[styles.largeTitle, { color: c.label }]}>Lists</Text>

        {!session ? (
          <EmptyState
            icon="cloud-offline-outline"
            title="Couldn’t connect"
            body="Check your connection and try again."
            action={<Button label="Retry" onPress={() => ensureSession()} />}
          />
        ) : error && !lists ? (
          <EmptyState icon="alert-circle-outline" title="Couldn’t load your lists" body={error} action={<Button label="Retry" onPress={load} />} />
        ) : lists === null ? (
          <ActivityIndicator color={c.meta} style={{ marginTop: 30 }} />
        ) : lists.length === 0 ? (
          <View>
            <EmptyState
              icon="bookmark-outline"
              title="Start your first list"
              body="Keep the places you eat at in one spot, share them with friends, and hear if a score changes."
            />
            <View style={styles.suggestRow}>
              {SUGGESTED_NAMES.map((name) => (
                <Pressable key={name} onPress={() => onCreate(name)} style={[styles.suggest, { backgroundColor: c.card }]}>
                  <Text style={[styles.suggestText, { color: c.label }]}>{name}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : (
          <>
            <SearchField value={query} onChangeText={setQuery} placeholder="Search lists" style={styles.search} />
            {section('Shared', shared)}
            {section('Private', privateLists)}
            {filtered.length === 0 ? (
              <Text style={[styles.noMatch, { color: c.meta }]}>No lists match “{query.trim()}”.</Text>
            ) : null}
          </>
        )}
      </ScrollView>

      <NameListDialog
        visible={naming !== null}
        initialName={naming?.name ?? ''}
        title={naming?.id ? 'Rename list' : 'New list'}
        confirmLabel={naming?.id ? 'Save' : 'Create'}
        onCancel={() => setNaming(null)}
        onConfirm={onNamed}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  topBar: { height: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', paddingHorizontal: 16 },
  plus: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  largeTitle: { fontSize: 34, fontWeight: '700', letterSpacing: -0.6, paddingHorizontal: 20, paddingBottom: 12 },
  search: { marginHorizontal: 16, marginBottom: 22 },
  card: { marginHorizontal: 16, backgroundColor: '#FFFFFF', borderRadius: 14, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingLeft: 16 },
  rowBody: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12, paddingRight: 16, minWidth: 0 },
  rowTitle: { fontSize: 17, fontWeight: '600' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  meta: { fontSize: 14, flexShrink: 1 },
  swipeBtn: { width: 84, alignItems: 'center', justifyContent: 'center' },
  swipeText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  suggestRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginTop: 20, paddingHorizontal: 24 },
  suggest: { paddingVertical: 9, paddingHorizontal: 14, borderRadius: 17 },
  suggestText: { fontSize: 15, fontWeight: '500' },
  noMatch: { fontSize: 15, textAlign: 'center', marginTop: 12 },
})
