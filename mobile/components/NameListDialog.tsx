import { useEffect, useState } from 'react'
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { useTheme } from '@/theme/useTheme'

// Create or rename a list. Cross-platform stand-in for Alert.prompt, which
// only exists on iOS.
export function NameListDialog({
  visible,
  initialName = '',
  title,
  confirmLabel,
  onCancel,
  onConfirm,
}: {
  visible: boolean
  initialName?: string
  title: string
  confirmLabel: string
  onCancel: () => void
  onConfirm: (name: string) => void
}) {
  const c = useTheme()
  const [name, setName] = useState(initialName)
  useEffect(() => {
    if (visible) setName(initialName)
  }, [visible, initialName])
  const ok = name.trim().length > 0

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.backdrop}>
        <View style={styles.dialog}>
          <Text style={[styles.title, { color: c.label }]}>{title}</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="e.g. Weekend brunch"
            placeholderTextColor={c.meta}
            autoFocus
            maxLength={60}
            returnKeyType="done"
            onSubmitEditing={() => ok && onConfirm(name.trim())}
            style={[styles.input, { backgroundColor: c.bg, color: c.label }]}
          />
          <View style={[styles.buttons, { borderTopColor: c.separator }]}>
            <Pressable style={styles.btn} onPress={onCancel}>
              <Text style={[styles.btnText, { color: c.tint }]}>Cancel</Text>
            </Pressable>
            <View style={{ width: StyleSheet.hairlineWidth, backgroundColor: c.separator }} />
            <Pressable style={styles.btn} onPress={() => ok && onConfirm(name.trim())} disabled={!ok}>
              <Text style={[styles.btnText, { color: ok ? c.tint : c.chevron, fontWeight: '600' }]}>
                {confirmLabel}
              </Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'center', padding: 40 },
  dialog: { backgroundColor: 'rgba(250,250,252,0.98)', borderRadius: 14, overflow: 'hidden' },
  title: { fontSize: 17, fontWeight: '600', textAlign: 'center', paddingTop: 20, paddingHorizontal: 16 },
  input: { margin: 16, marginTop: 14, height: 40, borderRadius: 9, paddingHorizontal: 10, fontSize: 16 },
  buttons: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth },
  btn: { flex: 1, height: 46, alignItems: 'center', justifyContent: 'center' },
  btnText: { fontSize: 17 },
})
