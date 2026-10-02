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
import {
  getOfferings,
  getStorefrontCountry,
  purchasePackage,
  restorePurchases,
  isPurchasesConfigured,
  retryIdentityAndEntitlement,
} from '@/lib/purchases'
import { PRIVACY_POLICY_URL, TERMS_OF_USE_URL } from '@/lib/legal'
import { errorMessage } from '@/lib/errors'
import { Button } from './ui'
import { BadgeFan } from './BadgeFan'
import { EmailSignIn } from './EmailSignIn'

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
    title: 'Every place, no limit',
    body: 'Full details, history and inspection scores for every place.',
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

// The store's own price string can carry the wrong symbol: UK testers saw
// "$9.99" on the paywall while Apple's purchase sheet charged £9.99 (the
// StoreKit formatter follows the device's region, not the storefront). So we
// format the amount ourselves in the storefront's currency, falling back to
// the store string for currencies we don't have a symbol for.
const CURRENCY_SYMBOL: Record<string, string> = { GBP: '£', USD: '$', EUR: '€' }

type PriceFormatter = (amount: number, pkg: PurchasesPackage) => string

function makePriceFormatter(storefrontCountry: string | null): PriceFormatter {
  return (amount, pkg) => {
    const currency = storefrontCountry === 'GBR' ? 'GBP' : pkg.product.currencyCode
    const symbol = CURRENCY_SYMBOL[currency]
    if (!symbol) {
      return amount === pkg.product.price
        ? pkg.product.priceString
        : `${amount.toFixed(2)} ${currency}`
    }
    return `${symbol}${amount.toFixed(2)}`
  }
}

const MONTHS_IN_PERIOD: Partial<Record<PACKAGE_TYPE, number>> = {
  [PACKAGE_TYPE.TWO_MONTH]: 2,
  [PACKAGE_TYPE.THREE_MONTH]: 3,
  [PACKAGE_TYPE.SIX_MONTH]: 6,
  [PACKAGE_TYPE.ANNUAL]: 12,
}

