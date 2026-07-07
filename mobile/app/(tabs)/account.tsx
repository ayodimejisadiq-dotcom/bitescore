import { useEffect, useState } from 'react'
import {
  View,
  Text,
  TextInput,
  Pressable,
  Switch,
  StyleSheet,
  ActivityIndicator,
  Alert,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '@/theme/useTheme'
import { useSession } from '@/hooks/useSession'
import { sendLoginCode, verifyLoginCode, signOut, updateDisplayName, deleteMyAccount } from '@/lib/auth'
import { getNotificationPrefs, setNotificationPrefs } from '@/lib/data'
import { registerForPushNotifications } from '@/lib/push'
import { supabase } from '@/lib/supabase'

export default function AccountScreen() {
  const c = useTheme()
  const { session, loading: sessionLoading } = useSession()

  if (sessionLoading) {
    return (
      <View style={[styles.center, { backgroundColor: c.bg }]}>
        <ActivityIndicator color={c.primary} />
      </View>
    )
  }

  return session ? <SignedIn /> : <SignedOut />
}

// ---------------------------------------------------------------------------
// Signed out: email code sign-in
// ---------------------------------------------------------------------------

function SignedOut() {
  const c = useTheme()
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [stage, setStage] = useState<'email' | 'code'>('email')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onSendCode = async () => {
    if (!email.trim()) return
    setBusy(true)
    setError(null)
    try {
      await sendLoginCode(email)
      setStage('code')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const onVerify = async () => {
    if (!code.trim()) return
    setBusy(true)
    setError(null)
    try {
      await verifyLoginCode(email, code)
      // useSession picks up the new session automatically via onAuthStateChange.
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <SafeAreaView edges={['top']} style={[styles.root, { backgroundColor: c.bg }]}>
        <View style={styles.head}>
          <Text style={[styles.title, { color: c.text }]}>Account</Text>
        </View>

        <View style={styles.signInBlock}>
          <Ionicons name="person-circle-outline" size={44} color={c.subtext} />
          <Text style={[styles.p, { color: c.subtext }]}>
            Sign in to save lists, get score-change{'\n'}alerts, and manage your subscription.
          </Text>

          {stage === 'email' ? (
            <>
              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                placeholderTextColor={c.subtext}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                style={[styles.input, { backgroundColor: c.card, color: c.text, borderColor: c.border }]}
              />
              <Pressable
                onPress={onSendCode}
                disabled={busy || !email.trim()}
                style={[styles.button, { backgroundColor: c.primary, opacity: busy ? 0.6 : 1 }]}
              >
                {busy ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.buttonText}>Send me a code</Text>
                )}
              </Pressable>
            </>
          ) : (
            <>
              <Text style={[styles.p, { color: c.subtext, marginTop: 0 }]}>
                Enter the 6-digit code we sent to {email}
              </Text>
              <TextInput
                value={code}
                onChangeText={setCode}
                placeholder="123456"
                placeholderTextColor={c.subtext}
                keyboardType="number-pad"
                autoFocus
                style={[styles.input, { backgroundColor: c.card, color: c.text, borderColor: c.border }]}
              />
              <Pressable
                onPress={onVerify}
                disabled={busy || !code.trim()}
                style={[styles.button, { backgroundColor: c.primary, opacity: busy ? 0.6 : 1 }]}
              >
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Verify</Text>}
              </Pressable>
              <Pressable onPress={() => setStage('email')} style={styles.linkBtn}>
                <Text style={{ color: c.primary, fontSize: 14 }}>Use a different email</Text>
              </Pressable>
            </>
          )}

          {error ? <Text style={[styles.error, { color: '#E4572E' }]}>{error}</Text> : null}
        </View>
      </SafeAreaView>
    </KeyboardAvoidingView>
  )
}

// ---------------------------------------------------------------------------
// Signed in: profile, notifications, sign out, delete account
// ---------------------------------------------------------------------------

function SignedIn() {
  const c = useTheme()
  const { session } = useSession()
  const [displayName, setDisplayNameState] = useState('')
  const [savingName, setSavingName] = useState(false)
  const [notifEnabled, setNotifEnabled] = useState(true)
  const [notifBusy, setNotifBusy] = useState(false)
  const [loadingPrefs, setLoadingPrefs] = useState(true)

  useEffect(() => {
    ;(async () => {
      try {
        setNotifEnabled(await getNotificationPrefs())
      } catch {
        /* default stays true */
      } finally {
        setLoadingPrefs(false)
      }
    })()
  }, [])

  const onSaveName = async () => {
    if (!displayName.trim()) return
    setSavingName(true)
    try {
      await updateDisplayName(displayName)
      Alert.alert('Saved', 'Your display name has been updated.')
    } catch (e) {
      Alert.alert('Couldn’t save', e instanceof Error ? e.message : String(e))
    } finally {
      setSavingName(false)
    }
  }

  const onToggleNotif = async (next: boolean) => {
    setNotifEnabled(next)
    setNotifBusy(true)
    try {
      if (next) {
        const result = await registerForPushNotifications()
        if (!result.ok && result.reason === 'permission-denied') {
          Alert.alert(
            'Notifications off',
            'Enable notifications for Bitescore in Settings to get score-change alerts.',
          )
        }
      }
      await setNotificationPrefs(next)
    } catch (e) {
      setNotifEnabled(!next)
      Alert.alert('Couldn’t update', e instanceof Error ? e.message : String(e))
    } finally {
      setNotifBusy(false)
    }
  }

  const onSignOut = () => {
    Alert.alert('Sign out?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => signOut() },
    ])
  }

  const onDeleteAccount = () => {
    Alert.alert(
      'Delete your account?',
      'This permanently deletes your lists, reviews, and saved places. This can’t be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete account',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteMyAccount()
            } catch (e) {
              Alert.alert('Couldn’t delete account', e instanceof Error ? e.message : String(e))
            }
          },
        },
      ],
    )
  }

  return (
    <SafeAreaView edges={['top']} style={[styles.root, { backgroundColor: c.bg }]}>
      <ScrollView contentContainerStyle={{ paddingBottom: 60 }}>
        <View style={styles.head}>
          <Text style={[styles.title, { color: c.text }]}>Account</Text>
          <Text style={[styles.subtitle, { color: c.subtext }]}>{session?.user.email}</Text>
        </View>

        <Section title="Profile" c={c}>
          <TextInput
            value={displayName}
            onChangeText={setDisplayNameState}
            placeholder="Display name (shown on reviews)"
            placeholderTextColor={c.subtext}
            style={[styles.input, { backgroundColor: c.card, color: c.text, borderColor: c.border }]}
          />
          <Pressable
            onPress={onSaveName}
            disabled={savingName || !displayName.trim()}
            style={[styles.buttonSmall, { backgroundColor: c.primary, opacity: savingName ? 0.6 : 1 }]}
          >
            {savingName ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Save name</Text>}
          </Pressable>
        </Section>

        <Section title="Notifications" c={c}>
          <View style={styles.row}>
            <Text style={[styles.rowLabel, { color: c.text }]}>Score-change alerts</Text>
            {loadingPrefs ? (
              <ActivityIndicator color={c.primary} />
            ) : (
              <Switch value={notifEnabled} onValueChange={onToggleNotif} disabled={notifBusy} />
            )}
          </View>
          <Text style={[styles.hint, { color: c.subtext }]}>
            Get notified when a place on one of your lists gets a new hygiene score.
          </Text>
        </Section>

        <Section title="Session" c={c}>
          <Pressable onPress={onSignOut} style={styles.rowButton}>
            <Text style={{ color: c.text, fontSize: 15 }}>Sign out</Text>
            <Ionicons name="chevron-forward" size={18} color={c.subtext} />
          </Pressable>
        </Section>

        <Section title="Account" c={c}>
          <Pressable onPress={onDeleteAccount} style={styles.rowButton}>
            <Text style={{ color: '#E4572E', fontSize: 15 }}>Delete account</Text>
            <Ionicons name="chevron-forward" size={18} color={c.subtext} />
          </Pressable>
        </Section>
      </ScrollView>
    </SafeAreaView>
  )
}

function Section({ title, c, children }: { title: string; c: ReturnType<typeof useTheme>; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: c.subtext }]}>{title}</Text>
      <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>{children}</View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  head: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 4 },
  title: { fontSize: 30, fontWeight: '800', letterSpacing: -0.5 },
  subtitle: { fontSize: 14, marginTop: 2 },
  signInBlock: { alignItems: 'center', gap: 14, paddingHorizontal: 32, marginTop: 40 },
  p: { fontSize: 15, textAlign: 'center', lineHeight: 22, marginTop: 4 },
  input: {
    width: '100%',
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  button: {
    width: '100%',
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonSmall: {
    marginTop: 10,
    paddingVertical: 11,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  linkBtn: { paddingVertical: 6 },
  error: { fontSize: 13, textAlign: 'center', marginTop: 4 },
  section: { marginTop: 22, paddingHorizontal: 20 },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 8,
  },
  card: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, padding: 14, gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowLabel: { fontSize: 15, fontWeight: '500' },
  hint: { fontSize: 12.5, lineHeight: 18 },
  rowButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 2 },
})
