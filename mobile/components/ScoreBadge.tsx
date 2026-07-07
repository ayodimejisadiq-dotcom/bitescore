import { View, Text, StyleSheet } from 'react-native'
import { colorForRating } from '@/theme/colors'
import { isNumericRating, ratingLabel } from '@/lib/fsa'

// The signature Bitescore element: a rounded square, coloured by score, with
// the number front and centre. Non-numeric statuses (Exempt, Awaiting…) render
// as a short label instead.
export function ScoreBadge({
  rating,
  size = 44,
}: {
  rating: string
  size?: number
}) {
  const numeric = isNumericRating(rating)
  const bg = colorForRating(rating)
  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: bg, width: size, height: size, borderRadius: size * 0.3 },
      ]}
      accessible
      accessibilityLabel={`Hygiene rating ${ratingLabel(rating)}`}
    >
      {numeric ? (
        <Text style={[styles.num, { fontSize: size * 0.5 }]}>{rating}</Text>
      ) : (
        <Text style={styles.mini} numberOfLines={2}>
          {rating === 'Exempt' ? 'Exempt' : 'Awaiting'}
        </Text>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  badge: { alignItems: 'center', justifyContent: 'center' },
  num: { color: '#fff', fontWeight: '800' },
  mini: { color: '#fff', fontWeight: '700', fontSize: 9, textAlign: 'center', paddingHorizontal: 2 },
})
