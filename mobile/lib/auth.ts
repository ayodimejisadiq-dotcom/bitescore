import { supabase } from './supabase'

// Email magic-link auth — works with zero extra provisioning since Supabase's
// email provider is on by default. Apple/Google sign-in are fast-follows once
// their OAuth client credentials exist (Apple Developer / Google Cloud).

// Sends a 6-digit one-time code by email (not a clickable link) — avoids
// needing universal links / deep-link config to be set up for auth to work.
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

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}

export async function updateDisplayName(displayName: string): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Not signed in')
  const { error } = await supabase
    .from('profiles')
    .update({ display_name: displayName.trim() })
    .eq('user_id', user.id)
  if (error) throw error
}

// GDPR / Apple-mandated in-app account deletion.
export async function deleteMyAccount(): Promise<void> {
  const { error } = await supabase.rpc('delete_my_account')
  if (error) throw error
  await supabase.auth.signOut()
}
