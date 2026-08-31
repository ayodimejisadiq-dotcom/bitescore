import { supabase } from './supabase'
import { generateUsername, sanitizeUsername } from './username'
import {
  EMPTY_FILTERS,
  type BrowseFilters,
  type ListWithItems,
  type PlaceLookupResult,
  type Restaurant,
  type RestaurantCluster,
  type RestaurantNear,
  type RestaurantPin,
  type Review,
} from './types'

const SERVER_URL = process.env.EXPO_PUBLIC_SERVER_URL

export interface Bounds {
  minLng: number
  minLat: number
  maxLng: number
  maxLat: number
}

// Maps the UI's rating selection to the exact rating_value strings stored in
// the DB — null/empty means no filter (show everything).
function toRatingValues(filters: BrowseFilters): string[] | null {
  if (!filters.ratings || filters.ratings.length === 0) return null
  return filters.ratings.map((r) => (r === 'awaiting' ? 'AwaitingInspection' : String(r)))
}

// Map viewport pins. maxRows is deliberately low by default: every pin becomes
// a custom native view on the map, and a few hundred is where rendering starts
// to cost more than it conveys.
export async function fetchPins(
  bounds: Bounds,
  filters: BrowseFilters,
  maxRows = 150,
): Promise<RestaurantPin[]> {
  const { data, error } = await supabase.rpc('restaurants_in_bounds', {
    min_lng: bounds.minLng,
    min_lat: bounds.minLat,
    max_lng: bounds.maxLng,
    max_lat: bounds.maxLat,
    types: filters.types,
    max_rows: maxRows,
    rating_values: toRatingValues(filters),
  })
  if (error) throw error
  return (data ?? []) as RestaurantPin[]
}

// Grid-aggregated counts for zoomed-out views, where one marker per venue is
// both unreadable and too much native work to render.
export async function fetchClusters(
  bounds: Bounds,
  filters: BrowseFilters,
  cells = 10,
): Promise<RestaurantCluster[]> {
  const { data, error } = await supabase.rpc('restaurant_clusters', {
    min_lng: bounds.minLng,
    min_lat: bounds.minLat,
    max_lng: bounds.maxLng,
    max_lat: bounds.maxLat,
    cells,
    types: filters.types,
    rating_values: toRatingValues(filters),
  })
  if (error) throw error
  // n is a bigint server-side, which PostgREST may serialise as a string.
  return ((data ?? []) as RestaurantCluster[]).map((c) => ({ ...c, n: Number(c.n) }))
}

// "Near me" list, sorted by distance.
export async function fetchNear(
  origin: { lng: number; lat: number },
  radiusM: number,
  filters: BrowseFilters,
): Promise<RestaurantNear[]> {
  const { data, error } = await supabase.rpc('restaurants_near', {
    origin_lng: origin.lng,
    origin_lat: origin.lat,
    radius_m: radiusM,
    types: filters.types,
    rating_values: toRatingValues(filters),
  })
  if (error) throw error
  return (data ?? []) as RestaurantNear[]
}

// Text search by business name or postcode prefix, nearest first. Same filters
// as the map/near-me queries apply here too, for consistency with FilterChips.
//
// Origin is optional: without location permission there is nothing to measure
// from, and the server falls back to alphabetical rather than refusing to
// search.
export async function searchRestaurants(
  query: string,
  filters: BrowseFilters = EMPTY_FILTERS,
  origin?: { lng: number; lat: number } | null,
): Promise<RestaurantNear[]> {
  const q = query.trim()
  if (!q) return []
  const { data, error } = await supabase.rpc('search_restaurants_near', {
    q,
    origin_lng: origin?.lng ?? null,
    origin_lat: origin?.lat ?? null,
    types: filters.types,
    rating_values: toRatingValues(filters),
  })
  if (error) throw error
  return (data ?? []) as RestaurantNear[]
}

