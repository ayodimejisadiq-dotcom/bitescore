// Shapes returned by the database (tables + RPCs).

export interface RestaurantPin {
  id: string
  name: string
  business_type: string
  rating_value: string
  rating_is_numeric: boolean
  lng: number
  lat: number
}

export interface RestaurantNear {
  id: string
  name: string
  business_type: string
  address: string | null
  postcode: string | null
  rating_value: string
  rating_is_numeric: boolean
  rating_date: string | null
  distance_m: number
}

export interface Restaurant {
  id: string
  fhrs_id: number
  name: string
  business_type: string
  business_type_id: number | null
  address: string | null
  postcode: string | null
  local_authority: string | null
  rating_value: string
  rating_is_numeric: boolean
  rating_date: string | null
  hours_cache: OpeningHours | null
  hours_fetched_at: string | null
  google_rating: number | null
  google_rating_count: number | null
  lng: number | null
  lat: number | null
}

export interface PlaceLookupResult {
  googleRating: number | null
  googleRatingCount: number | null
  hours: OpeningHours | null
}

export interface OpeningHours {
  // Mirrors the subset of Google Places opening_hours we cache.
  open_now?: boolean
  weekday_text?: string[]
}

export interface Review {
  id: string
  restaurant_id: string
  user_id: string
  display_name_snapshot: string | null
  is_anonymous: boolean
  body: string
  status: 'visible' | 'hidden'
  created_at: string
}

export type RatingValue = 0 | 1 | 2 | 3 | 4 | 5 | 'awaiting'

export interface BrowseFilters {
  // null/empty = "Any rating" (shows everything, numeric + non-numeric).
  // Otherwise an exact-match, multi-select set — [5] shows only 5-rated
  // places, [0, 5] shows 0s and 5s together, ['awaiting'] shows only places
  // never inspected, etc.
  ratings: RatingValue[] | null
  types: string[] | null // FSA business_type filter
}

export const EMPTY_FILTERS: BrowseFilters = {
  ratings: null,
  types: null,
}

export interface ListItemRestaurant {
  id: string
  name: string
  business_type: string
  rating_value: string
  rating_is_numeric: boolean
  address: string | null
  postcode: string | null
}

export interface ListWithItems {
  id: string
  name: string
  created_at: string
  items: ListItemRestaurant[]
}
