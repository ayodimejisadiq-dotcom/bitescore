# Bitescore

UK food hygiene ratings in your pocket — official FSA scores on a map, saved
lists, score-change alerts, and reviews. iOS & Android.

**Standalone project.** Nothing here depends on or writes to the Dilagee/Shiftly
app or its infrastructure.

## Layout

```
bitescore/
  mobile/      Expo / React Native app (the product)
  server/      Vercel project: FSA ingestion cron, Google Places proxy,
               push dispatch, RevenueCat webhook
  supabase/    SQL migrations (own Supabase project)
  PLAN.md      Full architecture plan
```

## What you must provision (Claude can't create these)

Everything reads from env vars. Create these and fill in the `.env` files:

1. **Supabase project** — new project at supabase.com
   - Run the SQL in `supabase/migrations/` (in order) via the SQL editor or CLI.
   - Copy Project URL, `anon` key (mobile), `service_role` key (server only).
2. **Vercel project** — deploy `server/`; set env vars there.
3. **Google Cloud** — enable Places API, create an API key (restrict to Places),
   enable billing.
4. **RevenueCat** — create app, add products: `annual` (auto-renewing sub,
   £4.99/yr) and `lifetime` (non-consumable, £49.99). Copy API keys + set the
   webhook to `https://<server>/api/revenuecat/webhook`.
5. **Apple Developer + Google Play Console** — bundle IDs, the two IAP products,
   EAS build credentials.

See `mobile/.env.example` and `server/.env.example` for the exact variable names.

## Status

Step 1 of the build order (see PLAN.md): scaffold + database schema. Subsequent
steps add ingestion, browse UI, lists/notifications, reviews, and the paywall.
