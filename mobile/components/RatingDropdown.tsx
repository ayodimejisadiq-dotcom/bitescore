import { useState } from 'react'
import { View, Text, Pressable, Modal, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '@/theme/useTheme'
import { greyToGreen, NEUTRAL_RATING } from '@/theme/colors'
import type { RatingValue } from '@/lib/types'

// Each row is an independent, multi-selectable exact match — picking 5 shows
// only 5-rated places, picking 5 and 0 together shows both, picking Awaiting
// shows only places never inspected. An empty selection ("Any rating") shows
// everything, numeric and non-numeric alike.
const STEPS: RatingValue[] = [5, 4, 3, 2, 1, 0, 'awaiting']

function labelFor(v: RatingValue): string {
  return v === 'awaiting' ? 'Awaiting' : `${v} rated`
}

function colorFor(v: RatingValue, c: ReturnType<typeof useTheme>): string {
  return v === 'awaiting' ? NEUTRAL_RATING : greyToGreen(v)
}

function triggerLabel(selected: RatingValue[]): string {
  if (selected.length === 0) return 'Any rating'
  if (selected.length <= 2) return selected.map(labelFor).join(', ')
  return `${selected.length} selected`
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
        style={[
          styles.trigger,
          isAny
            ? { backgroundColor: c.card, borderColor: c.border }
            : { backgroundColor: c.primary, borderColor: c.primary },
        ]}
      >
        <Text style={[styles.triggerText, { color: isAny ? c.text : '#fff' }]}>
          {triggerLabel(selected)}
        </Text>
        <Ionicons name="chevron-down" size={14} color={isAny ? c.subtext : '#fff'} />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
            <Text style={[styles.title, { color: c.subtext }]}>Hygiene rating</Text>

            <Pressable
              onPress={() => {
                onChange(null)
                setOpen(false)
              }}
              style={styles.row}
            >
              <View style={[styles.swatch, { backgroundColor: c.border }]} />
              <Text style={[styles.rowLabel, { color: c.text }]}>Any rating</Text>
              {isAny ? (
                <Ionicons name="checkmark" size={18} color={c.primary} style={styles.check} />
              ) : null}
            </Pressable>

            {STEPS.map((step) => {
              const active = selected.includes(step)
              const color = colorFor(step, c)
              return (
                <Pressable key={String(step)} onPress={() => toggle(step)} style={styles.row}>
                  <View style={[styles.swatch, { backgroundColor: color }]}>
                    {typeof step === 'number' ? (
                      <Text style={styles.swatchText}>{step}</Text>
                    ) : (
                      <Ionicons name="hourglass-outline" size={13} color="#fff" />
                    )}
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