export async function getRestaurant(id: string): Promise<Restaurant | null> {
  const { data, error } = await supabase.rpc('restaurant_detail', { p_id: id }).maybeSingle()
  if (error) throw error
  return (data as Restaurant) ?? null
}

// Triggers the server's lazy Google Places lookup (rating + hours) for this
// restaurant. Cheap to call on every detail-page view — the server itself
// skips the actual Google API call if the cached data is still fresh.
export async function lookupPlaceData(restaurantId: string): Promise<PlaceLookupResult | null> {
  if (!SERVER_URL) return null
  try {
    const res = await fetch(`${SERVER_URL}/api/places/lookup?restaurantId=${restaurantId}`)
    if (!res.ok) return null
    const json = await res.json()
    return {
      googleRating: json.googleRating ?? null,
      googleRatingCount: json.googleRatingCount ?? null,
      hours: json.hours ?? null,
    }
  } catch {
    return null
  }
}

export async function getReviews(restaurantId: string): Promise<Review[]> {
  const { data, error } = await supabase
    .from('reviews')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .eq('status', 'visible')
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) throw error
  return (data ?? []) as Review[]
}

// The current user's own review for this restaurant, if any — used to show
// "Edit your review" instead of "Write a review", and to prefill the composer.
export async function getMyReview(restaurantId: string): Promise<Review | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null
  const { data, error } = await supabase
    .from('reviews')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .eq('user_id', user.id)
    .maybeSingle()
  if (error) throw error
  return (data as Review) ?? null
}

// Creates or replaces the current user's review for this restaurant (one
// review per user per place — see migration 0010). Non-anonymous reviews
// snapshot the current username so a later name change doesn't rewrite history.
export async function submitReview({
  restaurantId,
  body,
  isAnonymous,
}: {
  restaurantId: string
  body: string
  isAnonymous: boolean
}): Promise<Review> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Not signed in')

  const displayNameSnapshot = isAnonymous ? null : ((await getProfile())?.username ?? null)

  const { data, error } = await supabase
    .from('reviews')
    .upsert(
      {
        restaurant_id: restaurantId,
        user_id: user.id,
        body,
        is_anonymous: isAnonymous,
        display_name_snapshot: displayNameSnapshot,
        status: 'visible',
      },
      { onConflict: 'user_id,restaurant_id' },
    )
    .select('*')
    .single()
  if (error) throw error
  return data as Review
}

export async function deleteReview(reviewId: string): Promise<void> {
  const { error } = await supabase.from('reviews').delete().eq('id', reviewId)
  if (error) throw error
}

// Flags a review for moderation. Reporting the same review twice is a no-op
// (unique constraint on review_reports) — surfaced to the caller so the UI
// can tell the user they've already reported it.
export async function reportReview(reviewId: string): Promise<{ alreadyReported: boolean }> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Not signed in')
  const { error } = await supabase.from('review_reports').insert({ review_id: reviewId, reporter_id: user.id })
  if (error) {
    if (error.code === '23505') return { alreadyReported: true }
    throw error
  }
  return { alreadyReported: false }
}

// Hides this user's reviews from the current user going forward (RLS on
// `reviews` excludes blocked authors from reviews_read_visible).
export async function blockUser(userId: string): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Not signed in')
  const { error } = await supabase
    .from('user_blocks')
    .upsert({ blocker_id: user.id, blocked_id: userId }, { onConflict: 'blocker_id,blocked_id' })
  if (error) throw error
}

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

export async function fetchMyLists(): Promise<ListWithItems[]> {
  const { data, error } = await supabase
    .from('lists')
    .select(
      'id,name,created_at,list_items(restaurant_id,restaurants(id,name,business_type,rating_value,rating_is_numeric,address,postcode))',
    )
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []).map((l: any) => ({
    id: l.id,
    name: l.name,
    created_at: l.created_at,
    items: (l.list_items ?? [])
      .map((li: any) => li.restaurants)
      .filter(Boolean),
  }))
}

