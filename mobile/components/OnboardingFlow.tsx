import { useCallback, useEffect, useRef, useState } from 'react'
import {
  View,
  Text,
  TextInput,
  Pressable,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  Keyboard,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '@/theme/useTheme'
import { fonts } from '@/theme/type'
import { BadgeFan } from './BadgeFan'
import { RestaurantRow } from './RestaurantRow'
import { EdgeButton } from './ui'
import { createList, addToList, removeFromList, searchRestaurants } from '@/lib/data'
import { registerForPushAfterSave } from '@/lib/push'
import { FAVES_LIST_NAME, markOnboarded } from '@/lib/onboarding'
import { errorMessage } from '@/lib/errors'
import { EMPTY_FILTERS, type RestaurantNear } from '@/lib/types'

export function OnboardingFlow({ onDone }: { onDone: () => void }) {
  const c = useTheme()
  const [step, setStep] = useState<'welcome' | 'add'>('welcome')

  const finish = useCallback(() => {
    // Mark first so a failure to write can't trap someone in the intro on
    // every launch; the flag is convenience, not correctness.
    markOnboarded().finally(onDone)
  }, [onDone])

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: c.bg }]} edges={['top', 'bottom']}>
      {step === 'welcome' ? (
        <WelcomeStep c={c} onNext={() => setStep('add')} onSkip={finish} />
      ) : (
        <AddStep c={c} onDone={finish} />
      )}
    </SafeAreaView>
  )
}

function WelcomeStep({
  c,
  onNext,
  onSkip,
}: {
  c: ReturnType<typeof useTheme>
  onNext: () => void
  onSkip: () => void
}) {
  return (
    <View style={styles.welcome}>
      <BadgeFan />
      <Text style={[styles.title, { color: c.text }]}>Keep an eye on your regulars</Text>
      <Text style={[styles.body, { color: c.subtext }]}>
        Save the places you actually eat at, and we'll tell you if one of them gets re-inspected
        and its hygiene score changes.
      </Text>

      <View style={styles.points}>
        <Point c={c} icon="bookmark" text={`We'll start a list called "${FAVES_LIST_NAME}"`} />
        <Point c={c} icon="search" text="Search for a few places you go to" />
        <Point c={c} icon="notifications" text="Get an alert if a score changes" />
      </View>

      <EdgeButton
        color={c.primary}
        edgeColor={c.primaryDark}
        edge={4}
        radius={18}
        onPress={onNext}
        containerStyle={{ alignSelf: 'stretch', marginTop: 28 }}
        style={styles.cta}
      >
        <Text style={styles.ctaText}>Add my places</Text>
      </EdgeButton>

      <Pressable onPress={onSkip} style={styles.skip} hitSlop={8}>
        <Text style={[styles.skipText, { color: c.mutedOnCard }]}>Not now</Text>
      </Pressable>
    </View>
  )
}

function Point({
  c,
  icon,
  text,
}: {
  c: ReturnType<typeof useTheme>
  icon: keyof typeof Ionicons.glyphMap
  text: string
}) {
  return (
    <View style={styles.point}>
      <View style={[styles.pointIcon, { backgroundColor: c.primaryTint }]}>
        <Ionicons name={icon} size={16} color={c.primary} />
      </View>
      <Text style={[styles.pointText, { color: c.inkSecondary }]}>{text}</Text>
    </View>
  )
}

