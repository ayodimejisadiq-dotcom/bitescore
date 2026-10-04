-- Where a typed postcode is, so search can move the map there.
--
-- Search used to treat a postcode as text: it listed restaurants registered
-- at that postcode and never moved the map. A full postcode with no food
-- business on it ("WF17 5BB") found nothing at all, and neither did one
-- typed without its space ("WF175BB").
--
-- This locates it from our own data: the centre of the restaurants at the
-- full postcode, else in its sector ("WF17 5", a few streets), else in its
-- district ("WF17"). No third-party geocoder, so searches stay private.
-- Accepts any spacing and case; returns no row for something that isn't a
-- postcode or that no restaurant is near.
create or replace function public.postcode_point(q text)
returns table (
  label text,            -- what was typed, tidied: 'wf175bb' -> 'WF17 5BB'
  level text,            -- how precisely it was found: 'postcode' | 'sector' | 'district'
  lat double precision,
  lng double precision,
  area text              -- the council most of those places are in
)
language plpgsql stable
set search_path = public
as $$
declare
  s        text := upper(regexp_replace(coalesce(q, ''), '\s+', '', 'g'));
  m        text[];
  outward  text;
  inward   text;
  pattern  text;
  lvl      text;
begin
  -- Outward code (WF17, M1, SW1A, EC1V), then an optional partial or whole
  -- inward code (5, 5B, 5BB). Backtracking splits "WF15AB" as WF1 + 5AB.
  m := regexp_match(s, '^([A-Z]{1,2}[0-9][A-Z0-9]?)([0-9][A-Z]{0,2})?$');
  if m is null then return; end if;
  outward := m[1];
  inward := coalesce(m[2], '');

  foreach lvl in array array['postcode', 'sector', 'district'] loop
    pattern := case lvl
      when 'postcode' then case when length(inward) = 3 then outward || ' ' || inward end
      when 'sector' then case when length(inward) >= 1 then outward || ' ' || left(inward, 1) || '%' end
      else outward || ' %'
    end;
    continue when pattern is null;

    return query
      select outward || case when inward <> '' then ' ' || inward else '' end,
             lvl,
             avg(r.geo_lat),
             avg(r.geo_lng),
             mode() within group (order by r.local_authority)
      from public.restaurants r
      where r.postcode ilike pattern
        and r.geo_lat is not null and r.geo_lng is not null
      having count(*) > 0;
    if found then return; end if;
  end loop;
end;
$$;

grant execute on function public.postcode_point(text) to anon, authenticated;
