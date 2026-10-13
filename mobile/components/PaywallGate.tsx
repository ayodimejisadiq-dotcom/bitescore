import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '@/theme/useTheme'
import { BadgeFan } from './BadgeFan'
import { PricingSheet } from './PricingSheet'

// The standalone paywall: brand hero and benefit checklist, with the pricing
// sheet pinned underneath. Shown at launch to anyone without Pro who has
// already been through onboarding (the wizard ends on its own reveal +
// pricing sheet), and as a dismissible sheet from Settings.

export const BENEFITS: { icon: keyof typeof Ionicons.glyphMap; title: string; body: string }[] = [
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

export function PaywallGate({
  onUnlocked,
  userId,
  identityFailed = false,
  onClose,
  notice,
}: {
  onUnlocked: () => void
  userId?: string
  identityFailed?: boolean
  // Shown as a modal from inside the app: can be dismissed.
  onClose?: () => void
  // A line in the hero, e.g. the personal note after onboarding.
  notice?: string
}) {
  const c = useTheme()
  const insets = useSafeAreaInsets()

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
            <Text style={[styles.sourceText, { color: c.meta }]}>Ratings from the Food Standards Agency</Text>
          </View>
        </View>
      </ScrollView>

      <PricingSheet userId={userId} identityFailed={identityFailed} onUnlocked={onUnlocked} />
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
  proPill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, marginBottom: 10 },
  proPillText: { fontSize: 11, fontWeight: '700', letterSpacing: 1.2 },
  title: { fontSize: 32, lineHeight: 36, fontWeight: '700', letterSpacing: -1, textAlign: 'center' },
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
  benefitIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  benefitText: { flex: 1 },
  benefitTitle: { fontSize: 15.5, fontWeight: '600' },
  benefitBody: { fontSize: 13.5, fontWeight: '400', lineHeight: 18, marginTop: 1 },
  source: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 6 },
  sourceText: { fontSize: 12.5, fontWeight: '500' },
})
