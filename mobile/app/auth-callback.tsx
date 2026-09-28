import { Redirect } from 'expo-router'

// bitescore://auth-callback is handled in the root layout (it signs the app in
// from the URL). This route only stops the router showing "not found" for it.
export default function AuthCallback() {
  return <Redirect href="/" />
}
