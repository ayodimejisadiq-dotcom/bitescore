// Supabase-js query errors (PostgrestError) are plain objects with a
// `.message` string — they are NOT instanceof Error. Using `instanceof Error`
// alone to extract a message misses them and falls back to `String(e)`,
// which renders as the useless "[object Object]". This covers both shapes.
export function errorMessage(e: unknown): string {
  if (typeof e === 'object' && e !== null && 'message' in e) {
    const m = (e as { message: unknown }).message
    if (typeof m === 'string' && m.length > 0) return m
  }
  return String(e)
}

// Search failures are shown under the search bar, so keep database wording
// ("canceling statement due to statement timeout") out of them. The real
// error still goes to the log.
export function searchErrorMessage(e: unknown): string {
  console.warn('[bitescore] search failed', e)
  return 'Search didn’t finish. Check your connection and try again.'
}

// What people see in alerts and empty states. Supabase, Postgres and the
// network speak in their own terms ("TypeError: Network request failed",
// "new row violates row-level security policy"); translate the ones we know,
// hide anything else that reads like a stack trace, and keep messages our own
// code wrote for people. The raw error still goes to the log.
const FRIENDLY: [RegExp, string][] = [
  [/statement timeout|canceling statement/i, 'That took too long. Try again in a moment.'],
  [/network request failed|failed to fetch|fetch failed|network ?error|aborted|timed? ?out/i,
    'Check your connection and try again.'],
  [/not signed in|not authenticated|jwt|refresh token/i, 'Your session ended. Close and reopen the app, then try again.'],
  [/list_not_found/i, 'That list no longer exists.'],
  [/not_owner|not_allowed|not_following|row-level security|permission denied/i,
    'You don’t have access to do that.'],
  [/too_far/i, 'You need to be at the place to do that.'],
  [/daily_visit_cap/i, 'You’ve logged the most visits allowed for today.'],
  [/duplicate key|already exists|23505/i, 'That already exists.'],
]
const TECHNICAL = /TypeError|PGRST|violates|relation |function |syntax|null value|column |\bsql\b|\[object Object\]/i

export function friendlyMessage(e: unknown): string {
  const raw = errorMessage(e)
  console.warn('[bitescore] error shown to user', e)
  for (const [pattern, text] of FRIENDLY) if (pattern.test(raw)) return text
  if (TECHNICAL.test(raw)) return 'Something went wrong. Try again.'
  return raw
}
