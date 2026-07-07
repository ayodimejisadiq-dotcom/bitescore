import { supabase } from './supabase'

// Anonymous-first auth: the app signs a user in anonymously on first launch
// (see ensureSession, called from the root layout) so lists/reviews/saves
// work immediately with zero friction. Adding an email later upgrades that
// same session in place — same user_id, existing data carries over — rather
// than creating a separate account.

export async function signInAnonymously(): Promise<void> {
  const { error } = await supabase.auth.signInAnonymously()
  if (error) throw error
}

// Called once at app startup. No-op if a session (anonymous or not) already
// exists from a previous launch.
export async function ensureSession(): Promise<void> {
  const { data } = await supabase.auth.getSession()
  if (!data.session) await signInAnonymously()
}

// --- Returning-user sign-in (existing account, new device/reinstall) -------
// Also doubles as the "verify" step of the anonymous -> real account upgrade
// is handled separately below; this path is for signing back into an
// account that already has a confirmed email, from a fresh install.

export async function sendLoginCode(email: string): Promise<void> {
  const { error } = await supabase.auth.signInWithOtp({ email: email.trim() })
  if (error) throw error
}

export async function verifyLoginCode(email: string, token: string): Promise<void> {
  const { error } = await supabase.auth.verifyOtp({
    email: email.trim(),
    token: token.trim(),
    type: 'email',
  })
  if (error) throw error
}

// --- Upgrading the current (possibly anonymous) session with an email ------

export async function startEmailUpgrade(email: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ email: email.trim() })
  if (error) throw error
}

export async function confirmEmailUpgrade(email: string, token: string): Promise<void> {
  const { error } = await supabase.auth.verifyOtp({
    email: email.trim(),
    token: token.trim(),
    type: 'email_change',
  })
  if (error) throw error
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}

// GDPR / Apple-mandated in-app account deletion.
export async function deleteMyAccount(): Promise<void> {
  const { error } = await supabase.rpc('delete_my_account')
  if (error) throw error
  await supabase.auth.signOut()
}
