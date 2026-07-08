import type { VercelRequest, VercelResponse } from '@vercel/node'
import Expo, { type ExpoPushMessage } from 'expo-server-sdk'
import { admin } from '../../lib/supabase.js'

// Sends push notifications for score_changes the ingestion job has logged
// but not yet notified anyone about (see migration 0004's ingest_upsert and
// migration 0005's notify_candidates). Runs on its own daily cron, a few
// hours after ingestion — there's nothing new to notify about in between,
// since score_changes rows only ever get created during an ingest pass.
//
// Resumable like the ingest job: processes a bounded batch per invocation
// and re-triggers itself if more unsent rows remain, so a large backlog
// (e.g. the first run after this feature ships) can't blow the function's
// time limit.

const BUDGET_MS = 45_000
const BATCH_SIZE = 200 // score_changes rows per invocation

const expo = new Expo()

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

// Friendly text for the notification body — mirrors mobile/lib/fsa.ts's
// ratingLabel, kept as a small standalone copy since the server has no
// access to the mobile app's source.
function ratingText(value: string): string {
  if (/^[0-5]$/.test(value)) return value
  switch (value) {
    case 'AwaitingInspection':
      return 'Awaiting inspection'
    case 'AwaitingPublication':
      return 'Awaiting publication'
    case 'Exempt':
      return 'Exempt'
    default:
      return value
  }
}

function triggerContinuation(req: VercelRequest): void {
  const host = req.headers['x-forwarded-host'] ?? req.headers.host
  const proto = req.headers['x-forwarded-proto'] ?? 'https'
  const secret = process.env.CRON_SECRET ?? ''
  const url = `${proto}://${host}/api/cron/notify?secret=${encodeURIComponent(secret)}`
  // Don't await — return promptly and let the next invocation pick up where
  // this one left off.
  void fetch(url, { method: 'POST' }).catch(() => {})
}

interface PendingChange {
  id: string
  restaurant_id: string
  new_rating: string
  restaurants: { name: string } | null
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!authorized(req)) return res.status(401).json({ error: 'unauthorized' })

  const started = Date.now()

  const { data: changes, error: changesErr } = await admin
    .from('score_changes')
    .select('id, restaurant_id, new_rating, restaurants(name)')
    .is('notified_at', null)
    .order('changed_at', { ascending: true })
    .limit(BATCH_SIZE)
  if (changesErr) return res.status(500).json({ error: changesErr.message })

  const pending = (changes ?? []) as unknown as PendingChange[]
  let messagesSent = 0
  const doneIds: string[] = []

  for (const change of pending) {
    if (Date.now() - started > BUDGET_MS) break

    const { data: recipients, error: recErr } = await admin.rpc('notify_candidates', {
      p_restaurant_id: change.restaurant_id,
    })
    if (recErr) continue // leave unmarked — retried next run

    const restaurantName = change.restaurants?.name ?? 'A place you saved'
    const messages: ExpoPushMessage[] = (recipients ?? [])
      .filter((r: { expo_token: string }) => Expo.isExpoPushToken(r.expo_token))
      .map((r: { expo_token: string }) => ({
        to: r.expo_token,
        title: 'Bitescore',
        body: `${restaurantName}’s hygiene rating changed to ${ratingText(change.new_rating)}`,
        data: { restaurantId: change.restaurant_id },
      }))

    let sendFailed = false
    for (const chunk of expo.chunkPushNotifications(messages)) {
      try {
        await expo.sendPushNotificationsAsync(chunk)
        messagesSent += chunk.length
      } catch {
        sendFailed = true
      }
    }

    if (!sendFailed) doneIds.push(change.id)
  }

  if (doneIds.length) {
    await admin
      .from('score_changes')
      .update({ notified_at: new Date().toISOString() })
      .in('id', doneIds)
  }

  const remaining = pending.length >= BATCH_SIZE
  if (remaining) triggerContinuation(req)

  return res.status(200).json({
    ok: true,
    scoreChangesProcessed: doneIds.length,
    messagesSent,
    remaining,
  })
}
