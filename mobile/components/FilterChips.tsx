import { ScrollView, Pressable, Text, StyleSheet } from 'react-native'
import { useTheme } from '@/theme/useTheme'
import { fonts } from '@/theme/type'
import { BUSINESS_TYPE_LABEL, DINING_BUSINESS_TYPES } from '@/lib/fsa'
import { tileEdge } from './ui'
import { RatingDropdown } from './RatingDropdown'
import type { BrowseFilters } from '@/lib/types'

// Horizontal filter row for the map and search screens. The rating chip is
// always the filled green anchor; category chips invert to green when
// selected, matching it. Changes flow up via onChange.
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
      style={styles.scroll}
      contentContainerStyle={styles.row}
    >
      <RatingDropdown
        value={filters.ratings}
        onChange={(ratings) => onChange({ ...filters, ratings })}
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
        active
          ? [{ backgroundColor: c.primary }, tileEdge(c.primaryDark)]
          : { backgroundColor: c.card, borderWidth: 1.5, borderColor: c.controlBorder },
      ]}
    >
      <Text style={[styles.chipText, { color: active ? '#fff' : c.chipText }]}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 0 },
  row: { gap: 8, paddingHorizontal: 14, paddingVertical: 4, alignItems: 'center' },
  chip: {
    height: 38,
    borderRadius: 12,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipText: { fontSize: 14, fontFamily: fonts.display600 },
})
