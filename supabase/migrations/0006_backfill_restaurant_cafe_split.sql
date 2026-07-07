-- One-time backfill: reclassify already-ingested rows that still carry FSA's
-- combined 'Restaurant/Cafe/Canteen' BusinessType into our own split
-- 'Restaurant' / 'Cafe' values, using the same name-keyword heuristic as
-- server/lib/fsa.ts (normalizedBusinessType) and mobile/lib/fsa.ts
-- (classifyRestaurantOrCafe). Future ingestion runs write the split value
-- directly, so this only needs to run once against existing data.
update public.restaurants
set business_type = case
  when name ~* 'caf[eé]|coffee|tea\s*room|patisserie' then 'Cafe'
  else 'Restaurant'
end
where business_type = 'Restaurant/Cafe/Canteen';
