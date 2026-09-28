import type { ReactNode } from 'react'
import { Pressable, View, Text, StyleSheet } from 'react-native'
import { useTheme } from '@/theme/useTheme'
import { BUSINESS_TYPE_LABEL } from '@/lib/fsa'
import { distanceLabel } from '@/lib/people'
import { ScoreBadge } from './ScoreBadge'
import type { RestaurantNear } from '@/lib/types'

export function categoryOne(businessType: string): string {
  const category = BUSINESS_TYPE_LABEL[businessType] ?? businessType
  // "Takeaways" → "Takeaway"; leave "Hotels & B&Bs" alone.
  return category.endsWith('s') && !category.includes('&') ? category.slice(0, -1) : category
}

// Plain grouped-list row: score tile, name, "category · address · distance".
// Put several inside a GroupedCard (inset 74) for separators.
export function RestaurantRow({
  item,
  onPress,
  right,
  subtitle,
}: {
  item: Pick<RestaurantNear, 'name' | 'business_type' | 'rating_value'> &
    Partial<Pick<RestaurantNear, 'address' | 'distance_m'>>
  onPress: () => void
  right?: ReactNode
  subtitle?: string
}) {
  const c = useTheme()
  const sub =
    subtitle ??
    [categoryOne(item.business_type), item.address, distanceLabel(item.distance_m)].filter(Boolean).join(' · ')

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, { backgroundColor: pressed ? '#EBEBEF' : 'transparent' }]}
    >
      <ScoreBadge rating={item.rating_value} size={44} />
      <View style={styles.meta}>
        <Text style={[styles.name, { color: c.label }]} numberOfLines={1}>
          {item.name}
        </Text>
        {sub ? (
          <Text style={[styles.sub, { color: c.meta }]} numberOfLines={1}>
            {sub}
          </Text>
        ) : null}
      </View>
      {right}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 10, paddingHorizontal: 16 },
  meta: { flex: 1, minWidth: 0 },
  name: { fontSize: 17, fontWeight: '600' },
  sub: { fontSize: 14, marginTop: 2 },
})
