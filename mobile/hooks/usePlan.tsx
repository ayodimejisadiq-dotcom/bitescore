import { createContext, useContext } from 'react'

// Whether this person has Pro, for screens below the root layout. Pro comes
// from the store entitlement (RevenueCat). There is no free plan, so anyone
// inside the app normally has it; dev builds without store keys can be in
// without it.
export interface PlanState {
  isPro: boolean
  // After a purchase or restore made from the in-app paywall.
  unlockPro: () => void
  // Re-reads the entitlement now, e.g. after Manage subscription, where a
  // trial may just have been cancelled. Sends them to the paywall if so.
  recheckPro: () => void
}

export const PlanContext = createContext<PlanState>({
  isPro: true,
  unlockPro: () => {},
  recheckPro: () => {},
})

export function usePlan(): PlanState {
  return useContext(PlanContext)
}
