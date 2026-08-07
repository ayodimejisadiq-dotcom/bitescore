-- Stored coordinates alongside the PostGIS geography.
--
-- Every map query recomputed st_x(geo::geometry) / st_y(geo::geometry) for
-- each row it touched. Measured on a UK-wide viewport that is ~250k casts:
-- 4.8s total, against 385ms for the identical scan and bbox filter without
-- them. Generated STORED columns pay that cost once, at write time, and
-- Postgres maintains them on insert and update — so ingest_upsert needs no
-- change and they can never drift from `geo`.
--
-- Named geo_lng/geo_lat rather than lng/lat deliberately: restaurants_in_bounds
-- declares OUT parameters called lng and lat, and matching column names would
-- shadow them inside the function body.
alter table public.restaurants
  add column if not exists geo_lng double precision
    generated always as (st_x(geo::geometry)) stored,
  add column if not exists geo_lat double precision
    generated always as (st_y(geo::geometry)) stored;

-- A plain btree beats the GIST geography index for axis-aligned viewport
-- filtering, and lets the cluster aggregate below use an index scan: a
-- city-sized viewport measured 10ms.
create index if not exists restaurants_geo_lnglat_idx
  on public.restaurants (geo_lng, geo_lat);

-- The planner has no statistics for freshly added columns, and without them it
-- estimated 8 rows where 250,603 matched — choosing an index scan with a
-- disk-based sort that took 10.9s. Analyze immediately so the first real query
-- gets a sane plan.
analyze public.restaurants;
