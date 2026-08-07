import { Pressable, View, Text, StyleSheet } from 'react-native'
import { useTheme } from '@/theme/useTheme'
import { fonts } from '@/theme/type'
import { BUSINESS_TYPE_LABEL } from '@/lib/fsa'
import { ScoreBadge } from './ScoreBadge'
import type { RestaurantNear } from '@/lib/types'

function distanceLabel(m: number): string | null {
  if (!m) return null
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`
}

// Card-style result row: score tile, name, "category · address · distance".
export function RestaurantRow({
  item,
  onPress,
  saved = false,
}: {
  item: RestaurantNear
  onPress: () => void
  saved?: boolean
}) {
  const c = useTheme()
  const category = BUSINESS_TYPE_LABEL[item.business_type] ?? item.business_type
  // Singularise the chip label for a single place ("Takeaways" → "Takeaway").
  const categoryOne = category.endsWith('s') && !category.includes('&') ? category.slice(0, -1) : category
  const sub = [categoryOne, item.address, distanceLabel(item.distance_m)].filter(Boolean).join(' · ')

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: c.card, borderColor: c.rowBorder, opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <ScoreBadge rating={item.rating_value} size={46} edge={false} />
      <View style={styles.meta}>
        <Text style={[styles.name, { color: c.text }]} numberOfLines={1}>
          {item.name}
        </Text>
        {sub ? (
          <Text style={[styles.sub, { color: c.mutedOnCard }]} numberOfLines={1}>
            {sub}
          </Text>
        ) : null}
      </View>
      {saved ? (
        <View style={[styles.savedChip, { backgroundColor: c.primaryTint }]}>
          <Text style={[styles.savedText, { color: c.primary }]}>SAVED</Text>
        </View>
      ) : null}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    marginHorizontal: 16,
    marginBottom: 9,
    paddingVertical: 11,
    paddingHorizontal: 13,
    borderRadius: 18,
    borderWidth: 1.5,
  },
  meta: { flex: 1, minWidth: 0 },
  name: { fontSize: 17, fontFamily: fonts.display600 },
  sub: { fontSize: 13, fontFamily: fonts.body, marginTop: 3 },
  savedChip: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 7 },
  savedText: { fontSize: 11, fontFamily: fonts.display600, letterSpacing: 0.5 },
})
