import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useRouter } from 'expo-router'
import { useTheme } from '@/theme/useTheme'
import { SectionFooter, SectionHeader } from '@/components/ui'
import { getProfile, savePublicProfile, setUsername } from '@/lib/data'
import { sanitizeUsername } from '@/lib/username'
import { errorMessage } from '@/lib/errors'

// What other people see. The name is optional and only what you type here —
// your private account details never appear publicly.
export default function EditProfile() {
  const c = useTheme()
  const router = useRouter()
  const [loaded, setLoaded] = useState(false)
  const [name, setName] = useState('')
  const [username, setUsernameInput] = useState('')
  const [originalUsername, setOriginalUsername] = useState('')
  const [city, setCity] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    getProfile()
      .then((p) => {
        setName(p?.public_name ?? '')
        setCity(p?.city ?? '')
        setUsernameInput(p?.username ?? '')
        setOriginalUsername(p?.username ?? '')
      })
      .finally(() => setLoaded(true))
  }, [])

  const clean = sanitizeUsername(username)

  const onSave = async () => {
    if (!clean) {
      Alert.alert('Username needed', 'Use letters, numbers or underscores.')
      return
    }
    setSaving(true)
    try {
      if (clean !== originalUsername) await setUsername(clean)
      await savePublicProfile(name, city)
      router.back()
    } catch (e) {
      const msg = errorMessage(e)
      Alert.alert(
        'Couldn’t save',
        /duplicate|unique|23505/i.test(msg) ? `@${clean} is taken. Try another username.` : msg,
      )
    } finally {
      setSaving(false)
    }
  }

  const field = (label: string, value: string, onChange: (v: string) => void, props: Partial<React.ComponentProps<typeof TextInput>> = {}) => (
    <View style={styles.field}>
      <Text style={[styles.label, { color: c.label }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholderTextColor={c.meta}
        style={[styles.input, { color: c.label }]}
        {...props}
      />
    </View>
  )

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.nav}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Text style={[styles.navText, { color: c.tint }]}>Cancel</Text>
        </Pressable>
        <Text style={[styles.navTitle, { color: c.label }]}>Edit profile</Text>
        <Pressable onPress={onSave} disabled={saving || !loaded} hitSlop={10}>
          {saving ? <ActivityIndicator color={c.tint} /> : <Text style={[styles.navText, { color: c.tint, fontWeight: '600' }]}>Save</Text>}
        </Pressable>
      </View>
      {!loaded ? (
        <ActivityIndicator color={c.meta} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView contentContainerStyle={{ paddingTop: 16 }} keyboardShouldPersistTaps="handled">
          <SectionHeader>Public profile</SectionHeader>
          <View style={styles.card}>
            {field('Name', name, setName, { placeholder: 'Optional', maxLength: 60, autoCapitalize: 'words' })}
            <View style={[styles.sep, { backgroundColor: c.separator }]} />
            {field('Username', username, setUsernameInput, {
              placeholder: 'username',
              autoCapitalize: 'none',
              autoCorrect: false,
              maxLength: 30,
            })}
            <View style={[styles.sep, { backgroundColor: c.separator }]} />
            {field('City', city, setCity, { placeholder: 'Optional', maxLength: 60, autoCapitalize: 'words' })}
          </View>
          <SectionFooter>
            People who find you see your name, @{clean || 'username'} and city. Leave the name blank to show only
            your username. Anonymous reviews never appear on your profile.
          </SectionFooter>
        </ScrollView>
      )}
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  nav: { height: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16 },
  navText: { fontSize: 17 },
  navTitle: { fontSize: 17, fontWeight: '600' },
  card: { marginHorizontal: 16, backgroundColor: '#FFFFFF', borderRadius: 14, overflow: 'hidden' },
  field: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, minHeight: 48 },
  label: { width: 96, fontSize: 17 },
  input: { flex: 1, fontSize: 17, paddingVertical: 12 },
  sep: { height: StyleSheet.hairlineWidth, marginLeft: 16 },
})
