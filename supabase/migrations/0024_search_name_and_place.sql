-- Search understands "venue + place": "nandos croydon", "nandos trafford",
-- "croydon nandos", "pizza express m1".
--
-- The query is tried whole as a name first (as before), then split at every
-- word boundary into a name part and a place part, both ways round. The place
-- part matches the address, the local authority ("Trafford") or a postcode
-- prefix. Whole-name matches rank above split ones; each group is nearest
-- first.
--
-- Names compare by name_key (lowercase, letters and digits only), so
-- "nandos" finds "Nando's" and "pizzaexpress" finds "Pizza Express". Before
-- this, "nandos" missed all ~350 Nando's because of the apostrophe.
--
-- The statement is built with the search words written in as literals: a
-- query planned without seeing them can't tell '%pizza%' can use the trigram
-- index, and falls back to computing name_key for all ~310k rows (4-5s).

-- Serves the name_key comparisons. Production built it with CREATE INDEX
-- CONCURRENTLY first, so this is a no-op there.
create index if not exists restaurants_name_key_trgm_idx
  on public.restaurants using gin (public.name_key(name) gin_trgm_ops);

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
  w       text[] := regexp_split_to_array(btrim(q, E' ,\t'), E'[\\s,]+');
  n       int := cardinality(w);
  parts   text[];
  name_k  text;
  place_k text;
  place_p text;
  k       int;
  pass    int;
begin
  if coalesce(w[1], '') = '' then return; end if;

  -- As before: a postcode prefix. A literal name match is only needed when
  -- the query's key is too short to search ("M&S"): otherwise the name_key
  -- match below already finds everything it would, and running both doubles
  -- the work for common words like "pizza".
  parts := array[format(
    'select r.id, 0 as rank from public.restaurants r where %s or r.postcode ilike %L',
    case when length(q) >= 3 and length(name_key(q)) < 3
         then format('r.name ilike %L', '%' || q || '%') else 'false' end,
    q || '%')];

  -- The whole query as a name (rank 0), then every split into name + place:
  -- "nandos croydon" (rank 1) and "croydon nandos" (rank 2).
  for pass in 0..2 loop
    for k in (case when pass = 0 then n else 1 end)..(case when pass = 0 then n else n - 1 end) loop
      if pass = 0 then
        name_k := name_key(q);
        place_k := null;
      elsif pass = 1 then
        name_k := name_key(array_to_string(w[1:k], ' '));
        place_p := array_to_string(w[k + 1:], ' ');
      else
        name_k := name_key(array_to_string(w[k + 1:], ' '));
        place_p := array_to_string(w[1:k], ' ');
      end if;
      if pass > 0 then
        place_k := name_key(place_p);
        -- "upper norwood" -> '%upper%norwood%'; punctuation and ilike's own
        -- wildcards become gaps too.
        place_p := '%' || regexp_replace(place_p, '[^a-zA-Z0-9]+', '%', 'g') || '%';
      end if;
      continue when length(name_k) < 3;
      parts := parts || format(
        'select r.id, %s from public.restaurants r where name_key(r.name) like %L and %s',
        pass, '%' || name_k || '%',
        case when place_k is null then 'true'
             else format('(%s or %s)',
               -- Plain ilike, not name_key: a vague name part ("the") can
               -- leave tens of thousands of rows to check.
               case when length(place_k) >= 3
                    then format('(r.address ilike %1$L or r.local_authority ilike %1$L)', place_p)
                    else 'false' end,
               case when length(place_k) >= 2
                    then format('replace(r.postcode, %L, %L) ilike %L', ' ', '', place_k || '%')
                    else 'false' end)
        end);
    end loop;
  end loop;

  return query execute format($sql$
    with hits as (%s),
    best as (select h.id, min(h.rank) as rank from hits h group by h.id)
    select r.id, r.name, r.business_type, r.address, r.postcode,
           r.rating_value, r.rating_is_numeric, r.rating_date,
           case
             when $1 is null or $2 is null or r.geo is null then null
             else st_distance(r.geo, st_point($1, $2)::geography)
           end
    from best b
    join public.restaurants r on r.id = b.id
    where ($3 is null or r.business_type = any($3))
      and ($4 is null or r.rating_value = any($4))
    order by
      (b.rank > 0) asc,
      case
        when $1 is null or $2 is null or r.geo is null then null
        else r.geo <-> st_point($1, $2)::geography
      end asc nulls last,
      r.name asc
    limit $5
  $sql$, array_to_string(parts, ' union all '))
  using origin_lng, origin_lat, types, rating_values, max_rows;
end;
$$;
