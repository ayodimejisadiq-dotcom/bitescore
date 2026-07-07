import { useCallback, useEffect, useState } from 'react'
import { View, Text, Pressable, ActivityIndicator, StyleSheet } from 'react-native'
import RevenueCatUI, { PAYWALL_RESULT } from 'react-native-purchases-ui'
import { useTheme } from '@/theme/useTheme'
import { ENTITLEMENT_ID } from '@/lib/purchases'

// Presents RevenueCat's dashboard-configured Paywall (design lives in the
// RevenueCat dashboard, editable without an app update — requires a Paywall
// to be set up there against the default Offering). Auto-presents on mount;
// if the user dismisses it without buying, this screen stays up with a
// button to reopen rather than leaving them stuck on a blank loading state.
export function PaywallGate({ onUnlocked }: { onUnlocked: () => void }) {
  const c = useTheme()
  const [presenting, setPresenting] = useState(false)

  const present = useCallback(async () => {
    setPresenting(true)
    try {
      const result = await RevenueCatUI.presentPaywallIfNeeded({
        requiredEntitlementIdentifier: ENTITLEMENT_ID,
      })
      if (result === PAYWALL_RESULT.PURCHASED || result === PAYWALL_RESULT.RESTORED) {
        onUnlocked()
      }
      // CANCELLED / ERROR / NOT_PRESENTED: stay gated; the button below
      // lets them reopen it.
    } finally {
      setPresenting(false)
    }
  }, [onUnlocked])

  useEffect(() => {
    present()
  }, [present])

  return (
    <View style={[styles.root, { backgroundColor: c.bg }]}>
      <View style={[styles.badge, { backgroundColor: c.primary }]}>
        <Text style={styles.badgeText}>5</Text>
      </View>
      <Text style={[styles.title, { color: c.text }]}>Unlock Bitescore</Text>
      <Text style={[styles.subtitle, { color: c.subtext }]}>
        Official UK hygiene ratings on a map,{'\n'}saved lists, and score-change alerts.
      </Text>
      <Pressable
        onPress={present}
        disabled={presenting}
        style={[styles.button, { backgroundColor: c.primary, opacity: presenting ? 0.7 : 1 }]}
      >
        {presenting ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>View plans</Text>}
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },
  badge: { width: 64, height: 64, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  badgeText: { color: '#fff', fontSize: 32, fontWeight: '800' },
  title: { fontSize: 28, fontWeight: '800', letterSpacing: -0.5, textAlign: 'center' },
  subtitle: { fontSize: 15, textAlign: 'center', lineHeight: 22, marginTop: 10 },
  button: { marginTop: 30, paddingVertical: 15, paddingHorizontal: 36, borderRadius: 16 },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
})
