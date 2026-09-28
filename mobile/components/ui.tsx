import { Children, isValidElement, type ReactNode } from 'react'
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { palette as c, avatarTint, colorForRating, textOnRating } from '@/theme/colors'
import { type } from '@/theme/type'
import { displayName, initialsFor } from '@/lib/people'

type IconName = keyof typeof Ionicons.glyphMap

// Bottom padding for scroll views on tab screens: the tab bar floats over content.
export const TAB_BAR_SPACE = 110

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

type ButtonVariant = 'primary' | 'secondary' | 'soft' | 'plain'

const BUTTON_COLORS: Record<ButtonVariant, { bg: string; pressed: string; fg: string }> = {
  primary: { bg: c.tint, pressed: c.tintPressed, fg: '#FFFFFF' },
  secondary: { bg: c.card, pressed: '#EDEDF0', fg: c.tint },
  soft: { bg: c.tintSoft, pressed: '#D4E9DC', fg: c.tint },
  plain: { bg: 'transparent', pressed: 'transparent', fg: c.tint },
}

// Primary buttons are 52 tall / radius 14; secondary rows 40–44 / radius 12.
export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'large',
  icon,
  disabled = false,
  loading = false,
  bg,
  fg,
  style,
}: {
  label: string
  onPress?: () => void
  variant?: ButtonVariant
  size?: 'large' | 'medium' | 'small'
  icon?: IconName
  disabled?: boolean
  loading?: boolean
  bg?: string
  fg?: string
  style?: StyleProp<ViewStyle>
}) {
  const colors = BUTTON_COLORS[variant]
  const height = size === 'large' ? 52 : size === 'medium' ? 44 : 40
  const radius = size === 'large' ? 14 : 12
  const textSize = size === 'large' ? 17 : size === 'medium' ? 16 : 15
  const background =
    variant === 'primary' && disabled ? c.tintDisabled : (bg ?? colors.bg)
  const color = fg ?? colors.fg
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        styles.button,
        {
          height,
          borderRadius: radius,
          backgroundColor: pressed && !bg ? colors.pressed : background,
          opacity: disabled && variant !== 'primary' ? 0.4 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={color} />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={textSize + 2} color={color} /> : null}
          <Text style={{ fontSize: textSize, fontWeight: '600', color }} numberOfLines={1}>
            {label}
          </Text>
        </>
      )}
    </Pressable>
  )
}

// Round 36px translucent button over a hero (back, share, save).
export function HeroIconButton({
  icon,
  onPress,
  label,
}: {
  icon: IconName
  onPress: () => void
  label: string
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.heroIcon, { opacity: pressed ? 0.6 : 1 }]}
    >
      <Ionicons name={icon} size={19} color={c.label} />
    </Pressable>
  )
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

// iOS-style nav bar: "‹ Back" on the left, optional centred title, actions right.
export function NavBar({
  backLabel,
  onBack,
  title,
  right,
}: {
  backLabel?: string
  onBack?: () => void
  title?: string
  right?: ReactNode
}) {
  const router = useRouter()
  return (
    <View style={styles.navBar}>
      <View style={styles.navSide}>
        {backLabel !== undefined ? (
          <Pressable
            onPress={onBack ?? (() => router.back())}
            hitSlop={10}
            style={styles.navBack}
            accessibilityRole="button"
            accessibilityLabel={backLabel || 'Back'}
          >
            <Ionicons name="chevron-back" size={26} color={c.tint} />
            {backLabel ? <Text style={styles.navBackText}>{backLabel}</Text> : null}
          </Pressable>
        ) : null}
      </View>
      {title ? (
        <Text style={styles.navTitle} numberOfLines={1}>
          {title}
        </Text>
      ) : null}
      <View style={[styles.navSide, { alignItems: 'flex-end' }]}>
        <View style={styles.navRight}>{right}</View>
      </View>
    </View>
  )
}

export function NavIcon({
  icon,
  onPress,
  label,
}: {
  icon: IconName
  onPress: () => void
  label: string
}) {
  return (
    <Pressable onPress={onPress} hitSlop={10} accessibilityRole="button" accessibilityLabel={label}>
      <Ionicons name={icon} size={24} color={c.tint} />
    </Pressable>
  )
}

// ---------------------------------------------------------------------------
// Grouped lists
// ---------------------------------------------------------------------------

