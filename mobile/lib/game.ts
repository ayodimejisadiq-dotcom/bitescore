import AsyncStorage from '@react-native-async-storage/async-storage'

// The light game layer from the redesign — checks, week streak, badges. It
// lives only on the Lists and Account screens and is deliberately local to
// this device (AsyncStorage): losing it on reinstall is acceptable, and it
// never blocks or gates anything.

const KEY = 'bitescore.game.v1'

interface GameState {
  checkedIds: string[] // restaurant ids the user has opened
  fiveCheckIds: string[] // subset of checks that were rated 5
  weeks: string[] // ISO week stamps ("2026-W31") with ≥1 check
  reviews: number // reviews posted from this device
}

const EMPTY: GameState = { checkedIds: [], fiveCheckIds: [], weeks: [], reviews: 0 }

async function read(): Promise<GameState> {
  try {
    const raw = await AsyncStorage.getItem(KEY)
    return raw ? { ...EMPTY, ...(JSON.parse(raw) as GameState) } : { ...EMPTY }
  } catch {
    return { ...EMPTY }
  }
}

async function write(state: GameState): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    // Non-essential — never surface storage failures for the game layer.
  }
}

function isoWeek(d = new Date()): string {
  // ISO-8601 week number, UTC-based.
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const day = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

function prevIsoWeek(stamp: string): string {
  // Any date inside the stamped week, minus 7 days, restamped.
  const [y, w] = stamp.split('-W').map(Number)
  const jan4 = new Date(Date.UTC(y, 0, 4))
  const day = jan4.getUTCDay() || 7
  const monday = new Date(jan4)
  monday.setUTCDate(jan4.getUTCDate() - day + 1 + (w - 1) * 7 - 7)
  return isoWeek(monday)
}

// Record that the user opened a place's detail page.
export async function recordCheck(restaurantId: string, ratingValue: string): Promise<void> {
  const s = await read()
  if (!s.checkedIds.includes(restaurantId)) {
    s.checkedIds.push(restaurantId)
    if (ratingValue === '5') s.fiveCheckIds.push(restaurantId)
  }
  const week = isoWeek()
  if (!s.weeks.includes(week)) s.weeks.push(week)
  await write(s)
}

export async function recordReview(): Promise<void> {
  const s = await read()
  s.reviews += 1
  await write(s)
}

export interface BadgeDef {
  id: string
  label: string
  kind: 'score' | 'flame' | 'lock'
  scoreText?: string
  earned: boolean
}

export interface GameStats {
  placesChecked: number
  weekStreak: number
  reviews: number
  badges: BadgeDef[]
  earnedCount: number
  // Progress toward the next unearned badge, 0..1, with a caption.
  nextProgress: number | null
  nextCaption: string | null
}

export async function getGameStats(): Promise<GameStats> {
  const s = await read()

  // Current streak = consecutive ISO weeks with a check, ending this week or
  // last week (so the streak doesn't die mid-week before the first check).
  const weekSet = new Set(s.weeks)
  let cursor = isoWeek()
  if (!weekSet.has(cursor)) cursor = prevIsoWeek(cursor)
  let streak = 0
  while (weekSet.has(cursor)) {
    streak++
    cursor = prevIsoWeek(cursor)
  }

  const checked = s.checkedIds.length
  const badges: BadgeDef[] = [
    { id: 'first', label: 'First check', kind: 'score', scoreText: '1', earned: checked >= 1 },
    { id: 'ten', label: 'Ten deep', kind: 'score', scoreText: '10', earned: checked >= 10 },
    { id: 'streak', label: 'Streak', kind: 'flame', earned: streak >= 3 },
    { id: 'reviewer', label: 'Reviewer', kind: 'lock', earned: s.reviews >= 1 },
    { id: 'explorer', label: 'Explorer', kind: 'lock', earned: checked >= 40 },
    { id: 'fives', label: 'All fives', kind: 'lock', earned: s.fiveCheckIds.length >= 10 },
  ]

  // Nearest goal among the unearned count-based badges.
  const goals: { badge: string; now: number; target: number; noun: string }[] = [
    { badge: 'Ten deep', now: checked, target: 10, noun: 'checks' },
    { badge: 'Explorer', now: checked, target: 40, noun: 'checks' },
    { badge: 'All fives', now: s.fiveCheckIds.length, target: 10, noun: 'five-rated checks' },
    { badge: 'Reviewer', now: s.reviews, target: 1, noun: 'review' },
  ]
  const next = goals
    .filter((g) => g.now < g.target)
    .sort((a, b) => a.target - a.now - (b.target - b.now))[0]

  return {
    placesChecked: checked,
    weekStreak: streak,
    reviews: s.reviews,
    badges,
    earnedCount: badges.filter((b) => b.earned).length,
    nextProgress: next ? next.now / next.target : null,
    nextCaption: next
      ? `${next.target - next.now} more ${next.target - next.now === 1 && next.noun.endsWith('s') ? next.noun.slice(0, -1) : next.noun} unlocks ${next.badge}.`
      : null,
  }
}
