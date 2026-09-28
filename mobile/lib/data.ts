import { supabase } from './supabase'
import { generateUsername, sanitizeUsername } from './username'
import {
  EMPTY_FILTERS,
  type BrowseFilters,
  type DinerCheckSummary,
  type FollowRow,
  type Inspection,
  type ListAccess,
  type ListDetail,
  type ListInvite,
  type ListSummary,
  type PersonCard,
  type ProfileSummary,
  type PublicList,
  type TasteMatch,
  type UserReview,
  type Verdict,
  type PlaceLookupResult,
  type Restaurant,
  type RestaurantCluster,
  type RestaurantNear,
  type RestaurantPin,
  type Review,
} from './types'

const SERVER_URL = process.env.EXPO_PUBLIC_SERVER_URL

// Share links point at the server's /l and /u pages, which open the app.
const SHARE_HOST = SERVER_URL ?? 'https://bitescore.vercel.app'

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

export async function getInspectionHistory(restaurantId: string): Promise<Inspection[]> {
  const { data, error } = await supabase.rpc('inspection_history', { p_restaurant_id: restaurantId })
  if (error) throw error
  return (data ?? []) as Inspection[]
}

export async function getReviews(restaurantId: string): Promise<Review[]> {
  // Through an RPC rather than the table: it hides who wrote anonymous
  // reviews and joins the author's public name.
  const { data, error } = await supabase.rpc('restaurant_reviews', { p_restaurant_id: restaurantId })
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

// Hides this review's author from the current user going forward. Works on
// anonymous reviews without the app ever learning who wrote them.
export async function blockReviewAuthor(reviewId: string): Promise<void> {
  const { error } = await supabase.rpc('block_review_author', { p_review_id: reviewId })
  if (error) throw error
}

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

export async function fetchMyLists(): Promise<ListSummary[]> {
  const { data, error } = await supabase.rpc('my_lists')
  if (error) throw error
  return (data ?? []) as ListSummary[]
}

export async function getListDetail(listId: string): Promise<ListDetail | null> {
  const { data, error } = await supabase.rpc('list_detail', { p_list_id: listId })
  if (error) throw error
  return (data as ListDetail) ?? null
}

export async function getListBySlug(slug: string): Promise<ListInvite | null> {
  const { data, error } = await supabase.rpc('list_by_slug', { p_slug: slug })
  if (error) throw error
  return (data as ListInvite) ?? null
}

export async function joinList(slug: string, role: 'editor' | 'viewer'): Promise<string> {
  const { data, error } = await supabase.rpc('join_list', { p_slug: slug, p_role: role })
  if (error) throw error
  return data as string
}

export async function inviteToList(listId: string, userId: string): Promise<void> {
  const { error } = await supabase.rpc('invite_to_list', { p_list_id: listId, p_user_id: userId })
  if (error) throw error
}

export async function leaveList(listId: string): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Not signed in')
  const { error } = await supabase.from('list_members').delete().eq('list_id', listId).eq('user_id', user.id)
  if (error) throw error
}

export async function removeListMember(listId: string, userId: string): Promise<void> {
  const { error } = await supabase.from('list_members').delete().eq('list_id', listId).eq('user_id', userId)
  if (error) throw error
}

// Changing access to invited/link mints a share link server-side; going
// private removes it (see lists_manage_slug in migration 0021).
export async function updateListSharing(
  listId: string,
  patch: { access?: ListAccess; collaborators_can_add?: boolean },
): Promise<{ access: ListAccess; share_slug: string | null; collaborators_can_add: boolean }> {
  const { data, error } = await supabase
    .from('lists')
    .update(patch)
    .eq('id', listId)
    .select('access,share_slug,collaborators_can_add')
    .single()
  if (error) throw error
  return data as { access: ListAccess; share_slug: string | null; collaborators_can_add: boolean }
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
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Not signed in')
  const { error } = await supabase
    .from('list_items')
    .upsert(
      { list_id: listId, restaurant_id: restaurantId, added_by: user.id },
      { onConflict: 'list_id,restaurant_id', ignoreDuplicates: true },
    )
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

// Which of the given lists already contain this restaurant. Scoped to the
// caller's own lists: RLS also lets anyone read public link-only lists, which
// must not show up as "saved".
export async function listIdsContaining(restaurantId: string, listIds: string[]): Promise<Set<string>> {
  if (listIds.length === 0) return new Set()
  const { data, error } = await supabase
    .from('list_items')
    .select('list_id')
    .eq('restaurant_id', restaurantId)
    .in('list_id', listIds)
  if (error) throw error
  return new Set((data ?? []).map((r) => r.list_id as string))
}

export function shareUrl(slug: string): string {
  return `${SHARE_HOST}/l/${slug}`
}

export function profileUrl(userId: string): string {
  return `${SHARE_HOST}/u/${userId}`
}

// ---------------------------------------------------------------------------
// Visits & diner checks
// ---------------------------------------------------------------------------

export async function logVisit(
  restaurantId: string,
  method: 'location' | 'none',
  coords?: { lng: number; lat: number },
): Promise<{ id: string; verified: boolean; visited_at: string }> {
  const { data, error } = await supabase.rpc('log_visit', {
    p_restaurant_id: restaurantId,
    p_method: method,
    p_lng: coords?.lng ?? null,
    p_lat: coords?.lat ?? null,
  })
  if (error) throw error
  return data as { id: string; verified: boolean; visited_at: string }
}

export async function undoVisitToday(visitId: string): Promise<void> {
  const { error } = await supabase.from('visits').delete().eq('id', visitId)
  if (error) throw error
}

export async function myVisitToday(
  restaurantId: string,
): Promise<{ id: string; verified: boolean; visited_at: string } | null> {
  const { data, error } = await supabase
    .from('visits')
    .select('id,verified,visited_at,visit_date')
    .eq('restaurant_id', restaurantId)
    .order('visited_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' })
  return data.visit_date === today ? data : null
}

