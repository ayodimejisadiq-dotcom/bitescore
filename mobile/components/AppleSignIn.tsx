import { useCallback, useEffect, useState } from 'react'
import { Alert, StyleSheet, View, type ViewStyle } from 'react-native'
import * as AppleAuthentication from 'expo-apple-authentication'
import { isAppleSignInAvailable, signInWithApple } from '@/lib/appleAuth'
import { errorMessage } from '@/lib/errors'
import { useSession } from '@/hooks/useSession'

// Shared state for the Sign in with Apple buttons: whether this device can
// offer it, whether the account already has an Apple ID, and a run() that
// handles cancel and failure the same way everywhere.
export function useAppleSignIn() {
  const { session } = useSession()
  const [available, setAvailable] = useState<boolean | null>(null)
  const [justLinked, setJustLinked] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    isAppleSignInAvailable().then(setAvailable)
  }, [])

  useEffect(() => setJustLinked(false), [session?.user.id])

  // From the local session, so an offline launch can't misreport it.
  const linked = justLinked || !!session?.user.identities?.some((i) => i.provider === 'apple')
  const ready = available !== null

  // Resolves true once signed in; false if cancelled or it failed (failure
  // is shown to the user here).
  const run = useCallback(async (): Promise<boolean> => {
    if (busy) return false
    setBusy(true)
    try {
      const result = await signInWithApple()
      if (result === 'cancelled') return false
      setJustLinked(true)
      return true
    } catch (e) {
      Alert.alert('Couldn’t sign in with Apple', errorMessage(e))
      return false
    } finally {
      setBusy(false)
    }
  }, [busy])

  return { available: available === true, linked, ready, busy, run }
}

// Apple's own button, as App Review expects for Sign in with Apple.
export function AppleSignInButton({
  onPress,
  label = 'continue',
  style,
}: {
  onPress: () => void
  label?: 'continue' | 'sign-in'
  style?: ViewStyle
}) {
  return (
    <View style={[styles.wrap, style]}>
      <AppleAuthentication.AppleAuthenticationButton
        buttonType={
          label === 'sign-in'
            ? AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN
            : AppleAuthentication.AppleAuthenticationButtonType.CONTINUE
        }
        buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
        cornerRadius={14}
        style={styles.button}
        onPress={onPress}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { alignSelf: 'stretch' },
  button: { height: 50, width: '100%' },
})
