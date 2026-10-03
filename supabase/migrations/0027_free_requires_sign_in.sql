-- The free plan needs Sign in with Apple first (app 1.0.4+, on devices that
-- offer it), so deleting and reinstalling the app can't reset the monthly
-- allowance: the same Apple ID always comes back to the same account.
--
-- Switch it off without an app update:
--   update public.app_config set value = 'false' where key = 'free_requires_sign_in';
-- Builds before 1.0.4 don't read it.
insert into public.app_config (key, value)
values ('free_requires_sign_in', 'true')
on conflict (key) do nothing;
