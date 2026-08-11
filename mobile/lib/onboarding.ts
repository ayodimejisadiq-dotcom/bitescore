import AsyncStorage from '@react-native-async-storage/async-storage'
import { fetchMyLists } from './data'

// First-run journey: create a list for the places someone actually eats at,
// and get a few into it straight away. That list is what score-change alerts
// are built on — without one there is nothing to notify about, which is why
// notifications had never fired for anyone.

const KEY = 'bitescore.onboarded.v1'

export const FAVES_LIST_NAME = 'My faves'

export async function markOnboarded(): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, '1')
  } catch {
    // Worst case they see the intro once more; never block entry over this.
  }
}

// Show the intro only to someone genuinely new: no completed run, and no
// lists of their own. The second check matters for anyone who installed
// before this existed — they already have lists and should not be walked
// through creating one.
//
// Any failure resolves to "don't show". Getting the intro wrongly is a much
// worse first impression than missing it, and a network error at launch
// should never stand between someone and the app.
export async function shouldShowOnboarding(): Promise<boolean> {
  try {
    if (await AsyncStorage.getItem(KEY)) return false
    const lists = await fetchMyLists()
    return lists.length === 0
  } catch {
    return false
  }
}
