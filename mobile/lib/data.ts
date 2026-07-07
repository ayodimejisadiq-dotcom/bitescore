import { supabase } from './supabase'
import type {
  BrowseFilters,
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
