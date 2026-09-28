-- Inspection history and FSA sub-scores.
--
-- The FSA only publishes each establishment's *current* rating, so history has
-- to be collected by us as the import sees ratings change. This keeps one row
-- per inspection we have seen, in its own table: score_changes stays exactly
-- what it was (the push-notification queue), so recording history can never
-- send anyone a notification.
--
-- Sub-scores are the FSA's three inspection areas, in penalty points where
-- lower is better:
--   hygiene     food hygiene and safety       0, 5, 10, 15, 20, 25
--   structural  structure and cleanliness     0, 5, 10, 15, 20, 25
--   management  confidence in management      0, 5, 10, 20, 30

-- Give up rather than queue: an ALTER waiting on a lock blocks every read of
-- restaurants behind it (the map, search) until it gets through.
set lock_timeout = '5s';

-- Nullable columns without defaults: a catalog-only change, instant.
alter table public.restaurants
  add column if not exists hygiene_score smallint,
  add column if not exists structural_score smallint,
  add column if not exists management_score smallint;

create table if not exists public.inspections (
  id            bigint generated always as identity primary key,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  rating_value  text not null,
  -- The FSA's inspection date. Null only for ratings that predate this table,
  -- recovered from score_changes, which never stored dates.
  rating_date   date,
  hygiene       smallint,
  structural    smallint,
  management    smallint,
  seen_from     timestamptz,           -- first time the import saw this rating
  seen_until    timestamptz,           -- when it was replaced; null = current
  created_at    timestamptz not null default now()
);

create unique index if not exists inspections_dated_uniq
  on public.inspections (restaurant_id, rating_date, rating_value)
  where rating_date is not null;
create index if not exists inspections_restaurant_idx
  on public.inspections (restaurant_id, seen_until);

alter table public.inspections enable row level security;

-- Public data, like restaurants.
drop policy if exists inspections_read on public.inspections;
create policy inspections_read on public.inspections for select using (true);

-- ---------------------------------------------------------------------------
-- Backfill
-- ---------------------------------------------------------------------------

-- Past ratings recovered from score_changes: each change's old rating held
-- until the change was noticed. Only numeric ratings count as inspections.
insert into public.inspections (restaurant_id, rating_value, rating_date, seen_from, seen_until)
select restaurant_id, old_rating, null,
       lag(changed_at) over (partition by restaurant_id order by changed_at),
       changed_at
from public.score_changes
where old_rating ~ '^[0-5]$';

-- The current rating of every inspected place (~260k rows). The last-change
-- time comes from one grouped pass over score_changes, not a lookup per place:
-- score_changes has no restaurant_id index and the per-row version ran for
-- minutes. Production ran this in slices by id so no statement held on long.
insert into public.inspections (restaurant_id, rating_value, rating_date, seen_from)
select r.id, r.rating_value, r.rating_date, sc.last_change
from public.restaurants r
left join (
  select restaurant_id, max(changed_at) as last_change
  from public.score_changes group by restaurant_id
) sc on sc.restaurant_id = r.id
where r.rating_is_numeric and r.rating_date is not null
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Import: record inspections and sub-scores as they arrive
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
  v_old_date date;
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

    select rating_value, rating_date into v_old, v_old_date
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

    -- History: a new inspection (new date, or new rating) closes the previous
    -- one. A re-inspection that keeps the same score still counts.
    if v_old is not null
       and (v_old is distinct from v_new or v_old_date is distinct from v_new_date) then
      update public.inspections set seen_until = now()
      where restaurant_id = v_id and seen_until is null;
    end if;

    if v_new ~ '^[0-5]$' and v_new_date is not null then
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

-- Newest first: the current inspection, then earlier ones by date (or, for
-- recovered ratings, by when they were replaced).
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
         i.seen_until, i.seen_until is null
  from public.inspections i
  where i.restaurant_id = p_restaurant_id
  order by (i.seen_until is null) desc,
           coalesce(i.rating_date, i.seen_until::date) desc
  limit 20;
$$;
