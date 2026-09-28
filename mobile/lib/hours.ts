// Open/closed from Google's cached weekday_text, worked out at view time.
//
// The cache also holds Google's `open_now`, but that is a snapshot from
// whenever the place was last looked up — up to 30 days ago — so it can say
// "Open" at 3am. The weekly hours don't go stale that way.

// "Monday: 9:00 AM – 11:00 PM" → "9:00 AM – 11:00 PM". Google weeks start Monday.
export function hoursForDay(weekdayText: string[] | undefined, dayIndexMon0: number): string | null {
  const line = weekdayText?.[dayIndexMon0]
  if (!line) return null
  const idx = line.indexOf(':')
  return idx === -1 ? line : line.slice(idx + 1).trim()
}

export function todayIndexMon0(d = new Date()): number {
  return (d.getDay() + 6) % 7
}

// "11:00 PM" / "11 PM" / "23:00" → minutes after midnight. `fallbackPm`
// covers Google's "9:00 – 11:00 PM", where the first time borrows the second's
// meridiem.
function parseTime(raw: string, fallbackMeridiem?: string): { mins: number; meridiem?: string } | null {
  const m = raw.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*([AP]M)?$/i)
  if (!m) return null
  let h = Number(m[1])
  const min = m[2] ? Number(m[2]) : 0
  const meridiem = m[3]?.toUpperCase() ?? fallbackMeridiem
  if (meridiem === 'PM' && h < 12) h += 12
  if (meridiem === 'AM' && h === 12) h = 0
  return { mins: h * 60 + min, meridiem: m[3]?.toUpperCase() }
}

function ranges(text: string): { start: number; end: number }[] | 'closed' | 'always' | null {
  const t = text.replace(/[   ]/g, ' ')
  if (/closed/i.test(t)) return 'closed'
  if (/24 hours/i.test(t)) return 'always'
  const out: { start: number; end: number }[] = []
  for (const part of t.split(',')) {
    const [a, b] = part.split(/\s*[–-]\s*/)
    if (!a || !b) return null
    const end = parseTime(b)
    const start = parseTime(a, end?.meridiem)
    if (!start || !end) return null
    out.push({ start: start.mins, end: end.mins <= start.mins ? end.mins + 24 * 60 : end.mins })
  }
  return out
}

function hhmm(mins: number): string {
  const m = ((mins % (24 * 60)) + 24 * 60) % (24 * 60)
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

export type OpenState =
  | { kind: 'open'; until: string | null }
  | { kind: 'closed'; opensAt: string | null }
  | { kind: 'unknown' }

export function openState(weekdayText: string[] | undefined, now = new Date()): OpenState {
  if (!weekdayText || weekdayText.length !== 7) return { kind: 'unknown' }
  const today = todayIndexMon0(now)
  const mins = now.getHours() * 60 + now.getMinutes()

  // Last night's hours can run past midnight into this morning.
  const yesterday = ranges(hoursForDay(weekdayText, (today + 6) % 7) ?? '')
  if (Array.isArray(yesterday)) {
    for (const r of yesterday) {
      if (r.end > 24 * 60 && mins < r.end - 24 * 60) return { kind: 'open', until: hhmm(r.end) }
    }
  }

  const todays = ranges(hoursForDay(weekdayText, today) ?? '')
  if (todays === null) return { kind: 'unknown' }
  if (todays === 'always') return { kind: 'open', until: null }
  if (todays === 'closed') return { kind: 'closed', opensAt: null }
  for (const r of todays) {
    if (mins >= r.start && mins < r.end) return { kind: 'open', until: hhmm(r.end) }
  }
  const later = todays.find((r) => r.start > mins)
  return { kind: 'closed', opensAt: later ? hhmm(later.start) : null }
}

export function openLabel(state: OpenState): string | null {
  switch (state.kind) {
    case 'open':
      return state.until ? `Open until ${state.until}` : 'Open 24 hours'
    case 'closed':
      return state.opensAt ? `Closed · opens ${state.opensAt}` : 'Closed today'
    default:
      return null
  }
}
