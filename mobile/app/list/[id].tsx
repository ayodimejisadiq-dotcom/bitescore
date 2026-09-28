import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { Swipeable } from 'react-native-gesture-handler'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { useTheme } from '@/theme/useTheme'
import { ScoreBadge } from '@/components/ScoreBadge'
import { AvatarStack, Button, EmptyState, NavBar, NavIcon } from '@/components/ui'
import { AddPlaceSheet } from '@/components/AddPlaceSheet'
import { ShareListSheet } from '@/components/ShareListSheet'
import { NameListDialog } from '@/components/NameListDialog'
import {
  currentUserId,
  deleteList,
  getListDetail,
  joinList,
  leaveList,
  removeFromList,
  renameList,
  shareUrl,
} from '@/lib/data'
import { errorMessage } from '@/lib/errors'
import { lastKnownCoords } from '@/lib/location'
import { distanceLabel, joinNames, metersBetween, shortName } from '@/lib/people'
import type { ListDetail, ListPerson } from '@/lib/types'

function peopleLine(people: ListPerson[], me: string | null, count: number): string {
  const places = `${count} place${count === 1 ? '' : 's'}`
  if (people.length <= 1) return places
  const names = people.map((p) => (p.user_id === me ? 'You' : shortName(p)))
  // "You" leads when you're on it.
  names.sort((a, b) => (a === 'You' ? -1 : b === 'You' ? 1 : 0))
  return `${joinNames(names.slice(0, 3), names.length)} · ${places}`
}

