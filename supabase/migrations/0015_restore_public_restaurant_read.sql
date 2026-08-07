-- Restores public read on `restaurants`, matching migration 0001.
--
-- The live database had drifted: its restaurants_read policy read
--   using ( has_active_entitlement() )
-- gating every row behind an entitlements row for auth.uid(). That predicate
-- exists only in the database — it appears nowhere in this repo — so it was
-- applied out of band and silently diverged from 0001's `using (true)`.
--
-- The effect was severe and invisible: RLS filters rather than errors, so any
-- client without an active entitlement (29 of 34 users at the time) received
-- zero restaurants with no error at all. The map rendered empty, search
-- returned nothing, and only the server kept working because it uses the
-- service-role key, which bypasses RLS entirely.
--
-- Enforcing the paywall here was also the wrong layer. FSA hygiene ratings are
-- open government data published under the Open Government Licence, and the
-- app already gates entry on launch in components/PaywallGate.tsx — which is
-- where the entitlement check belongs, since it can explain itself to the user
-- instead of returning an empty result set.
--
-- has_active_entitlement() is deliberately left in place: it is still useful
-- for gating genuinely paid, non-public resources, and dropping it could break
-- other policies that reference it.
drop policy if exists restaurants_read on public.restaurants;
create policy restaurants_read on public.restaurants
  for select using (true);
