import { useCallback, useEffect, useState } from 'react'
import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
  StyleSheet,
  Alert,
  Linking,
  ScrollView,
} from 'react-native'
import { PACKAGE_TYPE, PRODUCT_CATEGORY, type PurchasesPackage } from 'react-native-purchases'
import { useTheme } from '@/theme/useTheme'
import { getOfferings, purchasePackage, restorePurchases } from '@/lib/purchases'
import { PRIVACY_POLICY_URL, TERMS_OF_USE_URL } from '@/lib/legal'
import { errorMessage } from '@/lib/errors'

// Native paywall built directly on the default RevenueCat Offering, rather
// than the dashboard-configured RevenueCatUI paywall. App Review requires
// the purchase flow itself to display the subscription title, length, price,
// and functional Privacy Policy / Terms of Use links (guideline 3.1.2c) —
// rendering it natively guarantees all of that regardless of dashboard
// state, and lets us surface real error messages instead of a dead screen.

const LENGTH_LABEL: Partial<Record<PACKAGE_TYPE, string>> = {
  [PACKAGE_TYPE.WEEKLY]: '1 week',
  [PACKAGE_TYPE.MONTHLY]: '1 month',
  [PACKAGE_TYPE.TWO_MONTH]: '2 months',
  [PACKAGE_TYPE.THREE_MONTH]: '3 months',
  [PACKAGE_TYPE.SIX_MONTH]: '6 months',
  [PACKAGE_TYPE.ANNUAL]: '1 year',
  [PACKAGE_TYPE.LIFETIME]: 'One-time purchase',
}

// Yearly first, lifetime second, anything unexpected last.
const DISPLAY_ORDER: Partial<Record<PACKAGE_TYPE, number>> = {
  [PACKAGE_TYPE.ANNUAL]: 0,
  [PACKAGE_TYPE.LIFETIME]: 1,
}

function priceLine(pkg: PurchasesPackage): string {
  const price = pkg.product.priceString
  switch (pkg.packageType) {
    case PACKAGE_TYPE.WEEKLY:
      return `${price} / week`
    case PACKAGE_TYPE.MONTHLY:
      return `${price} / month`
    case PACKAGE_TYPE.ANNUAL:
      return `${price} / year`
    case PACKAGE_TYPE.LIFETIME:
      return `${price} once`
    default:
      return price
  }
}

function isAutoRenewing(pkg: PurchasesPackage): boolean {
  return (
    pkg.packageType !== PACKAGE_TYPE.LIFETIME &&
    pkg.product.productCategory === PRODUCT_CATEGORY.SUBSCRIPTION
  )
}

