import { Tabs } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '@/theme/useTheme'

// Explore, Lists, Profile. Filled icons when active, outlines otherwise.
export default function TabsLayout() {
  const c = useTheme()
  const insets = useSafeAreaInsets()
  // ~90pt on iPhones with a home indicator (34pt inset). The design's 84 leaves
  // 43pt for icon + label, which clips the labels; phones without an inset
  // still need a few points under them.
  const bottom = Math.max(insets.bottom, 8)
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.tint,
        tabBarInactiveTintColor: c.meta,
        tabBarStyle: {
          position: 'absolute',
          backgroundColor: 'rgba(250,250,252,0.94)',
          borderTopColor: c.tabBorder,
          borderTopWidth: 0.5,
          height: 56 + bottom,
          paddingTop: 7,
          paddingBottom: bottom,
        },
        tabBarLabelStyle: { fontSize: 10.5, fontWeight: '500' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Explore',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'map' : 'map-outline'} size={26} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="lists"
        options={{
          title: 'Lists',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'bookmark' : 'bookmark-outline'} size={26} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'person' : 'person-outline'} size={26} color={color} />
          ),
        }}
      />
    </Tabs>
  )
}
