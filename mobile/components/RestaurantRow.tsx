import { Pressable, View, Text, StyleSheet } from 'react-native'
import { useTheme } from '@/theme/useTheme'
import { ScoreBadge } from './ScoreBadge'
import type { RestaurantNear } from '@/lib/types'

function distanceLabel(m: number): string | null {
  if (!m) return null
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`
}

export function RestaurantRow({
  item,
  onPress,
}: {
  item: RestaurantNear
  onPress: () => void
}) {
  const c = useTheme()
  const dist = distanceLabel(item.distance_m)
  const sub = [item.address, dist].filter(Boolean).join(' · ')

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { borderBottomColor: c.border, opacity: pressed ? 0.6 : 1 },
      ]}
    >
      <ScoreBadge rating={item.rating_value} size={40} />
      <View style={styles.meta}>
        <Text style={[styles.name, { color: c.text }]} numberOfLines={1}>
          {item.name}
        </Text>
        {sub ? (
          <Text style={[styles.sub, { color: c.subtext }]} numberOfLines={1}>
            {sub}
          </Text>
        ) : null}
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  meta: { flex: 1, minWidth: 0 },
  name: { fontSize: 15, fontWeight: '600', letterSpacing: -0.2 },
  sub: { fontSize: 13, marginTop: 2 },
})
