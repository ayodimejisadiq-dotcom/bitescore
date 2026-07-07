-- One review per user per restaurant. Writing a new review for a place
-- you've already reviewed edits it in place (upsert on this constraint)
-- instead of creating a second row.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'reviews_user_restaurant_unique'
  ) then
    alter table public.reviews
      add constraint reviews_user_restaurant_unique unique (user_id, restaurant_id);
  end if;
end $$;
