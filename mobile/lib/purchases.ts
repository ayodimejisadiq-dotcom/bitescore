import { Platform } from 'react-native'
import Purchases, {
  INTRO_ELIGIBILITY_STATUS,
  LOG_LEVEL,
  type CustomerInfo,
  type PurchasesOffering,
  type PurchasesPackage,
} from 'react-native-purchases'

const IOS_KEY = process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY
const ANDROID_KEY = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY

// Must match the entitlement identifier configured in the RevenueCat
// dashboard exactly (Entitlements -> "Bitescore Pro"), attached to both the
// yearly and lifetime products.
export const ENTITLEMENT_ID = 'Bitescore Pro'

let configured = false

// Call once at app startup, before anything else touches Purchases.
export function configurePurchases(): void {
  if (configured) return
  const apiKey = Platform.OS === 'ios' ? IOS_KEY : ANDROID_KEY
  if (!apiKey) {
    console.warn(`[bitescore] Missing RevenueCat API key for ${Platform.OS}`)
    return
  }
  if (__DEV__) {
    Purchases.setLogLevel(LOG_LEVEL.WARN)
    // The SDK auto-fetches offerings on configure and logs a full error if
    // it fails — expected in dev builds without a store connection, and RN's
    // LogBox turns any console.error into a blocking full-screen overlay.
    // Downgrade this one known message to a plain log (PaywallGate surfaces
    // real offering failures to the user itself); let everything else through.
    Purchases.setLogHandler((_level, message) => {
      if (message.includes('Error fetching offerings')) return
      console.log(`[RevenueCat] ${message}`)
    })
  }
  Purchases.configure({ apiKey })
  configured = true
}

// Whether the SDK is currently known to be operating as our Supabase user.
// False means any entitlement answer is about some other customer and cannot
// be trusted either way.
let identityConfirmed = false

export function isPurchasesIdentityConfirmed(): boolean {
  return identityConfirmed
}

// Links RevenueCat's customer to our own Supabase user id, so the webhook
// (server/api/revenuecat/webhook.ts) can update the right row in
// public.entitlements without any separate mapping table.
//
// This used to swallow its own failure. That is a bad trade for a call this
// load-bearing: RevenueCat persists the last app user id across launches, so a
// failed logIn leaves the SDK operating as a *previous* user while the app
// carries on as the current one. Everything downstream then answers about the
// wrong customer — a purchase can attach to a stale id, and someone who has
// genuinely paid can be told they haven't, with nothing surfacing anywhere.
//
// So: retry transient failures, and confirm the SDK really switched rather
// than trusting logIn resolving. Returns whether identity is established.
export async function loginPurchases(userId: string): Promise<boolean> {
  if (!configured) return false
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await Purchases.logIn(userId)
      if ((await Purchases.getAppUserID()) === userId) {
        identityConfirmed = true
        return true
      }
      console.warn('[bitescore] RevenueCat logIn resolved but app user id did not change')
    } catch (e) {
      console.warn(`[bitescore] RevenueCat login failed (attempt ${attempt + 1})`, e)
    }
    // Launch-time network blips are the common case; back off and retry.
    if (attempt < 2) await new Promise((r) => setTimeout(r, 500 * 2 ** attempt))
  }
  identityConfirmed = false
  return false
}

// Cancelling a free trial ends access straight away. The store would keep the
// trial running to its end date (and RevenueCat reports it active until then),
// so this is our rule on top: a trial with auto-renew switched off is over.
// Only trials: a cancelled paid plan keeps access to the end of what was paid.
function isCancelledTrial(info: CustomerInfo): boolean {
  const ent = info.entitlements.active[ENTITLEMENT_ID]
  return !!ent && ent.periodType === 'TRIAL' && ent.unsubscribeDetectedAt !== null
}

function isEntitledFrom(info: CustomerInfo): boolean {
  return typeof info.entitlements.active[ENTITLEMENT_ID] !== 'undefined' && !isCancelledTrial(info)
}

// True only when configure() actually ran with a key. Screens use this to
// explain an unusable purchase flow rather than silently misbehaving.
export function isPurchasesConfigured(): boolean {
  return configured
}

