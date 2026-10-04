import { supabase } from './supabase'

// A UK postcode, whole or partial, as someone might type it: "WF17 5BB",
// "wf175bb", "WF17 5", "WF17". Must agree with postcode_point (0028).
const POSTCODE = /^[A-Z]{1,2}[0-9][A-Z0-9]?([0-9][A-Z]{0,2})?$/

export function looksLikePostcode(q: string): boolean {
  return POSTCODE.test(q.replace(/\s+/g, '').toUpperCase())
}

export interface PostcodePoint {
  label: string // "WF17 5BB"
  level: 'postcode' | 'sector' | 'district'
  lat: number
  lng: number
  area: string | null // council, e.g. "Kirklees"
}

// Where a postcode is, worked out from the restaurants registered around it
// (no outside geocoder). Null when it isn't one, or nothing is near it.
export async function postcodePoint(q: string): Promise<PostcodePoint | null> {
  const { data, error } = await supabase.rpc('postcode_point', { q }).maybeSingle()
  if (error) throw error
  return (data as PostcodePoint | null) ?? null
}

// How much map to show, and how far to look for places, for each precision.
export const POSTCODE_SPAN: Record<PostcodePoint['level'], { delta: number; radiusM: number }> = {
  postcode: { delta: 0.012, radiusM: 1500 },
  sector: { delta: 0.025, radiusM: 2500 },
  district: { delta: 0.06, radiusM: 5000 },
}
