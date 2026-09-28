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
