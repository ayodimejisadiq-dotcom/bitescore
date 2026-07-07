import { View, Text, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '@/theme/useTheme'

// Full lists + score-change alerts arrive in the next build step (needs
// accounts). This is the placeholder so the tab exists.
export default function ListsScreen() {
  const c = useTheme()
  return (
    <SafeAreaView edges={['top']} style={[styles.root, { backgroundColor: c.bg }]}>
      <View style={styles.head}>
        <Text style={[styles.title, { color: c.text }]}>My Lists</Text>
      </View>
      <View style={styles.center}>
        <Ionicons name="bookmark-outline" size={40} color={c.subtext} />
        <Text style={[styles.h, { color: c.text }]}>Save places you love</Text>
        <Text style={[styles.p, { color: c.subtext }]}>
          Create lists like “Date night” or “Want to try”,{'\n'}and get alerted when a score changes.
        </Text>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  head: { paddingHorizontal: 20, paddingTop: 8 },
  title: { fontSize: 30, fontWeight: '800', letterSpacing: -0.5 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 40 },
  h: { fontSize: 19, fontWeight: '700', marginTop: 6 },
  p: { fontSize: 15, textAlign: 'center', lineHeight: 22 },
})
