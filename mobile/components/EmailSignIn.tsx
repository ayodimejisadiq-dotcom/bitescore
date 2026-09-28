import { useEffect, useState } from 'react'
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { useTheme } from '@/theme/useTheme'
import { Button } from './ui'
import { sendLoginCode, verifyLoginCode } from '@/lib/auth'
import { errorMessage } from '@/lib/errors'

// Sign back into an existing account (one that has an email) with a 6-digit
// code. Without this, a reinstall or a new phone always starts a fresh
// anonymous account, and anything tied to the old one — lists, and a
// RevenueCat grant or purchase keyed to that user id — is out of reach.
//
// On success the auth state change does the rest: the root layout sees a new
// user id, logs RevenueCat into it and re-reads the entitlement.
function friendlyError(e: unknown): string {
  const msg = errorMessage(e)
  if (/signups? not allowed|user not found|otp_disabled/i.test(msg)) {
    return 'No account uses that email. If you’re new, just close this and carry on.'
  }
  if (/expired|invalid/i.test(msg)) return 'That code didn’t work. Check it, or send a new one.'
  if (/rate limit|security purposes/i.test(msg)) return 'Too many tries. Wait a minute, then send a new code.'
  return msg
}

export function EmailSignIn({
  visible,
  onClose,
  note,
}: {
  visible: boolean
  onClose: () => void
  note?: string
}) {
  const c = useTheme()
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [stage, setStage] = useState<'email' | 'code'>('email')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!visible) return
    setCode('')
    setStage('email')
    setError(null)
  }, [visible])

  const send = async () => {
    setBusy(true)
    setError(null)
    try {
      await sendLoginCode(email)
      setStage('code')
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }

  const verify = async () => {
    setBusy(true)
    setError(null)
    try {
      await verifyLoginCode(email, code)
      onClose()
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.nav}>
          <Pressable onPress={onClose} hitSlop={10}>
            <Text style={[styles.navText, { color: c.tint }]}>Cancel</Text>
          </Pressable>
          <Text style={[styles.navTitle, { color: c.label }]}>Sign in</Text>
          <View style={{ width: 56 }} />
        </View>
        <View style={styles.body}>
          <Text style={[styles.lead, { color: c.label2 }]}>
            {stage === 'email'
              ? 'Enter the email on your Bitescore account. We’ll email you a sign-in code.'
              : `Enter the code we emailed to ${email.trim()}.`}
          </Text>
          <View style={styles.card}>
            {stage === 'email' ? (
              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                placeholderTextColor={c.meta}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                keyboardType="email-address"
                autoFocus
                returnKeyType="send"
                onSubmitEditing={() => email.trim() && send()}
                style={[styles.input, { color: c.label }]}
              />
            ) : (
              <TextInput
                value={code}
                onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 10))}
                placeholder="123456"
                placeholderTextColor={c.meta}
                keyboardType="number-pad"
                textContentType="oneTimeCode"
                autoComplete="one-time-code"
                autoFocus
                style={[styles.input, styles.code, { color: c.label }]}
              />
            )}
          </View>
          {error ? <Text style={[styles.error, { color: c.danger }]}>{error}</Text> : null}
          {note && stage === 'email' ? <Text style={[styles.note, { color: c.meta }]}>{note}</Text> : null}
          <View style={{ marginTop: 20, gap: 4 }}>
            {stage === 'email' ? (
              <Button label="Send code" onPress={send} loading={busy} disabled={!email.trim()} />
            ) : (
              <>
                <Button label="Sign in" onPress={verify} loading={busy} disabled={code.length < 6} />
                <Button label="Use a different email" variant="plain" size="medium" onPress={() => setStage('email')} />
              </>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  nav: { height: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16 },
  navText: { fontSize: 17 },
  navTitle: { fontSize: 17, fontWeight: '600' },
  body: { paddingHorizontal: 16, paddingTop: 8 },
  lead: { fontSize: 15, lineHeight: 21, paddingHorizontal: 16, paddingBottom: 12 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 14, paddingHorizontal: 16 },
  input: { height: 52, fontSize: 17 },
  code: { fontSize: 24, letterSpacing: 6, fontWeight: '600' },
  error: { fontSize: 14, lineHeight: 19, paddingHorizontal: 16, paddingTop: 10 },
  note: { fontSize: 13, lineHeight: 18, paddingHorizontal: 16, paddingTop: 10 },
})
