import { View, Text, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '@/theme/useTheme'

// Sign-in, subscription status, notification settings and account deletion
// arrive in later build steps. Placeholder for the tab.
export default function AccountScreen() {
  const c = useTheme()
  return (
    <SafeAreaView edges={['top']} style={[styles.root, { backgroundColor: c.bg }]}>
      <View style={styles.head}>
        <Text style={[styles.title, { color: c.text }]}>Account</Text>
      </View>
      <View style={styles.center}>
        <Ionicons name="person-circle-outline" size={44} color={c.subtext} />
        <Text style={[styles.p, { color: c.subtext }]}>
          Sign in to save lists and manage{'\n'}your subscription — coming next.
        </Text>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  head: { paddingHorizontal: 20, paddingTop: 8 },
  title: { fontSize: 30, fontWeight: '800', letterSpacing: -0.5 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 40 },
  p: { fontSize: 15, textAlign: 'center', lineHeight: 22 },
})
