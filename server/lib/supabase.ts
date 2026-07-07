import { createClient } from '@supabase/supabase-js'

// Server-side Supabase client using the service-role key. Bypasses RLS — never
// expose this key to the app or the browser.
const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !serviceKey) {
  throw new Error(
    'Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. Set them in the server env.',
  )
}

export const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})
