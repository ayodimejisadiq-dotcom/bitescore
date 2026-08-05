import { View, Text, StyleSheet } from 'react-native'
import { colorForRating, edgeForRating } from '@/theme/colors'
import { fonts } from '@/theme/type'
import { isNumericRating, ratingLabel } from '@/lib/fsa'
import { tileEdge } from './ui'

// The signature Bitescore element: a rounded score tile with a hard dark
// bottom edge so it reads as a physical object. Non-numeric statuses
// (Exempt, Awaiting…) render as a neutral tile with a short label.
export function ScoreBadge({
  rating,
  size = 46,
  edge = true,
}: {
  rating: string
  size?: number
  edge?: boolean
}) {
  const numeric = isNumericRating(rating)
  const bg = colorForRating(rating)
  const edgeHeight = size >= 60 ? 4 : 3
  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: bg, width: size, height: size, borderRadius: size * 0.34 },
        edge ? tileEdge(edgeForRating(rating), edgeHeight) : null,
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
  num: { color: '#fff', fontFamily: fonts.display800 },
  mini: {
    color: '#fff',
    fontFamily: fonts.display600,
    fontSize: 9,
    textAlign: 'center',
    paddingHorizontal: 2,
  },
})
