import { useEffect, useState } from 'react'
import { View, Text, TextInput, Pressable, Modal, ActivityIndicator, StyleSheet, Alert } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '@/theme/useTheme'
import { submitReview, deleteReview } from '@/lib/data'
import type { Review } from '@/lib/types'

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
      const review = await submitReview({ restaurantId, body: trimmed, isAnonymous: anonymous })
      onSaved(review)
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
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.card, { backgroundColor: c.card }]} onPress={() => {}}>
          <Text style={[styles.title, { color: c.text }]}>
            {existingReview ? 'Edit your review' : 'Write a review'}
          </Text>
          <TextInput
            value={body}
            onChangeText={setBody}
            placeholder="What was it like?"
            placeholderTextColor={c.subtext}
            multiline
            maxLength={2000}
            style={[styles.input, { backgroundColor: c.bg, color: c.text, borderColor: c.border }]}
          />
          <Pressable style={styles.anonRow} onPress={() => setAnonymous((a) => !a)} hitSlop={8}>
            <Ionicons
              name={anonymous ? 'checkbox' : 'square-outline'}
              size={20}
              color={anonymous ? c.primary : c.subtext}
            />
            <Text style={[styles.anonLabel, { color: c.text }]}>Post anonymously</Text>
          </Pressable>

          <Pressable
            style={[styles.primaryBtn, { backgroundColor: c.primary, opacity: body.trim() ? 1 : 0.5 }]}
            onPress={onSubmit}
            disabled={saving || !body.trim()}
          >
            {saving ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryBtnText}>{existingReview ? 'Save changes' : 'Post review'}</Text>
            )}
          </Pressable>

          {existingReview ? (
            <Pressable onPress={onDelete} disabled={deleting} style={styles.deleteBtn}>
              {deleting ? (
                <ActivityIndicator color={c.subtext} />
              ) : (
                <Text style={styles.deleteBtnText}>Delete review</Text>
              )}
            </Pressable>
          ) : null}

          <Pressable onPress={onClose} style={styles.cancelBtn}>
            <Text style={[styles.cancelBtnText, { color: c.subtext }]}>Cancel</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' },
  card: { width: '88%', borderRadius: 18, padding: 18 },
  title: { fontSize: 17, fontWeight: '700', marginBottom: 12 },
  input: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    minHeight: 110,
    textAlignVertical: 'top',
  },
  anonRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  anonLabel: { fontSize: 14, fontWeight: '500' },
  primaryBtn: { marginTop: 16, paddingVertical: 13, borderRadius: 14, alignItems: 'center' },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  deleteBtn: { alignItems: 'center', marginTop: 12, paddingVertical: 4 },
  deleteBtnText: { color: '#D64545', fontSize: 14, fontWeight: '600' },
  cancelBtn: { alignItems: 'center', marginTop: 10, paddingVertical: 4 },
  cancelBtnText: { fontSize: 15, fontWeight: '600' },
})
