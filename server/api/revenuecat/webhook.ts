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
  transferred_from?: string[]
  transferred_to?: string[]
}

// Only events that change access touch the table. Everything else (TEST,
// SUBSCRIBER_ALIAS, INVOICE_ISSUANCE, EXPERIMENT_ENROLLMENT, ...) is not a
// purchase, and used to be written as an active Pro row with no product.
const ACCESS_EVENTS = new Set([
  'INITIAL_PURCHASE',
  'RENEWAL',
  'NON_RENEWING_PURCHASE',
  'UNCANCELLATION',
  'PRODUCT_CHANGE',
  'SUBSCRIPTION_EXTENDED',
  'TEMPORARY_ENTITLEMENT_GRANT',
  'REFUND_REVERSED',
  'CANCELLATION',
  'BILLING_ISSUE',
  'EXPIRATION',
])

// Our app user ids are Supabase user ids. Anything else (e.g. RevenueCat's
// $RCAnonymousID) has no account to attach to; writing it would fail the
// foreign key, 500, and make RevenueCat retry it for days.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isUserId = (id: string | undefined): id is string => !!id && UUID.test(id)

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
  if (!event?.type) return res.status(400).json({ error: 'missing event.type' })

  if (event.type === 'TRANSFER') {
    const { error } = await transfer(event.transferred_from ?? [], event.transferred_to ?? [])
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ ok: true })
  }

  if (!ACCESS_EVENTS.has(event.type) || !isUserId(event.app_user_id)) {
    return res.status(200).json({ ok: true, ignored: event.type })
  }

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

// A restore on another account moves the purchase there: copy the row to the
// new owner(s) and switch the old one(s) off.
async function transfer(from: string[], to: string[]) {
  const fromIds = from.filter(isUserId)
  const toIds = to.filter(isUserId)
  if (fromIds.length === 0) return { error: null }

  const { data, error } = await admin
    .from('entitlements')
    .select('product, status, expires_at')
    .in('user_id', fromIds)
    .eq('status', 'active')
    .limit(1)
  if (error) return { error }

  const now = new Date().toISOString()
  const moved = data?.[0]
  if (moved && toIds.length > 0) {
    const { error: upsertError } = await admin.from('entitlements').upsert(
      toIds.map((user_id) => ({ ...moved, user_id, source: 'revenuecat', updated_at: now })),
      { onConflict: 'user_id' },
    )
    if (upsertError) return { error: upsertError }
  }

  return admin
    .from('entitlements')
    .update({ status: 'inactive', updated_at: now })
    .in('user_id', fromIds)
}
