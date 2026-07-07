import { Platform } from 'react-native'
import Purchases, {
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
  if (__DEV__) Purchases.setLogLevel(LOG_LEVEL.WARN)
  Purchases.configure({ apiKey })
  configured = true
}

// Links RevenueCat's customer to our own Supabase user id, so the webhook
// (server/api/revenuecat/webhook.ts) can update the right row in
// public.entitlements without any separate mapping table.
export async function loginPurchases(userId: string): Promise<void> {
  if (!configured) return
  try {
    await Purchases.logIn(userId)
  } catch (e) {
    console.warn('[bitescore] RevenueCat login failed', e)
  }
}

function isEntitledFrom(info: CustomerInfo): boolean {
  return typeof info.entitlements.active[ENTITLEMENT_ID] !== 'undefined'
}

export async function getIsEntitled(): Promise<boolean> {
  // Fail-open if RevenueCat isn't configured (e.g. keys missing locally) —
  // a real build always has them, so this only affects incomplete dev setups,
  // never production.
  if (!configured) return true
  try {
    const info = await Purchases.getCustomerInfo()
    return isEntitledFrom(info)
  } catch {
    return false
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

export async function restorePurchases(): Promise<boolean> {
  const info = await Purchases.restorePurchases()
  return isEntitledFrom(info)
}
