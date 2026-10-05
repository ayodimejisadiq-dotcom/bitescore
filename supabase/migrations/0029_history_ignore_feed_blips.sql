-- Inspection history: stop counting one inspection twice.
--
-- The FSA feed sometimes flips a place to "AwaitingInspection" (or another
-- rating) for a few days, then back to the same inspection. The import treated
-- the flip as a new inspection and closed the current one, and the 0023
-- backfill turned each flip in score_changes into an "earlier" rating. So a
-- place inspected on 7 Jul showed that 2 as current and, under it, the same 2
-- "rated until Sep" (the day of the flip).
--
-- Now an inspection is only closed when a newer dated inspection replaces it,
-- and "current" means it matches the rating the place shows today.

set lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- Clean up: undated ratings that are the current inspection seen again. Same
-- rating, and still on the feed after the current inspection's date, so it
-- can't have been an earlier one. (534 rows in production.)
-- ---------------------------------------------------------------------------
delete from public.inspections old
using public.inspections cur
where old.rating_date is null
  and cur.restaurant_id = old.restaurant_id
  and cur.seen_until is null
  and cur.rating_date is not null
  and cur.rating_value = old.rating_value
  and cur.rating_date < old.seen_until::date;

-- ---------------------------------------------------------------------------
-- Import: a non-numeric blip no longer closes the current inspection
-- ---------------------------------------------------------------------------
create or replace function public.ingest_upsert(rows jsonb)
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
  r          jsonb;
  v_fhrs     bigint;
  v_id       uuid;
  v_old      text;
  v_new      text;
  v_new_date date;
  v_lng      double precision;
  v_lat      double precision;
  v_hyg      smallint;
  v_str      smallint;
  v_man      smallint;
  v_scores   boolean;
  n          int := 0;
begin
  for r in select * from jsonb_array_elements(rows)
  loop
    v_fhrs     := (r->>'fhrs_id')::bigint;
    v_new      := coalesce(r->>'rating_value', '');
    v_new_date := nullif(r->>'rating_date', '')::date;
    v_lng      := nullif(r->>'lng', '')::double precision;
    v_lat      := nullif(r->>'lat', '')::double precision;
    -- Older importers don't send scores at all; only overwrite them when the
    -- row actually carries the keys.
    v_scores   := r ? 'hygiene';
    v_hyg      := nullif(r->>'hygiene', '')::smallint;
    v_str      := nullif(r->>'structural', '')::smallint;
    v_man      := nullif(r->>'management', '')::smallint;

    select rating_value into v_old
    from public.restaurants where fhrs_id = v_fhrs;

    insert into public.restaurants (
      fhrs_id, name, business_type, business_type_id, address, postcode,
      local_authority, geo, rating_value, rating_is_numeric, rating_date,
      hygiene_score, structural_score, management_score, last_synced_at
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
      v_new_date,
      v_hyg, v_str, v_man,
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
      hygiene_score    = case when v_scores then excluded.hygiene_score else restaurants.hygiene_score end,
      structural_score = case when v_scores then excluded.structural_score else restaurants.structural_score end,
      management_score = case when v_scores then excluded.management_score else restaurants.management_score end,
      last_synced_at   = now()
    returning id into v_id;

    -- Only log a change for establishments we already knew about.
    if v_old is not null and v_old is distinct from v_new then
      insert into public.score_changes (restaurant_id, old_rating, new_rating)
      values (v_id, v_old, v_new);
    end if;

    -- History: only a dated inspection closes the previous one (a re-inspection
    -- that keeps the same score still counts). "AwaitingInspection" and the
    -- like leave it open, so when the feed flips back it is the same row.
    if v_new ~ '^[0-5]$' and v_new_date is not null then
      update public.inspections set seen_until = now()
      where restaurant_id = v_id and seen_until is null
        and (rating_date is distinct from v_new_date or rating_value <> v_new);

      insert into public.inspections (restaurant_id, rating_value, rating_date, hygiene, structural, management, seen_from)
      values (v_id, v_new, v_new_date, v_hyg, v_str, v_man, now())
      on conflict (restaurant_id, rating_date, rating_value) where rating_date is not null
      do update set
        hygiene    = coalesce(excluded.hygiene, inspections.hygiene),
        structural = coalesce(excluded.structural, inspections.structural),
        management = coalesce(excluded.management, inspections.management),
        seen_until = null;
    end if;

    n := n + 1;
  end loop;
  return n;
end;
$$;

revoke execute on function public.ingest_upsert(jsonb) from public, anon, authenticated;
grant execute on function public.ingest_upsert(jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- History: "current" is the rating the place shows today, not just the last
-- row left open (a place now awaiting inspection has no current inspection).
-- Dated rows first, newest first; undated ones predate them all.
-- ---------------------------------------------------------------------------
create or replace function public.inspection_history(p_restaurant_id uuid)
returns table (
  rating_value text,
  rating_date date,
  hygiene smallint,
  structural smallint,
  management smallint,
  seen_until timestamptz,
  is_current boolean
)
language sql stable
as $$
  select i.rating_value, i.rating_date, i.hygiene, i.structural, i.management,
         i.seen_until,
         coalesce(i.rating_value = r.rating_value and i.rating_date = r.rating_date, false) as is_current
  from public.inspections i
  join public.restaurants r on r.id = i.restaurant_id
  where i.restaurant_id = p_restaurant_id
  order by is_current desc,
           i.rating_date desc nulls last,
           i.seen_until desc nulls first
  limit 20;
$$;
