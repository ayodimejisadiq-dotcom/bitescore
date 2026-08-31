import { useCallback, useState } from 'react'
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
  Linking,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useFocusEffect } from 'expo-router'
import RevenueCatUI from 'react-native-purchases-ui'
import { useTheme } from '@/theme/useTheme'
import { fonts } from '@/theme/type'
import { useSession } from '@/hooks/useSession'
import { EdgeButton, tileEdge } from '@/components/ui'
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
  fetchMyLists,
  type Profile,
} from '@/lib/data'
import { getGameStats, type GameStats } from '@/lib/game'
import { registerForPushNotifications } from '@/lib/push'
import { errorMessage } from '@/lib/errors'
import { PRIVACY_POLICY_URL, TERMS_OF_USE_URL } from '@/lib/legal'
import { scoreFill, scoreEdge } from '@/theme/colors'

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
            <Text style={{ color: c.primary, fontFamily: fonts.display600 }}>Retry</Text>
          </Pressable>
        ) : null}
      </View>
    )
  }

  return <AccountEditor />
}

// The game layer's badge grid — earned tiles keep their score colours,
// locked ones are dashed with a padlock.
function BadgesCard({ stats, c }: { stats: GameStats; c: ReturnType<typeof useTheme> }) {
  return (
    <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
      <View style={styles.badgesHead}>
        <Text style={[styles.sectionLabel, { color: c.placeholder, marginBottom: 0 }]}>
          BADGES · {stats.earnedCount} OF {stats.badges.length}
        </Text>
      </View>
      <View style={styles.badgeGrid}>
        {stats.badges.map((b) => {
          const earned = b.earned
          const fill =
            b.kind === 'flame' ? c.accent : b.scoreText === '1' ? scoreFill['5'] : scoreFill['4']
          const edge =
            b.kind === 'flame' ? c.accentDark : b.scoreText === '1' ? scoreEdge['5'] : scoreEdge['4']
          return (
            <View key={b.id} style={styles.badgeCell}>
              {earned ? (
                <View style={[styles.badgeCircle, { backgroundColor: fill }, tileEdge(edge)]}>
                  {b.kind === 'flame' ? (
                    <Ionicons name="flame" size={18} color="#fff" />
                  ) : (
                    <Text style={styles.badgeNum}>{b.scoreText}</Text>
                  )}
                </View>
              ) : (
                <View
                  style={[
                    styles.badgeCircle,
                    styles.badgeLocked,
                    { backgroundColor: c.lockedFill, borderColor: c.dashedBorderDark },
                  ]}
                >
                  <Ionicons name="lock-closed" size={14} color={c.disabled} />
                </View>
              )}
              <Text
                style={[styles.badgeCaption, { color: earned ? c.mutedOnCard : c.disabled }]}
                numberOfLines={2}
              >
                {b.label}
              </Text>
            </View>
          )
        })}
      </View>
      {stats.nextProgress !== null ? (
        <>
          <View style={[styles.progressTrack, { backgroundColor: c.subtleFill }]}>
            <View
              style={[
                styles.progressFill,
                { backgroundColor: c.primary, width: `${Math.round(stats.nextProgress * 100)}%` },
              ]}
            />
          </View>
          {stats.nextCaption ? (
            <Text style={[styles.progressCaption, { color: c.mutedOnCard }]}>
              {stats.nextCaption}
            </Text>
          ) : null}
        </>
      ) : null}
    </View>
  )
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

  const [stats, setStats] = useState<GameStats | null>(null)
  const [listCount, setListCount] = useState<number | null>(null)

  useFocusEffect(
    useCallback(() => {
      ;(async () => {
        try {
          const p = await getProfile()
          setProfile(p)
          setFirstName((prev) => prev || (p?.first_name ?? ''))
          setLastName((prev) => prev || (p?.last_name ?? ''))
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
        try {
          setStats(await getGameStats())
        } catch {
          /* game layer is best-effort */
        }
        try {
          setListCount((await fetchMyLists()).length)
        } catch {
          /* leave null */
        }
      })()
    }, []),
  )

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

  const initial = (profile?.username ?? profile?.first_name ?? 'B').trim().charAt(0).toUpperCase() || 'B'

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <SafeAreaView edges={['top']} style={[styles.root, { backgroundColor: c.bg }]}>
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 14, paddingBottom: 60 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Identity */}
          <View style={styles.head}>
            <View style={[styles.avatar, { backgroundColor: c.primary }, tileEdge(c.primaryDark, 4)]}>
              <Text style={styles.avatarText}>{initial}</Text>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[styles.title, { color: c.text }]} numberOfLines={1}>
                {profile?.username ? `@${profile.username}` : 'Account'}
              </Text>
              {memberSince(session?.user?.created_at) ? (
                <Text style={[styles.subtitle, { color: c.mutedOnCard }]}>
                  Member since {memberSince(session?.user?.created_at)}
                </Text>
              ) : null}
            </View>
          </View>

          {/* Game layer stats */}
          {stats ? (
            <View style={styles.statRow}>
              <View style={[styles.statCard, { backgroundColor: c.text }]}>
                <Text style={styles.statNumOnDark}>{stats.placesChecked}</Text>
                <Text style={[styles.statLabel, { color: c.onDarkMuted }]}>places checked</Text>
              </View>
              <View style={[styles.statCard, { backgroundColor: c.accent }, tileEdge(c.accentDark)]}>
                <Text style={styles.statNumOnDark}>{stats.weekStreak}</Text>
                <Text style={[styles.statLabel, { color: 'rgba(255,255,255,0.85)' }]}>
                  week streak
                </Text>
              </View>
              <View style={[styles.statCard, { backgroundColor: c.card, borderWidth: 1.5, borderColor: c.border }]}>
                <Text style={[styles.statNumOnDark, { color: c.text }]}>{listCount ?? '–'}</Text>
                <Text style={[styles.statLabel, { color: c.mutedOnCard }]}>
                  {listCount === 1 ? 'list' : 'lists'}
                </Text>
              </View>
            </View>
          ) : null}

          {stats ? <BadgesCard stats={stats} c={c} /> : null}

          {/* Your details */}
          <Text style={[styles.sectionLabel, { color: c.placeholder }]}>YOUR DETAILS</Text>
          <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
            <View style={styles.nameRow}>
              <TextInput
                value={firstName}
                onChangeText={setFirstName}
                placeholder="First name"
                placeholderTextColor={c.disabled}
                style={[styles.input, { backgroundColor: c.bg, color: c.text, borderColor: c.rowBorder, flex: 1 }]}
              />
              <TextInput
                value={lastName}
                onChangeText={setLastName}
                placeholder="Last name"
                placeholderTextColor={c.disabled}
                style={[styles.input, { backgroundColor: c.bg, color: c.text, borderColor: c.rowBorder, flex: 1 }]}
              />
            </View>
            <EdgeButton
              color={c.primary}
              edgeColor={c.primaryDark}
              radius={15}
              disabled={savingName || !firstName.trim() || !lastName.trim()}
              onPress={onSaveName}
              style={styles.saveBtn}
            >
              {savingName ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>Save</Text>}
            </EdgeButton>
            <Text style={[styles.hint, { color: c.mutedOnCard }]}>
              Reviews only ever show your username, never your real name.
            </Text>

            <View style={[styles.divider, { backgroundColor: c.rowBorder }]} />

            {editingUsername ? (
              <>
                <TextInput
                  value={usernameInput}
                  onChangeText={setUsernameInput}
                  placeholder="username"
                  placeholderTextColor={c.disabled}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={[styles.input, { backgroundColor: c.bg, color: c.text, borderColor: c.rowBorder }]}
                />
                <View style={{ flexDirection: 'row', gap: 12, marginTop: 10 }}>
                  <Pressable onPress={() => setEditingUsername(false)} style={styles.rowButton}>
                    <Text style={{ color: c.mutedOnCard, fontSize: 14, fontFamily: fonts.body }}>Cancel</Text>
                  </Pressable>
                  <Pressable onPress={onSaveUsername} disabled={savingUsername} style={styles.rowButton}>
                    {savingUsername ? (
                      <ActivityIndicator color={c.primary} />
                    ) : (
                      <Text style={{ color: c.primary, fontSize: 14, fontFamily: fonts.display600 }}>
                        Save username
                      </Text>
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
                <Ionicons name="pencil" size={16} color={c.mutedOnCard} />
              </Pressable>
            )}
          </View>

          {/* Email */}
          <Text style={[styles.sectionLabel, { color: c.placeholder }]}>EMAIL</Text>
          <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
            {hasEmail ? (
              <Text style={[styles.rowLabel, { color: c.text }]}>{session?.user?.email}</Text>
            ) : (
              <EmailUpgrade c={c} />
            )}
          </View>

          {/* Alerts */}
          <View style={[styles.card, styles.cardSpaced, { backgroundColor: c.card, borderColor: c.border }]}>
            <View style={styles.row}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={[styles.rowTitle, { color: c.text }]}>Score-change alerts</Text>
                <Text style={[styles.hint, { color: c.mutedOnCard, marginTop: 2 }]}>
                  We'll ping you if a saved place is re-inspected.
                </Text>
              </View>
              {loadingPrefs ? (
                <ActivityIndicator color={c.primary} />
              ) : (
                <Switch
                  value={notifEnabled}
                  onValueChange={onToggleNotif}
                  disabled={notifBusy}
                  trackColor={{ true: '#5EA632', false: c.dashedBorder }}
                  thumbColor="#fff"
                />
              )}
            </View>
          </View>

          {/* Subscription */}
          <View style={[styles.card, styles.cardSpaced, { backgroundColor: c.card, borderColor: c.border }]}>
            <Pressable onPress={() => RevenueCatUI.presentCustomerCenter()} style={styles.row}>
              <Text style={[styles.rowTitle, { color: c.text }]}>Manage subscription</Text>
              <Ionicons name="chevron-forward" size={18} color={c.disabled} />
            </Pressable>
          </View>

          {/* Legal */}
          <View style={[styles.card, styles.cardSpaced, { backgroundColor: c.card, borderColor: c.border }]}>
            <Pressable onPress={() => Linking.openURL(PRIVACY_POLICY_URL)} style={styles.row}>
              <Text style={[styles.rowTitle, { color: c.text }]}>Privacy Policy</Text>
              <Ionicons name="open-outline" size={16} color={c.disabled} />
            </Pressable>
            <View style={[styles.divider, { backgroundColor: c.rowBorder }]} />
            <Pressable onPress={() => Linking.openURL(TERMS_OF_USE_URL)} style={styles.row}>
              <Text style={[styles.rowTitle, { color: c.text }]}>Terms of Use</Text>
              <Ionicons name="open-outline" size={16} color={c.disabled} />
            </Pressable>
          </View>

          {/* Session */}
          <View style={[styles.card, styles.cardSpaced, { backgroundColor: c.card, borderColor: c.border }]}>
            <Pressable onPress={onSignOut} style={styles.row}>
              <Text style={[styles.rowTitle, { color: c.text }]}>Sign out</Text>
              <Ionicons name="chevron-forward" size={18} color={c.disabled} />
            </Pressable>
            <View style={[styles.divider, { backgroundColor: c.rowBorder }]} />
            <Pressable onPress={onDeleteAccount} style={styles.row}>
              <Text style={[styles.rowTitle, { color: '#E24B29' }]}>Delete account</Text>
              <Ionicons name="chevron-forward" size={18} color={c.disabled} />
            </Pressable>
          </View>
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
      <Text style={[styles.hint, { color: c.mutedOnCard, marginBottom: 10, marginTop: 0 }]}>
        Add an email so you never lose your lists and reviews if you switch phones.
      </Text>
      {stage === 'email' ? (
        <>
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            placeholderTextColor={c.disabled}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            style={[styles.input, { backgroundColor: c.bg, color: c.text, borderColor: c.rowBorder }]}
          />
          <EdgeButton
            color={c.primary}
            edgeColor={c.primaryDark}
            radius={15}
            disabled={busy || !email.trim()}
            onPress={onSend}
            style={styles.saveBtn}
          >
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>Send me a code</Text>}
          </EdgeButton>
        </>
      ) : (
        <>
          <Text style={[styles.hint, { color: c.mutedOnCard, marginBottom: 8 }]}>
            Enter the 6-digit code sent to {email}
          </Text>
          <TextInput
            value={code}
            onChangeText={setCode}
            placeholder="123456"
            placeholderTextColor={c.disabled}
            keyboardType="number-pad"
            style={[styles.input, { backgroundColor: c.bg, color: c.text, borderColor: c.rowBorder }]}
          />
          <EdgeButton
            color={c.primary}
            edgeColor={c.primaryDark}
            radius={15}
            disabled={busy || !code.trim()}
            onPress={onConfirm}
            style={styles.saveBtn}
          >
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>Confirm</Text>}
          </EdgeButton>
        </>
      )}
      {error ? <Text style={[styles.error, { color: '#E24B29' }]}>{error}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingBottom: 4 },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: '#fff', fontFamily: fonts.display800, fontSize: 26 },
  title: { fontSize: 25, fontFamily: fonts.display800, letterSpacing: -0.4 },
  subtitle: { fontSize: 13.5, fontFamily: fonts.body, marginTop: 2 },
  statRow: { flexDirection: 'row', gap: 9, marginTop: 16 },
  statCard: { flex: 1, borderRadius: 19, padding: 13 },
  statNumOnDark: { color: '#fff', fontSize: 28, fontFamily: fonts.display800, letterSpacing: -0.5, lineHeight: 30 },
  statLabel: { fontSize: 12, fontFamily: fonts.body, marginTop: 2 },
  card: { borderRadius: 20, borderWidth: 1.5, padding: 16, marginTop: 14 },
  cardSpaced: {},
  badgesHead: { marginBottom: 12 },
  badgeGrid: { flexDirection: 'row', gap: 9 },
  badgeCell: { flex: 1, alignItems: 'center', gap: 5 },
  badgeCircle: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeLocked: { borderWidth: 1.5, borderStyle: 'dashed' },
  badgeNum: { color: '#fff', fontFamily: fonts.display800, fontSize: 15 },
  badgeCaption: { fontSize: 9.5, fontFamily: fonts.body, textAlign: 'center', lineHeight: 12 },
  progressTrack: { height: 8, borderRadius: 4, marginTop: 14, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 4 },
  progressCaption: { fontSize: 12.5, fontFamily: fonts.body, marginTop: 7 },
  sectionLabel: {
    fontSize: 11.5,
    fontFamily: fonts.display600,
    letterSpacing: 1.5,
    marginTop: 18,
    marginBottom: -5,
  },
  nameRow: { flexDirection: 'row', gap: 9 },
  input: {
    height: 48,
    borderRadius: 14,
    borderWidth: 1.5,
    paddingHorizontal: 14,
    fontSize: 15,
    fontFamily: fonts.body,
  },
  saveBtn: { marginTop: 11, height: 50, alignItems: 'center', justifyContent: 'center' },
  saveBtnText: { color: '#fff', fontFamily: fonts.display600, fontSize: 16 },
  hint: { fontSize: 12.5, fontFamily: fonts.body, lineHeight: 18, marginTop: 10 },
  divider: { height: 1.5, marginVertical: 12 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowLabel: { fontSize: 15, fontFamily: fonts.bodyMedium },
  rowTitle: { fontSize: 16.5, fontFamily: fonts.display600 },
  rowButton: { flexDirection: 'row', alignItems: 'center', paddingVertical: 2 },
  error: { fontSize: 13, fontFamily: fonts.body, textAlign: 'center', marginTop: 8 },
})
