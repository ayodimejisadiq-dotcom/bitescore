import { View, Text, StyleSheet } from 'react-native'
import { scoreFill, scoreEdge } from '@/theme/colors'
import { fonts } from '@/theme/type'
import { tileEdge } from './ui'

// Empty-state illustration built from three real score tiles — a fanned
// 4 / 5 / 3 — so no image asset is needed.
export function BadgeFan() {
  return (
    <View style={styles.fan}>
      <View
        style={[
          styles.tile,
          { backgroundColor: scoreFill['4'], transform: [{ rotate: '-11deg' }] },
          tileEdge(scoreEdge['4'], 4),
        ]}
      >
        <Text style={styles.num}>4</Text>
      </View>
      <View
        style={[
          styles.tile,
          styles.tileCenter,
          { backgroundColor: scoreFill['5'] },
          tileEdge(scoreEdge['5'], 4),
        ]}
      >
        <Text style={styles.num}>5</Text>
      </View>
      <View
        style={[
          styles.tile,
          { backgroundColor: scoreFill['3'], transform: [{ rotate: '10deg' }] },
          tileEdge(scoreEdge['3'], 4),
        ]}
      >
        <Text style={styles.num}>3</Text>
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
  },
  tileCenter: { width: 46, height: 58, marginBottom: 10, zIndex: 1 },
  num: { color: '#fff', fontFamily: fonts.display800, fontSize: 24 },
})
