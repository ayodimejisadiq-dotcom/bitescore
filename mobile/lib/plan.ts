import { supabase } from './supabase'

// The free plan: a monthly allowance of restaurant pages for people without
// Pro (migration 0026). The allowance is set on the server, so it can change
// or be switched off (0) without an app update.

export interface FreePlanStatus {
  free_limit: number
  used: number
  resets_on: string // first day of next month, YYYY-MM-DD
}

export interface FreePlaceClaim extends FreePlanStatus {
  allowed: boolean
}

export async function getFreePlanStatus(): Promise<FreePlanStatus> {
  const { data, error } = await supabase.rpc('free_plan_status').single()
  if (error) throw error
  return data as FreePlanStatus
}

// Counts opening this place against the allowance (re-opening one already
// counted this month is free) and says whether it may be shown.
export async function claimFreePlace(restaurantId: string): Promise<FreePlaceClaim> {
  const { data, error } = await supabase
    .rpc('claim_free_place', { p_restaurant_id: restaurantId })
    .single()
  if (error) throw error
  return data as FreePlaceClaim
}

export function freeLeft(s: FreePlanStatus): number {
  return Math.max(0, s.free_limit - s.used)
}

// "1 November"
export function resetsLabel(s: FreePlanStatus): string {
  return new Date(`${s.resets_on}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })
}

// Whether the free plan needs Sign in with Apple first, so a reinstall can't
// reset the monthly count (app_config.free_requires_sign_in). Off if unset
// or unreadable: never block someone over a lookup.
export async function getFreeRequiresSignIn(): Promise<boolean> {
  const { data, error } = await supabase
    .from('app_config')
    .select('value')
    .eq('key', 'free_requires_sign_in')
    .maybeSingle()
  if (error || !data) return false
  return data.value === true
}
