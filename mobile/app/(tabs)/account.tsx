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
import {
  signOut,
  deleteMyAccount,
  startEmailUpgrade,
  confirmEmailUpgrade,
  ensureSession,
} from '@/lib/auth'
import {
  getProfile,
  saveProfileNames,
  setUsername,
  getNotificationPrefs,
  setNotificationPrefs,
  type Profile,
} from '@/lib/data'
import { registerForPushNotifications } from '@/lib/push'
import { errorMessage } from '@/lib/errors'

function initials(first: string | null, last: string | null): string {
  const a = first?.trim().charAt(0) ?? ''
  const b = last?.trim().charAt(0) ?? ''
  return (a + b).toUpperCase() || '?'
}

function memberSince(createdAt: string | undefined): string | null {
  if (!createdAt) return null
  return new Date(createdAt).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
}

export default function AccountScreen() {
  const c = useTheme()
  const { session, loading: sessionLoading } = useSession()

  if (sessionLoading || !session) {
    return (
      <View style={[styles.center, { backgroundColor: c.bg }]}>
        <ActivityIndicator color={c.primary} />
        {!sessionLoading && !session ? (
          <Pressable onPress={() => ensureSession()} style={{ marginTop: 12 }}>
            <Text style={{ color: c.primary }}>Retry</Text>
          </Pressable>
        ) : null}
      </View>
    )
  }

  return <AccountEditor />
}

function AccountEditor() {
  const c = useTheme()
  const { session } = useSession()
  const isAnonymous = Boolean((session?.user as { is_anonymous?: boolean })?.is_anonymous)
  const hasEmail = Boolean(session?.user?.email)

  const [profile, setProfile] = useState<Profile | null>(null)
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [savingName, setSavingName] = useState(false)
  const [editingUsername, setEditingUsername] = useState(false)
  const [usernameInput, setUsernameInput] = useState('')
  const [savingUsername, setSavingUsername] = useState(false)

  const [notifEnabled, setNotifEnabled] = useState(true)
  const [notifBusy, setNotifBusy] = useState(false)
  const [loadingPrefs, setLoadingPrefs] = useState(true)

  useEffect(() => {
    ;(async () => {
      try {
        const p = await getProfile()
        setProfile(p)
        setFirstName(p?.first_name ?? '')
        setLastName(p?.last_name ?? '')
      } catch {
        /* leave blank */
      }
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
    if (!firstName.trim() || !lastName.trim()) return
    setSavingName(true)
    try {
      const username = await saveProfileNames(firstName, lastName)
      setProfile((prev) => ({ ...prev, first_name: firstName.trim(), last_name: lastName.trim(), username }))
    } catch (e) {
      Alert.alert('Couldn’t save', errorMessage(e))
    } finally {
      setSavingName(false)
    }
  }

  const onSaveUsername = async () => {
    setSavingUsername(true)
    try {
      await setUsername(usernameInput)
      setProfile((prev) => (prev ? { ...prev, username: usernameInput.trim().toLowerCase() } : prev))
      setEditingUsername(false)
    } catch (e) {
      Alert.alert('Couldn’t update username', errorMessage(e))
    } finally {
      setSavingUsername(false)
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
      Alert.alert('Couldn’t update', errorMessage(e))
    } finally {
      setNotifBusy(false)
    }
  }

  const onSignOut = () => {
    if (isAnonymous) {
      Alert.alert(
        'You haven’t added an email yet',
        'Signing out now will permanently lose your lists, reviews, and saved places — there’s no way back in without an email on this account. Add one first to keep your data safe.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Sign out anyway', style: 'destructive', onPress: () => signOut() },
        ],
      )
      return
    }
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
              Alert.alert('Couldn’t delete account', errorMessage(e))
            }
          },
        },
      ],
    )
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <SafeAreaView edges={['top']} style={[styles.root, { backgroundColor: c.bg }]}>
        <ScrollView contentContainerStyle={{ paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
          <View style={styles.head}>
            <View style={[styles.avatar, { backgroundColor: c.primary }]}>
              <Text style={styles.avatarText}>{initials(profile?.first_name ?? null, profile?.last_name ?? null)}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.title, { color: c.text }]}>
                {profile?.username ? `@${profile.username}` : 'Account'}
              </Text>
              {memberSince(session?.user?.created_at) ? (
                <Text style={[styles.subtitle, { color: c.subtext }]}>
                  Member since {memberSince(session?.user?.created_at)}
                </Text>
              ) : null}
            </View>
          </View>

          <Section title="Profile" c={c}>
            <TextInput
              value={firstName}
              onChangeText={setFirstName}
              placeholder="First name"
              placeholderTextColor={c.subtext}
              style={[styles.input, { backgroundColor: c.bg, color: c.text, borderColor: c.border }]}
            />
            <TextInput
              value={lastName}
              onChangeText={setLastName}
              placeholder="Last name"
              placeholderTextColor={c.subtext}
              style={[styles.input, { backgroundColor: c.bg, color: c.text, borderColor: c.border }]}
            />
            <Pressable
              onPress={onSaveName}
              disabled={savingName || !firstName.trim() || !lastName.trim()}
              style={[styles.buttonSmall, { backgroundColor: c.primary, opacity: savingName ? 0.6 : 1 }]}
            >
              {savingName ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Save name</Text>}
            </Pressable>
            <Text style={[styles.hint, { color: c.subtext }]}>
              Only your username is shown publicly on reviews — never your real name.
            </Text>

            <View style={[styles.divider, { backgroundColor: c.border }]} />

            {editingUsername ? (
              <>
                <TextInput
                  value={usernameInput}
                  onChangeText={setUsernameInput}
                  placeholder="username"
                  placeholderTextColor={c.subtext}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={[styles.input, { backgroundColor: c.bg, color: c.text, borderColor: c.border }]}
                />
                <View style={{ flexDirection: 'row', gap: 12 }}>
                  <Pressable onPress={() => setEditingUsername(false)} style={styles.rowButton}>
                    <Text style={{ color: c.subtext, fontSize: 14 }}>Cancel</Text>
                  </Pressable>
                  <Pressable onPress={onSaveUsername} disabled={savingUsername} style={styles.rowButton}>
                    {savingUsername ? (
                      <ActivityIndicator color={c.primary} />
                    ) : (
                      <Text style={{ color: c.primary, fontSize: 14, fontWeight: '700' }}>Save username</Text>
                    )}
                  </Pressable>
                </View>
              </>
            ) : (
              <Pressable
                style={styles.row}
                onPress={() => {
                  setUsernameInput(profile?.username ?? '')
                  setEditingUsername(true)
                }}
              >
                <Text style={[styles.rowLabel, { color: c.text }]}>
                  Username: {profile?.username ? `@${profile.username}` : '—'}
                </Text>
                <Ionicons name="pencil" size={16} color={c.subtext} />
              </Pressable>
            )}
          </Section>

          <Section title="Email" c={c}>
            {hasEmail ? (
              <Text style={[styles.rowLabel, { color: c.text }]}>{session?.user?.email}</Text>
            ) : (
              <EmailUpgrade c={c} />
            )}
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
    </KeyboardAvoidingView>
  )
}

