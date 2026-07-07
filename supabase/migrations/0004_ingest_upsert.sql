-- Bulk upsert used by the FSA ingestion job. Takes a JSON array of rows,
-- builds the PostGIS geography from lng/lat, and records a score_changes row
-- whenever an existing establishment's rating actually changed (drives
-- notifications). Service role only.

create or replace function public.ingest_upsert(rows jsonb)
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
  r      jsonb;
  v_fhrs bigint;
  v_old  text;
  v_new  text;
  v_lng  double precision;
  v_lat  double precision;
  n      int := 0;
begin
  for r in select * from jsonb_array_elements(rows)
  loop
    v_fhrs := (r->>'fhrs_id')::bigint;
    v_new  := coalesce(r->>'rating_value', '');
    v_lng  := nullif(r->>'lng', '')::double precision;
    v_lat  := nullif(r->>'lat', '')::double precision;

    select rating_value into v_old
    from public.restaurants where fhrs_id = v_fhrs;

    insert into public.restaurants (
      fhrs_id, name, business_type, business_type_id, address, postcode,
      local_authority, geo, rating_value, rating_is_numeric, rating_date, last_synced_at
    ) values (
      v_fhrs,
      r->>'name',
      r->>'business_type',
      nullif(r->>'business_type_id', '')::int,
      r->>'address',
      r->>'postcode',
      r->>'local_authority',
      case when v_lng is not null and v_lat is not null
           then st_setsrid(st_makepoint(v_lng, v_lat), 4326)::geography
           else null end,
      v_new,
      v_new ~ '^[0-5]$',
      nullif(r->>'rating_date', '')::date,
      now()
    )
    on conflict (fhrs_id) do update set
      name             = excluded.name,
      business_type    = excluded.business_type,
      business_type_id = excluded.business_type_id,
      address          = excluded.address,
      postcode         = excluded.postcode,
      local_authority  = excluded.local_authority,
      geo              = excluded.geo,
      rating_value     = excluded.rating_value,
      rating_is_numeric= excluded.rating_is_numeric,
      rating_date      = excluded.rating_date,
      last_synced_at   = now();

    -- Only log a change for establishments we already knew about.
    if v_old is not null and v_old is distinct from v_new then
      insert into public.score_changes (restaurant_id, old_rating, new_rating)
      select id, v_old, v_new from public.restaurants where fhrs_id = v_fhrs;
    end if;

    n := n + 1;
  end loop;
  return n;
end;
$$;
