-- Functions that bypass RLS but were callable by anyone holding the app's
-- public (anon) key, found by the Supabase security advisor.
--
-- ingest_upsert: the nightly FSA import. Security definer and executable by
-- anon/authenticated, so anyone could POST /rest/v1/rpc/ingest_upsert and
-- overwrite restaurant ratings. Only the server (service role) calls it.
--
-- list_mosaic / list_people: internal helpers for my_lists(), list_detail()
-- and friends, which check access themselves. Called directly they would
-- return any list's scores and members given its id, private lists included.
-- The functions that use them run as their owner, so revoking the public
-- grant doesn't affect them.
--
-- profile_cards: added in 0021 but never used by the app.

revoke execute on function public.ingest_upsert(jsonb) from public, anon, authenticated;
grant execute on function public.ingest_upsert(jsonb) to service_role;

revoke execute on function public.list_mosaic(uuid) from public, anon, authenticated;
revoke execute on function public.list_people(uuid) from public, anon, authenticated;

drop function if exists public.profile_cards(uuid[]);
