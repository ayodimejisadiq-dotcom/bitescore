import { useEffect, useRef, useState } from 'react'
import * as Location from 'expo-location'

export type UserPose = {
  latitude: number
  longitude: number
  /** Compass bearing in degrees, 0 = true north. */
  heading: number
  /** Metres of horizontal error reported by the OS, if known. */
  accuracy: number | null
}

// Raw compass output jitters by several degrees while the phone is held
// still, which reads as a twitching wedge rather than a heading. Ease towards
// each new reading instead of snapping to it, going the short way around so a
// swing across north (359° → 1°) doesn't spin the cone the long way.
const SMOOTHING = 0.25

function smooth(prev: number | null, next: number): number {
  if (prev == null) return next
  let delta = ((next - prev + 540) % 360) - 180
  return (prev + delta * SMOOTHING + 360) % 360
}

// The system blue dot tells you where you are but not which way you're
// pointing, which is exactly what you need when standing outside a venue
// deciding whether it's the place on your left or your right. We watch
// position and compass heading ourselves so the map can draw the direction
// cone (see UserHeadingCone) without switching the map into
// follow-with-heading mode, which would seize the camera from the user.
export function useUserHeading(enabled: boolean): UserPose | null {
  const [pose, setPose] = useState<UserPose | null>(null)
  // Position and heading arrive from two independent subscriptions at very
  // different rates; keep the last of each so either can emit a full pose.
  const coords = useRef<{ latitude: number; longitude: number; accuracy: number | null } | null>(
    null,
  )
  const heading = useRef<number | null>(null)

  useEffect(() => {
    if (!enabled) {
      setPose(null)
      return
    }

    let cancelled = false
    let posSub: Location.LocationSubscription | null = null
    let headSub: Location.LocationSubscription | null = null

    const emit = () => {
      if (cancelled || !coords.current || heading.current == null) return
      setPose({ ...coords.current, heading: heading.current })
    }

    ;(async () => {
      try {
        const { status } = await Location.getForegroundPermissionsAsync()
        if (status !== 'granted' || cancelled) return

        posSub = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.Balanced, distanceInterval: 5 },
          (p) => {
            coords.current = {
              latitude: p.coords.latitude,
              longitude: p.coords.longitude,
              accuracy: p.coords.accuracy ?? null,
            }
            emit()
          },
        )
        if (cancelled) {
          posSub?.remove()
          posSub = null
          return
        }

        headSub = await Location.watchHeadingAsync((h) => {
          // trueHeading is -1 until the compass calibrates; magHeading is
          // close enough for "which way am I facing" in the meantime.
          const next = h.trueHeading >= 0 ? h.trueHeading : h.magHeading
          if (next < 0) return
          heading.current = smooth(heading.current, next)
          emit()
        })
        if (cancelled) {
          headSub?.remove()
          headSub = null
        }
      } catch {
        // No compass (simulator, some Android hardware) or permission pulled
        // mid-flight — the plain blue dot still works, so stay quiet.
      }
    })()

    return () => {
      cancelled = true
      posSub?.remove()
      headSub?.remove()
    }
  }, [enabled])

  return pose
}