export function SectionHeader({ children, style }: { children: string; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.sectionHeader, style]}>
      <Text style={styles.sectionHeaderText}>{children.toUpperCase()}</Text>
    </View>
  )
}

export function SectionFooter({ children }: { children: ReactNode }) {
  return <Text style={styles.sectionFooter}>{children}</Text>
}

// White grouped card, 14 radius, 16 side margin. Inserts inset separators
// between children, starting where the text starts (`inset`).
export function GroupedCard({
  children,
  inset = 16,
  style,
}: {
  children: ReactNode
  inset?: number
  style?: StyleProp<ViewStyle>
}) {
  const items = Children.toArray(children).filter(isValidElement)
  return (
    <View style={[styles.card, style]}>
      {items.map((child, i) => (
        <View key={(child as { key?: string }).key ?? i}>
          {child}
          {i < items.length - 1 ? <View style={[styles.separator, { marginLeft: inset }]} /> : null}
        </View>
      ))}
    </View>
  )
}

export function Separator({ inset = 16 }: { inset?: number }) {
  return <View style={[styles.separator, { marginLeft: inset }]} />
}

// A settings-style row: title left, value/accessory right.
export function Row({
  title,
  subtitle,
  value,
  valueColor,
  left,
  right,
  chevron = false,
  onPress,
  titleColor,
  minHeight = 48,
}: {
  title: string
  subtitle?: string
  value?: string
  valueColor?: string
  left?: ReactNode
  right?: ReactNode
  chevron?: boolean
  onPress?: () => void
  titleColor?: string
  minHeight?: number
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [styles.row, { minHeight, backgroundColor: pressed ? '#EBEBEF' : 'transparent' }]}
    >
      {left}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[type.callout, { color: titleColor ?? c.label }]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={[type.caption, { color: c.meta, marginTop: 1 }]} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text style={[type.callout, { color: valueColor ?? c.meta, flexShrink: 1 }]} numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      {right}
      {chevron ? <Ionicons name="chevron-forward" size={18} color={c.chevron} /> : null}
    </Pressable>
  )
}

// Coloured 30px square icon for radio/settings rows.
export function RowIcon({ icon, color, size = 30 }: { icon: IconName; color: string; size?: number }) {
  return (
    <View style={[styles.rowIcon, { width: size, height: size, backgroundColor: color }]}>
      <Ionicons name={icon} size={size * 0.55} color="#FFFFFF" />
    </View>
  )
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.plainCard, style]}>{children}</View>
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export function SearchField({
  value,
  onChangeText,
  placeholder,
  height = 38,
  style,
  ...rest
}: {
  value: string
  onChangeText: (t: string) => void
  placeholder: string
  height?: number
  style?: StyleProp<ViewStyle>
} & Omit<TextInputProps, 'style'>) {
  return (
    <View style={[styles.search, { height }, style]}>
      <Ionicons name="search" size={18} color={c.meta} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={c.meta}
        autoCorrect={false}
        style={styles.searchInput}
        {...rest}
      />
      {value ? (
        <Pressable onPress={() => onChangeText('')} hitSlop={8} accessibilityLabel="Clear search">
          <Ionicons name="close-circle" size={17} color={c.chevron} />
        </Pressable>
      ) : null}
    </View>
  )
}

