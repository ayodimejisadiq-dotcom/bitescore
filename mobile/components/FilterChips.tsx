import { ScrollView, Pressable, Text, StyleSheet } from 'react-native'
import { useTheme } from '@/theme/useTheme'
import { BUSINESS_TYPE_LABEL, DINING_BUSINESS_TYPES } from '@/lib/fsa'
import { RatingDropdown } from './RatingDropdown'
import type { BrowseFilters } from '@/lib/types'

// Horizontal filter row for the map and search screens. Toggles minimum rating
// and venue type; changes flow up via onChange.
export function FilterChips({
  filters,
  onChange,
}: {
  filters: BrowseFilters
  onChange: (next: BrowseFilters) => void
}) {
  const c = useTheme()

  const toggleType = (t: string) => {
    const set = new Set(filters.types ?? [])
    set.has(t) ? set.delete(t) : set.add(t)
    onChange({ ...filters, types: set.size ? Array.from(set) : null })
  }

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
    >
      <RatingDropdown
        value={filters.minRating}
        onChange={(minRating) => onChange({ ...filters, minRating })}
      />
      {DINING_BUSINESS_TYPES.map((t) => (
        <Chip
          key={t}
          label={BUSINESS_TYPE_LABEL[t] ?? t}
          active={(filters.types ?? []).includes(t)}
          onPress={() => toggleType(t)}
          c={c}
        />
      ))}
    </ScrollView>
  )
}

function Chip({
  label,
  active,
  onPress,
  c,
}: {
  label: string
  active: boolean
  onPress: () => void
  c: ReturnType<typeof useTheme>
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.chip,
        { backgroundColor: active ? c.primary : c.card, borderColor: active ? c.primary : c.border },
      ]}
    >
      <Text style={[styles.chipText, { color: active ? '#fff' : c.text }]}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  row: { gap: 8, paddingHorizontal: 14, paddingVertical: 4 },
  chip: { paddingHorizontal: 13, paddingVertical: 8, borderRadius: 999, borderWidth: 1 },
  chipText: { fontSize: 13, fontWeight: '600' },
})
