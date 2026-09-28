import { View, Text, StyleSheet } from 'react-native'
import { scoreFill } from '@/theme/colors'

// Illustration built from three real score tiles — a fanned 4 / 5 / 3 — so no
// image asset is needed. Used in the paywall hero.
export function BadgeFan() {
  return (
    <View style={styles.fan}>
      <View style={[styles.tile, { backgroundColor: scoreFill['4'], transform: [{ rotate: '-11deg' }] }]}>
        <Text style={styles.num}>4</Text>
      </View>
      <View style={[styles.tile, styles.tileCenter, { backgroundColor: scoreFill['5'] }]}>
        <Text style={styles.num}>5</Text>
      </View>
      <View style={[styles.tile, { backgroundColor: scoreFill['3'], transform: [{ rotate: '10deg' }] }]}>
        <Text style={[styles.num, { color: '#1C1C1E' }]}>3</Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  fan: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 2,
    marginBottom: 18,
    height: 96,
  },
  tile: {
    width: 44,
    height: 56,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 6px 14px rgba(0,0,0,0.15)',
  },
  tileCenter: { width: 46, height: 58, marginBottom: 10, zIndex: 1 },
  num: { color: '#fff', fontWeight: '700', fontSize: 24 },
})
