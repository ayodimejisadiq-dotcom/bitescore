// One-off: gives everyone who used the old free plan a free month of Pro, as
// a RevenueCat promotional entitlement, before the free plan is switched off
// (migration 0033). Run BEFORE applying 0033 / shipping the update.
//
//   cd server
//   node --env-file=.env scripts/grant-free-month.mjs           # dry run: counts only
//   node --env-file=.env scripts/grant-free-month.mjs --apply   # grants
//
// Needs SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and REVENUECAT_SECRET_KEY
// (RevenueCat -> Project settings -> API keys -> a v1 secret key, sk_...).
// Safe to re-run: anyone who already has Pro (bought or granted) is skipped.
import { createClient } from '@supabase/supabase-js'

const ENTITLEMENT_ID = 'Bitescore Pro' // must match mobile/lib/purchases.ts
const apply = process.argv.includes('--apply')
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, REVENUECAT_SECRET_KEY } = process.env
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !REVENUECAT_SECRET_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / REVENUECAT_SECRET_KEY')
  process.exit(1)
}

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

// Everyone with a free_opens row: they chose the free plan and used it.
async function freeUsers() {
  const ids = new Set()
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from('free_opens').select('user_id').range(from, from + 999)
    if (error) throw error
    data.forEach((r) => ids.add(r.user_id))
    if (data.length < 1000) break
  }
  return [...ids]
}

const rc = (path, init = {}) =>
  fetch(`https://api.revenuecat.com/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${REVENUECAT_SECRET_KEY}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })

async function hasPro(userId) {
  const res = await rc(`/subscribers/${encodeURIComponent(userId)}`)
  if (!res.ok) throw new Error(`lookup ${userId}: ${res.status} ${await res.text()}`)
  const ent = (await res.json()).subscriber?.entitlements?.[ENTITLEMENT_ID]
  return !!ent && (ent.expires_date === null || new Date(ent.expires_date) > new Date())
}

async function grantMonth(userId) {
  const res = await rc(
    `/subscribers/${encodeURIComponent(userId)}/entitlements/${encodeURIComponent(ENTITLEMENT_ID)}/promotional`,
    { method: 'POST', body: JSON.stringify({ duration: 'monthly' }) },
  )
  if (!res.ok) throw new Error(`grant ${userId}: ${res.status} ${await res.text()}`)
}

const users = await freeUsers()
console.log(`${users.length} free-plan users`)
let granted = 0, skipped = 0, failed = 0
for (const id of users) {
  try {
    if (await hasPro(id)) {
      skipped++
      continue
    }
    if (apply) await grantMonth(id)
    granted++
  } catch (e) {
    failed++
    console.warn(String(e))
  }
  await new Promise((r) => setTimeout(r, 150)) // stay well under RevenueCat's rate limit
}
console.log(`${apply ? 'Granted' : 'Would grant'}: ${granted} · already Pro: ${skipped} · failed: ${failed}`)
if (!apply) console.log('Dry run. Re-run with --apply to grant.')
