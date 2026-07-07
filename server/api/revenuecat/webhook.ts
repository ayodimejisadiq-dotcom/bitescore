import type { VercelRequest, VercelResponse } from '@vercel/node'
import { admin } from '../../lib/supabase.js'

// RevenueCat webhook -> keeps public.entitlements in sync. Not required for
// the app itself to work (the client checks RevenueCat's SDK directly for
// gating), but useful for server-side/admin visibility into subscription
// state without querying RevenueCat's API separately.
//
// Configure in the RevenueCat dashboard: Project Settings -> Webhooks ->
// URL = https://bitescore.vercel.app/api/revenuecat/webhook, Authorization
// header value = REVENUECAT_WEBHOOK_SECRET.

interface RevenueCatEvent {
  type: string
  app_user_id: string
  product_id?: string
  expiration_at_ms?: number | null
}

function authorized(req: VercelRequest): boolean {
  const secret = process.env.REVENUECAT_WEBHOOK_SECRET
  if (!secret) return false
  return req.headers.authorization === `Bearer ${secret}`
}

function statusFor(event: RevenueCatEvent): 'active' | 'inactive' | 'expired' | 'grace' {
  if (event.type === 'EXPIRATION') return 'expired'
  if (event.type === 'BILLING_ISSUE') return 'grace'
  if (event.type === 'CANCELLATION') {
    // Auto-renew was turned off, but access continues until the period ends.
    if (!event.expiration_at_ms || event.expiration_at_ms > Date.now()) return 'active'
    return 'expired'
  }
  // INITIAL_PURCHASE, RENEWAL, UNCANCELLATION, PRODUCT_CHANGE, NON_RENEWING_PURCHASE, ...
  return 'active'
}

function productFor(event: RevenueCatEvent): 'annual' | 'lifetime' | null {
  const id = (event.product_id ?? '').toLowerCase()
  if (id.includes('lifetime')) return 'lifetime'
  if (id.includes('year') || id.includes('annual')) return 'annual'
  return null
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' })
  if (!authorized(req)) return res.status(401).json({ error: 'unauthorized' })

  const event = req.body?.event as RevenueCatEvent | undefined
  if (!event?.app_user_id) return res.status(400).json({ error: 'missing event.app_user_id' })

  const { error } = await admin.from('entitlements').upsert(
    {
      user_id: event.app_user_id,
      product: productFor(event),
      status: statusFor(event),
      source: 'revenuecat',
      expires_at: event.expiration_at_ms ? new Date(event.expiration_at_ms).toISOString() : null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  )

  if (error) return res.status(500).json({ error: error.message })
  return res.status(200).json({ ok: true })
}
