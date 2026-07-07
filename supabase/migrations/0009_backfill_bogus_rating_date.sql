-- One-time backfill: FSA sends a meaningless sentinel date (e.g. 1900-01-01)
-- for non-numeric rating statuses like AwaitingInspection instead of leaving
-- it blank. Ingestion now nulls this out at the source (server/lib/fsa.ts),
-- but rows already ingested before that fix still carry the bogus date.
update public.restaurants
set rating_date = null
where not rating_is_numeric
  and rating_date is not null;
