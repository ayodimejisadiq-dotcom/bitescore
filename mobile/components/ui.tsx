import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native'

// The design's signature "physical tile" treatment: a hard 0/N/0 bottom edge
// in a darker shade of the fill, no blur — rendered with the cross-platform
// boxShadow style (RN new-architecture). Buttons press "down" — translateY 2
// and the edge collapses to 1 — the one piece of playfulness the system
// allows itself.

export function tileEdge(edgeColor: string, edge = 3): ViewStyle {
  return { boxShadow: `0 ${edge}px 0 ${edgeColor}` }
}

export function EdgeButton({
  color,
  edgeColor,
  edge = 3,
  radius = 15,
  disabled = false,
  onPress,
  style,
  containerStyle,
  children,
}: {
  color: string
  edgeColor: string
  edge?: number
  radius?: number
  disabled?: boolean
  onPress?: () => void
  style?: StyleProp<ViewStyle>
  // Layout styles (flex, width, margins) belong on the Pressable wrapper.
  containerStyle?: StyleProp<ViewStyle>
  children: React.ReactNode
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[{ opacity: disabled ? 0.6 : 1 }, containerStyle]}
    >
      {({ pressed }) => (
        <View
          style={[
            {
              backgroundColor: color,
              borderRadius: radius,
              transform: [{ translateY: pressed ? 2 : 0 }],
            },
            disabled ? null : tileEdge(edgeColor, pressed ? 1 : edge),
            style,
          ]}
        >
          {children}
        </View>
      )}
    </Pressable>
  )
}