export async function getDinerCheck(restaurantId: string): Promise<DinerCheckSummary> {
  const { data, error } = await supabase.rpc('diner_check_summary', { p_restaurant_id: restaurantId })
  if (error) throw error
  return data as DinerCheckSummary
}

export async function setDinerCheck(restaurantId: string, verdict: Verdict | null): Promise<void> {
  const { error } = await supabase.rpc('set_diner_check', {
    p_restaurant_id: restaurantId,
    p_verdict: verdict,
  })
  if (error) throw error
}

export async function getFollowedVisitors(
  restaurantId: string,
): Promise<{ total: number; people: PersonCard[] }> {
  const { data, error } = await supabase.rpc('followed_visitors', { p_restaurant_id: restaurantId })
  if (error) throw error
  return (data as { total: number; people: PersonCard[] }) ?? { total: 0, people: [] }
}

// Server errors raised by log_visit / set_diner_check, in plain words.
export function visitErrorMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e)
  if (msg.includes('too_far')) return 'You need to be at the venue to log a verified visit.'
  if (msg.includes('daily_visit_cap')) return 'You’ve logged the most visits allowed for today.'
  if (msg.includes('venue_has_no_location')) return 'We don’t have a location for this place, so it can’t be verified.'
  if (msg.includes('needs_verified_visit')) return 'Log a verified visit first to add your diner check.'
  return 'Check your connection and try again.'
}

// ---------------------------------------------------------------------------
// People & following
// ---------------------------------------------------------------------------

export async function getProfileSummary(userId: string): Promise<ProfileSummary | null> {
  const { data, error } = await supabase.rpc('profile_summary', { p_user_id: userId })
  if (error) throw error
  return (data as ProfileSummary) ?? null
}

export async function getFollowList(userId: string, kind: 'followers' | 'following'): Promise<FollowRow[]> {
  const { data, error } = await supabase.rpc('follow_list', { p_user_id: userId, p_kind: kind })
  if (error) throw error
  return (data ?? []) as FollowRow[]
}

export async function follow(userId: string): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Not signed in')
  const { error } = await supabase
    .from('follows')
    .upsert({ follower_id: user.id, followee_id: userId }, { onConflict: 'follower_id,followee_id', ignoreDuplicates: true })
  if (error) throw error
}

export async function unfollow(userId: string): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Not signed in')
  const { error } = await supabase.from('follows').delete().eq('follower_id', user.id).eq('followee_id', userId)
  if (error) throw error
}

// Which of these people I follow, for Follow pills on review rows.
export async function followingSet(userIds: string[]): Promise<Set<string>> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user || userIds.length === 0) return new Set()
  const { data, error } = await supabase
    .from('follows')
    .select('followee_id')
    .eq('follower_id', user.id)
    .in('followee_id', userIds)
  if (error) throw error
  return new Set((data ?? []).map((r) => r.followee_id as string))
}

export async function getTasteMatch(otherId: string): Promise<TasteMatch> {
  const { data, error } = await supabase.rpc('taste_match', { p_other: otherId })
  if (error) throw error
  return data as TasteMatch
}

export async function getPublicLists(userId: string): Promise<PublicList[]> {
  const { data, error } = await supabase.rpc('public_lists', { p_user_id: userId })
  if (error) throw error
  return (data ?? []) as PublicList[]
}

export async function getUserReviews(userId: string): Promise<UserReview[]> {
  const { data, error } = await supabase.rpc('user_reviews', { p_user_id: userId })
  if (error) throw error
  return (data ?? []) as UserReview[]
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

export interface Profile {
  first_name: string | null
  last_name: string | null
  username: string | null
  public_name: string | null
  city: string | null
}

export async function getProfile(): Promise<Profile | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null
  const { data, error } = await supabase
    .from('profiles')
    .select('first_name,last_name,username,public_name,city')
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

// What other people see: an optional public name and city.
export async function savePublicProfile(publicName: string, city: string): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Not signed in')
  const { error } = await supabase
    .from('profiles')
    .update({ public_name: publicName.trim() || null, city: city.trim() || null })
    .eq('user_id', user.id)
  if (error) throw error
}

export async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession()
  return data.session?.user.id ?? null
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
