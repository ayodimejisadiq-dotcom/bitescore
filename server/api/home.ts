import type { VercelRequest, VercelResponse } from '@vercel/node'
import { renderPage, CONTACT_EMAIL } from '../lib/page.js'

// Landing page at the bare domain. The root previously returned 404, which is
// exactly what an App Review check of a Support URL would have hit, so this
// exists so that no URL a reviewer or user can reasonably try comes back as an
// error.

const HTML = renderPage({
  title: 'Bitescore — UK food hygiene ratings',
  heading: 'Bitescore',
  subtitle: 'Official UK food hygiene ratings for places you eat out.',
  body: `
<p>Bitescore puts the Food Standards Agency's hygiene ratings on a map, so you
can check a restaurant, café, takeaway or pub before you order. Save the places
you go to a list, and get told if one of them is re-inspected and its score
changes.</p>

<h2>Where the data comes from</h2>
<p>Ratings are published by the Food Standards Agency for England, Wales and
Northern Ireland, from inspections carried out by local authorities. Each rating
is a snapshot from the date of its last inspection, which the app always shows
alongside the score.</p>

<h2>Help and contact</h2>
<p>Questions, corrections or data requests:
<a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>. There's more on the
<a href="/support">support page</a>, and our
<a href="/privacy">privacy policy</a> explains what the app stores.</p>

<h2>Attribution</h2>
<p>Food hygiene ratings © Crown copyright, Food Standards Agency, used under the
Open Government Licence.</p>
`,
})

export default function handler(_req: VercelRequest, res: VercelResponse) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400')
  return res.status(200).send(HTML)
}
