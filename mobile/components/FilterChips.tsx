import { useState } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '@/theme/useTheme'
import { NEUTRAL_RATING } from '@/theme/colors'
import { ScoreBadge } from './ScoreBadge'
import { GroupedCard, ScoreSquare } from './ui'
import type { BrowseFilters, RatingValue } from '@/lib/types'

// Floating chip row on the map. "Any score" opens a picker for exact scores;
// "5 only" is the one-tap shortcut. Type chips toggle independently.
const TYPE_CHIPS: { type: string; label: string }[] = [
  { type: 'Cafe', label: 'Cafés' },
  { type: 'Takeaway/sandwich shop', label: 'Takeaway' },
  { type: 'Restaurant', label: 'Restaurants' },
  { type: 'Pub/bar/nightclub', label: 'Pubs & bars' },
  { type: 'Hotel/bed & breakfast/guest house', label: 'Hotels & B&Bs' },
  { type: 'Mobile caterer', label: 'Mobile caterers' },
]

const STEPS: RatingValue[] = [5, 4, 3, 2, 1, 0]

const WORD: Record<number, string> = {
  5: 'Very good',
  4: 'Good',
  3: 'Generally satisfactory',
  2: 'Improvement necessary',
  1: 'Major improvement necessary',
  0: 'Urgent improvement necessary',
}

function scoreLabel(ratings: RatingValue[] | null): string {
  if (!ratings || ratings.length === 0) return 'Any score'
  if (ratings.length === 1) return ratings[0] === 'awaiting' ? 'Awaiting' : `${ratings[0]} only`
  const nums = ratings.filter((r): r is Exclude<RatingValue, 'awaiting'> => r !== 'awaiting').sort((a, b) => b - a)
  const contiguous = nums.every((n, i) => i === 0 || nums[i - 1] - n === 1)
  if (contiguous && nums.length === ratings.length) return `${nums[nums.length - 1]}–${nums[0]}`
  return `${ratings.length} scores`
}

export function FilterChips({
  filters,
  onChange,
}: {
  filters: BrowseFilters
  onChange: (next: BrowseFilters) => void
}) {
  const c = useTheme()
  const [pickerOpen, setPickerOpen] = useState(false)
  const ratings = filters.ratings ?? []
  const fiveOnly = ratings.length === 1 && ratings[0] === 5
  const scoreActive = ratings.length > 0 && !fiveOnly

  const toggleType = (t: string) => {
    const set = new Set(filters.types ?? [])
    set.has(t) ? set.delete(t) : set.add(t)
    onChange({ ...filters, types: set.size ? Array.from(set) : null })
  }

  return (
    <>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.scroll}
        contentContainerStyle={styles.row}
        keyboardShouldPersistTaps="handled"
      >
        <Chip
          label={fiveOnly ? 'Any score' : scoreLabel(filters.ratings)}
          active={!fiveOnly && (scoreActive || ratings.length === 0)}
          onPress={() => setPickerOpen(true)}
          trailing={<Ionicons name="chevron-down" size={13} color={!fiveOnly ? '#FFFFFF' : c.label} />}
        />
        <Chip
          label="5 only"
          active={fiveOnly}
          leading={<ScoreSquare rating="5" />}
          onPress={() => onChange({ ...filters, ratings: fiveOnly ? null : [5] })}
        />
        {TYPE_CHIPS.map((t) => (
          <Chip
            key={t.type}
            label={t.label}
            active={(filters.types ?? []).includes(t.type)}
            onPress={() => toggleType(t.type)}
          />
        ))}
      </ScrollView>

      <RatingPicker
        visible={pickerOpen}
        value={filters.ratings}
        onChange={(next) => onChange({ ...filters, ratings: next })}
        onClose={() => setPickerOpen(false)}
      />
    </>
  )
}

function Chip({
  label,
  active,
  onPress,
  leading,
  trailing,
}: {
  label: string
  active: boolean
  onPress: () => void
  leading?: React.ReactNode
  trailing?: React.ReactNode
}) {
  const c = useTheme()
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={[styles.chip, { backgroundColor: active ? c.label : 'rgba(255,255,255,0.94)' }]}
    >
      {leading}
      <Text style={[styles.chipText, { color: active ? '#FFFFFF' : c.label }]}>{label}</Text>
      {trailing}
    </Pressable>
  )
}

// Exact-match, multi-select: picking 5 and 0 shows both. Empty = any score.
function RatingPicker({
  visible,
  value,
  onChange,
  onClose,
}: {
  visible: boolean
  value: RatingValue[] | null
  onChange: (next: RatingValue[] | null) => void
  onClose: () => void
}) {
  const c = useTheme()
  const insets = useSafeAreaInsets()
  const selected = value ?? []
  const toggle = (v: RatingValue) => {
    const set = new Set(selected)
    set.has(v) ? set.delete(v) : set.add(v)
    onChange(set.size ? Array.from(set) : null)
  }
  const check = (on: boolean) =>
    on ? <Ionicons name="checkmark" size={20} color={c.tint} /> : <View style={{ width: 20 }} />

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
        <View style={styles.grabber} />
        <View style={styles.sheetHead}>
          <Text style={styles.sheetTitle}>Hygiene score</Text>
          <Pressable onPress={onClose} hitSlop={10}>
            <Text style={styles.done}>Done</Text>
          </Pressable>
        </View>
        <GroupedCard inset={70}>
          <Pressable style={styles.pickRow} onPress={() => onChange(null)}>
            <View style={[styles.anyTile, { backgroundColor: c.fill }]}>
              <Ionicons name="apps" size={16} color={c.meta} />
            </View>
            <Text style={styles.pickLabel}>Any score</Text>
            {check(selected.length === 0)}
          </Pressable>
          {STEPS.map((v) => (
            <Pressable key={v} style={styles.pickRow} onPress={() => toggle(v)}>
              <ScoreBadge rating={String(v)} size={38} />
              <Text style={styles.pickLabel}>{WORD[v as number]}</Text>
              {check(selected.includes(v))}
            </Pressable>
          ))}
          <Pressable style={styles.pickRow} onPress={() => toggle('awaiting')}>
            <View style={[styles.anyTile, { backgroundColor: NEUTRAL_RATING }]}>
              <Ionicons name="hourglass-outline" size={16} color="#fff" />
            </View>
            <Text style={styles.pickLabel}>Awaiting inspection</Text>
            {check(selected.includes('awaiting'))}
          </Pressable>
        </GroupedCard>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 0 },
  row: { gap: 8, paddingHorizontal: 16, alignItems: 'center' },
  chip: {
    height: 34,
    borderRadius: 17,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
  },
  chipText: { fontSize: 14, fontWeight: '500' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)' },
  sheet: { backgroundColor: '#F2F2F7', borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingTop: 8 },
  grabber: { width: 36, height: 5, borderRadius: 3, backgroundColor: '#C7C7CC', alignSelf: 'center', marginBottom: 6 },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  sheetTitle: { fontSize: 20, fontWeight: '700', color: '#1C1C1E' },
  done: { fontSize: 17, fontWeight: '600', color: '#047B42' },
  pickRow: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 16, paddingVertical: 8 },
  pickLabel: { flex: 1, fontSize: 17, color: '#1C1C1E' },
  anyTile: { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
})
