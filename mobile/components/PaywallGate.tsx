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
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { PACKAGE_TYPE, PRODUCT_CATEGORY, type PurchasesPackage } from 'react-native-purchases'
import { useTheme } from '@/theme/useTheme'
import { fonts } from '@/theme/type'
import {
  getOfferings,
  purchasePackage,
  restorePurchases,
  isPurchasesConfigured,
  retryIdentityAndEntitlement,
} from '@/lib/purchases'
import { PRIVACY_POLICY_URL, TERMS_OF_USE_URL } from '@/lib/legal'
import { errorMessage } from '@/lib/errors'
import { EdgeButton, tileEdge } from './ui'
import { BadgeFan } from './BadgeFan'

// Native paywall built directly on the default RevenueCat Offering, rather
// than the dashboard-configured RevenueCatUI paywall. App Review requires
// the purchase flow itself to display the subscription title, length, price,
// and functional Privacy Policy / Terms of Use links (guideline 3.1.2c) —
// rendering it natively guarantees all of that regardless of dashboard
// state, and lets us surface real error messages instead of a dead screen.

const FEATURES: { title: string; body: string }[] = [
  {
    title: 'EAT WITH CONFIDENCE',
    body: 'See official hygiene ratings for every restaurant, café and pub near you.',
  },
  {
    title: 'SAVE YOUR GO-TOS',
    body: 'Build lists of your favourite places so you never lose track of a good find.',
  },
  {
    title: 'SCORE DROP ALERTS',
    body: "Get notified the second a saved place's rating changes.",
  },
  {
    title: 'HONEST REVIEWS',
    body: "Read and leave real reviews from people who've actually eaten there.",
  },
]

