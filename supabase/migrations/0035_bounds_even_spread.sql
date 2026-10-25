-- Spread map pins across the whole viewport instead of one edge of it.
--
-- The old query was a bare `limit max_rows` over the (geo_lng, geo_lat) btree,
-- which returns rows in longitude order: the westernmost venues first. In
-- central London at street zoom ~3,000 venues are in view and the 150 returned
-- all sat in a ~75m strip down the left edge of a ~2km screen. Panning showed
-- nothing new across most of the map until you dragged that edge into view.
--
-- Now the viewport is cut into a grid of 8–16 cells per side and each cell
-- contributes up to 3 venues, picked by an index lookup per cell so wide views
-- don't read every venue in range (that was 6.5s for greater London). The
-- lookup uses the GIST index on geo: the (geo_lng, geo_lat) btree can only
-- narrow on longitude, so each cell scanned a north-to-south strip of the
-- country and the query took 1–4s. With GIST it's 10–150ms warm. Cells
-- are aligned to a fixed world grid, sized in powers of two, so a pan keeps
-- the same cells — and the same pins — for the ground that stays on screen.
-- When there are more candidates than max_rows, every cell's first pick comes
-- before any cell's second, and cells are dropped in a stable hashed order
-- rather than from one side.
--
-- Signature and result columns are unchanged, so the client needs no update.
create or replace function public.restaurants_in_bounds(
  min_lng double precision,
  min_lat double precision,
  max_lng double precision,
  max_lat double precision,
  types text[] default null,
  max_rows int default 500,
  rating_values text[] default null
)
returns table (
  id uuid,
  name text,
  business_type text,
  rating_value text,
  rating_is_numeric boolean,
  lng double precision,
  lat double precision
)
language sql
stable
as $$
  with g as (
    select power(2::float8, floor(ln(greatest(max_lng - min_lng, 1e-6) / 8) / ln(2))) as cx,
           power(2::float8, floor(ln(greatest(max_lat - min_lat, 1e-6) / 8) / ln(2))) as cy
  ),
  cells as (
    select ix, iy,
           greatest(ix * g.cx, min_lng) as x0, least((ix + 1) * g.cx, max_lng) as x1,
           greatest(iy * g.cy, min_lat) as y0, least((iy + 1) * g.cy, max_lat) as y1
    from g,
         generate_series(floor(min_lng / g.cx)::int, floor(max_lng / g.cx)::int) ix,
         generate_series(floor(min_lat / g.cy)::int, floor(max_lat / g.cy)::int) iy
  ),
  picked as (
    select p.*, c.ix, c.iy, row_number() over (partition by c.ix, c.iy order by p.geo_lng, p.geo_lat, p.id) as rn
    from cells c
    cross join lateral (
      select r.id, r.name, r.business_type, r.rating_value, r.rating_is_numeric,
             r.geo_lng, r.geo_lat
      from public.restaurants r
      -- Half-open on the grid lines so a venue on one belongs to one cell;
      -- closed on the viewport's outer edge, as before.
      where r.geo && st_makeenvelope(c.x0, c.y0, c.x1, c.y1, 4326)::geography
        and r.geo_lng >= c.x0
        and (r.geo_lng < c.x1 or (c.x1 = max_lng and r.geo_lng = max_lng))
        and r.geo_lat >= c.y0
        and (r.geo_lat < c.y1 or (c.y1 = max_lat and r.geo_lat = max_lat))
        and (types is null or r.business_type = any(types))
        and (rating_values is null or r.rating_value = any(rating_values))
      limit 3
    ) p
  )
  select id, name, business_type, rating_value, rating_is_numeric, geo_lng, geo_lat
  from picked
  order by rn, hashtext(ix || ',' || iy)
  limit max_rows;
$$;
