import { Platform } from 'react-native'
import * as AppleAuthentication from 'expo-apple-authentication'
import * as Crypto from 'expo-crypto'
import { supabase } from './supabase'

// Sign in with Apple, native (no web redirect). The same Apple ID always
// lands on the same account, so a reinstall keeps lists, Pro and the free
// plan's monthly count.
//
// Supabase setup this relies on: the Apple provider enabled with the app's
// bundle id (com.bitescore.app) under Client IDs, and manual linking allowed,
// so the anonymous account someone has been using can take the Apple ID on.

export async function isAppleSignInAvailable(): Promise<boolean> {
  if (Platform.OS !== 'ios') return false
  try {
    return await AppleAuthentication.isAvailableAsync()
  } catch {
    // Builds made before this module existed (runtime 1.0.3) have no native
    // side to ask.
    return false
  }
}

export type AppleSignInResult = 'signed-in' | 'cancelled'

export async function signInWithApple(): Promise<AppleSignInResult> {
  // Apple signs the hashed nonce into the token; Supabase checks it against
  // the raw one, so a captured token can't be replayed.
  const rawNonce = Crypto.randomUUID()
  const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce)

  let credential: AppleAuthentication.AppleAuthenticationCredential
  try {
    credential = await AppleAuthentication.signInAsync({
      requestedScopes: [AppleAuthentication.AppleAuthenticationScope.EMAIL],
      nonce: hashedNonce,
    })
  } catch (e) {
    if ((e as { code?: string }).code === 'ERR_REQUEST_CANCELED') return 'cancelled'
    throw e
  }
  if (!credential.identityToken) throw new Error('Apple didn’t return a sign-in token. Try again.')
  const token = { provider: 'apple' as const, token: credential.identityToken, nonce: rawNonce }

  // Someone already using the app: attach the Apple ID to this account, so
  // nothing they've saved is left behind.
  const { data } = await supabase.auth.getSession()
  if (data.session) {
    const { error } = await supabase.auth.linkIdentity(token)
    if (!error) {
      // Linking doesn't always refresh the cached user; make the new
      // identity visible to screens that read it.
      await supabase.auth.refreshSession().catch(() => {})
      return 'signed-in'
    }
    // Already belongs to another account: they've signed in with Apple
    // before (another phone, or before a reinstall). Switch to that account.
    if (!isIdentityTaken(error)) throw error
  }

  const { error } = await supabase.auth.signInWithIdToken(token)
  if (error) throw error
  return 'signed-in'
}

function isIdentityTaken(error: { code?: string; message?: string }): boolean {
  return (
    error.code === 'identity_already_exists' ||
    /already (linked|exists|registered)/i.test(error.message ?? '')
  )
}
