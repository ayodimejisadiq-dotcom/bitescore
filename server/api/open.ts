import type { VercelRequest, VercelResponse } from '@vercel/node'
import { renderPage } from '../lib/page.js'
import { admin } from '../lib/supabase.js'

// Share links: /l/<slug> for a list, /u/<user id> for a profile. Messages and
// chats make https links tappable but not bitescore:// ones, so the app
// shares these and this page hands off to the app with a button.

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!)

const SCORE_BG: Record<string, string> = {
  '5': '#046A38', '4': '#5EA632', '3': '#F2A31C', '2': '#EF7B22', '1': '#E24B29', '0': '#C0362C',
}

function button(deepLink: string, label: string): string {
  return `<p><a href="${esc(deepLink)}" style="display:inline-block;background:#047B42;color:#fff;
padding:14px 22px;border-radius:14px;font-weight:600;text-decoration:none">${esc(label)}</a></p>
<p class="meta">Don't have Bitescore? Get it from the App Store or Google Play, then open this link again.</p>`
}

function score(r: string): string {
  const bg = SCORE_BG[r] ?? '#AEAEB2'
  const fg = r === '3' ? '#1C1C1E' : '#fff'
  return `<span style="display:inline-grid;place-items:center;width:32px;height:32px;border-radius:9px;
background:${bg};color:${fg};font-weight:700;margin-right:10px">${/^[0-5]$/.test(r) ? r : '–'}</span>`
}

type ListPreview = {
  name: string
  place_count: number
  people_count: number
  access: string
  owner: { username: string | null; public_name: string | null } | null
  preview: { name: string; rating_value: string }[]
}

async function listPage(slug: string): Promise<string | null> {
  const { data, error } = await admin.rpc('list_by_slug', { p_slug: slug })
  if (error || !data) return null
  const l = data as ListPreview
  const who = l.owner?.public_name || (l.owner?.username ? `@${l.owner.username}` : 'Someone')
  const rows = l.preview
    .map((p) => `<li style="list-style:none;display:flex;align-items:center;margin:8px 0">${score(p.rating_value)}${esc(p.name)}</li>`)
    .join('')
  return renderPage({
    title: `${esc(l.name)} · Bitescore`,
    heading: esc(l.name),
    subtitle: `${l.access === 'invited' ? 'Invite from' : 'Shared by'} ${esc(who)} · ${l.place_count} places · ${l.people_count} ${l.people_count === 1 ? 'person' : 'people'}`,
    body: `<ul style="padding:0">${rows}</ul>${button(`bitescore://l/${slug}`, 'Open in Bitescore')}`,
  })
}

async function userPage(id: string): Promise<string | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null
  const { data, error } = await admin.rpc('profile_summary', { p_user_id: id })
  if (error || !data) return null
  const p = data as { username: string | null; public_name: string | null; followers: number; verified_visits: number }
  const name = p.public_name || (p.username ? `@${p.username}` : 'Bitescore user')
  return renderPage({
    title: `${esc(name)} · Bitescore`,
    heading: esc(name),
    subtitle: `${p.username ? `@${esc(p.username)} · ` : ''}${p.followers} followers · ${p.verified_visits} verified visits`,
    body: button(`bitescore://user/${id}`, 'View in Bitescore'),
  })
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const kind = String(req.query.kind ?? '')
  const key = String(req.query.key ?? '')
  const html = kind === 'l' ? await listPage(key) : kind === 'u' ? await userPage(key) : null
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300')
  if (!html) {
    return res.status(404).send(
      renderPage({
        title: 'Link not found · Bitescore',
        heading: 'This link doesn’t work any more',
        body: '<p>The list may have been made private or deleted.</p>',
      }),
    )
  }
  return res.status(200).send(html)
}
