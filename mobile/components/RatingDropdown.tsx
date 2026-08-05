import { useState } from 'react'
import { View, Text, Pressable, Modal, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '@/theme/useTheme'
import { NEUTRAL_RATING } from '@/theme/colors'
import { fonts } from '@/theme/type'
import { ScoreBadge } from './ScoreBadge'
import { tileEdge } from './ui'
import type { RatingValue } from '@/lib/types'

// Each row is an independent, multi-selectable exact match — picking 5 shows
// only 5-rated places, picking 5 and 0 together shows both, picking Awaiting
// shows only places never inspected. An empty selection ("Any rating") shows
// everything, numeric and non-numeric alike.
const STEPS: RatingValue[] = [5, 4, 3, 2, 1, 0]

// FSA words, per the design — the numbers alone mean nothing to newcomers.
const WORD: Record<number, string> = {
  5: 'Very good',
  4: 'Good',
  3: 'Generally satisfactory',
  2: 'Improvement needed',
  1: 'Major improvement',
  0: 'Urgent improvement',
}

function triggerLabel(selected: RatingValue[]): string {
  if (selected.length === 0) return 'Any rating'
  if (selected.length === 1)
    return selected[0] === 'awaiting' ? 'Awaiting' : `${selected[0]} rated`
  return `${selected.length} ratings`
}

export function RatingDropdown({
  value,
  onChange,
}: {
  value: RatingValue[] | null
  onChange: (next: RatingValue[] | null) => void
}) {
  const c = useTheme()
  const [open, setOpen] = useState(false)
  const selected = value ?? []
  const isAny = selected.length === 0

  const toggle = (v: RatingValue) => {
    const set = new Set(selected)
    set.has(v) ? set.delete(v) : set.add(v)
    onChange(set.size ? Array.from(set) : null)
  }

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        style={[styles.trigger, { backgroundColor: c.primary }, tileEdge(c.primaryDark)]}
      >
        <Text style={styles.triggerText}>{triggerLabel(selected)}</Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={12} color="#fff" />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <View style={[styles.card, { backgroundColor: c.card }]}>
            <Text style={[styles.title, { color: c.placeholder }]}>Hygiene rating</Text>

            <Pressable
              onPress={() => {
                onChange(null)
                setOpen(false)
              }}
              style={[styles.row, isAny ? { backgroundColor: '#F2EFE3', borderRadius: 14 } : null]}
            >
              <View style={[styles.anyTile, { backgroundColor: c.lockedFill, borderColor: c.dashedBorderDark }]}>
                <Text style={{ color: c.placeholder, fontFamily: fonts.display800 }}>·</Text>
              </View>
              <Text style={[styles.rowLabel, { color: c.text }]}>Any rating</Text>
              {isAny ? <Ionicons name="checkmark" size={19} color={c.primary} /> : null}
            </Pressable>

            {STEPS.map((step) => {
              const active = selected.includes(step)
              return (
                <Pressable
                  key={String(step)}
                  onPress={() => toggle(step)}
                  style={[styles.row, active ? { backgroundColor: '#F2EFE3', borderRadius: 14 } : null]}
                >
                  <ScoreBadge rating={String(step)} size={34} edge={false} />
                  <Text style={[styles.rowLabel, { color: c.text }]}>
                    <Text style={{ fontFamily: fonts.display800 }}>{step}</Text> {WORD[step as number]}
                  </Text>
                  {active ? <Ionicons name="checkmark" size={19} color={c.primary} /> : null}
                </Pressable>
              )
            })}

            <View style={[styles.divider, { backgroundColor: '#EBE5D6' }]} />

            <Pressable
              onPress={() => toggle('awaiting')}
              style={[
                styles.row,
                selected.includes('awaiting') ? { backgroundColor: '#F2EFE3', borderRadius: 14 } : null,
              ]}
            >
              <View style={[styles.awaitingTile, { backgroundColor: NEUTRAL_RATING }]}>
                <Ionicons name="hourglass-outline" size={15} color="#fff" />
              </View>
              <Text style={[styles.rowLabel, { color: c.inkSecondary }]}>Awaiting inspection</Text>
              {selected.includes('awaiting') ? (
                <Ionicons name="checkmark" size={19} color={c.primary} />
              ) : null}
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </>
  )
}

const styles = StyleSheet.create({
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 38,
    paddingHorizontal: 14,
    borderRadius: 12,
  },
  triggerText: { fontSize: 14, fontFamily: fonts.display600, color: '#fff' },
  backdrop: { flex: 1, backgroundColor: 'rgba(23,23,15,0.34)' },
  card: {
    position: 'absolute',
    top: 162,
    left: 14,
    width: 296,
    borderRadius: 22,
    paddingTop: 16,
    paddingHorizontal: 8,
    paddingBottom: 10,
    boxShadow: '0 18px 44px rgba(23,23,15,0.3)',
  },
  title: {
    fontSize: 11.5,
    fontFamily: fonts.display600,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  anyTile: {
    width: 34,
    height: 34,
    borderRadius: 12,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  awaitingTile: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowLabel: { flex: 1, fontSize: 17, fontFamily: fonts.display600 },
  divider: { height: 1, marginVertical: 8, marginHorizontal: 12 },
})