// Adding an email upgrades the current (anonymous) session in place — same
// user_id, same lists/reviews, just no longer at risk of being lost.
function EmailUpgrade({ c }: { c: ReturnType<typeof useTheme> }) {
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [stage, setStage] = useState<'email' | 'code'>('email')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onSend = async () => {
    if (!email.trim()) return
    setBusy(true)
    setError(null)
    try {
      await startEmailUpgrade(email)
      setStage('code')
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const onConfirm = async () => {
    if (!code.trim()) return
    setBusy(true)
    setError(null)
    try {
      await confirmEmailUpgrade(email, code)
      // useSession picks up session.user.email automatically.
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <View>
      <Text style={[styles.hint, { color: c.subtext, marginBottom: 10 }]}>
        Add an email so you never lose your lists and reviews if you switch phones.
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
            style={[styles.input, { backgroundColor: c.bg, color: c.text, borderColor: c.border }]}
          />
          <Pressable
            onPress={onSend}
            disabled={busy || !email.trim()}
            style={[styles.buttonSmall, { backgroundColor: c.primary, opacity: busy ? 0.6 : 1 }]}
          >
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Send me a code</Text>}
          </Pressable>
        </>
      ) : (
        <>
          <Text style={[styles.hint, { color: c.subtext }]}>Enter the 6-digit code sent to {email}</Text>
          <TextInput
            value={code}
            onChangeText={setCode}
            placeholder="123456"
            placeholderTextColor={c.subtext}
            keyboardType="number-pad"
            style={[styles.input, { backgroundColor: c.bg, color: c.text, borderColor: c.border }]}
          />
          <Pressable
            onPress={onConfirm}
            disabled={busy || !code.trim()}
            style={[styles.buttonSmall, { backgroundColor: c.primary, opacity: busy ? 0.6 : 1 }]}
          >
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Confirm</Text>}
          </Pressable>
        </>
      )}
      {error ? <Text style={[styles.error, { color: '#E4572E' }]}>{error}</Text> : null}
    </View>
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
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 4,
  },
  avatar: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontWeight: '800', fontSize: 18 },
  title: { fontSize: 24, fontWeight: '800', letterSpacing: -0.5 },
  subtitle: { fontSize: 13, marginTop: 2 },
  input: {
    width: '100%',
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    marginBottom: 10,
  },
  buttonSmall: {
    paddingVertical: 11,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  error: { fontSize: 13, textAlign: 'center', marginTop: 8 },
  section: { marginTop: 22, paddingHorizontal: 20 },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 8,
  },
  card: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, padding: 14, gap: 4 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowLabel: { fontSize: 15, fontWeight: '500' },
  hint: { fontSize: 12.5, lineHeight: 18, marginTop: 4 },
  rowButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 2 },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 12 },
})
