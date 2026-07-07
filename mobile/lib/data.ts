import { supabase } from './supabase'
import type {
  BrowseFilters,
  ListWithItems,
  Restaurant,
  RestaurantNear,
  RestaurantPin,
  Review,
} from './types'

export interface Bounds {
  minLng: number
  minLat: number
  maxLng: number
  maxLat: number
}

// Map viewport pins.
export async function fetchPins(
  bounds: Bounds,
  filters: BrowseFilters,
): Promise<RestaurantPin[]> {
  const { data, error } = await supabase.rpc('restaurants_in_bounds', {
    min_lng: bounds.minLng,
    min_lat: bounds.minLat,
    max_lng: bounds.maxLng,
    max_lat: bounds.maxLat,
    min_rating: filters.minRating,
    types: filters.types,
  })
  if (error) throw error
  return (data ?? []) as RestaurantPin[]
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
    min_rating: filters.minRating,
    types: filters.types,
  })
  if (error) throw error
  return (data ?? []) as RestaurantNear[]
}

// Text search by business name or postcode prefix.
export async function searchRestaurants(query: string): Promise<RestaurantNear[]> {
  const q = query.trim()
  if (!q) return []
  const isPostcodeish = /\d/.test(q) && q.length <= 8
  let builder = supabase
    .from('restaurants')
    .select('id,name,business_type,address,postcode,rating_value,rating_is_numeric,rating_date')
    .limit(50)

  builder = isPostcodeish
    ? builder.ilike('postcode', `${q}%`)
    : builder.ilike('name', `%${q}%`)

  const { data, error } = await builder
  if (error) throw error
  // Shape to RestaurantNear (no distance in a text search).
  return (data ?? []).map((r) => ({ ...r, distance_m: 0 }) as RestaurantNear)
}

export async function getRestaurant(id: string): Promise<Restaurant | null> {
  const { data, error } = await supabase
    .from('restaurants')
    .select(
      'id,fhrs_id,name,business_type,business_type_id,address,postcode,local_authority,rating_value,rating_is_numeric,rating_date,hours_cache,hours_fetched_at',
    )
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return (data as Restaurant) ?? null
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
