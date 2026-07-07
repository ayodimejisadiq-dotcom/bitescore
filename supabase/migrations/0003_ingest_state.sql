-- Tracks the nightly FSA ingestion so a run can be spread across several
-- serverless invocations (Vercel function time limits) and resume cleanly.

create table if not exists public.ingest_state (
  id                 int primary key default 1 check (id = 1),  -- singleton row
  cursor             int not null default 0,                    -- next authority index to process
  authority_count    int not null default 0,
  pass_started_at    timestamptz,
  last_run_at        timestamptz,
  last_completed_at  timestamptz,                               -- when a full pass last finished
  establishments_seen int not null default 0
);

insert into public.ingest_state (id) values (1)
  on conflict (id) do nothing;

alter table public.ingest_state enable row level security;
-- No policies: service role only.
