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
