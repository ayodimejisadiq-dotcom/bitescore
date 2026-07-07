import type { VercelRequest, VercelResponse } from '@vercel/node'
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

// Fire-and-forget continuation so one daily cron can drive a full pass on plans
// with short function limits. Guarded by the cursor so it can't loop forever.
function triggerContinuation(req: VercelRequest): void {
  const host = req.headers['x-forwarded-host'] ?? req.headers.host
  const proto = req.headers['x-forwarded-proto'] ?? 'https'
  const secret = process.env.CRON_SECRET ?? ''
  const url = `${proto}://${host}/api/cron/ingest?secret=${encodeURIComponent(secret)}`
  // Don't await — we want to return promptly and let the next invocation run.
  void fetch(url, { method: 'POST' }).catch(() => {})
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!authorized(req)) return res.status(401).json({ error: 'unauthorized' })

  const started = Date.now()

  const { data: state, error: stateErr } = await admin
    .from('ingest_state')
    .select('*')
    .eq('id', 1)
    .single()
  if (stateErr || !state) return res.status(500).json({ error: 'ingest_state missing' })

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