function AddStep({ c, onDone }: { c: ReturnType<typeof useTheme>; onDone: () => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<RestaurantNear[]>([])
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [added, setAdded] = useState<Set<string>>(new Set())
  const listId = useRef<string | null>(null)
  const creating = useRef<Promise<string> | null>(null)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Created once, on demand, and shared by every tap — two quick taps would
  // otherwise race and produce two lists with the same name.
  const ensureList = useCallback(async (): Promise<string> => {
    if (listId.current) return listId.current
    if (!creating.current) creating.current = createList(FAVES_LIST_NAME)
    listId.current = await creating.current
    return listId.current
  }, [])

  useEffect(() => {
    // Make the list up front so it exists as promised, even for someone who
    // adds nothing — an empty list is a useful thing to come back to.
    ensureList().catch(() => {
      // Retried on first add; nothing to show yet.
    })
  }, [ensureList])

  const onChange = (text: string) => {
    setQuery(text)
    if (debounce.current) clearTimeout(debounce.current)
    if (!text.trim()) {
      setResults([])
      setSearching(false)
      return
    }
    setSearching(true)
    debounce.current = setTimeout(async () => {
      setError(null)
      try {
        setResults(await searchRestaurants(text, EMPTY_FILTERS))
      } catch (e) {
        setError(errorMessage(e))
        setResults([])
      } finally {
        setSearching(false)
      }
    }, 300)
  }

  const toggle = async (item: RestaurantNear) => {
    const wasAdded = added.has(item.id)
    const next = new Set(added)
    wasAdded ? next.delete(item.id) : next.add(item.id)
    setAdded(next) // optimistic
    try {
      const id = await ensureList()
      if (wasAdded) {
        await removeFromList(id, item.id)
      } else {
        await addToList(id, item.id)
        // Same moment the rest of the app asks: saving a place is what the
        // alerts are for.
        void registerForPushAfterSave()
      }
    } catch (e) {
      setAdded(added) // revert
      setError(errorMessage(e))
    }
  }

  const count = added.size

  return (
    <View style={styles.addRoot}>
      <View style={styles.addHead}>
        <Text style={[styles.addTitle, { color: c.text }]}>{FAVES_LIST_NAME}</Text>
        <Text style={[styles.addSub, { color: c.subtext }]}>
          {count === 0
            ? 'Search for a place you eat at, then tap it to add.'
            : `${count} place${count === 1 ? '' : 's'} added — add more, or you're done.`}
        </Text>

        <View style={[styles.search, { backgroundColor: c.card, borderColor: c.controlBorder }]}>
          <Ionicons name="search" size={19} color={c.primary} />
          <TextInput
            value={query}
            onChangeText={onChange}
            placeholder="Search by name or postcode"
            placeholderTextColor={c.placeholder}
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            returnKeyType="search"
            onSubmitEditing={() => Keyboard.dismiss()}
            style={[styles.input, { color: c.text }]}
          />
          {searching ? <ActivityIndicator size="small" color={c.primary} /> : null}
        </View>
      </View>

      {error ? (
        <Text style={[styles.error, { color: c.accent }]}>{error}</Text>
      ) : null}

      <FlatList
        data={results}
        keyExtractor={(item) => item.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingTop: 12, paddingBottom: 24 }}
        ListEmptyComponent={
          query.trim() && !searching ? (
            <Text style={[styles.empty, { color: c.subtext }]}>
              Nothing matched "{query.trim()}". Try a different spelling or a postcode.
            </Text>
          ) : null
        }
        renderItem={({ item }) => (
          <RestaurantRow item={item} saved={added.has(item.id)} onPress={() => toggle(item)} />
        )}
      />

      <View style={[styles.footer, { borderTopColor: c.border, backgroundColor: c.bg }]}>
        <EdgeButton
          color={count > 0 ? c.primary : c.subtleFill}
          edgeColor={count > 0 ? c.primaryDark : c.dashedBorder}
          edge={4}
          radius={18}
          onPress={onDone}
          containerStyle={{ alignSelf: 'stretch' }}
          style={styles.cta}
        >
          <Text style={[styles.ctaText, count === 0 ? { color: c.inkSecondary } : null]}>
            {count > 0 ? 'Done' : 'Skip for now'}
          </Text>
        </EdgeButton>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  welcome: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  title: { fontSize: 27, fontFamily: fonts.display800, textAlign: 'center', letterSpacing: -0.5 },
  body: {
    fontSize: 15,
    fontFamily: fonts.body,
    lineHeight: 23,
    textAlign: 'center',
    marginTop: 10,
    maxWidth: 320,
  },
  points: { alignSelf: 'stretch', marginTop: 28, gap: 14 },
  point: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  pointIcon: { width: 32, height: 32, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  pointText: { flex: 1, fontSize: 14.5, fontFamily: fonts.body, lineHeight: 20 },
  cta: { height: 56, alignItems: 'center', justifyContent: 'center' },
  ctaText: { color: '#fff', fontSize: 16.5, fontFamily: fonts.display600 },
  skip: { marginTop: 16, paddingVertical: 6 },
  skipText: { fontSize: 14.5, fontFamily: fonts.display600 },

  addRoot: { flex: 1 },
  addHead: { paddingHorizontal: 20, paddingTop: 8 },
  addTitle: { fontSize: 30, fontFamily: fonts.display800, letterSpacing: -0.6 },
  addSub: { fontSize: 14, fontFamily: fonts.body, lineHeight: 20, marginTop: 4 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 50,
    paddingHorizontal: 15,
    borderRadius: 17,
    borderWidth: 1.5,
    marginTop: 14,
  },
  input: { flex: 1, fontSize: 16, fontFamily: fonts.body, padding: 0 },
  error: { fontSize: 13, fontFamily: fonts.body, paddingHorizontal: 20, paddingTop: 10 },
  empty: {
    fontSize: 14.5,
    fontFamily: fonts.body,
    lineHeight: 21,
    textAlign: 'center',
    marginTop: 40,
    paddingHorizontal: 40,
  },
  footer: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8, borderTopWidth: 1.5 },
})
