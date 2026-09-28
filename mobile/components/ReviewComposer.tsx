import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '@/theme/useTheme'
import { Button } from './ui'
import { submitReview, deleteReview } from '@/lib/data'
import type { Review } from '@/lib/types'

export function AnonymousCheckbox({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  const c = useTheme()
  return (
    <Pressable style={styles.anonRow} onPress={() => onChange(!value)} hitSlop={8} accessibilityRole="checkbox" accessibilityState={{ checked: value }}>
      <View style={[styles.box, value ? { backgroundColor: c.tint, borderColor: c.tint } : { borderColor: c.chevron }]}>
        {value ? <Ionicons name="checkmark" size={16} color="#fff" /> : null}
      </View>
      <Text style={[styles.anonLabel, { color: c.label2 }]}>Post anonymously</Text>
    </Pressable>
  )
}

export function ReviewComposer({
  visible,
  restaurantId,
  existingReview,
  onClose,
  onSaved,
  onDeleted,
}: {
  visible: boolean
  restaurantId: string
  existingReview: Review | null
  onClose: () => void
  onSaved: (review: Review) => void
  onDeleted: () => void
}) {
  const c = useTheme()
  const insets = useSafeAreaInsets()
  const [body, setBody] = useState('')
  const [anonymous, setAnonymous] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    if (!visible) return
    setBody(existingReview?.body ?? '')
    setAnonymous(existingReview?.is_anonymous ?? false)
  }, [visible, existingReview])

  const onSubmit = async () => {
    const trimmed = body.trim()
    if (!trimmed) return
    setSaving(true)
    try {
      onSaved(await submitReview({ restaurantId, body: trimmed, isAnonymous: anonymous }))
    } catch {
      Alert.alert('Couldn’t post your review', 'Check your connection and try again.')
    } finally {
      setSaving(false)
    }
  }

  const onDelete = () => {
    if (!existingReview) return
    Alert.alert('Delete your review?', 'This can’t be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setDeleting(true)
          try {
            await deleteReview(existingReview.id)
            onDeleted()
          } catch {
            Alert.alert('Couldn’t delete', 'Check your connection and try again.')
          } finally {
            setDeleting(false)
          }
        },
      },
    ])
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.nav}>
            <Pressable onPress={onClose} hitSlop={10}>
              <Text style={[styles.navText, { color: c.tint }]}>Cancel</Text>
            </Pressable>
            <Text style={[styles.navTitle, { color: c.label }]}>
              {existingReview ? 'Edit review' : 'Write a review'}
            </Text>
            <View style={{ width: 52 }} />
          </View>
          <View style={styles.card}>
            <TextInput
              value={body}
              onChangeText={setBody}
              placeholder="Food, service, cleanliness…"
              placeholderTextColor={c.meta}
              multiline
              maxLength={2000}
              autoFocus
              style={[styles.input, { backgroundColor: c.bg, color: c.label }]}
            />
            <AnonymousCheckbox value={anonymous} onChange={setAnonymous} />
          </View>
          <View style={{ paddingHorizontal: 16, marginTop: 16, gap: 4 }}>
            <Button
              label={existingReview ? 'Save changes' : 'Post'}
              onPress={onSubmit}
              loading={saving}
              disabled={!body.trim()}
            />
            {existingReview ? (
              <Pressable onPress={onDelete} disabled={deleting} style={styles.deleteBtn}>
                {deleting ? (
                  <ActivityIndicator color={c.meta} />
                ) : (
                  <Text style={[styles.deleteText, { color: c.danger }]}>Delete review</Text>
                )}
              </Pressable>
            ) : null}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { backgroundColor: '#F2F2F7', borderTopLeftRadius: 22, borderTopRightRadius: 22 },
  nav: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  navText: { fontSize: 17 },
  navTitle: { fontSize: 17, fontWeight: '600' },
  card: { marginHorizontal: 16, backgroundColor: '#FFFFFF', borderRadius: 16, padding: 16, gap: 12 },
  input: { minHeight: 110, borderRadius: 12, padding: 12, fontSize: 16, textAlignVertical: 'top' },
  anonRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  box: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  anonLabel: { fontSize: 15 },
  deleteBtn: { alignItems: 'center', paddingVertical: 12 },
  deleteText: { fontSize: 16, fontWeight: '600' },
})
