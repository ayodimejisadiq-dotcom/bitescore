import { useCallback, useState } from 'react'
import { useFocusEffect } from 'expo-router'
import { fetchSavedRestaurantIds } from '@/lib/data'
import { useSession } from './useSession'

const EMPTY: ReadonlySet<string> = new Set()

// Which restaurants the user already has on a list, so result rows can say so
// before you tap into them.
//
// Refetched on focus rather than held in module state: saving happens on the
// detail screen, so the interesting moment is coming *back* to a results list
// having just saved something. Also keyed on the user id, because the session
// is established asynchronously at launch — without that, a screen focused
// before the anonymous sign-in lands would show no chips until the next focus.
//
// Failures are silent by design. An unmarked row is the same thing the app
// showed before this existed, which is a much better outcome than an error
// banner over working search results.
export function useSavedIds(): ReadonlySet<string> {
  const { session } = useSession()
  const userId = session?.user.id
  const [ids, setIds] = useState<ReadonlySet<string>>(EMPTY)

  useFocusEffect(
    useCallback(() => {
      if (!userId) {
        setIds(EMPTY)
        return
      }
      let active = true
      fetchSavedRestaurantIds()
        .then((saved) => {
          if (active) setIds(new Set(saved))
        })
        .catch(() => {
          // Leave whatever we last knew in place — a transient network blip
          // shouldn't make every chip disappear.
        })
      return () => {
        active = false
      }
    }, [userId]),
  )

  return ids
}
