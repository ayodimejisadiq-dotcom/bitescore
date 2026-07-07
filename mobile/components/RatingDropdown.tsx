import { useState } from 'react'
import { View, Text, Pressable, Modal, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '@/theme/useTheme'
import { greyToGreen, NEUTRAL_RATING } from '@/theme/colors'
import type { RatingFilter } from '@/lib/types'

// "Any rating" (null) shows everything, including non-numeric FSA statuses
// (Exempt / Awaiting). Picking 0–5 filters to numeric ratings >= that value —
// 0 is a real, selectable choice, distinct from "Any". 'awaiting' is its own
// tier: places registered but never inspected, shown to the exclusion of
// everything else (same one-tap, mutually-exclusive behavior as the rest).
const STEPS: RatingFilter[] = [null, 5, 4, 3, 2, 1, 0, 'awaiting']

function labelFor(v: RatingFilter): string {
  if (v === null) return 'Any rating'
  if (v === 'awaiting') return 'Awaiting'
  return `${v}+ rated`
}

function colorFor(v: RatingFilter, c: ReturnType<typeof useTheme>): string {
  if (v === null) return c.border
  if (v === 'awaiting') return NEUTRAL_RATING
  return greyToGreen(v)
}

export function RatingDropdown({
  value,
  onChange,
}: {
  value: RatingFilter
  onChange: (next: RatingFilter) => void
}) {
  const c = useTheme()
  const [open, setOpen] = useState(false)
  const swatch = colorFor(value, c)

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        style={[styles.trigger, { backgroundColor: swatch, borderColor: swatch }]}
      >
        <Text style={[styles.triggerText, { color: value === null ? c.text : '#fff' }]}>
          {labelFor(value)}
        </Text>
        <Ionicons name="chevron-down" size={14} color={value === null ? c.subtext : '#fff'} />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
            <Text style={[styles.title, { color: c.subtext }]}>Minimum hygiene rating</Text>
            {STEPS.map((step) => {
              const active = step === value
              const color = colorFor(step, c)
              return (
                <Pressable
                  key={String(step)}
                  onPress={() => {
                    onChange(step)
                    setOpen(false)
                  }}
                  style={styles.row}
                >
                  <View style={[styles.swatch, { backgroundColor: color }]}>
                    {typeof step === 'number' ? (
                      <Text style={styles.swatchText}>{step}</Text>
                    ) : step === 'awaiting' ? (
                      <Ionicons name="hourglass-outline" size={13} color="#fff" />
                    ) : null}
                  </View>
                  <Text style={[styles.rowLabel, { color: c.text }]}>{labelFor(step)}</Text>
                  {active ? (
                    <Ionicons name="checkmark" size={18} color={c.primary} style={styles.check} />
                  ) : null}
                </Pressable>
              )
            })}
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
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  triggerText: { fontSize: 13, fontWeight: '600' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.25)' },
  card: {
    position: 'absolute',
    top: 150,
    left: 14,
    width: 220,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 8,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  title: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    paddingHorizontal: 14,
    paddingTop: 4,
    paddingBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  swatch: {
    width: 26,
    height: 26,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatchText: { color: '#fff', fontWeight: '800', fontSize: 12 },
  rowLabel: { flex: 1, fontSize: 14.5, fontWeight: '500' },
  check: { marginLeft: 4 },
})
