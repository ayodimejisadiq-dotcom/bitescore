# Bitescore server

Vercel project hosting the background jobs and integrations:

- `api/cron/ingest.ts` — nightly FSA ingestion (resumable; self-continues across
  invocations). Records score changes for the notification dispatcher.

Later steps add: Google Places proxy (opening hours), Expo push dispatcher
(score-change alerts), and the RevenueCat entitlement webhook.

## Deploy

1. `vercel link` this `server/` directory to a **new** Vercel project.
2. Set env vars (see `.env.example`): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
   `CRON_SECRET` (and later `GOOGLE_PLACES_API_KEY`, `REVENUECAT_WEBHOOK_SECRET`).
3. The `vercel.json` cron runs `/api/cron/ingest` daily at 03:00 UTC. Vercel sends
   `Authorization: Bearer $CRON_SECRET`, which the handler verifies.

## How ingestion works

The FSA dataset is ~380 local authorities and 600k+ establishments. One run can't
process it all within a function time limit, so the job keeps a cursor in the
`ingest_state` table and processes authorities a slice at a time. When a slice
hits its time budget with authorities remaining, it self-invokes to continue,
so a single daily cron drives a full pass. Only dining venue types are ingested
(see `DINING_BUSINESS_TYPES`).

## Manual trigger

```
curl -X POST "https://<your-server>/api/cron/ingest?secret=$CRON_SECRET"
```

Returns progress JSON (`processedAuthorities`, `diningEstablishmentsSeen`,
`cursor`, `done`).

## Note on local testing

This coding sandbox blocks outbound access to `api.ratings.food.gov.uk` and to
Supabase, so the job can't be exercised end-to-end from here — it runs on Vercel,
whose network is unrestricted.
