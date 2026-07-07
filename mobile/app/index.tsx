import { View, Text, StyleSheet, useColorScheme } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { brand, dark, light } from '@/theme/colors'

// Placeholder entry screen for the scaffold. In later build steps this becomes
// the gate that routes: no session -> auth, no entitlement -> paywall,
// otherwise -> the map/tabs.
export default function Index() {
  const scheme = useColorScheme()
  const c = scheme === 'dark' ? dark : light

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: c.bg }]}>
      <View style={styles.center}>
        <View style={[styles.badge, { backgroundColor: brand.primary }]}>
          <Text style={styles.badgeText}>5</Text>
        </View>
        <Text style={[styles.title, { color: c.text }]}>Bitescore</Text>
        <Text style={[styles.subtitle, { color: c.subtext }]}>
          UK food hygiene ratings,{'\n'}wherever you eat
        </Text>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  badge: {
    width: 84,
    height: 84,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#fff', fontSize: 44, fontWeight: '800' },
  title: { fontSize: 34, fontWeight: '800', letterSpacing: -0.5 },
  subtitle: { fontSize: 17, textAlign: 'center', lineHeight: 24 },
})