// Just the restaurant ids the user has saved anywhere, for marking rows that
// are already on a list. RLS on `list_items` is gated on ownership of the
// parent list, so an unfiltered select returns this user's saved ids and
// nobody else's. Deliberately not built on fetchMyLists(): that joins the
// full restaurant record for every saved place, which is a lot of payload to
// answer a question that only needs ids.
export async function fetchSavedRestaurantIds(): Promise<string[]> {
  const { data, error } = await supabase.from('list_items').select('restaurant_id')
  if (error) throw error
  // The same place can sit on several lists; callers want a membership test.
  return Array.from(new Set((data ?? []).map((r: { restaurant_id: string }) => r.restaurant_id)))
}

export async function createList(name: string): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Not signed in')
  const { data, error } = await supabase
    .from('lists')
    .insert({ user_id: user.id, name: name.trim() })
    .select('id')
    .single()
  if (error) throw error
  return data.id as string
}

export async function renameList(listId: string, name: string): Promise<void> {
  const { error } = await supabase.from('lists').update({ name: name.trim() }).eq('id', listId)
  if (error) throw error
}

export async function deleteList(listId: string): Promise<void> {
  const { error } = await supabase.from('lists').delete().eq('id', listId)
  if (error) throw error
}

export async function addToList(listId: string, restaurantId: string): Promise<void> {
  const { error } = await supabase
    .from('list_items')
    .upsert({ list_id: listId, restaurant_id: restaurantId }, { onConflict: 'list_id,restaurant_id' })
  if (error) throw error
}

export async function removeFromList(listId: string, restaurantId: string): Promise<void> {
  const { error } = await supabase
    .from('list_items')
    .delete()
    .eq('list_id', listId)
    .eq('restaurant_id', restaurantId)
  if (error) throw error
}

// Which of the current user's lists already contain this restaurant.
export async function listIdsContaining(restaurantId: string): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('list_items')
    .select('list_id')
    .eq('restaurant_id', restaurantId)
  if (error) throw error
  return new Set((data ?? []).map((r) => r.list_id as string))
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

export interface Profile {
  first_name: string | null
  last_name: string | null
  username: string | null
}

export async function getProfile(): Promise<Profile | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null
  const { data, error } = await supabase
    .from('profiles')
    .select('first_name,last_name,username')
    .eq('user_id', user.id)
    .maybeSingle()
  if (error) throw error
  return (data as Profile) ?? null
}

// Saves first/last name and (re)generates a username from them. Retries a
// few times on a username collision before giving up.
export async function saveProfileNames(firstName: string, lastName: string): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Not signed in')

  for (let attempt = 0; attempt < 5; attempt++) {
    const username = generateUsername(firstName, lastName)
    const { error } = await supabase
      .from('profiles')
      .update({ first_name: firstName.trim(), last_name: lastName.trim(), username })
      .eq('user_id', user.id)
    if (!error) return username
    if (error.code !== '23505') throw error // not a unique-violation, don't retry
  }
  throw new Error('Could not generate a unique username — please try again')
}

export async function setUsername(username: string): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Not signed in')
  const clean = sanitizeUsername(username)
  if (!clean) throw new Error('Enter a username')
  const { error } = await supabase.from('profiles').update({ username: clean }).eq('user_id', user.id)
  if (error) throw error
}

// ---------------------------------------------------------------------------
// Notification prefs
// ---------------------------------------------------------------------------

export async function getNotificationPrefs(): Promise<boolean> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return true
  const { data, error } = await supabase
    .from('notification_prefs')
    .select('score_change_enabled')
    .eq('user_id', user.id)
    .maybeSingle()
  if (error) throw error
  return data?.score_change_enabled ?? true
}

export async function setNotificationPrefs(enabled: boolean): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Not signed in')
  const { error } = await supabase
    .from('notification_prefs')
    .upsert({ user_id: user.id, score_change_enabled: enabled }, { onConflict: 'user_id' })
  if (error) throw error
}
