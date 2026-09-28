import { useEffect, useState } from 'react'
import { Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '@/theme/useTheme'
import { ScoreBadge } from './ScoreBadge'
import { Button, GroupedCard, RowIcon } from './ui'
import { logVisit, visitErrorMessage } from '@/lib/data'
import { freshCoords, lastKnownCoords, VERIFY_RADIUS_M } from '@/lib/location'
import { distanceLabel, metersBetween } from '@/lib/people'
import { cancelDirectionsFollowUp } from '@/lib/followups'

type Method = 'here' | 'none'

// Receipt scanning (the third option in the design) needs on-device text
// recognition, which is native code — it arrives with the next app build.
const COPY: Record<Method, { note: string; cta: string }> = {
  here: { note: 'We check your location once, right now.', cta: 'Log verified visit' },
  none: { note: 'Won’t count toward diner checks, tiers or taste match.', cta: 'Log visit' },
}

export function LogVisitSheet({
  visible,
  place,
  onClose,
  onLogged,
}: {
  visible: boolean
  place: { id: string; name: string; rating_value: string; lat: number | null; lng: number | null }
  onClose: () => void
  onLogged: (visit: { id: string; verified: boolean; visited_at: string }) => void
}) {
  const c = useTheme()
  const insets = useSafeAreaInsets()
  const [method, setMethod] = useState<Method>('here')
  const [distance, setDistance] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!visible) return
    setDistance(null)
    lastKnownCoords().then((me) => {
      if (!me || place.lat == null || place.lng == null) return
      const d = metersBetween(me, { lat: place.lat, lng: place.lng })
      setDistance(d)
      // Only suggest verifying when it can actually pass the server's check.
      setMethod(d <= VERIFY_RADIUS_M ? 'here' : 'none')
    })
  }, [visible, place.lat, place.lng])

  const near = distance !== null && distance <= VERIFY_RADIUS_M
  const hereSubtitle =
    distance === null
      ? 'Checks your location · Verified'
      : near
        ? `You're ${distanceLabel(distance)} away · Verified`
        : `You're ${distanceLabel(distance)} away`

  const onConfirm = async () => {
    setBusy(true)
    try {
      let visit
      if (method === 'here') {
        const coords = await freshCoords()
        if (!coords) {
          Alert.alert(
            'Location needed',
            'Allow location access to verify this visit, or log it without proof.',
          )
          return
        }
        visit = await logVisit(place.id, 'location', coords)
      } else {
        visit = await logVisit(place.id, 'none')
      }
      cancelDirectionsFollowUp(place.id)
      onLogged(visit)
    } catch (e) {
      Alert.alert('Couldn’t log your visit', visitErrorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const check = (on: boolean) => (on ? <Ionicons name="checkmark" size={20} color={c.tint} /> : null)

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
        <View style={styles.grabber} />
        <View style={styles.head}>
          <ScoreBadge rating={place.rating_value} size={44} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { color: c.label }]}>Log a visit</Text>
            <Text style={[styles.sub, { color: c.meta }]} numberOfLines={1}>
              {place.name}
            </Text>
          </View>
        </View>

        <GroupedCard inset={62}>
          <Pressable style={styles.option} onPress={() => setMethod('here')}>
            <RowIcon icon="navigate" color={c.blue} size={32} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.optTitle, { color: c.label }]}>I'm here now</Text>
              <Text
                style={[
                  styles.optSub,
                  near || distance === null ? { color: c.success, fontWeight: '500' } : { color: c.meta },
                ]}
              >
                {hereSubtitle}
              </Text>
            </View>
            {check(method === 'here')}
          </Pressable>
          <Pressable style={styles.option} onPress={() => setMethod('none')}>
            <RowIcon icon="pencil" color={c.meta} size={32} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.optTitle, { color: c.label }]}>Log without proof</Text>
              <Text style={[styles.optSub, { color: c.meta }]}>Only shows in your history</Text>
            </View>
            {check(method === 'none')}
          </Pressable>
        </GroupedCard>
        <Text style={[styles.note, { color: c.meta }]}>{COPY[method].note}</Text>

        <View style={{ paddingHorizontal: 16, marginTop: 28 }}>
          <Button label={COPY[method].cta} onPress={onConfirm} loading={busy} />
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { backgroundColor: '#F2F2F7', borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingTop: 8 },
  grabber: { width: 36, height: 5, borderRadius: 3, backgroundColor: '#C7C7CC', alignSelf: 'center', marginBottom: 14 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingBottom: 18 },
  title: { fontSize: 20, fontWeight: '700', letterSpacing: -0.3 },
  sub: { fontSize: 14 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 12 },
  optTitle: { fontSize: 17 },
  optSub: { fontSize: 13 },
  note: { fontSize: 13, lineHeight: 18, paddingHorizontal: 32, paddingTop: 10 },
})
