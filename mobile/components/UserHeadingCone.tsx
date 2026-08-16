import { memo } from 'react'
import { View, StyleSheet } from 'react-native'
import { Marker } from 'react-native-maps'
import type { UserPose } from '@/hooks/useUserHeading'

// The translucent wedge that fans out from the blue dot in the direction the
// phone is pointing — the thing you need when standing outside a venue and
// working out whether it's the place on your left or your right. Drawn as two
// stacked CSS triangles (a wide faint beam and a tighter stronger one), which
// reads as a soft cone without pulling in an SVG/gradient dependency.
//
// Geometry: the wrapper is 2 x CONE_LEN tall and the triangle occupies the
// top half, pointing down, so its apex lands exactly on the wrapper's centre.
// With anchor {0.5, 0.5} that apex sits on the user's coordinate and the wedge
// opens away from it — towards the top of the marker, i.e. bearing 0 before
// the rotation below is applied.
const CONE_LEN = 60
const OUTER_HALF_WIDTH = 38
const INNER_HALF_WIDTH = 22

function Cone({ rotation }: { rotation: number }) {
  return (
    <View
      style={[styles.wrap, { transform: [{ rotate: `${rotation}deg` }] }]}
      pointerEvents="none"
    >
      <View style={[styles.tri, styles.outer]} />
      <View style={[styles.tri, styles.inner]} />
    </View>
  )
}

// Heading updates land many times a second; re-render only when the cone
// would visibly move.
export const UserHeadingCone = memo(
  function UserHeadingCone({ pose, mapBearing }: { pose: UserPose; mapBearing: number }) {
    return (
      <Marker
        coordinate={{ latitude: pose.latitude, longitude: pose.longitude }}
        anchor={{ x: 0.5, y: 0.5 }}
        zIndex={0}
        tappable={false}
        // The wedge is rotated by the child view's own transform rather than
        // the Marker's `rotation` prop: on iOS that prop is applied to the
        // annotation view when it is created and does not reliably follow
        // later updates for a marker with custom children, which left the cone
        // frozen at whatever bearing it first rendered with. A style transform
        // is plain React Native and re-renders like anything else.
        //
        // That makes the rotation screen-relative, so the map's own bearing is
        // subtracted to keep the wedge pointing at true ground north — the job
        // `flat` used to do.
        tracksViewChanges
      >
        <Cone rotation={pose.heading - mapBearing} />
      </Marker>
    )
  },
  (a, b) =>
    Math.round(a.pose.heading) === Math.round(b.pose.heading) &&
    Math.round(a.mapBearing) === Math.round(b.mapBearing) &&
    a.pose.latitude === b.pose.latitude &&
    a.pose.longitude === b.pose.longitude,
)

const styles = StyleSheet.create({
  wrap: {
    width: OUTER_HALF_WIDTH * 2,
    height: CONE_LEN * 2,
    alignItems: 'center',
  },
  tri: {
    position: 'absolute',
    top: 0,
    width: 0,
    height: 0,
    backgroundColor: 'transparent',
    borderStyle: 'solid',
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  outer: {
    borderLeftWidth: OUTER_HALF_WIDTH,
    borderRightWidth: OUTER_HALF_WIDTH,
    borderTopWidth: CONE_LEN,
    borderTopColor: 'rgba(0, 122, 255, 0.15)',
  },
  inner: {
    borderLeftWidth: INNER_HALF_WIDTH,
    borderRightWidth: INNER_HALF_WIDTH,
    borderTopWidth: CONE_LEN,
    borderTopColor: 'rgba(0, 122, 255, 0.28)',
  },
})
