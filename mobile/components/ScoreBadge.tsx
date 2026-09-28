import { View, Text, StyleSheet } from 'react-native'
import { colorForRating, textOnRating } from '@/theme/colors'
import { isNumericRating, ratingLabel } from '@/lib/fsa'

// Rounded score tile. Radius scales with size: 44 → 12, 96 → 26. Non-numeric
// statuses (Exempt, Awaiting…) render as a neutral tile with a short label.
export function ScoreBadge({
  rating,
  size = 44,
  glow = false,
}: {
  rating: string
  size?: number
  glow?: boolean
}) {
  const numeric = isNumericRating(rating)
  const bg = colorForRating(rating)
  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: bg, width: size, height: size, borderRadius: Math.round(size * 0.272) },
        glow ? { boxShadow: `0 10px 24px ${bg}55` } : null,
      ]}
      accessible
      accessibilityLabel={`Hygiene rating ${ratingLabel(rating)}`}
    >
      {numeric ? (
        <Text
          style={{
            color: textOnRating(rating),
            fontSize: Math.round(size * 0.5),
            fontWeight: '700',
            letterSpacing: size > 80 ? -1 : 0,
          }}
        >
          {rating}
        </Text>
      ) : (
        <Text style={[styles.mini, { fontSize: Math.max(8, size * 0.2) }]} numberOfLines={2}>
          {rating === 'Exempt' ? 'Exempt' : 'Awaiting'}
        </Text>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  badge: { alignItems: 'center', justifyContent: 'center' },
  mini: { color: '#fff', fontWeight: '600', textAlign: 'center', paddingHorizontal: 2 },
})
