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

// One populated cell of the viewport grid, from restaurant_clusters(). Counts
// are computed across the whole viewport server-side, so a cluster's number is
// the true total for that area rather than a count of whatever was fetched.
export interface RestaurantCluster {
  lng: number
  lat: number
  n: number
  best_rating: string | null
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
  // Null when the query had no origin to measure from — location denied, or a
  // venue the FSA never geocoded. The row simply omits the distance then.
  distance_m: number | null
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
  user_id: string | null // null on others' anonymous reviews
  display_name_snapshot: string | null
  is_anonymous: boolean
  body: string
  status: 'visible' | 'hidden'
  created_at: string
  // From restaurant_reviews(); null on anonymous reviews.
  username?: string | null
  public_name?: string | null
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

export type ListAccess = 'private' | 'invited' | 'link'
export type ListRole = 'owner' | 'editor' | 'viewer' | 'link'

export interface PersonCard {
  user_id: string
  username: string | null
  public_name: string | null
}

export interface ListPerson extends PersonCard {
  role: 'owner' | 'editor' | 'viewer'
}

// A row on the Lists tab, from my_lists().
export interface ListSummary {
  id: string
  name: string
  created_at: string
  owner_id: string
  access: ListAccess
  share_slug: string | null
  collaborators_can_add: boolean
  my_role: 'owner' | 'editor' | 'viewer'
  place_count: number
  mosaic: string[]
  people: ListPerson[]
}

export interface ListItemDetail extends ListItemRestaurant {
  lng: number | null
  lat: number | null
  added_by: string | null
  added_at: string
}

export interface ListDetail {
  id: string
  name: string
  owner_id: string
  access: ListAccess
  share_slug: string | null
  collaborators_can_add: boolean
  my_role: ListRole
  can_add: boolean
  people: ListPerson[]
  items: ListItemDetail[]
}

export interface ListInvite {
  id: string
  name: string
  access: ListAccess
  owner_id: string
  collaborators_can_add: boolean
  my_role: ListRole | null
  place_count: number
  people_count: number
  owner: PersonCard | null
  mosaic: string[]
  preview: { id: string; name: string; rating_value: string }[]
}

export type Verdict = 'match' | 'cleaner'

export interface DinerCheckSummary {
  total: number
  cleaner: number | null // null until the place has enough votes to show
  match: number | null
  min_public: number
  my_verdict: Verdict | null
  can_vote: boolean
  my_visit_today: { verified: boolean; visited_at: string; method: string } | null
}

export interface ProfileSummary extends PersonCard {
  city: string | null
  is_me: boolean
  followers: number
  following: number
  i_follow: boolean
  follows_me: boolean
  reviews: number
  verified_visits: number
  independent_pct: number | null
  avg_score: number | null
  authorities: number
  chain_visits: number
}

export interface FollowRow extends PersonCard {
  i_follow: boolean
  follows_me: boolean
}

export interface TasteMatch {
  shared: number
  compared: number
  agreed: number
  places: { id: string; name: string; rating_value: string; mine: Verdict | null; theirs: Verdict | null }[]
}

export interface PublicList {
  id: string
  name: string
  share_slug: string | null
  place_count: number
  mosaic: string[]
}

export interface UserReview {
  id: string
  restaurant_id: string
  restaurant_name: string
  rating_value: string
  body: string
  created_at: string
}
