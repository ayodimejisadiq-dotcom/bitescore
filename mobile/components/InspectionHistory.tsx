import { StyleSheet, Text, View } from 'react-native'
import { useTheme } from '@/theme/useTheme'
import { colorForRating } from '@/theme/colors'
import { ScoreBadge } from './ScoreBadge'
import { isNumericRating, ratingDescription } from '@/lib/fsa'
import type { Inspection } from '@/lib/types'

// The FSA's three inspection areas, in penalty points (lower is better).
const AREAS: { key: 'hygiene' | 'structural' | 'management'; label: string; max: number }[] = [
  { key: 'hygiene', label: 'Food hygiene', max: 25 },
  { key: 'structural', label: 'Cleanliness & building', max: 25 },
  { key: 'management', label: 'Management', max: 30 },
]

// Points on the FSA's own scale mapped to the score colour they correspond to,
// so a bar reads the same way as the rating tiles.
function colorForPoints(points: number): string {
  const equivalent = points <= 0 ? 5 : points <= 5 ? 4 : points <= 10 ? 3 : points <= 15 ? 2 : points <= 20 ? 1 : 0
  return colorForRating(String(equivalent))
}

function wordForPoints(points: number): string {
  if (points <= 0) return 'Very good'
  if (points <= 5) return 'Good'
  if (points <= 10) return 'Satisfactory'
  if (points <= 15) return 'Needs improving'
  if (points <= 20) return 'Major improvement'
  return 'Urgent improvement'
}

function when(i: Inspection): string {
  if (i.rating_date) {
    return new Date(i.rating_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  }
  // Early ratings carry no inspection date. seen_until is only when we noticed
  // the change, often weeks after the next inspection, so it isn't shown.
  return 'Earlier inspection'
}

function hasScores(i: Inspection): boolean {
  return i.hygiene !== null || i.structural !== null || i.management !== null
}

// Worth a card only when it says more than the "Last inspected" row does.
export function showsInspectionHistory(history: Inspection[]): boolean {
  return history.length > 1 || history.some(hasScores)
}

export function InspectionHistory({ history }: { history: Inspection[] }) {
  const c = useTheme()
  return (
    <View style={styles.card}>
      <Text style={[styles.title, { color: c.label }]}>Inspection history</Text>
      {history.map((i, idx) => {
        const older = history[idx + 1]
        const change =
          older && isNumericRating(older.rating_value) && isNumericRating(i.rating_value)
            ? Number(i.rating_value) - Number(older.rating_value)
            : 0
        return (
          <View
            key={`${i.rating_value}-${i.rating_date ?? i.seen_until}-${idx}`}
            style={[styles.entry, idx > 0 ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.separator } : null]}
          >
            <View style={styles.head}>
              <ScoreBadge rating={i.rating_value} size={36} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.word, { color: c.label }]} numberOfLines={1}>
                  {ratingDescription(i.rating_value)}
                </Text>
                <Text style={[styles.date, { color: c.meta }]}>
                  {when(i)}
                  {i.is_current ? ' · Current' : ''}
                </Text>
              </View>
              {change !== 0 ? (
                <View style={[styles.pill, { backgroundColor: change > 0 ? c.tintSoft : '#FBE4DE' }]}>
                  <Text style={[styles.pillText, { color: change > 0 ? c.tint : '#A8321A' }]}>
                    {change > 0 ? '↑' : '↓'} from {older!.rating_value}
                  </Text>
                </View>
              ) : null}
            </View>
            {hasScores(i) ? (
              <View style={styles.areas}>
                {AREAS.map((a) => {
                  const points = i[a.key]
                  if (points === null) return null
                  const fill = Math.max(0.06, 1 - points / a.max)
                  return (
                    <View key={a.key} style={styles.area}>
                      <View style={styles.areaHead}>
                        <Text style={[styles.areaLabel, { color: c.label2 }]}>{a.label}</Text>
                        <Text style={[styles.areaWord, { color: c.meta }]}>{wordForPoints(points)}</Text>
                      </View>
                      <View style={[styles.track, { backgroundColor: c.bg }]}>
                        <View style={{ width: `${fill * 100}%`, height: '100%', borderRadius: 3, backgroundColor: colorForPoints(points) }} />
                      </View>
                    </View>
                  )
                })}
              </View>
            ) : null}
          </View>
        )
      })}
      <Text style={[styles.note, { color: c.meta }]}>
        The FSA publishes only the latest rating, so Bitescore records each one as it changes. History starts
        July 2026.
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  card: { marginHorizontal: 16, backgroundColor: '#FFFFFF', borderRadius: 16, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 14 },
  title: { fontSize: 17, fontWeight: '600', marginBottom: 4 },
  entry: { paddingVertical: 12, gap: 10 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  word: { fontSize: 16, fontWeight: '600' },
  date: { fontSize: 13, marginTop: 1 },
  pill: { height: 24, paddingHorizontal: 9, borderRadius: 12, justifyContent: 'center' },
  pillText: { fontSize: 12, fontWeight: '600' },
  areas: { gap: 8, paddingLeft: 48 },
  area: { gap: 4 },
  areaHead: { flexDirection: 'row', justifyContent: 'space-between' },
  areaLabel: { fontSize: 13 },
  areaWord: { fontSize: 12 },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  note: { fontSize: 12, lineHeight: 17, marginTop: 4 },
})