export function PaywallGate({ onUnlocked }: { onUnlocked: () => void }) {
  const c = useTheme()
  const [packages, setPackages] = useState<PurchasesPackage[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [buying, setBuying] = useState(false)
  const [restoring, setRestoring] = useState(false)

  const load = useCallback(async () => {
    setLoadError(null)
    setPackages(null)
    try {
      const offering = await getOfferings()
      const pkgs = [...(offering?.availablePackages ?? [])].sort(
        (a, b) => (DISPLAY_ORDER[a.packageType] ?? 9) - (DISPLAY_ORDER[b.packageType] ?? 9),
      )
      if (pkgs.length === 0) {
        setLoadError('Plans aren’t available right now. Check your connection and try again.')
        return
      }
      setPackages(pkgs)
      setSelected((prev) => prev ?? pkgs[0].identifier)
    } catch (e) {
      setLoadError(errorMessage(e))
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const selectedPkg = packages?.find((p) => p.identifier === selected) ?? null

  const onBuy = async () => {
    if (!selectedPkg || buying) return
    setBuying(true)
    try {
      if (await purchasePackage(selectedPkg)) onUnlocked()
    } catch (e) {
      if (!(e as { userCancelled?: boolean }).userCancelled) {
        Alert.alert('Purchase failed', errorMessage(e))
      }
    } finally {
      setBuying(false)
    }
  }

  const onRestore = async () => {
    if (restoring) return
    setRestoring(true)
    try {
      if (await restorePurchases()) {
        onUnlocked()
      } else {
        Alert.alert('Nothing to restore', 'No previous purchase was found for this Apple ID.')
      }
    } catch (e) {
      Alert.alert('Restore failed', errorMessage(e))
    } finally {
      setRestoring(false)
    }
  }

  return (
    <View style={[styles.root, { backgroundColor: c.bg }]}>
      <ScrollView contentContainerStyle={styles.scroll} bounces={false}>
        <View style={[styles.badge, { backgroundColor: c.primary }]}>
          <Text style={styles.badgeText}>5</Text>
        </View>
        <Text style={[styles.title, { color: c.text }]}>Unlock Bitescore</Text>
        <Text style={[styles.subtitle, { color: c.subtext }]}>
          Official UK hygiene ratings on a map,{'\n'}saved lists, and score-change alerts.
        </Text>

        {packages === null && loadError === null ? (
          <ActivityIndicator color={c.primary} style={{ marginTop: 36 }} />
        ) : loadError !== null ? (
          <View style={styles.errorBox}>
            <Text style={[styles.errorText, { color: c.subtext }]}>{loadError}</Text>
            <Pressable onPress={load} style={[styles.button, { backgroundColor: c.primary }]}>
              <Text style={styles.buttonText}>Try again</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <View style={styles.plans}>
              {packages!.map((pkg) => {
                const active = pkg.identifier === selected
                return (
                  <Pressable
                    key={pkg.identifier}
                    onPress={() => setSelected(pkg.identifier)}
                    style={[
                      styles.plan,
                      {
                        backgroundColor: c.card,
                        borderColor: active ? c.primary : c.border,
                        borderWidth: active ? 2 : StyleSheet.hairlineWidth,
                      },
                    ]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.planTitle, { color: c.text }]}>{pkg.product.title}</Text>
                      {LENGTH_LABEL[pkg.packageType] ? (
                        <Text style={[styles.planLength, { color: c.subtext }]}>
                          {LENGTH_LABEL[pkg.packageType]}
                          {isAutoRenewing(pkg) ? ' · renews automatically' : ''}
                        </Text>
                      ) : null}
                    </View>
                    <Text style={[styles.planPrice, { color: c.text }]}>{priceLine(pkg)}</Text>
                  </Pressable>
                )
              })}
            </View>

            <Pressable
              onPress={onBuy}
              disabled={buying || !selectedPkg}
              style={[styles.button, { backgroundColor: c.primary, opacity: buying ? 0.7 : 1 }]}
            >
              {buying ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Continue</Text>}
            </Pressable>

            {selectedPkg && isAutoRenewing(selectedPkg) ? (
              <Text style={[styles.fineprint, { color: c.subtext }]}>
                The yearly plan is an auto-renewing subscription. Payment is charged to your Apple
                Account at confirmation, and it renews at {selectedPkg.product.priceString} per year
                unless cancelled at least 24 hours before the end of the current period. Manage or
                cancel anytime in your Apple Account settings.
              </Text>
            ) : null}
          </>
        )}

        <Pressable onPress={onRestore} disabled={restoring} style={styles.restore}>
          {restoring ? (
            <ActivityIndicator color={c.primary} />
          ) : (
            <Text style={[styles.restoreText, { color: c.primary }]}>Restore purchases</Text>
          )}
        </Pressable>

        <View style={styles.legalRow}>
          <Pressable onPress={() => Linking.openURL(PRIVACY_POLICY_URL)} hitSlop={8}>
            <Text style={[styles.legalLink, { color: c.subtext }]}>Privacy Policy</Text>
          </Pressable>
          <Text style={[styles.legalDot, { color: c.subtext }]}>·</Text>
          <Pressable onPress={() => Linking.openURL(TERMS_OF_USE_URL)} hitSlop={8}>
            <Text style={[styles.legalLink, { color: c.subtext }]}>Terms of Use</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },
  badge: { width: 64, height: 64, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  badgeText: { color: '#fff', fontSize: 32, fontWeight: '800' },
  title: { fontSize: 28, fontWeight: '800', letterSpacing: -0.5, textAlign: 'center' },
  subtitle: { fontSize: 15, textAlign: 'center', lineHeight: 22, marginTop: 10 },
  plans: { width: '100%', gap: 12, marginTop: 30 },
  plan: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 18,
  },
  planTitle: { fontSize: 16, fontWeight: '700' },
  planLength: { fontSize: 13, marginTop: 3 },
  planPrice: { fontSize: 16, fontWeight: '700' },
  button: {
    marginTop: 18,
    paddingVertical: 15,
    paddingHorizontal: 36,
    borderRadius: 16,
    alignSelf: 'stretch',
    alignItems: 'center',
  },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  fineprint: { fontSize: 11.5, lineHeight: 16, textAlign: 'center', marginTop: 14 },
  errorBox: { alignItems: 'center', marginTop: 30, alignSelf: 'stretch' },
  errorText: { fontSize: 14, lineHeight: 20, textAlign: 'center' },
  restore: { marginTop: 22, minHeight: 20, justifyContent: 'center' },
  restoreText: { fontSize: 14, fontWeight: '600' },
  legalRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14 },
  legalLink: { fontSize: 12.5, textDecorationLine: 'underline' },
  legalDot: { fontSize: 12.5 },
})
