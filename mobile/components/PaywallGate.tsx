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
  Platform,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import {
  PACKAGE_TYPE,
  PRODUCT_CATEGORY,
  PURCHASES_ERROR_CODE,
  type PurchasesPackage,
} from 'react-native-purchases'
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
import { EdgeButton } from './ui'
import { BadgeFan } from './BadgeFan'

// Native paywall built directly on the default RevenueCat Offering, rather
// than the dashboard-configured RevenueCatUI paywall. App Review requires
// the purchase flow itself to display the subscription title, length, price,
// and functional Privacy Policy / Terms of Use links (guideline 3.1.2c) —
// rendering it natively guarantees all of that regardless of dashboard
// state, and lets us surface real error messages instead of a dead screen.
//
// Layout follows the common subscription-paywall shape: brand hero, benefit
// checklist, then a pinned footer with stacked plan rows, one CTA, and the
// legal links. The billed price stays the most prominent price on each row;
// the per-month equivalent is secondary (guideline 3.1.2).

const PERIOD_WORD: Partial<Record<PACKAGE_TYPE, string>> = {
  [PACKAGE_TYPE.WEEKLY]: 'week',
  [PACKAGE_TYPE.MONTHLY]: 'month',
  [PACKAGE_TYPE.TWO_MONTH]: '2 months',
  [PACKAGE_TYPE.THREE_MONTH]: '3 months',
  [PACKAGE_TYPE.SIX_MONTH]: '6 months',
  [PACKAGE_TYPE.ANNUAL]: 'year',
}

// Yearly first, lifetime second, anything unexpected last.
const DISPLAY_ORDER: Partial<Record<PACKAGE_TYPE, number>> = {
  [PACKAGE_TYPE.ANNUAL]: 0,
  [PACKAGE_TYPE.LIFETIME]: 1,
}

const BENEFITS: { icon: keyof typeof Ionicons.glyphMap; title: string; body: string }[] = [
  {
    icon: 'shield-checkmark',
    title: 'Every rating, everywhere',
    body: 'Official scores for every place near you.',
  },
  {
    icon: 'notifications',
    title: 'Score drop alerts',
    body: "Know when a saved place's rating changes.",
  },
  {
    icon: 'bookmark',
    title: 'Lists for your go-tos',
    body: 'Save favourites so you never lose a find.',
  },
  {
    icon: 'chatbubbles',
    title: 'Honest reviews',
    body: 'Real reviews from people who ate there.',
  },
]

// Brand yellow from the logo, icon and splash — used only for the hero.
const HERO_BG = '#FFDE59'

const STORE_NAME = Platform.OS === 'ios' ? 'the App Store' : 'Google Play'
const STORE_ACCOUNT = Platform.OS === 'ios' ? 'Apple Account' : 'Google Play account'

// RevenueCat's errors are written for developers. Store/dashboard setup
// failures (e.g. "None of the products registered in the RevenueCat dashboard
// could be fetched from App Store Connect") are not something a customer can
// act on, so they get a plain message; the raw error still goes to the log.
// Everything else (payment pending, purchase not allowed, …) is already
// user-readable and passes through unchanged.
const SETUP_ERROR_CODES = new Set<string>([
  PURCHASES_ERROR_CODE.CONFIGURATION_ERROR,
  PURCHASES_ERROR_CODE.INVALID_CREDENTIALS_ERROR,
  PURCHASES_ERROR_CODE.INVALID_APPLE_SUBSCRIPTION_KEY_ERROR,
  PURCHASES_ERROR_CODE.PRODUCT_NOT_AVAILABLE_FOR_PURCHASE_ERROR,
  PURCHASES_ERROR_CODE.UNEXPECTED_BACKEND_RESPONSE_ERROR,
  PURCHASES_ERROR_CODE.UNKNOWN_BACKEND_ERROR,
])
const CONNECTION_ERROR_CODES = new Set<string>([
  PURCHASES_ERROR_CODE.NETWORK_ERROR,
  PURCHASES_ERROR_CODE.OFFLINE_CONNECTION_ERROR,
  PURCHASES_ERROR_CODE.PRODUCT_REQUEST_TIMED_OUT_ERROR,
])
const PLANS_UNAVAILABLE = 'Plans aren’t available right now. Please try again in a little while.'

function purchaseErrorMessage(e: unknown): string {
  console.warn('[bitescore] RevenueCat error', e)
  const code = (e as { code?: unknown } | null)?.code
  if (typeof code === 'string') {
    if (SETUP_ERROR_CODES.has(code)) return PLANS_UNAVAILABLE
    if (CONNECTION_ERROR_CODES.has(code)) {
      return `Couldn’t reach ${STORE_NAME}. Check your connection and try again.`
    }
  }
  return errorMessage(e)
}

