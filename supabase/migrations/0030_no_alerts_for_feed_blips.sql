-- Rating alerts: only when the place really has a different inspection.
--
-- The FSA feed sometimes flips a place to "AwaitingInspection" for a few days,
-- then back to the same inspection. Every flip was logged to score_changes,
-- the push queue, so anyone who saved the place was told its rating "changed
-- to Awaiting inspection", then "changed to 2", with no new inspection at all.
--
-- Since 0029 a blip leaves the place's inspection row open. So now a change is
-- logged only when the open inspection is replaced by a different one with a
-- different rating, and old_rating is that inspection's rating, not the blip.
-- A place's first rating still alerts (Awaiting -> 3). A move to a non-rating
-- (Exempt, AwaitingInspection) no longer does.

set lock_timeout = '5s';

-- Places mid-blip right now: the old import closed their inspection when the
-- blip started. Reopen it, so the flip back isn't seen as a change. (61 rows:
-- every place with inspections but none open is currently non-numeric.)
update public.inspections i set seen_until = null
where i.id in (
  select distinct on (l.restaurant_id) l.id
  from public.inspections l
  where l.rating_date is not null
    and not exists (select 1 from public.inspections o
                    where o.restaurant_id = l.restaurant_id and o.seen_until is null)
  order by l.restaurant_id, l.seen_until desc
);

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
  v_cur_id   bigint;
  v_cur_val  text;
  v_insp_id  bigint;
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

    -- History: only a dated inspection closes the previous one (a re-inspection
    -- that keeps the same score still counts). "AwaitingInspection" and the
    -- like leave it open, so when the feed flips back it is the same row.
    if v_new ~ '^[0-5]$' and v_new_date is not null then
      select id, rating_value into v_cur_id, v_cur_val
      from public.inspections
      where restaurant_id = v_id and seen_until is null
      order by rating_date desc nulls last
      limit 1;

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
        seen_until = null
      returning id into v_insp_id;

      -- Alert: a different inspection with a different rating, for a place we
      -- already knew about. Not a blip, which keeps the same inspection.
      if v_old is not null
         and v_insp_id is distinct from v_cur_id
         and coalesce(v_cur_val, v_old) is distinct from v_new then
        insert into public.score_changes (restaurant_id, old_rating, new_rating)
        values (v_id, coalesce(v_cur_val, v_old), v_new);
      end if;
    end if;

    n := n + 1;
  end loop;
  return n;
end;
$$;

revoke execute on function public.ingest_upsert(jsonb) from public, anon, authenticated;
grant execute on function public.ingest_upsert(jsonb) to service_role;
