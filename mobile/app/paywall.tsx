import { useEffect, useState } from 'react'
import { useRouter } from 'expo-router'
import { PaywallGate } from '@/components/PaywallGate'
import { usePlan } from '@/hooks/usePlan'
import { currentUserId } from '@/lib/data'

// The paywall as a dismissible sheet, opened from Settings by anyone inside
// the app without Pro (dev builds without store keys).
export default function PaywallScreen() {
  const router = useRouter()
  const plan = usePlan()
  const [userId, setUserId] = useState<string | undefined>()

  useEffect(() => {
    currentUserId().then((id) => setUserId(id ?? undefined)).catch(() => {})
  }, [])

  return (
    <PaywallGate
      userId={userId}
      onClose={() => router.back()}
      onUnlocked={() => {
        plan.unlockPro()
        router.back()
      }}
    />
  )
}
