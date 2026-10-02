import { createContext, useContext } from 'react'
import type { FreePlanStatus } from '@/lib/plan'

// Who is on which plan, for screens below the root layout. Pro comes from the
// store entitlement (RevenueCat); `free` is the server's allowance and usage,
// null for Pro users or while unknown.
export interface PlanState {
  isPro: boolean
  free: FreePlanStatus | null
  setFree: (s: FreePlanStatus) => void
  // After a purchase or restore made from the in-app paywall.
  unlockPro: () => void
}

export const PlanContext = createContext<PlanState>({
  isPro: true,
  free: null,
  setFree: () => {},
  unlockPro: () => {},
})

export function usePlan(): PlanState {
  return useContext(PlanContext)
}