function isAutoRenewing(pkg: PurchasesPackage): boolean {
  return (
    pkg.packageType !== PACKAGE_TYPE.LIFETIME &&
    pkg.product.productCategory === PRODUCT_CATEGORY.SUBSCRIPTION
  )
}

// "7-day free trial" when the product carries a free intro offer, else null.
// Paid intro offers are ignored — they'd need their own pricing copy.
function freeTrialLabel(pkg: PurchasesPackage): string | null {
  const intro = pkg.product.introPrice
  if (!intro || intro.price !== 0 || !isAutoRenewing(pkg)) return null
  const unit = intro.periodUnit.toLowerCase()
  return `${intro.periodNumberOfUnits}-${unit} free trial`
}

// Secondary line under the plan name: the per-month equivalent for longer
// subscriptions, or what "lifetime" means.
function planDetail(pkg: PurchasesPackage): string {
  if (pkg.packageType === PACKAGE_TYPE.LIFETIME) return 'Pay once, yours forever'
  const perMonth = pkg.product.pricePerMonthString
  const period = PERIOD_WORD[pkg.packageType]
  if (perMonth && pkg.packageType !== PACKAGE_TYPE.MONTHLY && pkg.packageType !== PACKAGE_TYPE.WEEKLY) {
    return `Just ${perMonth}/month, billed ${period === 'year' ? 'yearly' : `every ${period}`}`
  }
  return period ? `Billed every ${period}` : 'Renews automatically'
}

function planName(pkg: PurchasesPackage): string {
  switch (pkg.packageType) {
    case PACKAGE_TYPE.ANNUAL:
      return 'Yearly'
    case PACKAGE_TYPE.LIFETIME:
      return 'Lifetime'
    case PACKAGE_TYPE.MONTHLY:
      return 'Monthly'
    case PACKAGE_TYPE.WEEKLY:
      return 'Weekly'
    default:
      return pkg.product.title
  }
}

function priceSuffix(pkg: PurchasesPackage): string {
  if (pkg.packageType === PACKAGE_TYPE.LIFETIME) return 'once'
  const period = PERIOD_WORD[pkg.packageType]
  return period ? `/${period}` : ''
}