export async function getIsEntitled(): Promise<boolean> {
  if (!configured) {
    // Only fail open in development, where a missing key is a normal
    // incomplete setup. A release build reaching this point is misconfigured,
    // and the old unconditional `return true` granted full access on the
    // strength of an assumption ("a real build always has them") that did not
    // hold: users landed inside the app with no entitlement, and — while the
    // database was also gating rows — saw an empty map instead of a paywall.
    // Failing closed sends them to PaywallGate, which says what is wrong.
    return __DEV__
  }
  try {
    const info = await Purchases.getCustomerInfo()
    return isEntitledFrom(info)
  } catch {
    return false
  }
}

// For re-checks while the app is open. Fetches fresh rather than trusting the
// SDK's cache, so a trial cancelled in Settings shows up on return. Null when
// the answer can't be trusted (identity not confirmed, offline, SDK error), so
// a failed read never locks a paying person out mid-session.
export async function readIsEntitled(): Promise<boolean | null> {
  if (!configured || !identityConfirmed) return null
  try {
    await Purchases.invalidateCustomerInfoCache()
    return isEntitledFrom(await Purchases.getCustomerInfo())
  } catch {
    return null
  }
}

// Calls back whenever RevenueCat has newer customer info for this person.
// Returns the unsubscribe.
export function onEntitlementChange(callback: (entitled: boolean) => void): () => void {
  if (!configured) return () => {}
  const listener = (info: CustomerInfo) => {
    if (identityConfirmed) callback(isEntitledFrom(info))
  }
  Purchases.addCustomerInfoUpdateListener(listener)
  return () => {
    Purchases.removeCustomerInfoUpdateListener(listener)
  }
}

// Re-attempts identity, then re-reads entitlement. Used by the paywall's
// retry, so someone locked out by a failed login at launch has a way back
// without reinstalling.
export async function retryIdentityAndEntitlement(userId: string): Promise<boolean> {
  await loginPurchases(userId)
  return getIsEntitled()
}

// The App Store / Play country the person is buying from, e.g. "GBR".
// Null when the store can't say.
export async function getStorefrontCountry(): Promise<string | null> {
  try {
    return (await Purchases.getStorefront())?.countryCode ?? null
  } catch {
    return null
  }
}

// Product ids whose free trial this person can't get, because they've already
// had one. The product's introPrice says what the offer is, not whether they
// can have it. iOS only: Google Play already leaves out offers someone isn't
// eligible for. Empty when the check fails or can't tell, so a new customer
// never loses the trial label by mistake; Apple's purchase sheet shows the
// real terms either way.
export async function getUsedTrialProductIds(productIds: string[]): Promise<Set<string>> {
  if (Platform.OS !== 'ios' || productIds.length === 0) return new Set()
  try {
    const eligibility = await Purchases.checkTrialOrIntroductoryPriceEligibility(productIds)
    return new Set(
      Object.entries(eligibility)
        .filter(([, e]) => e.status === INTRO_ELIGIBILITY_STATUS.INTRO_ELIGIBILITY_STATUS_INELIGIBLE)
        .map(([id]) => id),
    )
  } catch {
    return new Set()
  }
}

export async function getOfferings(): Promise<PurchasesOffering | null> {
  const offerings = await Purchases.getOfferings()
  return offerings.current
}

export async function purchasePackage(pkg: PurchasesPackage): Promise<boolean> {
  const { customerInfo } = await Purchases.purchasePackage(pkg)
  return isEntitledFrom(customerInfo)
}

// 'cancelledTrial' is someone with a trial they cancelled: there is a purchase,
// it just no longer gives access, so "nothing to restore" would be wrong.
export async function restorePurchases(): Promise<'pro' | 'cancelledTrial' | 'none'> {
  const info = await Purchases.restorePurchases()
  if (isEntitledFrom(info)) return 'pro'
  return isCancelledTrial(info) ? 'cancelledTrial' : 'none'
}

// The store's own subscription page, where a cancelled trial can be turned
// back on.
export async function showManageSubscriptions(): Promise<void> {
  await Purchases.showManageSubscriptions()
}
