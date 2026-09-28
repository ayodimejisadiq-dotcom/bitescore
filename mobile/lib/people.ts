// How a person is shown to others. Real first/last names are private; the
// public face is the optional public_name they chose, else their @username.

export interface PersonName {
  username?: string | null
  public_name?: string | null
}

export function displayName(p: PersonName): string {
  const name = p.public_name?.trim()
  if (name) return name
  return p.username ? `@${p.username}` : 'Someone'
}

// First name only, for compact copy like "Maya and Tom have been here".
export function shortName(p: PersonName): string {
  const name = p.public_name?.trim()
  if (name) return name.split(/\s+/)[0]
  return p.username ? `@${p.username}` : 'Someone'
}

export function handle(p: PersonName): string {
  return p.username ? `@${p.username}` : ''
}

export function initialsFor(p: PersonName): string {
  const name = p.public_name?.trim()
  if (name) {
    const parts = name.split(/\s+/).filter(Boolean)
    const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : parts[0].slice(0, 2)
    return letters.toUpperCase()
  }
  return (p.username ?? '?').replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase() || '?'
}

// "Maya", "Maya and Tom", "Maya, Tom and 3 others"
export function joinNames(names: string[], total = names.length): string {
  if (total === 0) return ''
  const others = total - names.length
  if (others > 0) {
    const shown = names.join(', ')
    return `${shown} and ${others} other${others === 1 ? '' : 's'}`
  }
  if (names.length === 1) return names[0]
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

// Tiers by verified visits: Taster 0–19, Regular 20–49, Foodie 50–99,
// Connoisseur 100+.
export const TIERS = [
  { name: 'Taster', from: 0 },
  { name: 'Regular', from: 20 },
  { name: 'Foodie', from: 50 },
  { name: 'Connoisseur', from: 100 },
] as const

export function tierFor(visits: number): {
  name: string
  index: number
  next: { name: string; from: number } | null
  toGo: number
  progress: number
} {
  let index = 0
  for (let i = 0; i < TIERS.length; i++) if (visits >= TIERS[i].from) index = i
  const tier = TIERS[index]
  const next = TIERS[index + 1] ?? null
  const progress = next ? (visits - tier.from) / (next.from - tier.from) : 1
  return { name: tier.name, index, next, toGo: next ? next.from - visits : 0, progress }
}

export function distanceLabel(m: number | null | undefined): string | null {
  if (m == null) return null
  const miles = m / 1609.34
  if (miles < 0.1) return `${Math.max(10, Math.round(m / 10) * 10)} m`
  return `${miles < 10 ? miles.toFixed(1) : Math.round(miles)} mi`
}

export function metersBetween(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

export function timeAgo(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  const d = Math.floor(s / 86400)
  if (d === 1) return 'yesterday'
  if (d < 30) return `${d} days ago`
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}
