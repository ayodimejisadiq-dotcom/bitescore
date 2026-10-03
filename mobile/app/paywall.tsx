import { useEffect, useState } from 'react'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { PaywallGate } from '@/components/PaywallGate'
import { usePlan } from '@/hooks/usePlan'
import { currentUserId } from '@/lib/data'
import { freeLeft, resetsLabel } from '@/lib/plan'

// The paywall as a dismissible sheet, for people on the free plan: opened
// when the monthly allowance runs out, or from Settings to upgrade.
export default function PaywallScreen() {
  const router = useRouter()
  const plan = usePlan()
  const { reason } = useLocalSearchParams<{ reason?: string }>()
  const [userId, setUserId] = useState<string | undefined>()

  useEffect(() => {
    currentUserId().then((id) => setUserId(id ?? undefined)).catch(() => {})
  }, [])

  const free = plan.free
  const notice =
    reason === 'limit' && free
      ? `You've used your ${free.free_limit} free places this month. More on ${resetsLabel(free)}.`
      : free
        ? `${freeLeft(free)} of ${free.free_limit} free places left this month`
        : undefined

  return (
    <PaywallGate
      userId={userId}
      notice={notice}
      onClose={() => router.back()}
      onUnlocked={() => {
        plan.unlockPro()
        router.back()
      }}
    />
  )
}
