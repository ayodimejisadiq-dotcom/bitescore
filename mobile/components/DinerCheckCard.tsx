import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useTheme } from '@/theme/useTheme'
import type { DinerCheckSummary, Verdict } from '@/lib/types'

// Verified diners say whether a place still matches its FSA score or is
// cleaner now. Totals show once enough people have voted; the official
// rating is never changed.
export function DinerCheckCard({
  summary,
  inspected,
  onVote,
}: {
  summary: DinerCheckSummary
  inspected: string | null
  onVote: (v: Verdict | null) => void
}) {
  const c = useTheme()
  const isPublic = summary.cleaner !== null && summary.match !== null
  const cleaner = summary.cleaner ?? 0
  const match = summary.match ?? 0
  const total = cleaner + match
  const vote = (v: Verdict) => onVote(summary.my_verdict === v ? null : v)

  const toggle = (v: Verdict, label: string) => {
    const on = summary.my_verdict === v
    return (
      <Pressable
        onPress={() => vote(v)}
        disabled={!summary.can_vote}
        accessibilityRole="button"
        accessibilityState={{ selected: on, disabled: !summary.can_vote }}
        style={[styles.toggle, { backgroundColor: on ? c.tint : c.bg }]}
      >
        <Text style={[styles.toggleText, { color: on ? '#FFFFFF' : c.label }]}>{label}</Text>
      </Pressable>
    )
  }

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Text style={[styles.title, { color: c.label }]}>Diner check</Text>
        {inspected ? <Text style={[styles.meta, { color: c.meta }]}>Inspected {inspected}</Text> : null}
      </View>

      <View style={{ gap: 6 }}>
        <View style={[styles.bar, { backgroundColor: c.bg }]}>
          {isPublic && total > 0 ? (
            <>
              <View style={{ width: `${(cleaner / total) * 100}%`, backgroundColor: c.switchOn }} />
              <View style={{ width: `${(match / total) * 100}%`, backgroundColor: c.chevron }} />
            </>
          ) : null}
        </View>
        {isPublic ? (
          <Text style={[styles.copy, { color: c.label2 }]}>
            <Text style={{ fontWeight: '600', color: c.label }}>
              {cleaner} verified diner{cleaner === 1 ? '' : 's'}
            </Text>{' '}
            say{cleaner === 1 ? 's' : ''} it's cleaner now · {match} say{match === 1 ? 's' : ''} it matches
          </Text>
        ) : (
          <Text style={[styles.copy, { color: c.label2 }]}>
            Not enough diner checks yet. Totals show once {summary.min_public} verified diners have voted
            {summary.total > 0 ? ` (${summary.total} so far)` : ''}.
          </Text>
        )}
      </View>

      <View style={[styles.toggles, { opacity: summary.can_vote ? 1 : 0.4 }]}>
        {toggle('match', 'Matches the score')}
        {toggle('cleaner', 'Cleaner than rated')}
      </View>

      <Text style={[styles.hint, { color: c.meta }]}>
        {summary.can_vote
          ? 'Your vote counts for 90 days. The official FSA rating is unchanged.'
          : 'Log a verified visit to add your diner check. The official FSA rating is unchanged.'}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  card: { marginHorizontal: 16, backgroundColor: '#FFFFFF', borderRadius: 16, padding: 16, gap: 12 },
  head: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  title: { fontSize: 17, fontWeight: '600' },
  meta: { fontSize: 13 },
  bar: { height: 8, borderRadius: 4, flexDirection: 'row', gap: 2, overflow: 'hidden' },
  copy: { fontSize: 15, lineHeight: 20 },
  toggles: { flexDirection: 'row', gap: 8 },
  toggle: { flex: 1, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  toggleText: { fontSize: 15, fontWeight: '600' },
  hint: { fontSize: 12, lineHeight: 17 },
})
