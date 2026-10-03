-- Faster search: nearby first, and an index for the place half of
-- "venue + town" searches.
--
-- In-app searches averaged 1.3s with spikes to 8s. Two causes:
--   * Common words read every match in the country to find the 50 nearest
--     (~10,000 rows for "pizza"). Name matches are now looked for within
--     40km of the user first, where the geo and name indexes intersect; the
--     rest of the country is only read when that finds fewer than max_rows.
--   * A vague name part ("the" in "the ivy chelsea") left tens of thousands
--     of addresses to check one by one. The place half now has its own
--     trigram index.
--
-- Places also match whole words now, and rank by how well they match: a
-- Costa in York (address ends "York", or York is the council) comes before
-- one on Leeds Road in Huddersfield for "kfc leeds", and "york" no longer
-- matches Yorkshire Street.
--
-- Production built the index with CREATE INDEX CONCURRENTLY first, so the
-- statement here is a no-op there.
create index if not exists restaurants_place_trgm_idx
  on public.restaurants using gin
  ((lower(coalesce(address, '') || ' ' || coalesce(local_authority, ''))) gin_trgm_ops);

create or replace function public.search_restaurants_near(
  q text,
  origin_lng double precision default null,
  origin_lat double precision default null,
  types text[] default null,
  rating_values text[] default null,
  max_rows int default 50
)
returns table (
  id uuid,
  name text,
  business_type text,
  address text,
  postcode text,
  rating_value text,
  rating_is_numeric boolean,
  rating_date date,
  distance_m double precision
)
language plpgsql stable
set search_path = public
as $$
declare
  w         text[] := regexp_split_to_array(btrim(q, E' ,\t'), E'[\\s,]+');
  n         int := cardinality(w);
  -- Same filters as the map, inside every branch so the "found enough
  -- nearby?" count is of rows that will actually be shown.
  filters   constant text :=
    '($3 is null or r.business_type = any($3)) and ($4 is null or r.rating_value = any($4))';
  whole     text[];   -- the query as a name: rank 0
  split     text[];   -- name + place: rank 1 (place is the town), 2 (elsewhere in the address)
  name_k    text;
  place_raw text;
  place_k   text;
  place_re  text;
  place_pc  text;
  k         int;
  near      text;
  far       text;
begin
  if coalesce(w[1], '') = '' then return; end if;

  -- A postcode prefix, and a literal name match only when the query's key
  -- is too short to search ("M&S"): otherwise the name_key match finds
  -- everything it would.
  whole := array[format(
    'select r.id, 0 as rank from public.restaurants r where (%s or r.postcode ilike %L) and %s and @near@',
    case when length(q) >= 3 and length(name_key(q)) < 3
         then format('r.name ilike %L', '%' || q || '%') else 'false' end,
    q || '%', filters)];
  if length(name_key(q)) >= 3 then
    whole := whole || format(
      'select r.id, 0 from public.restaurants r where name_key(r.name) like %L and %s and @near@',
      '%' || name_key(q) || '%', filters);
  end if;

  -- Every split into name + place, both ways round: "nandos croydon" and
  -- "croydon nandos". These match few rows anywhere, so they search the
  -- whole country in one go.
  for k in 1..n - 1 loop
    foreach place_raw in array array[array_to_string(w[k + 1:], ' '), array_to_string(w[1:k], ' ')] loop
      name_k := name_key(case when place_raw = array_to_string(w[k + 1:], ' ')
                              then array_to_string(w[1:k], ' ')
                              else array_to_string(w[k + 1:], ' ') end);
      place_k := name_key(place_raw);
      continue when length(name_k) < 3 or length(place_k) < 2;
      -- Whole words, in order: "upper norwood" -> \mupper\M.*\mnorwood\M.
      place_re := '\m' || array_to_string(array(
                    select x from unnest(regexp_split_to_array(lower(place_raw), '[^a-z0-9]+')) x
                    where x <> ''), '\M.*\m') || '\M';
      -- Postcode prefix, only when it could be one ("m17", "m17 8aa"): an
      -- un-indexable branch would stop the planner using the place index.
      place_pc := case when place_k ~ '[0-9]'
                       then format('r.postcode ilike %L',
                                   regexp_replace(btrim(place_raw), '[^a-zA-Z0-9]+', '%', 'g') || '%')
                       else 'false' end;
      split := split || format(
        $f$select r.id,
                  case when %3$s
                         or lower(coalesce(r.local_authority, '')) ~ %2$L
                         or lower(coalesce(r.address, '')) ~ %4$L
                       then 1 else 2 end
           from public.restaurants r
           where name_key(r.name) like %1$L
             and (%5$s or %3$s)
             and %6$s$f$,
        '%' || name_k || '%',
        place_re,
        place_pc,
        place_re || '\s*$',
        case when length(place_k) >= 3
             then format($f$lower(coalesce(r.address, '') || ' ' || coalesce(r.local_authority, '')) ~ %L$f$, place_re)
             else 'false' end,
        filters);
    end loop;
  end loop;

  if origin_lng is null or origin_lat is null then
    near := replace(array_to_string(whole, ' union all '), '@near@', 'true');
    far := 'select null::uuid, 0 where false';
  else
    near := replace(array_to_string(whole, ' union all '), '@near@',
                    'st_dwithin(r.geo, st_point($1, $2)::geography, 40000)');
    -- Runs only when nearby found too few: the count is a one-off check
    -- the planner evaluates before deciding to scan at all.
    far := replace(array_to_string(whole, ' union all '), '@near@',
                   'coalesce(not st_dwithin(r.geo, st_point($1, $2)::geography, 40000), true)'
                   || ' and (select count(*) from near) < $5');
  end if;

  return query execute format($sql$
    with near as (%s),
    far as (%s),
    hits as (
      select * from near union all select * from far
      %s
    ),
    best as (select h.id, min(h.rank) as rank from hits h group by h.id)
    select r.id, r.name, r.business_type, r.address, r.postcode,
           r.rating_value, r.rating_is_numeric, r.rating_date,
           case
             when $1 is null or $2 is null or r.geo is null then null
             else st_distance(r.geo, st_point($1, $2)::geography)
           end
    from best b
    join public.restaurants r on r.id = b.id
    order by
      b.rank asc,
      case
        when $1 is null or $2 is null or r.geo is null then null
        else r.geo <-> st_point($1, $2)::geography
      end asc nulls last,
      r.name asc
    limit $5
  $sql$, near, far,
    coalesce(' union all ' || array_to_string(split, ' union all '), ''))
  using origin_lng, origin_lat, types, rating_values, max_rows;
end;
$$;
