import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import RevenueCatUI from 'react-native-purchases-ui'
import { useTheme } from '@/theme/useTheme'
import { useSession } from '@/hooks/useSession'
import { Button, GroupedCard, NavBar, Row, SectionFooter, SectionHeader } from '@/components/ui'
import { confirmEmailUpgrade, deleteMyAccount, signOut, startEmailUpgrade } from '@/lib/auth'
import { getNotificationPrefs, setNotificationPrefs } from '@/lib/data'
import { registerForPushNotifications } from '@/lib/push'
import { errorMessage } from '@/lib/errors'
import { PRIVACY_POLICY_URL, TERMS_OF_USE_URL } from '@/lib/legal'

export default function SettingsScreen() {
  const c = useTheme()
  const { session } = useSession()
  const isAnonymous = Boolean((session?.user as { is_anonymous?: boolean } | undefined)?.is_anonymous)
  const email = session?.user?.email

  const [notif, setNotif] = useState<boolean | null>(null)
  const [notifBusy, setNotifBusy] = useState(false)

  useEffect(() => {
    getNotificationPrefs()
      .then(setNotif)
      .catch(() => setNotif(true))
  }, [])

  const onToggleNotif = async (next: boolean) => {
    setNotif(next)
    setNotifBusy(true)
    try {
      if (next) {
        const result = await registerForPushNotifications()
        if (!result.ok && result.reason === 'permission-denied') {
          Alert.alert('Notifications off', 'Turn on notifications for Bitescore in Settings to get score-change alerts.')
        }
      }
      await setNotificationPrefs(next)
    } catch (e) {
      setNotif(!next)
      Alert.alert('Couldn’t update', errorMessage(e))
    } finally {
      setNotifBusy(false)
    }
  }

  const onSignOut = () => {
    if (isAnonymous) {
      Alert.alert(
        'You haven’t added an email yet',
        'Signing out now permanently loses your lists, visits and reviews — there’s no way back in without an email on this account. Add one first to keep them.',
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

  const onDelete = () => {
    Alert.alert(
      'Delete your account?',
      'This permanently deletes your lists, visits, reviews and followers. This can’t be undone.',
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
    <SafeAreaView edges={['top']} style={[styles.root, { backgroundColor: c.bg }]}>
      <NavBar backLabel="Profile" title="Settings" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ paddingTop: 16, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
          <SectionHeader>Account</SectionHeader>
          {email ? (
            <GroupedCard>
              <Row title="Email" value={email} />
            </GroupedCard>
          ) : (
            <EmailUpgrade />
          )}

          <SectionHeader style={{ paddingTop: 24 }}>Notifications</SectionHeader>
          <GroupedCard>
            <Row
              title="Score-change alerts"
              subtitle="When a place on your lists is re-inspected."
              right={
                notif === null ? (
                  <ActivityIndicator color={c.meta} />
                ) : (
                  <Switch
                    value={notif}
                    onValueChange={onToggleNotif}
                    disabled={notifBusy}
                    trackColor={{ true: c.switchOn, false: c.separator }}
                    thumbColor="#FFFFFF"
                  />
                )
              }
            />
          </GroupedCard>
          <SectionFooter>
            After you tap Directions, we remind you two hours later to rate the place. Turn notifications
            off in iOS Settings to stop these.
          </SectionFooter>

          <SectionHeader style={{ paddingTop: 24 }}>Subscription</SectionHeader>
          <GroupedCard>
            <Row title="Manage subscription" chevron onPress={() => RevenueCatUI.presentCustomerCenter()} />
          </GroupedCard>

          <SectionHeader style={{ paddingTop: 24 }}>About</SectionHeader>
          <GroupedCard>
            <Row title="Privacy Policy" chevron onPress={() => Linking.openURL(PRIVACY_POLICY_URL)} />
            <Row title="Terms of Use" chevron onPress={() => Linking.openURL(TERMS_OF_USE_URL)} />
          </GroupedCard>
          <SectionFooter>
            Food hygiene ratings © Crown copyright, Food Standards Agency, under the Open Government Licence.
          </SectionFooter>

          <View style={{ height: 24 }} />
          <GroupedCard>
            <Row title="Sign out" titleColor={c.tint} onPress={onSignOut} />
            <Row title="Delete account" titleColor={c.danger} onPress={onDelete} />
          </GroupedCard>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

// Adding an email upgrades the anonymous session in place — same account,
// same lists and visits, just recoverable on a new phone.
function EmailUpgrade() {
  const c = useTheme()
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [stage, setStage] = useState<'email' | 'code'>('email')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={styles.card}>
      <Text style={[styles.hint, { color: c.label2 }]}>
        Add an email so you never lose your lists and visits if you switch phones.
      </Text>
      {stage === 'email' ? (
        <>
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            placeholderTextColor={c.meta}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            style={[styles.input, { backgroundColor: c.bg, color: c.label }]}
          />
          <Button
            label="Send me a code"
            size="medium"
            loading={busy}
            disabled={!email.trim()}
            onPress={() => run(async () => {
              await startEmailUpgrade(email)
              setStage('code')
            })}
          />
        </>
      ) : (
        <>
          <Text style={[styles.hint, { color: c.meta }]}>Enter the 6-digit code sent to {email}</Text>
          <TextInput
            value={code}
            onChangeText={setCode}
            placeholder="123456"
            placeholderTextColor={c.meta}
            keyboardType="number-pad"
            style={[styles.input, { backgroundColor: c.bg, color: c.label }]}
          />
          <Button
            label="Confirm"
            size="medium"
            loading={busy}
            disabled={!code.trim()}
            onPress={() => run(() => confirmEmailUpgrade(email, code))}
          />
        </>
      )}
      {error ? <Text style={[styles.error, { color: c.danger }]}>{error}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  card: { marginHorizontal: 16, backgroundColor: '#FFFFFF', borderRadius: 14, padding: 16, gap: 10 },
  hint: { fontSize: 14, lineHeight: 19 },
  input: { height: 44, borderRadius: 10, paddingHorizontal: 12, fontSize: 16 },
  error: { fontSize: 13, textAlign: 'center' },
})
