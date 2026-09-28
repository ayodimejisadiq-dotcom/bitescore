import { supabase } from './supabase'

// Where Supabase's email links send people back to. The project's emails are
// link-only (their templates can't show a code without custom SMTP), so
// tapping the link on the phone must land in the app with the session in the
// URL. Must be listed under Supabase → Authentication → URL Configuration →
// Redirect URLs, or Supabase falls back to the Site URL instead.
export const AUTH_REDIRECT = 'bitescore://auth-callback'

// Reads a Supabase auth redirect (sign-in or email-change link) and signs the
// app into that session. Returns null when the URL isn't one, otherwise an
// error message or '' on success.
export async function handleAuthRedirect(url: string | null): Promise<string | null> {
  if (!url || !url.includes('auth-callback')) return null
  const params = new URLSearchParams()
  const [beforeHash, hash = ''] = url.split('#')
  const query = beforeHash.split('?')[1] ?? ''
  for (const part of [query, hash]) {
    new URLSearchParams(part).forEach((v, k) => params.set(k, v))
  }

  const failure = params.get('error_description') ?? params.get('error')
  if (failure) return failure.replace(/\+/g, ' ')

  const accessToken = params.get('access_token')
  const refreshToken = params.get('refresh_token')
  const code = params.get('code')
  try {
    if (accessToken && refreshToken) {
      const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
      if (error) return error.message
      return ''
    }
    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code)
      if (error) return error.message
      return ''
    }
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
  return 'That sign-in link was incomplete. Request a new one.'
}
