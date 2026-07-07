// Google Places API (New) client. Server-only — the API key must never reach
// the mobile app. Used lazily, one restaurant at a time, when a user opens
// its detail page (not a bulk backfill — see PLAN.md for why that's deferred).

const PLACES_BASE = 'https://places.googleapis.com/v1'

function apiKey(): string {
  const key = process.env.GOOGLE_PLACES_API_KEY
  if (!key) throw new Error('Missing GOOGLE_PLACES_API_KEY')
  return key
}

export interface PlaceMatch {
  placeId: string
}

export interface PlaceDetails {
  rating: number | null
  userRatingCount: number | null
  openingHours: { openNow?: boolean; weekdayDescriptions?: string[] } | null
}

// Finds the best-guess Google Place for an FSA establishment by name +
// postcode. Best-effort text match, not a guaranteed correct match — chains,
// closed businesses, and renamed venues can mismatch.
export async function findPlace(name: string, postcode: string): Promise<PlaceMatch | null> {
  const res = await fetch(`${PLACES_BASE}/places:searchText`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey(),
      'X-Goog-FieldMask': 'places.id',
    },
    body: JSON.stringify({
      textQuery: `${name}, ${postcode}, UK`,
      maxResultCount: 1,
    }),
  })
  if (!res.ok) throw new Error(`Places searchText -> ${res.status}`)
  const data = (await res.json()) as { places?: { id: string }[] }
  const place = data.places?.[0]
  return place ? { placeId: place.id } : null
}

export async function getPlaceDetails(placeId: string): Promise<PlaceDetails> {
  const res = await fetch(`${PLACES_BASE}/places/${placeId}`, {
    headers: {
      'X-Goog-Api-Key': apiKey(),
      'X-Goog-FieldMask': 'rating,userRatingCount,regularOpeningHours',
    },
  })
  if (!res.ok) throw new Error(`Places details -> ${res.status}`)
  const data = (await res.json()) as {
    rating?: number
    userRatingCount?: number
    regularOpeningHours?: { openNow?: boolean; weekdayDescriptions?: string[] }
  }
  return {
    rating: data.rating ?? null,
    userRatingCount: data.userRatingCount ?? null,
    openingHours: data.regularOpeningHours
      ? {
          openNow: data.regularOpeningHours.openNow,
          weekdayDescriptions: data.regularOpeningHours.weekdayDescriptions,
        }
      : null,
  }
}