function priceLine(pkg: PurchasesPackage): string {
  const price = pkg.product.priceString
  switch (pkg.packageType) {
    case PACKAGE_TYPE.WEEKLY:
      return `${price} a week`
    case PACKAGE_TYPE.MONTHLY:
      return `${price} a month`
    case PACKAGE_TYPE.ANNUAL:
      return `${price} a year`
    case PACKAGE_TYPE.LIFETIME:
      return price
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

export function PaywallGate({
  onUnlocked,
  userId,
  identityFailed = false,
  onClose,
}: {
  onUnlocked: () => void
  // Present so the paywall can re-attempt the RevenueCat login itself.
  userId?: string
  // True when we could not confirm which customer we're acting as, so
  // "not entitled" may be wrong. Someone who has genuinely paid can land here.
  identityFailed?: boolean
  // When provided, renders a close button. Set this when the paywall is
  // shown as a dismissable upsell from a specific feature (map, notifications,
  // an extra list) rather than the old app-wide launch gate, which had
  // nothing to dismiss to.
  onClose?: () => void
}) {
  const c = useTheme()
  const [packages, setPackages] = useState<PurchasesPackage[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [buying, setBuying] = useState(false)
  const [restoring, setRestoring] = useState(false)

  const load = useCallback(async () => {
    setLoadError(null)
    setPackages(null)
    if (!isPurchasesConfigured()) {
      // Distinct from a failed fetch: the build shipped without a RevenueCat
      // key, so there is nothing to retry into. Say so plainly rather than
      // implying a network problem.
      setLoadError(
        'Purchases aren’t available in this build — it was made without its store keys. Please reinstall from the App Store or TestFlight.',
      )
      return
    }
    try {
      const offering = await getOfferings()
      const pkgs = offering?.availablePackages ?? []
      if (pkgs.length === 0) {
        setLoadError('Bitescore Pro isn’t available right now. Check your connection and try again.')
        return
      }
      setPackages(pkgs)
    } catch (e) {
      setLoadError(errorMessage(e))
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // Single one-time-purchase offering: pick the lifetime package if the
  // Offering ever carries more than one (e.g. mid-migration off the old
  // annual plan), otherwise whatever's there.
  const selectedPkg =
    packages?.find((p) => p.packageType === PACKAGE_TYPE.LIFETIME) ?? packages?.[0] ?? null

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
      // If identity was never confirmed, re-establish it first — otherwise a
      // restore succeeds against the wrong customer and still leaves the
      // person locked out.
      if (identityFailed && userId && (await retryIdentityAndEntitlement(userId))) {
        onUnlocked()
        return
      }
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
      {onClose ? (
        <SafeAreaView edges={['top']} style={styles.closeArea} pointerEvents="box-none">
          <Pressable
            onPress={onClose}
            style={[styles.closeBtn, { backgroundColor: c.card, borderColor: c.controlBorder }]}
            hitSlop={8}
          >
            <Ionicons name="close" size={20} color={c.text} />
          </Pressable>
        </SafeAreaView>
      ) : null}
      <ScrollView contentContainerStyle={styles.scroll}>
        <BadgeFan />
        <Text style={[styles.title, { color: c.text }]}>Unlock Bitescore</Text>
        <Text style={[styles.subtitle, { color: c.subtext }]}>
          Official UK hygiene ratings, wherever you're eating.
        </Text>

        <View style={styles.features}>
          {FEATURES.map((f) => (
            <View key={f.title} style={styles.feature}>
              <Text style={[styles.featureTitle, { color: c.primary }]}>{f.title}</Text>
              <Text style={[styles.featureBody, { color: c.inkSecondary }]}>{f.body}</Text>
            </View>
          ))}
        </View>
      </ScrollView>

      <View style={[styles.footer, { backgroundColor: c.card, borderTopColor: c.border }]}>
        {packages === null && loadError === null ? (
          <ActivityIndicator color={c.primary} style={{ marginVertical: 24 }} />
        ) : loadError !== null ? (
          <>
            <Text style={[styles.errorText, { color: c.subtext }]}>{loadError}</Text>
            <EdgeButton
              color={c.primary}
              edgeColor={c.primaryDark}
              edge={4}
              radius={18}
              onPress={load}
              style={styles.cta}
            >
              <Text style={styles.ctaText}>Try again</Text>
            </EdgeButton>
          </>
        ) : (
          <>
            {selectedPkg ? (
              <View style={styles.priceBlock}>
                <Text style={[styles.priceHeadline, { color: c.text }]}>{priceLine(selectedPkg)}</Text>
                <Text style={[styles.priceSub, { color: c.mutedOnCard }]}>
                  {isAutoRenewing(selectedPkg) ? 'Renews automatically' : 'One-time payment'}
                </Text>
              </View>
            ) : null}

            <EdgeButton
              color={c.primary}
              edgeColor={c.primaryDark}
              edge={4}
              radius={18}
              disabled={buying || !selectedPkg}
              onPress={onBuy}
              style={styles.cta}
            >
              {buying ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.ctaText}>Unlock Bitescore</Text>
              )}
            </EdgeButton>

            {selectedPkg && isAutoRenewing(selectedPkg) ? (
              <Text style={[styles.fineprint, { color: c.mutedOnCard }]}>
                Auto-renewing subscription. Payment is charged to your Apple Account at
                confirmation and renews at {selectedPkg.product.priceString} per year unless
                cancelled at least 24 hours before the period ends. Manage or cancel anytime in
                your Apple Account settings.
              </Text>
            ) : (
              <Text style={[styles.fineprint, { color: c.mutedOnCard }]}>
                One-time purchase. Yours forever, no subscription.
              </Text>
            )}
          </>
        )}

        {identityFailed ? (
          <View style={[styles.notice, { backgroundColor: c.subtleFill }]}>
            <Text style={[styles.noticeText, { color: c.inkSecondary }]}>
              We couldn't check your account just now, so this screen may be showing in error. If
              you've already bought Bitescore, tap Restore Purchases.
            </Text>
          </View>
        ) : null}

        <View style={styles.legalRow}>
          <Pressable onPress={onRestore} disabled={restoring} hitSlop={8}>
            {restoring ? (
              <ActivityIndicator size="small" color={c.primary} />
            ) : (
              <Text style={[styles.legalLink, { color: c.primary }]}>Restore Purchases</Text>
            )}
          </Pressable>
          <Pressable onPress={() => Linking.openURL(TERMS_OF_USE_URL)} hitSlop={8}>
            <Text style={[styles.legalLink, { color: c.primary }]}>Terms</Text>
          </Pressable>
          <Pressable onPress={() => Linking.openURL(PRIVACY_POLICY_URL)} hitSlop={8}>
            <Text style={[styles.legalLink, { color: c.primary }]}>Privacy</Text>
          </Pressable>
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  closeArea: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    alignItems: 'flex-end',
    zIndex: 10,
  },
  closeBtn: {
    width: 40,
    height: 40,
    borderRadius: 14,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 20,
    marginTop: 6,
  },
  scroll: { paddingHorizontal: 24, paddingTop: 40, paddingBottom: 24, alignItems: 'center' },
  title: { fontSize: 32, fontFamily: fonts.display800, letterSpacing: -0.6, textAlign: 'center' },
  subtitle: {
    fontSize: 15,
    fontFamily: fonts.body,
    textAlign: 'center',
    lineHeight: 22,
    marginTop: 8,
  },
  features: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 28, rowGap: 20 },
  feature: { width: '50%', paddingRight: 14 },
  featureTitle: { fontSize: 11.5, fontFamily: fonts.display600, letterSpacing: 1.2 },
  featureBody: { fontSize: 14.5, fontFamily: fonts.body, lineHeight: 20, marginTop: 5 },
  footer: {
    borderTopWidth: 1.5,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 28,
  },
  priceBlock: { alignItems: 'center' },
  priceHeadline: { fontSize: 36, fontFamily: fonts.display800, letterSpacing: -0.6 },
  priceSub: { fontSize: 13.5, fontFamily: fonts.body, marginTop: 4 },
  cta: { height: 56, alignItems: 'center', justifyContent: 'center', marginTop: 14 },
  ctaText: { color: '#fff', fontSize: 17, fontFamily: fonts.display600 },
  fineprint: { fontSize: 11.5, fontFamily: fonts.body, lineHeight: 16, textAlign: 'center', marginTop: 12 },
  errorText: { fontSize: 14, fontFamily: fonts.body, lineHeight: 20, textAlign: 'center', marginTop: 8 },
  notice: {
    marginTop: 16,
    alignSelf: 'stretch',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  noticeText: { fontSize: 12.5, lineHeight: 18, textAlign: 'center' },
  legalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 22,
    marginTop: 14,
    minHeight: 20,
  },
  legalLink: { fontSize: 13, fontFamily: fonts.display600 },
})