// Secondary line under the plan name: the per-month equivalent for longer
// subscriptions, or what "lifetime" means.
function planDetail(pkg: PurchasesPackage, fmt: PriceFormatter): string {
  if (pkg.packageType === PACKAGE_TYPE.LIFETIME) return 'Pay once, yours forever'
  const months = MONTHS_IN_PERIOD[pkg.packageType]
  const perMonth = months ? fmt(pkg.product.price / months, pkg) : null
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
  freeLimit,
  onContinueFree,
  onClose,
  notice,
}: {
  onUnlocked: () => void
  // Present so the paywall can re-attempt the RevenueCat login itself.
  userId?: string
  // True when we could not confirm which customer we're acting as, so
  // "not entitled" may be wrong. Someone who has genuinely paid can land here.
  identityFailed?: boolean
  // The free plan's monthly allowance, offered as a way past the paywall.
  freeLimit?: number
  onContinueFree?: () => void
  // Shown as a modal from inside the app (free plan): can be dismissed.
  onClose?: () => void
  // Why it opened, e.g. the free allowance ran out.
  notice?: string
}) {
  const c = useTheme()
  const insets = useSafeAreaInsets()
  const [packages, setPackages] = useState<PurchasesPackage[] | null>(null)
  const [fmt, setFmt] = useState<PriceFormatter>(() => makePriceFormatter(null))
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [buying, setBuying] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [signingIn, setSigningIn] = useState(false)

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
      const [offering, country] = await Promise.all([getOfferings(), getStorefrontCountry()])
      setFmt(() => makePriceFormatter(country))
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
        <View style={[styles.hero, { paddingTop: (onClose ? 16 : insets.top) + 20 }]}>
          {onClose ? (
            <Pressable
              onPress={onClose}
              hitSlop={10}
              style={[styles.close, { top: 14 }]}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <Ionicons name="close" size={20} color={c.label} />
            </Pressable>
          ) : null}
          <View style={styles.fan}>
            <BadgeFan />
          </View>
          <View style={[styles.proPill, { backgroundColor: c.label }]}>
            <Text style={[styles.proPillText, { color: HERO_BG }]}>BITESCORE PRO</Text>
          </View>
          <Text style={[styles.title, { color: c.label }]}>Know before you eat</Text>
          <Text style={[styles.subtitle, { color: c.label }]}>
            Official UK hygiene ratings, wherever you're eating.
          </Text>
          {notice ? (
            <View style={[styles.noticePill, { backgroundColor: 'rgba(255,255,255,0.7)' }]}>
              <Text style={[styles.noticePillText, { color: c.label }]}>{notice}</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.benefits}>
          {BENEFITS.map((b) => (
            <View key={b.title} style={styles.benefit}>
              <View style={[styles.benefitIcon, { backgroundColor: c.tintSoft }]}>
                <Ionicons name={b.icon} size={20} color={c.tint} />
              </View>
              <View style={styles.benefitText}>
                <Text style={[styles.benefitTitle, { color: c.label }]}>{b.title}</Text>
                <Text style={[styles.benefitBody, { color: c.label2 }]}>{b.body}</Text>
              </View>
            </View>
          ))}
          <View style={styles.source}>
            <Ionicons name="checkmark-circle" size={15} color={c.meta} />
            <Text style={[styles.sourceText, { color: c.meta }]}>
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
              <View key={i} style={[styles.planSkeleton, { backgroundColor: c.bg }]} />
            ))}
          </View>
        ) : loadError !== null ? (
          <View style={[styles.errorBox, { backgroundColor: c.bg }]}>
            <Ionicons name="cloud-offline-outline" size={22} color={c.meta} />
            <Text style={[styles.errorText, { color: c.label2 }]}>{loadError}</Text>
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
                      backgroundColor: active ? c.tintSoft : c.card,
                      borderColor: active ? c.tint : c.separator,
                    },
                  ]}
                >
                  {badge ? (
                    <View style={[styles.badge, { backgroundColor: c.tint }]}>
                      <Text style={styles.badgeText}>{badge.toUpperCase()}</Text>
                    </View>
                  ) : null}
                  <View
                    style={[
                      styles.radio,
                      { borderColor: active ? c.tint : c.chevron },
                      active && { backgroundColor: c.tint },
                    ]}
                  >
                    {active ? <Ionicons name="checkmark" size={14} color="#fff" /> : null}
                  </View>
                  <View style={styles.planBody}>
                    <Text style={[styles.planName, { color: c.label }]} numberOfLines={1}>
                      {planName(pkg)}
                    </Text>
                    <Text style={[styles.planDetail, { color: c.meta }]} numberOfLines={1}>
                      {planDetail(pkg, fmt)}
                    </Text>
                  </View>
                  <View style={styles.planPriceCol}>
                    <Text style={[styles.planPrice, { color: c.label }]}>
                      {fmt(pkg.product.price, pkg)}
                    </Text>
                    <Text style={[styles.planSuffix, { color: c.meta }]}>
                      {priceSuffix(pkg)}
                    </Text>
                  </View>
                </Pressable>
              )
            })}
          </View>
        )}

        <Button
          label={loadError !== null ? 'Try again' : selectedTrial ? 'Start free trial' : 'Continue'}
          disabled={loadError === null && !selectedPkg}
          loading={buying}
          onPress={loadError !== null ? load : onBuy}
          style={styles.cta}
        />

        {selectedPkg ? (
          <>
            <View style={styles.reassure}>
              <Ionicons name="shield-checkmark" size={14} color={c.tint} />
              <Text style={[styles.reassureText, { color: c.label2 }]}>
                {isAutoRenewing(selectedPkg)
                  ? 'Cancel anytime in Settings'
                  : 'One-time payment · No subscription'}
              </Text>
            </View>
            {isAutoRenewing(selectedPkg) ? (
              <Text style={[styles.fineprint, { color: c.meta }]}>
                {selectedTrial
                  ? `${selectedTrial[0].toUpperCase()}${selectedTrial.slice(1)}, then `
                  : ''}
                {fmt(selectedPkg.product.price, selectedPkg)} per {PERIOD_WORD[selectedPkg.packageType] ?? 'period'}.
                Payment is charged to your {STORE_ACCOUNT}
                {selectedTrial ? ' when the trial ends' : ' at confirmation'} and renews
                automatically unless cancelled at least 24 hours before the period ends. Manage or
                cancel anytime in your {STORE_ACCOUNT} settings.
              </Text>
            ) : null}
          </>
        ) : null}

        {onContinueFree && freeLimit ? (
          <Pressable
            onPress={onContinueFree}
            hitSlop={6}
            style={styles.freeRow}
            accessibilityRole="button"
          >
            <Text style={[styles.freeText, { color: c.label2 }]}>
              Not now · <Text style={{ color: c.tint, fontWeight: '600' }}>Continue free</Text>, {freeLimit}{' '}
              places a month
            </Text>
          </Pressable>
        ) : null}

        {identityFailed ? (
          <View style={[styles.notice, { backgroundColor: c.bg }]}>
            <Text style={[styles.noticeText, { color: c.label2 }]}>
              We couldn't check your account just now, so this screen may be showing in error. If
              you've already bought Bitescore, tap Restore.
            </Text>
          </View>
        ) : null}

        <Pressable onPress={() => setSigningIn(true)} hitSlop={8} style={styles.signInRow}>
          <Text style={[styles.signInText, { color: c.label2 }]}>
            Already have an account? <Text style={{ color: c.tint, fontWeight: '600' }}>Sign in</Text>
          </Text>
        </Pressable>

        <View style={styles.legalRow}>
          <Pressable onPress={onRestore} disabled={restoring} hitSlop={8}>
            {restoring ? (
              <ActivityIndicator size="small" color={c.meta} />
            ) : (
              <Text style={[styles.legalLink, { color: c.meta }]}>Restore</Text>
            )}
          </Pressable>
          <Text style={[styles.legalDot, { color: c.chevron }]}>·</Text>
          <Pressable onPress={() => Linking.openURL(TERMS_OF_USE_URL)} hitSlop={8}>
            <Text style={[styles.legalLink, { color: c.meta }]}>Terms</Text>
          </Pressable>
          <Text style={[styles.legalDot, { color: c.chevron }]}>·</Text>
          <Pressable onPress={() => Linking.openURL(PRIVACY_POLICY_URL)} hitSlop={8}>
            <Text style={[styles.legalLink, { color: c.meta }]}>Privacy</Text>
          </Pressable>
        </View>
      </View>

      <EmailSignIn visible={signingIn} onClose={() => setSigningIn(false)} />
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
  close: {
    position: 'absolute',
    left: 16,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.6)',
  },
  noticePill: { marginTop: 14, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 8 },
  noticePillText: { fontSize: 14, fontWeight: '600', textAlign: 'center', lineHeight: 19 },
  freeRow: { alignItems: 'center', paddingTop: 12 },
  freeText: { fontSize: 15 },
  proPill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, marginBottom: 10 },
  proPillText: { fontSize: 11, fontWeight: '700', letterSpacing: 1.2 },
  title: {
    fontSize: 32,
    lineHeight: 36,
    fontWeight: '700',
    letterSpacing: -1,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 15,
    fontWeight: '500',
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
  benefitTitle: { fontSize: 15.5, fontWeight: '600' },
  benefitBody: { fontSize: 13.5, fontWeight: '400', lineHeight: 18, marginTop: 1 },
  source: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 6,
  },
  sourceText: { fontSize: 12.5, fontWeight: '500' },
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
  badgeText: { color: '#fff', fontSize: 10.5, fontWeight: '700', letterSpacing: 0.6 },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  planBody: { flex: 1 },
  planName: { fontSize: 16, fontWeight: '600' },
  planDetail: { fontSize: 12.5, fontWeight: '400', marginTop: 2 },
  planPriceCol: { alignItems: 'flex-end' },
  planPrice: { fontSize: 19, fontWeight: '700' },
  planSuffix: { fontSize: 12, fontWeight: '400', marginTop: 1 },
  errorBox: {
    borderRadius: 18,
    paddingVertical: 16,
    paddingHorizontal: 16,
    alignItems: 'center',
    gap: 8,
  },
  errorText: { fontSize: 14, fontWeight: '400', lineHeight: 20, textAlign: 'center' },
  cta: { height: 56, alignItems: 'center', justifyContent: 'center', marginTop: 14 },
  ctaText: { color: '#fff', fontSize: 17, fontWeight: '600' },
  reassure: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 10,
  },
  reassureText: { fontSize: 13, fontWeight: '500' },
  fineprint: { fontSize: 10, fontWeight: '400', lineHeight: 13, textAlign: 'center', marginTop: 6 },
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
  legalLink: { fontSize: 13, fontWeight: '600' },
  signInRow: { alignItems: 'center', marginTop: 18 },
  signInText: { fontSize: 15 },
})
