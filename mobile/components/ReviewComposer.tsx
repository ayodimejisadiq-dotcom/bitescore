import { useEffect, useState } from 'react'
import { View, Text, TextInput, Pressable, Modal, ActivityIndicator, StyleSheet, Alert } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '@/theme/useTheme'
import { fonts } from '@/theme/type'
import { EdgeButton } from './ui'
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
            placeholderTextColor={c.disabled}
            multiline
            maxLength={2000}
            style={[styles.input, { backgroundColor: c.bg, color: c.text, borderColor: c.border }]}
          />
          <Pressable style={styles.anonRow} onPress={() => setAnonymous((a) => !a)} hitSlop={8}>
            <Ionicons
              name={anonymous ? 'checkbox' : 'square-outline'}
              size={20}
              color={anonymous ? c.primary : c.mutedOnCard}
            />
            <Text style={[styles.anonLabel, { color: c.text }]}>Post anonymously</Text>
          </Pressable>

          <EdgeButton
            color={c.primary}
            edgeColor={c.primaryDark}
            edge={4}
            radius={16}
            onPress={onSubmit}
            disabled={saving || !body.trim()}
            style={styles.primaryBtn}
          >
            {saving ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryBtnText}>{existingReview ? 'Save changes' : 'Post review'}</Text>
            )}
          </EdgeButton>

          {existingReview ? (
            <Pressable onPress={onDelete} disabled={deleting} style={styles.deleteBtn}>
              {deleting ? (
                <ActivityIndicator color={c.mutedOnCard} />
              ) : (
                <Text style={styles.deleteBtnText}>Delete review</Text>
              )}
            </Pressable>
          ) : null}

          <Pressable onPress={onClose} style={styles.cancelBtn}>
            <Text style={[styles.cancelBtnText, { color: c.mutedOnCard }]}>Cancel</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(23,23,15,0.36)', alignItems: 'center', justifyContent: 'center' },
  card: { width: '88%', borderRadius: 24, padding: 20 },
  title: { fontSize: 21, fontFamily: fonts.display800, marginBottom: 12 },
  input: {
    borderRadius: 16,
    borderWidth: 1.5,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    minHeight: 110,
    textAlignVertical: 'top',
  },
  anonRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  anonLabel: { fontSize: 14, fontFamily: fonts.bodyMedium },
  primaryBtn: { marginTop: 16, paddingVertical: 13, borderRadius: 16, alignItems: 'center' },
  primaryBtnText: { color: '#fff', fontFamily: fonts.display600, fontSize: 16 },
  deleteBtn: { alignItems: 'center', marginTop: 12, paddingVertical: 4 },
  deleteBtnText: { color: '#E24B29', fontSize: 14, fontFamily: fonts.display600 },
  cancelBtn: { alignItems: 'center', marginTop: 10, paddingVertical: 4 },
  cancelBtnText: { fontSize: 15, fontFamily: fonts.display600 },
})