export function PaywallGate({
  onUnlocked,
  userId,
  identityFailed = false,
}: {
  onUnlocked: () => void
  // Present so the paywall can re-attempt the RevenueCat login itself.
  userId?: string
  // True when we could not confirm which customer we're acting as, so
  // "not entitled" may be wrong. Someone who has genuinely paid can land here.
  identityFailed?: boolean
}) {
  const c = useTheme()
  const insets = useSafeAreaInsets()
  const [packages, setPackages] = useState<PurchasesPackage[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
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
      const pkgs = [...(offering?.availablePackages ?? [])].sort(
        (a, b) => (DISPLAY_ORDER[a.packageType] ?? 9) - (DISPLAY_ORDER[b.packageType] ?? 9),
      )
      if (pkgs.length === 0) {
        // An empty offering is a dashboard problem, not a connection one.
        setLoadError(PLANS_UNAVAILABLE)
        return
      }
      setPackages(pkgs)
      setSelected((prev) => prev ?? pkgs[0].identifier)
    } catch (e) {
      setLoadError(purchaseErrorMessage(e))
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const selectedPkg = packages?.find((p) => p.identifier === selected) ?? null
  const selectedTrial = selectedPkg ? freeTrialLabel(selectedPkg) : null

  const onBuy = async () => {
    if (!selectedPkg || buying) return
    setBuying(true)
    try {
      if (await purchasePackage(selectedPkg)) onUnlocked()
    } catch (e) {
      if (!(e as { userCancelled?: boolean }).userCancelled) {
        Alert.alert('Purchase failed', purchaseErrorMessage(e))
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
        Alert.alert('Nothing to restore', `No previous purchase was found for this ${STORE_ACCOUNT}.`)
      }
    } catch (e) {
      Alert.alert('Restore failed', purchaseErrorMessage(e))
    } finally {
      setRestoring(false)
    }
  }

  return (
    <View style={[styles.root, { backgroundColor: c.bg }]}>
      <ScrollView contentContainerStyle={styles.scroll} bounces={false}>
        <View style={[styles.hero, { paddingTop: insets.top + 20 }]}>
          <View style={styles.fan}>
            <BadgeFan />
          </View>
          <View style={[styles.proPill, { backgroundColor: c.text }]}>
            <Text style={[styles.proPillText, { color: HERO_BG }]}>BITESCORE PRO</Text>
          </View>
          <Text style={[styles.title, { color: c.text }]}>Know before you eat</Text>
          <Text style={[styles.subtitle, { color: c.text }]}>
            Official UK hygiene ratings, wherever you're eating.
          </Text>
        </View>

        <View style={styles.benefits}>
          {BENEFITS.map((b) => (
            <View key={b.title} style={styles.benefit}>
              <View style={[styles.benefitIcon, { backgroundColor: c.primaryTint }]}>
                <Ionicons name={b.icon} size={20} color={c.primary} />
              </View>
              <View style={styles.benefitText}>
                <Text style={[styles.benefitTitle, { color: c.text }]}>{b.title}</Text>
                <Text style={[styles.benefitBody, { color: c.inkSecondary }]}>{b.body}</Text>
              </View>
            </View>
          ))}
          <View style={styles.source}>
            <Ionicons name="checkmark-circle" size={15} color={c.mutedOnCard} />
            <Text style={[styles.sourceText, { color: c.mutedOnCard }]}>
              Ratings from the Food Standards Agency
            </Text>
          </View>
        </View>
      </ScrollView>

      <View
        style={[
          styles.footer,
          { backgroundColor: c.card, paddingBottom: insets.bottom + 10 },
        ]}
      >
        {packages === null && loadError === null ? (
          <View style={styles.plans}>
            {[0, 1].map((i) => (
              <View key={i} style={[styles.planSkeleton, { backgroundColor: c.subtleFill }]} />
            ))}
          </View>
        ) : loadError !== null ? (
          <View style={[styles.errorBox, { backgroundColor: c.subtleFill }]}>
            <Ionicons name="cloud-offline-outline" size={22} color={c.subtext} />
            <Text style={[styles.errorText, { color: c.inkSecondary }]}>{loadError}</Text>
          </View>
        ) : (
          <View style={styles.plans}>
            {packages!.map((pkg) => {
              const active = pkg.identifier === selected
              const trial = freeTrialLabel(pkg)
              // Lifetime carries "Best value" (at £19.99 once vs £9.99/yr it
              // wins after two years); a free trial outranks it wherever one
              // exists.
              const badge =
                trial ??
                (pkg.packageType === PACKAGE_TYPE.LIFETIME && packages!.length > 1
                  ? 'Best value'
                  : null)
              return (
                <Pressable
                  key={pkg.identifier}
                  onPress={() => setSelected(pkg.identifier)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  style={[
                    styles.plan,
                    {
                      backgroundColor: active ? c.primaryTint : c.card,
                      borderColor: active ? c.primary : c.controlBorder,
                    },
                  ]}
                >
                  {badge ? (
                    <View style={[styles.badge, { backgroundColor: c.primary }]}>
                      <Text style={styles.badgeText}>{badge.toUpperCase()}</Text>
                    </View>
                  ) : null}
                  <View
                    style={[
                      styles.radio,
                      { borderColor: active ? c.primary : c.dashedBorderDark },
                      active && { backgroundColor: c.primary },
                    ]}
                  >
                    {active ? <Ionicons name="checkmark" size={14} color="#fff" /> : null}
                  </View>
                  <View style={styles.planBody}>
                    <Text style={[styles.planName, { color: c.text }]} numberOfLines={1}>
                      {planName(pkg)}
                    </Text>
                    <Text style={[styles.planDetail, { color: c.mutedOnCard }]} numberOfLines={1}>
                      {planDetail(pkg)}
                    </Text>
                  </View>
                  <View style={styles.planPriceCol}>
                    <Text style={[styles.planPrice, { color: c.text }]}>
                      {pkg.product.priceString}
                    </Text>
                    <Text style={[styles.planSuffix, { color: c.mutedOnCard }]}>
                      {priceSuffix(pkg)}
                    </Text>
                  </View>
                </Pressable>
              )
            })}
          </View>
        )}

        <EdgeButton
          color={c.primary}
          edgeColor={c.primaryDark}
          edge={4}
          radius={18}
          disabled={loadError === null && (buying || !selectedPkg)}
          onPress={loadError !== null ? load : onBuy}
          style={styles.cta}
        >
          {buying ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.ctaText}>
              {loadError !== null ? 'Try again' : selectedTrial ? 'Start free trial' : 'Continue'}
            </Text>
          )}
        </EdgeButton>

        {selectedPkg ? (
          <>
            <View style={styles.reassure}>
              <Ionicons name="shield-checkmark" size={14} color={c.primary} />
              <Text style={[styles.reassureText, { color: c.inkSecondary }]}>
                {isAutoRenewing(selectedPkg)
                  ? 'Cancel anytime in Settings'
                  : 'One-time payment · No subscription'}
              </Text>
            </View>
            {isAutoRenewing(selectedPkg) ? (
              <Text style={[styles.fineprint, { color: c.legal }]}>
                {selectedTrial
                  ? `${selectedTrial[0].toUpperCase()}${selectedTrial.slice(1)}, then `
                  : ''}
                {selectedPkg.product.priceString} per {PERIOD_WORD[selectedPkg.packageType] ?? 'period'}.
                Payment is charged to your {STORE_ACCOUNT}
                {selectedTrial ? ' when the trial ends' : ' at confirmation'} and renews
                automatically unless cancelled at least 24 hours before the period ends. Manage or
                cancel anytime in your {STORE_ACCOUNT} settings.
              </Text>
            ) : null}
          </>
        ) : null}

        {identityFailed ? (
          <View style={[styles.notice, { backgroundColor: c.subtleFill }]}>
            <Text style={[styles.noticeText, { color: c.inkSecondary }]}>
              We couldn't check your account just now, so this screen may be showing in error. If
              you've already bought Bitescore, tap Restore.
            </Text>
          </View>
        ) : null}

        <View style={styles.legalRow}>
          <Pressable onPress={onRestore} disabled={restoring} hitSlop={8}>
            {restoring ? (
              <ActivityIndicator size="small" color={c.subtext} />
            ) : (
              <Text style={[styles.legalLink, { color: c.subtext }]}>Restore</Text>
            )}
          </Pressable>
          <Text style={[styles.legalDot, { color: c.dashedBorderDark }]}>·</Text>
          <Pressable onPress={() => Linking.openURL(TERMS_OF_USE_URL)} hitSlop={8}>
            <Text style={[styles.legalLink, { color: c.subtext }]}>Terms</Text>
          </Pressable>
          <Text style={[styles.legalDot, { color: c.dashedBorderDark }]}>·</Text>
          <Pressable onPress={() => Linking.openURL(PRIVACY_POLICY_URL)} hitSlop={8}>
            <Text style={[styles.legalLink, { color: c.subtext }]}>Privacy</Text>
          </Pressable>
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingBottom: 20 },
  hero: {
    backgroundColor: HERO_BG,
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingBottom: 24,
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
  },
  // BadgeFan reserves headroom for the raised centre tile; trim it here.
  fan: { marginTop: -22, marginBottom: -6 },
  proPill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, marginBottom: 10 },
  proPillText: { fontSize: 11, fontFamily: fonts.display800, letterSpacing: 1.2 },
  title: {
    fontSize: 32,
    lineHeight: 36,
    fontFamily: fonts.display800,
    letterSpacing: -1,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 15,
    fontFamily: fonts.bodyMedium,
    textAlign: 'center',
    lineHeight: 21,
    marginTop: 6,
    opacity: 0.75,
  },
  benefits: { paddingHorizontal: 24, paddingTop: 20, gap: 14 },
  benefit: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  benefitIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  benefitText: { flex: 1 },
  benefitTitle: { fontSize: 15.5, fontFamily: fonts.display600 },
  benefitBody: { fontSize: 13.5, fontFamily: fonts.body, lineHeight: 18, marginTop: 1 },
  source: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 6,
  },
  sourceText: { fontSize: 12.5, fontFamily: fonts.bodyMedium },
  footer: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 18,
    boxShadow: '0 -6px 24px rgba(23, 23, 15, 0.08)',
  },
  plans: { gap: 10 },
  planSkeleton: { height: 62, borderRadius: 18 },
  plan: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 18,
    borderWidth: 2,
    paddingVertical: 10,
    paddingHorizontal: 14,
    minHeight: 62,
  },
  badge: {
    position: 'absolute',
    top: -10,
    right: 14,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  badgeText: { color: '#fff', fontSize: 10.5, fontFamily: fonts.display800, letterSpacing: 0.6 },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  planBody: { flex: 1 },
  planName: { fontSize: 16, fontFamily: fonts.display600 },
  planDetail: { fontSize: 12.5, fontFamily: fonts.body, marginTop: 2 },
  planPriceCol: { alignItems: 'flex-end' },
  planPrice: { fontSize: 19, fontFamily: fonts.display800 },
  planSuffix: { fontSize: 12, fontFamily: fonts.body, marginTop: 1 },
  errorBox: {
    borderRadius: 18,
    paddingVertical: 16,
    paddingHorizontal: 16,
    alignItems: 'center',
    gap: 8,
  },
  errorText: { fontSize: 14, fontFamily: fonts.body, lineHeight: 20, textAlign: 'center' },
  cta: { height: 56, alignItems: 'center', justifyContent: 'center', marginTop: 14 },
  ctaText: { color: '#fff', fontSize: 17, fontFamily: fonts.display600 },
  reassure: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 10,
  },
  reassureText: { fontSize: 13, fontFamily: fonts.bodyMedium },
  fineprint: { fontSize: 10, fontFamily: fonts.body, lineHeight: 13, textAlign: 'center', marginTop: 6 },
  notice: {
    marginTop: 12,
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
    gap: 10,
    marginTop: 10,
    minHeight: 20,
  },
  legalDot: { fontSize: 13 },
  legalLink: { fontSize: 13, fontFamily: fonts.display600 },
})
