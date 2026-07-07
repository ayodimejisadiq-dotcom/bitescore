import type { VercelRequest, VercelResponse } from '@vercel/node'
import { admin } from '../../lib/supabase.js'
import { findPlace, getPlaceDetails } from '../../lib/places.js'

// Called by the mobile app when a user opens a restaurant's detail page.
// Lazy, per-restaurant — not a bulk job. Caches for 30 days (Google's terms
// require periodic refresh rather than indefinite caching) so repeat views
// of the same restaurant, by any number of users, cost at most one Google
// call per month.
const CACHE_MS = 30 * 24 * 60 * 60 * 1000

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const restaurantId = req.query.restaurantId
  if (typeof restaurantId !== 'string') {
    return res.status(400).json({ error: 'restaurantId is required' })
  }

  const { data: restaurant, error: fetchErr } = await admin
    .from('restaurants')
    .select('id,name,postcode,google_place_id,google_rating,google_rating_count,google_data_fetched_at,hours_cache')
    .eq('id', restaurantId)
    .maybeSingle()
  if (fetchErr) return res.status(500).json({ error: fetchErr.message })
  if (!restaurant) return res.status(404).json({ error: 'restaurant not found' })

  const fetchedAt = restaurant.google_data_fetched_at
    ? new Date(restaurant.google_data_fetched_at).getTime()
    : 0
  const isFresh = Date.now() - fetchedAt < CACHE_MS

  if (isFresh) {
    return res.status(200).json({
      googleRating: restaurant.google_rating,
      googleRatingCount: restaurant.google_rating_count,
      hours: restaurant.hours_cache,
      cached: true,
    })
  }

  if (!restaurant.postcode) {
    // Can't reliably text-search without at least a postcode; leave cached
    // values (if any) as-is rather than risk a bad match.
    return res.status(200).json({
      googleRating: restaurant.google_rating,
      googleRatingCount: restaurant.google_rating_count,
      hours: restaurant.hours_cache,
      cached: true,
    })
  }

  try {
    let placeId = restaurant.google_place_id as string | null
    if (!placeId) {
      const match = await findPlace(restaurant.name, restaurant.postcode)
      placeId = match?.placeId ?? null
    }

    if (!placeId) {
      // No confident match — record the attempt so we don't retry every view.
      await admin
        .from('restaurants')
        .update({ google_data_fetched_at: new Date().toISOString() })
        .eq('id', restaurantId)
      return res.status(200).json({ googleRating: null, googleRatingCount: null, hours: null, cached: false })
    }

    const details = await getPlaceDetails(placeId)
    const hoursCache = details.openingHours
      ? { open_now: details.openingHours.openNow, weekday_text: details.openingHours.weekdayDescriptions }
      : null

    await admin
      .from('restaurants')
      .update({
        google_place_id: placeId,
        google_rating: details.rating,
        google_rating_count: details.userRatingCount,
        google_data_fetched_at: new Date().toISOString(),
        hours_cache: hoursCache,
        hours_fetched_at: new Date().toISOString(),
      })
      .eq('id', restaurantId)

    return res.status(200).json({
      googleRating: details.rating,
      googleRatingCount: details.userRatingCount,
      hours: hoursCache,
      cached: false,
    })
  } catch (err) {
    // Places lookup failed (rate limit, bad key, network) — fall back to
    // whatever was already cached rather than erroring the detail page.
    return res.status(200).json({
      googleRating: restaurant.google_rating,
      googleRatingCount: restaurant.google_rating_count,
      hours: restaurant.hours_cache,
      cached: true,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
