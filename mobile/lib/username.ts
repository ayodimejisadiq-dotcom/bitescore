// Derives a public username from a real name — recognizable to the person
// themselves, but not a giveaway of their full identity to other users (used
// on reviews instead of a real name). "John Smith" -> something like
// "johns482". Not guaranteed unique on its own; callers retry on collision.

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '')
}

export function generateUsername(firstName: string, lastName: string): string {
  const f = slug(firstName).slice(0, 8) || 'user'
  const lInitial = slug(lastName).charAt(0)
  const suffix = Math.floor(100 + Math.random() * 900)
  return `${f}${lInitial}${suffix}`
}

// Used when the user types their own username directly.
export function sanitizeUsername(raw: string): string {
  return raw.trim().toLowerCase().replace(/[^a-z0-9_]/g, '')
}