export default function ListDetailScreen() {
  const c = useTheme()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { id } = useLocalSearchParams<{ id: string }>()
  const [list, setList] = useState<ListDetail | null>(null)
  const [missing, setMissing] = useState(false)
  const [me, setMe] = useState<string | null>(null)
  const [here, setHere] = useState<{ lat: number; lng: number } | null>(null)
  const [adding, setAdding] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [renaming, setRenaming] = useState(false)

  const load = useCallback(async () => {
    try {
      const [detail, uid] = await Promise.all([getListDetail(id), currentUserId()])
      setMe(uid)
      setList(detail)
      setMissing(!detail)
    } catch {
      setMissing(true)
    }
  }, [id])

  useFocusEffect(
    useCallback(() => {
      load()
    }, [load]),
  )

  useEffect(() => {
    lastKnownCoords().then(setHere)
  }, [])

  if (!list) {
    return (
      <SafeAreaView edges={['top']} style={[styles.root, { backgroundColor: c.bg }]}>
        <NavBar backLabel="Lists" />
        {missing ? (
          <EmptyState icon="lock-closed-outline" title="List not available" body="It may have been made private or deleted." />
        ) : (
          <ActivityIndicator color={c.meta} style={{ marginTop: 40 }} />
        )}
      </SafeAreaView>
    )
  }

  const isOwner = list.my_role === 'owner'
  const isMember = list.my_role === 'editor' || list.my_role === 'viewer'
  const link = list.share_slug ? shareUrl(list.share_slug) : null
  const nameOf = (userId: string | null) => {
    if (!userId) return null
    if (userId === me) return 'you'
    const p = list.people.find((x) => x.user_id === userId)
    return p ? shortName(p) : null
  }

  const onShareButton = () => {
    if (isOwner) setSharing(true)
    else if (link) Share.share({ message: `${list.name} on Bitescore: ${link}`, url: link }).catch(() => {})
  }

  const onMore = () => {
    const options: { text: string; style?: 'destructive' | 'cancel'; onPress?: () => void }[] = []
    if (isOwner) {
      options.push({ text: 'Rename', onPress: () => setRenaming(true) })
      options.push({ text: 'Sharing', onPress: () => setSharing(true) })
      options.push({
        text: 'Delete list',
        style: 'destructive',
        onPress: () =>
          Alert.alert(`Delete “${list.name}”?`, 'Its saved places will be removed for everyone on it.', [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Delete',
              style: 'destructive',
              onPress: async () => {
                try {
                  await deleteList(list.id)
                  router.back()
                } catch (e) {
                  Alert.alert('Couldn’t delete', errorMessage(e))
                }
              },
            },
          ]),
      })
    } else if (isMember) {
      options.push({
        text: 'Leave list',
        style: 'destructive',
        onPress: async () => {
          try {
            await leaveList(list.id)
            router.back()
          } catch (e) {
            Alert.alert('Couldn’t leave', errorMessage(e))
          }
        },
      })
    }
    options.push({ text: 'Cancel', style: 'cancel' })
    Alert.alert(list.name, undefined, options)
  }

  const canRemove = (addedBy: string | null) => isOwner || (list.can_add && addedBy === me)

  const onRemove = (restaurantId: string, name: string) => {
    Alert.alert(`Remove ${name}?`, undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await removeFromList(list.id, restaurantId)
            load()
          } catch (e) {
            Alert.alert('Couldn’t remove', errorMessage(e))
          }
        },
      },
    ])
  }

  const shared = list.people.length > 1

  return (
    <SafeAreaView edges={['top']} style={[styles.root, { backgroundColor: c.bg }]}>
      <NavBar
        backLabel="Lists"
        right={
          <>
            {isOwner || link ? <NavIcon icon="share-outline" label="Share list" onPress={onShareButton} /> : null}
            {isOwner || isMember ? <NavIcon icon="ellipsis-horizontal" label="More" onPress={onMore} /> : null}
          </>
        }
      />
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}>
        <Text style={[styles.title, { color: c.label }]}>{list.name}</Text>
        <View style={styles.peopleRow}>
          {shared ? <AvatarStack people={list.people} size={28} ring={c.bg} letters={2} /> : null}
          <Text style={[styles.peopleText, { color: c.label2 }]}>
            {peopleLine(list.people, me, list.items.length)}
          </Text>
        </View>

        <View style={styles.actions}>
          {list.can_add ? (
            <Button label="Add place" icon="add" size="medium" onPress={() => setAdding(true)} style={{ flex: 1 }} />
          ) : null}
          {isOwner ? (
            <Button label="Invite" icon="person-add-outline" size="medium" variant="secondary" onPress={() => setSharing(true)} style={{ flex: 1 }} />
          ) : null}
          {list.my_role === 'link' && list.share_slug ? (
            <Button
              label="Keep in my lists"
              icon="bookmark-outline"
              size="medium"
              variant="secondary"
              onPress={async () => {
                try {
                  await joinList(list.share_slug!, 'viewer')
                  load()
                } catch (e) {
                  Alert.alert('Couldn’t save', errorMessage(e))
                }
              }}
              style={{ flex: 1 }}
            />
          ) : null}
        </View>
        {list.my_role === 'viewer' || list.my_role === 'link' || (list.my_role === 'editor' && !list.can_add) ? (
          <Text style={[styles.viewOnly, { color: c.meta }]}>View only</Text>
        ) : null}

        {list.items.length === 0 ? (
          <Text style={[styles.empty, { color: c.meta }]}>
            {list.can_add ? 'No places yet. Tap Add place, or save one from any restaurant.' : 'No places yet.'}
          </Text>
        ) : (
          <View style={styles.card}>
            {list.items.map((it, i) => {
              const d = here && it.lat != null && it.lng != null ? metersBetween(here, { lat: it.lat, lng: it.lng }) : null
              const by = nameOf(it.added_by)
              const sub = [shared && by ? `Added by ${by}` : null, distanceLabel(d)].filter(Boolean).join(' · ')
              const row = (
                <Pressable
                  onPress={() => router.push(`/restaurant/${it.id}`)}
                  style={({ pressed }) => [styles.row, { backgroundColor: pressed ? '#EBEBEF' : c.card }]}
                >
                  <ScoreBadge rating={it.rating_value} size={44} />
                  <View
                    style={[
                      styles.rowBody,
                      i < list.items.length - 1 ? { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.separator } : null,
                    ]}
                  >
                    <Text style={[styles.rowTitle, { color: c.label }]} numberOfLines={1}>
                      {it.name}
                    </Text>
                    {sub ? <Text style={[styles.rowSub, { color: c.meta }]}>{sub}</Text> : null}
                  </View>
                </Pressable>
              )
              return canRemove(it.added_by) ? (
                <Swipeable
                  key={it.id}
                  overshootRight={false}
                  renderRightActions={() => (
                    <Pressable style={[styles.swipeBtn, { backgroundColor: c.danger }]} onPress={() => onRemove(it.id, it.name)}>
                      <Text style={styles.swipeText}>Remove</Text>
                    </Pressable>
                  )}
                >
                  {row}
                </Swipeable>
              ) : (
                <View key={it.id}>{row}</View>
              )
            })}
          </View>
        )}
      </ScrollView>

      {list.can_add ? (
        <AddPlaceSheet
          visible={adding}
          listId={list.id}
          existingIds={new Set(list.items.map((i) => i.id))}
          onClose={(changed) => {
            setAdding(false)
            if (changed) load()
          }}
        />
      ) : null}

      {isOwner && me ? (
        <ShareListSheet
          visible={sharing}
          listId={list.id}
          listName={list.name}
          me={me}
          sharing={{ access: list.access, share_slug: list.share_slug, collaborators_can_add: list.collaborators_can_add }}
          people={list.people}
          onChange={load}
          onClose={() => setSharing(false)}
        />
      ) : null}

      <NameListDialog
        visible={renaming}
        initialName={list.name}
        title="Rename list"
        confirmLabel="Save"
        onCancel={() => setRenaming(false)}
        onConfirm={async (name) => {
          setRenaming(false)
          try {
            await renameList(list.id, name)
            load()
          } catch (e) {
            Alert.alert('Couldn’t rename', errorMessage(e))
          }
        }}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  title: { fontSize: 34, fontWeight: '700', letterSpacing: -0.6, paddingHorizontal: 20, paddingTop: 4 },
  peopleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 16 },
  peopleText: { fontSize: 15, flexShrink: 1 },
  actions: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingBottom: 20 },
  viewOnly: { fontSize: 13, paddingHorizontal: 32, marginTop: -10, paddingBottom: 12 },
  empty: { fontSize: 15, lineHeight: 21, textAlign: 'center', paddingHorizontal: 40, marginTop: 20 },
  card: { marginHorizontal: 16, backgroundColor: '#FFFFFF', borderRadius: 14, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingLeft: 16 },
  rowBody: { flex: 1, paddingVertical: 12, paddingRight: 16, minWidth: 0 },
  rowTitle: { fontSize: 17, fontWeight: '600' },
  rowSub: { fontSize: 14, marginTop: 2 },
  swipeBtn: { width: 90, alignItems: 'center', justifyContent: 'center' },
  swipeText: { color: '#fff', fontSize: 15, fontWeight: '600' },
})
