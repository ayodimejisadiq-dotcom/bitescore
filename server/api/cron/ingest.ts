import type { VercelRequest, VercelResponse } from '@vercel/node'
import { waitUntil } from '@vercel/functions'
import { admin } from '../../lib/supabase.js'
import {
  fetchAuthorities,
  fetchEstablishmentsPage,
  isDining,
  toRow,
  type RestaurantRow,
} from '../../lib/fsa.js'

// The FSA dataset spans ~380 local authorities and 600k+ establishments, far
// more than one serverless invocation can process. This job is resumable: it
// keeps a cursor in `ingest_state` and works through the authority list a slice
// at a time, self-continuing until a full pass completes. A daily Vercel cron
// kicks off the first slice.

const BUDGET_MS = 45_000 // leave headroom under the function's maxDuration
const PAGE_SIZE = 1000 // FSA max page size
const UPSERT_BATCH = 500 // rows per ingest_upsert call

function authorized(req: VercelRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  // Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`. Also accept it as
  // a query param for manual/continuation triggers.
  const auth = req.headers.authorization
  if (auth === `Bearer ${secret}`) return true
  if (req.query.secret === secret) return true
  return false
}

async function ingestAuthority(authorityId: number): Promise<number> {
  let page = 1
  let totalPages = 1
  let seen = 0
  let buffer: RestaurantRow[] = []

  const flush = async () => {
    if (buffer.length === 0) return
    const { error } = await admin.rpc('ingest_upsert', { rows: buffer })
    if (error) throw new Error(`ingest_upsert: ${error.message}`)
    buffer = []
  }

  do {
    const { establishments, totalPages: tp } = await fetchEstablishmentsPage(
      authorityId,
      page,
      PAGE_SIZE,
    )
    totalPages = tp
    for (const e of establishments) {
      if (!isDining(e.BusinessType)) continue
      buffer.push(toRow(e))
      seen++
      if (buffer.length >= UPSERT_BATCH) await flush()
    }
    page++
  } while (page <= totalPages)

  await flush()
  return seen
}

// Continuation so one cron tick can drive a full pass rather than a single
// 45-second slice. Handed to waitUntil: a bare `void fetch(...)` is frozen the
// instant the response returns, so most continuations were never dispatched at
// all and each daily cron advanced the cursor by one slice. That put a full
// pass at roughly three weeks, which is how a rating could change on 8 July and
// still not be live in mid-August. Guarded by the cursor so it can't loop
// forever, and by the lease below so it can't overlap the next cron tick.
function triggerContinuation(req: VercelRequest): void {
  const host = req.headers['x-forwarded-host'] ?? req.headers.host
  const proto = req.headers['x-forwarded-proto'] ?? 'https'
  const secret = process.env.CRON_SECRET ?? ''
  // `continuation` waives the lease: this run has already finished its slice
  // and just refreshed last_run_at, so the lease it would otherwise contend
  // with is its own. A chain is serial by construction, and still authorized.
  const url = `${proto}://${host}/api/cron/ingest?secret=${encodeURIComponent(secret)}&continuation=1`
  // Not awaited — the next invocation runs independently — but waitUntil keeps
  // this one alive long enough for the request to actually leave.
  waitUntil(fetch(url, { method: 'POST' }).catch(() => {}))
}

// A run is expected to finish within maxDuration (60s). If ingest_state was
// touched more recently than this, another invocation is mid-slice and this one
// should stand down: the cron now fires every 15 minutes, so ticks would
// otherwise overlap the continuation chain and re-fetch authorities a second
// invocation is already working through. Upserts are idempotent, so an overlap
// is wasted work rather than corruption — but wasted work is what starves the
// cursor.
const LEASE_MS = 90_000

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!authorized(req)) return res.status(401).json({ error: 'unauthorized' })

  const started = Date.now()

  // Claim the lease and read state in one write: the update only matches when
  // the last run is old enough to have finished, so a losing invocation gets
  // zero rows back and exits instead of duplicating a slice.
  const leaseCutoff = new Date(Date.now() - LEASE_MS).toISOString()
  const isContinuation = req.query.continuation === '1'
  const claim = admin
    .from('ingest_state')
    .update({ last_run_at: new Date().toISOString() })
    .eq('id', 1)
  const { data: claimed, error: stateErr } = await (isContinuation
    ? claim.select()
    : claim.or(`last_run_at.is.null,last_run_at.lt.${leaseCutoff}`).select())

  if (stateErr) return res.status(500).json({ error: stateErr.message })
  if (!claimed || claimed.length === 0) {
    return res.status(200).json({ ok: true, skipped: 'another run holds the lease' })
  }
  const state = claimed[0]

  const authorities = await fetchAuthorities()
  let cursor: number = state.cursor ?? 0
  if (cursor >= authorities.length) cursor = 0 // start a fresh pass

  const passStartedAt = cursor === 0 ? new Date().toISOString() : state.pass_started_at

  let processed = 0
  let seen = 0
  while (cursor < authorities.length && Date.now() - started < BUDGET_MS) {
    seen += await ingestAuthority(authorities[cursor].id)
    cursor++
    processed++
  }

  const done = cursor >= authorities.length
  await admin
    .from('ingest_state')
    .update({
      cursor: done ? 0 : cursor,
      authority_count: authorities.length,
      pass_started_at: passStartedAt,
      last_run_at: new Date().toISOString(),
      last_completed_at: done ? new Date().toISOString() : state.last_completed_at,
      establishments_seen: (cursor === processed ? 0 : state.establishments_seen ?? 0) + seen,
    })
    .eq('id', 1)

  if (!done) triggerContinuation(req)

  return res.status(200).json({
    ok: true,
    processedAuthorities: processed,
    diningEstablishmentsSeen: seen,
    cursor: done ? 0 : cursor,
    totalAuthorities: authorities.length,
    done,
  })
}
