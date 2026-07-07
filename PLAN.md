# Bitescore — Architecture Plan

A standalone iOS/Android app showing official UK FSA food hygiene ratings for
places you eat out, with a map, search, filters, saved lists, score-change
notifications, and text reviews. Fully separate from the Dilagee/Shiftly product.

> This app must **not** live in, depend on, or write to any Dilagee/Shiftly
> folder or infrastructure. Everything lives under `bitescore/`.

---

## Decisions (locked)

| Topic | Decision |
| --- | --- |
| Product | Brand-new standalone consumer app, own store listings |
| Platform | Expo / React Native (own project under `bitescore/`) |
| Data coverage | England, Wales & NI via FSA FHRS (0–5). Scotland/FHIS out of scope |
| Venue types | Places you eat out: restaurants/cafes, takeaways, pubs/bars, mobile caterers, hotels/B&Bs. Excludes retailers, schools, care homes, hospitals |
| Opening hours | Google Places, matched by name+postcode, fetched on-demand, cached ~30 days |
| Reviews | Text-only; named or anonymous; **account-backed** (login required to post, name can be hidden publicly) |
| Moderation | Minimal v1: in-app report/flag + block-user; auto-hide after N reports; action via Supabase view + email alert. No admin dashboard |
| Accounts | Free account (Supabase Auth: email + Apple + Google). Required for lists & notifications |
| Lists | Multiple custom named lists per user |
| Notifications | Push when a listed venue's FSA score changes |
| Monetization | Hard paywall on launch. £4.99/yr or £49.99 lifetime via Apple/Google IAP (RevenueCat) |
| Infrastructure | **Own** Supabase project + **own** Vercel project. No reuse of Dilagee infra |

---

## Stack

- **App**: Expo / React Native + expo-router, TypeScript
- **Backend**: own Supabase project — Postgres + PostGIS, Auth, RLS, Storage
- **Cron/API**: own Vercel project — nightly FSA ingestion, Google Places proxy, push dispatch, RevenueCat webhook
- **Payments**: RevenueCat → Apple StoreKit / Google Play Billing
- **Push**: Expo Push Notifications
- **Analytics/crash**: PostHog + Sentry (own projects)

---

## Data pipeline

- **Source**: FSA per-local-authority bulk data files (~380 authorities, refreshed daily),
  not the paginated API — robust for 600k+ records.
- **Filter** to dining `BusinessType`s only (see venue types above).
- **Nightly job**: download → upsert `restaurants` → diff old vs. new `rating_value`
  → enqueue score-change push notifications for users with that venue on a list.
- **Ratings**: 0–5 numeric plus non-numeric states (`Exempt`, `AwaitingInspection`,
  `AwaitingPublication`) rendered and filtered gracefully.
- **Attribution**: FSA data under the Open Government Licence — attribution + a
  "score is point-in-time, may be out of date" disclaimer shown in-app.

## Opening hours

- Google Places match by name+postcode; fetched when a detail page opens; cached ~30 days.
- Risk: fuzzy matching can mis-match a venue. Show "hours via Google" + a
  "report wrong info" tap.

---

## Data model (Supabase)

- `restaurants` — fhrs_id, name, address, postcode, geo (PostGIS point), local_authority,
  rating_value, rating_date, business_type, hours_cache (jsonb), hours_fetched_at, last_synced_at
- `profiles` — user_id, display_name, created_at
- `lists` — id, user_id, name, created_at
- `list_items` — list_id, restaurant_id
- `reviews` — id, restaurant_id, user_id, display_name_snapshot, is_anonymous, body,
  status (`visible`/`hidden`), created_at
- `review_reports` — review_id, reporter_id, reason, created_at
- `user_blocks` — blocker_id, blocked_id
- `push_tokens` — user_id, expo_token, platform
- `notification_prefs` — user_id, score_change_enabled
- `entitlements` — user_id, product (annual/lifetime), status, source (RevenueCat), updated_at

RLS on every user-owned table. Reviews auto-hide after N reports pending action.

## Auth

- Supabase Auth: email + Sign in with Apple + Google (Apple sign-in mandatory
  because Google is offered).
- In-app account deletion + GDPR data export from day one (Apple requirement).

---

## Screens

1. **Map** (default) — score-coloured pins (FSA green→red), clustering, "near me"
2. **Search / List** — by name or postcode
3. **Filters** — min score, distance, venue type, recently inspected
4. **Restaurant detail** — score badge, last inspection date, address, hours, reviews, add-to-list, write-review
5. **My Lists** — create/rename/delete multiple named lists; view saved venues
6. **Reviews** — text-only; named or anonymous; report/flag + block user
7. **Paywall** — hard gate on launch; £4.99/yr or £49.99 lifetime; restore purchases
8. **Account / Settings** — subscription status, notification toggle, account deletion, legal

## Monetization

- Hard paywall on first launch; RevenueCat entitlement gates app entry.
- Annual subscription + lifetime non-consumable; restore purchases; RevenueCat webhook syncs `entitlements`.
- Paywall structured so a free-preview mode is a one-line flip if App Review objects.
- **Risk**: hard paywall over public government data with zero free content is the
  biggest App Store rejection risk (guideline 3.1.1). Mitigation above.

## Moderation (minimal, meets Apple guideline 1.2)

- In-app report/flag + block-user; EULA with zero-tolerance clause.
- Auto-hide after N reports; action queue via Supabase view + email alert.

## Notifications

- Permission prompt deferred to first list save; settings toggle.
- Nightly diff dispatches Expo push: "The Ivy's hygiene score changed to 5/5." Batched.

## Legal / store prep

- Privacy policy, EULA, FSA attribution + point-in-time disclaimer, "reviews are opinion"
  notice, age rating, App Privacy labels, screenshots, icons.

---

## Out of scope (v1)

Scotland (FHIS), business-owner replies, review photos, web app, star ratings.

---

## Build order

1. `bitescore/` Expo scaffold + own Supabase project + schema/PostGIS + RLS
2. FSA ingestion job (Vercel cron) + restaurants populated
3. Read-only browse: map / search / filter / detail
4. Auth + lists + score-change notifications
5. Reviews + report/block moderation
6. RevenueCat paywall + entitlement gate
7. Apple-esque visual polish + onboarding
8. Legal, store assets, App Review prep

## What you (the human) must provision

Bitescore reads all secrets from env. Claude cannot create these accounts/keys:

- Supabase project → URL + anon key + service-role key
- Vercel project (for cron/API) + env vars
- Google Cloud project → Places API key (billing enabled)
- RevenueCat account → API keys + product IDs (annual sub, lifetime non-consumable)
- Apple Developer + Google Play Console → app IDs, IAP products, EAS credentials

A precise `.env.example` + checklist ships with the scaffold.
