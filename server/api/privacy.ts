import type { VercelRequest, VercelResponse } from '@vercel/node'

// Serves the Bitescore privacy policy at https://bitescore.vercel.app/privacy
// (rewritten from /privacy in vercel.json). App Review requires a functional
// privacy policy link both inside the purchase flow (mobile/lib/legal.ts)
// and in the App Store Connect Privacy Policy field — this page is that link.

const LAST_UPDATED = '28 July 2026'
const CONTACT_EMAIL = 'dimejisadiq@live.com'

const HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Bitescore — Privacy Policy</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
         max-width: 720px; margin: 0 auto; padding: 32px 20px 80px; }
  h1 { font-size: 28px; letter-spacing: -0.5px; }
  h2 { font-size: 19px; margin-top: 32px; }
  ul { padding-left: 22px; }
  .meta { opacity: 0.6; font-size: 14px; }
  a { color: #0A7C4A; }
</style>
</head>
<body>
<h1>Bitescore Privacy Policy</h1>
<p class="meta">Last updated: ${LAST_UPDATED}</p>

<p>Bitescore is a mobile app that shows official UK food hygiene ratings
(published by the Food Standards Agency) for places to eat, with maps, search,
saved lists, reviews, and score-change notifications. This policy explains what
personal data the app handles and why.</p>

<h2>Data we collect</h2>
<ul>
  <li><strong>Account.</strong> The app creates an anonymous account
  automatically so lists and reviews work without signing up. If you choose to
  add an email address, we store it so you can sign back in. If you set a
  profile, we store your first name, last name, and username. Only your
  username is ever shown publicly.</li>
  <li><strong>Content you create.</strong> Your saved lists, reviews, and any
  reports you make about other reviews.</li>
  <li><strong>Purchases.</strong> Payment is processed entirely by Apple or
  Google — we never see your payment details. Our purchase partner RevenueCat
  tells us whether your account has an active subscription or lifetime
  purchase so we can unlock the app.</li>
  <li><strong>Notifications.</strong> If you enable score-change alerts, we
  store a push notification token for your device.</li>
  <li><strong>Location.</strong> With your permission, your device location is
  used to show hygiene ratings for places near you. It is used to run that
  lookup and is not stored or used for anything else.</li>
</ul>

<h2>What we don't do</h2>
<ul>
  <li>We don't sell your data or share it with advertisers.</li>
  <li>We don't run third-party advertising or ad tracking in the app.</li>
  <li>We don't store your payment details or your location history.</li>
</ul>

<h2>Services we rely on</h2>
<ul>
  <li><strong>Supabase</strong> — hosts our database and authentication (account,
  lists, reviews, notification preferences).</li>
  <li><strong>RevenueCat</strong> — manages in-app purchase entitlements on top of
  Apple's App Store and Google Play billing.</li>
  <li><strong>Expo</strong> — delivers push notifications.</li>
  <li><strong>Google Places</strong> — provides venue opening hours. We query it
  with the venue's name and postcode, never with your personal data.</li>
  <li><strong>Food Standards Agency</strong> — hygiene rating data, used under the
  Open Government Licence. Ratings are point-in-time and may not reflect a
  venue's current status.</li>
</ul>

<h2>Retention and deletion</h2>
<p>Your data is kept while your account exists. You can delete your account at
any time from the Account tab in the app, which permanently deletes your
profile, lists, reviews, and notification tokens. You can also email us at the
address below to request deletion or a copy of your data.</p>

<h2>Your rights</h2>
<p>Under UK GDPR you have the right to access, correct, export, or delete your
personal data, and to object to or restrict its processing. Contact us at the
address below to exercise any of these rights. You can also complain to the
Information Commissioner's Office (ICO).</p>

<h2>Children</h2>
<p>Bitescore is not directed at children under 13, and we don't knowingly
collect data from them.</p>

<h2>Changes</h2>
<p>If we change this policy we'll update this page and the date above.</p>

<h2>Contact</h2>
<p><a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a></p>
</body>
</html>
`

export default function handler(_req: VercelRequest, res: VercelResponse) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400')
  return res.status(200).send(HTML)
}
