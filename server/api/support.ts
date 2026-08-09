import type { VercelRequest, VercelResponse } from '@vercel/node'
import { renderPage, CONTACT_EMAIL } from '../lib/page.js'

// Serves the Bitescore support page at https://bitescore.vercel.app/support
// (rewritten from /support in vercel.json). This is the Support URL in App
// Store Connect; guideline 1.5 requires it to resolve to a working page with
// real support information, and the app was rejected once because no such
// page existed.

const HTML = renderPage({
  title: 'Bitescore — Support',
  heading: 'Bitescore Support',
  subtitle: 'Official UK food hygiene ratings for places to eat.',
  body: `
<p>Need help, spotted something wrong, or want your data removed? Email
<a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a> and we'll get back to you.
We aim to reply within two working days.</p>

<h2>About the ratings</h2>
<p>Bitescore shows food hygiene ratings published by the Food Standards Agency
(FSA) for England, Wales and Northern Ireland. We don't set or influence these
ratings — they come from inspections carried out by local authorities.</p>
<ul>
  <li><strong>Ratings run 0 to 5</strong>, where 5 is "very good" and 0 is
  "urgent improvement necessary".</li>
  <li><strong>A rating is a snapshot</strong> from the date of the last
  inspection, shown on each venue's page. A place may have changed since.</li>
  <li><strong>Some venues show "Awaiting inspection"</strong> — they're
  registered but haven't been inspected yet.</li>
  <li>Scotland uses a different scheme (FHIS) and isn't currently covered.</li>
</ul>

<h2>A rating looks wrong</h2>
<p>We publish FSA data as-is and can't change a rating. If you believe a rating
or a venue's details are incorrect, the FSA and the relevant local authority
handle corrections — see
<a href="https://ratings.food.gov.uk">ratings.food.gov.uk</a>. If our app is
showing something different from the FSA's own site, that's a bug on our side:
please email us.</p>

<h2>Opening hours look wrong</h2>
<p>Opening hours come from Google and are matched to each venue by name and
postcode, so occasionally a venue can be matched incorrectly. Email us the
venue name and postcode and we'll correct the match.</p>

<h2>Subscriptions and purchases</h2>
<ul>
  <li><strong>Manage or cancel:</strong> subscriptions are billed by Apple, not
  by us. Open the Settings app, tap your name, then Subscriptions. You can also
  reach this from the Account tab in Bitescore.</li>
  <li><strong>Restore a purchase:</strong> tap "Restore Purchases" on the
  purchase screen. This recovers a subscription or lifetime unlock bought with
  the same Apple Account.</li>
  <li><strong>Refunds</strong> are handled by Apple at
  <a href="https://reportaproblem.apple.com">reportaproblem.apple.com</a>.</li>
</ul>

<h2>Notifications</h2>
<p>If a place on one of your lists is re-inspected and its score changes, we can
notify you. Turn this on or off under Score-change alerts in the Account tab.
You'll be asked for notification permission the first time you save a place.</p>

<h2>Your account and data</h2>
<ul>
  <li><strong>Delete your account:</strong> Account tab → Delete account. This
  permanently removes your profile, lists, reviews and notification tokens.</li>
  <li><strong>Get a copy of your data,</strong> or ask us to delete it for you:
  email <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>.</li>
  <li><strong>Privacy:</strong> see our <a href="/privacy">privacy policy</a>.</li>
</ul>

<h2>Reviews</h2>
<p>Reviews are written by other people using the app and are their opinions, not
ours. Only your username is ever shown — never your real name. If you see a
review that breaks our rules, tap the options button on it to report it, or
block the reviewer. Reported reviews are hidden automatically once enough people
report them, and we review them.</p>

<h2>Attribution</h2>
<p>Food hygiene ratings © Crown copyright, Food Standards Agency, used under the
Open Government Licence. Ratings reflect the last inspection and may be out of
date.</p>
`,
})

export default function handler(_req: VercelRequest, res: VercelResponse) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400')
  return res.status(200).send(HTML)
}