export function Segmented({
  options,
  value,
  onChange,
}: {
  options: { key: string; label: string }[]
  value: string
  onChange: (key: string) => void
}) {
  return (
    <View style={styles.segmented}>
      {options.map((o) => {
        const on = o.key === value
        return (
          <Pressable
            key={o.key}
            onPress={() => onChange(o.key)}
            style={[styles.segment, on ? styles.segmentOn : null]}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
          >
            <Text style={styles.segmentText} numberOfLines={1}>
              {o.label}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

export interface PersonLike {
  user_id: string
  username?: string | null
  public_name?: string | null
}

export function Avatar({
  person,
  size = 44,
  ring,
  letters = 2,
}: {
  person: PersonLike
  size?: number
  ring?: string
  letters?: 1 | 2
}) {
  const tint = avatarTint(person.user_id)
  const initials = initialsFor(person).slice(0, letters)
  return (
    <View
      accessibilityLabel={displayName(person)}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: tint.bg,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: ring ? 2 : 0,
        borderColor: ring,
      }}
    >
      <Text style={{ color: tint.fg, fontWeight: '600', fontSize: Math.round(size * (letters === 1 ? 0.42 : 0.36)) }}>
        {initials}
      </Text>
    </View>
  )
}

// Overlapping avatars with a ring in the background colour.
export function AvatarStack({
  people,
  size = 26,
  ring = '#FFFFFF',
  max = 3,
  letters = 1,
}: {
  people: PersonLike[]
  size?: number
  ring?: string
  max?: number
  letters?: 1 | 2
}) {
  if (people.length === 0) return null
  return (
    <View style={{ flexDirection: 'row' }}>
      {people.slice(0, max).map((p, i) => (
        <View key={p.user_id} style={{ marginLeft: i === 0 ? 0 : -Math.round(size * 0.3) }}>
          <Avatar person={p} size={size} ring={ring} letters={letters} />
        </View>
      ))}
    </View>
  )
}

// ---------------------------------------------------------------------------
// Scores
// ---------------------------------------------------------------------------

// 2×2 grid of the first four places' scores; empty cells stay grey.
export function Mosaic({
  ratings,
  size = 48,
  radius,
  gap = 2,
  style,
}: {
  ratings: string[]
  size?: number
  radius?: number
  gap?: number
  style?: StyleProp<ViewStyle>
}) {
  const cells = [0, 1, 2, 3].map((i) => (ratings[i] ? colorForRating(ratings[i]) : c.separator))
  const cell = (size - gap) / 2
  return (
    <View
      style={[
        {
          width: size,
          height: size,
          borderRadius: radius ?? Math.round(size / 4),
          overflow: 'hidden',
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap,
        },
        style,
      ]}
    >
      {cells.map((bg, i) => (
        <View key={i} style={{ width: cell, height: cell, backgroundColor: bg }} />
      ))}
    </View>
  )
}

export function ScoreSquare({ rating, size = 10 }: { rating: string; size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size * 0.3, backgroundColor: colorForRating(rating) }} />
  )
}

export { textOnRating }

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: IconName
  title: string
  body?: string
  action?: ReactNode
}) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Ionicons name={icon} size={30} color={c.tint} />
      </View>
      <Text style={[type.title2, { color: c.label, textAlign: 'center', marginTop: 16 }]}>{title}</Text>
      {body ? (
        <Text style={[type.subhead, { color: c.label2, textAlign: 'center', marginTop: 6, lineHeight: 21 }]}>
          {body}
        </Text>
      ) : null}
      {action ? <View style={{ marginTop: 18, alignSelf: 'stretch' }}>{action}</View> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingHorizontal: 14,
  },
  heroIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.75)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  navBar: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 8,
    paddingRight: 16,
  },
  navSide: { flex: 1 },
  navBack: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start' },
  navBackText: { fontSize: 17, color: c.tint, marginLeft: -2 },
  navTitle: { fontSize: 17, fontWeight: '600', color: c.label, maxWidth: '55%', textAlign: 'center' },
  navRight: { flexDirection: 'row', alignItems: 'center', gap: 20 },
  sectionHeader: { paddingHorizontal: 32, paddingBottom: 8 },
  sectionHeaderText: { fontSize: 13, color: c.meta, letterSpacing: 0.3 },
  sectionFooter: { fontSize: 13, lineHeight: 18, color: c.meta, paddingHorizontal: 32, paddingTop: 10 },
  card: { marginHorizontal: 16, backgroundColor: c.card, borderRadius: 14, overflow: 'hidden' },
  plainCard: { marginHorizontal: 16, backgroundColor: c.card, borderRadius: 16, padding: 16 },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: c.separator },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 11,
  },
  rowIcon: { borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderRadius: 11,
    backgroundColor: c.fill,
    paddingHorizontal: 10,
  },
  searchInput: { flex: 1, fontSize: 17, color: c.label, padding: 0 },
  segmented: {
    height: 34,
    borderRadius: 9,
    backgroundColor: c.fill,
    padding: 2,
    flexDirection: 'row',
  },
  segment: { flex: 1, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  segmentOn: { backgroundColor: '#FFFFFF', boxShadow: '0 1px 3px rgba(0,0,0,0.12)' },
  segmentText: { fontSize: 14, fontWeight: '600', color: c.label },
  empty: { alignItems: 'center', paddingHorizontal: 36, paddingTop: 60 },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 22,
    backgroundColor: c.tintSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
