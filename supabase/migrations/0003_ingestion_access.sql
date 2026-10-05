-- SkillPulse: ingestion runs and lineage, the function that reports what a
-- user can read, and constraints the first schema left out.
-- Safe to run more than once.

-- 1. Ingestion runs -----------------------------------------------------------
-- One row per file loaded: what came in, what was mapped, what was refused and why.

alter table public.data_sources drop constraint if exists data_sources_status_check;
alter table public.data_sources add constraint data_sources_status_check
  check (status in ('prototype_synthetic', 'uploaded', 'prototype_reference', 'planned'));
alter table public.data_sources drop constraint if exists data_sources_records_check;
alter table public.data_sources add constraint data_sources_records_check
  check (records_mapped is null or records_in is null or records_mapped <= records_in);

create table if not exists public.ingestion_runs (
  id                   bigint primary key,
  source_id            text        not null references public.data_sources (id),
  file_name            text        not null,
  loaded_at            timestamptz not null default now(),
  loaded_by            text,                      -- e-mail or 'command line'; null for the seed
  mode                 text        not null check (mode in ('merge', 'replace')),
  synthetic            boolean     not null default true,
  rows_read            integer     not null check (rows_read >= 0),
  rows_mapped          integer     not null check (rows_mapped >= 0 and rows_mapped <= rows_read),
  rows_rejected        integer     not null check (rows_rejected >= 0),
  rows_loosely_matched integer     not null default 0 check (rows_loosely_matched >= 0),
  rows_held            integer     not null default 0 check (rows_held >= 0),   -- loose matches left out for review
  loose_policy         text        not null default 'hold' check (loose_policy in ('hold', 'count')),
  value_read           bigint,                    -- count sources: total of the value column read
  value_mapped         bigint,                    --                and the part of it that was mapped
  period_min           text,
  period_max           text,
  rejects              jsonb       not null default '[]'::jsonb,
  reject_kinds         integer     not null default 0,
  loose_matches        jsonb       not null default '[]'::jsonb,
  loose_kinds          integer     not null default 0,
  check (value_mapped is null or value_read is null or value_mapped <= value_read)
);
create index if not exists ingestion_runs_source_idx on public.ingestion_runs (source_id, loaded_at desc);

-- Which run last wrote each demand signal of a row ({"jobPostings": 3, ...}),
-- and which run last wrote a training row.
alter table public.labour_demand     add column if not exists lineage jsonb not null default '{}'::jsonb;
alter table public.training_capacity add column if not exists run_id bigint references public.ingestion_runs (id);

-- When the derived tables were last computed, and from which data.
alter table public.dataset_meta add column if not exists derived_at timestamptz;

-- 2. Constraints ----------------------------------------------------------------

-- A fact row's sector must be its trade's sector.
do $$
declare t text;
begin
  -- Drop the dependent keys first so the script can be run again.
  foreach t in array array['training_capacity', 'labour_demand', 'demand_forecasts', 'supply_forecasts', 'gap_analysis'] loop
    execute format('alter table public.%I drop constraint if exists %I', t, t || '_trade_sector_fkey');
  end loop;
  alter table public.trades drop constraint if exists trades_id_sector_key;
  alter table public.trades add constraint trades_id_sector_key unique (id, sector_id);
  foreach t in array array['training_capacity', 'labour_demand', 'demand_forecasts', 'supply_forecasts', 'gap_analysis'] loop
    execute format('alter table public.%I add constraint %I foreign key (trade_id, sector_id) references public.trades (id, sector_id)', t, t || '_trade_sector_fkey');
  end loop;
end $$;

alter table public.training_capacity drop constraint if exists training_capacity_outcomes_check;
alter table public.training_capacity add constraint training_capacity_outcomes_check check (
  year between 2000 and 2100
  and (completed is null or (enrolled is not null and completed <= enrolled))
  and (placed is null or (completed is not null and placed <= completed))
);
alter table public.demand_forecasts drop constraint if exists demand_forecasts_bounds_check;
alter table public.demand_forecasts add constraint demand_forecasts_bounds_check check (
  (confidence_score is null or confidence_score between 0 and 100)
  and (lower_bound is null or upper_bound is null or lower_bound <= upper_bound)
  and method in ('full', 'limited_history', 'baseline_estimate', 'insufficient_data')
);
alter table public.dataset_meta drop constraint if exists dataset_meta_period_check;
alter table public.dataset_meta add constraint dataset_meta_period_check check (extract(day from as_of_period) = 1);

-- 3. What can this user read? -------------------------------------------------
-- SECURITY INVOKER: it runs with the caller's rights, so the row level security
-- policies on the fact tables decide the answer. The application calls it as
-- the signed-in user before answering any request.

create or replace function public.visible_district_ids()
returns setof text language sql stable security invoker set search_path = public as $$
  select d.id
  from public.districts d
  where exists (select 1 from public.labour_demand l where l.district_id = d.id)
     or exists (select 1 from public.training_capacity c where c.district_id = d.id)
$$;
revoke all on function public.visible_district_ids() from public, anon;
grant execute on function public.visible_district_ids() to authenticated;

-- 4. Row level security for ingestion runs ------------------------------------

-- A run's reject and loose-match lists quote text from the file that was loaded
-- (job titles, place names, possibly employer names), so the table is readable
-- by administrators only. The application shows other roles the counts.
alter table public.ingestion_runs enable row level security;
drop policy if exists ingestion_runs_read on public.ingestion_runs;
create policy ingestion_runs_read on public.ingestion_runs for select to authenticated
  using (public.current_app_role() = 'admin');
drop policy if exists ingestion_runs_admin_write on public.ingestion_runs;
create policy ingestion_runs_admin_write on public.ingestion_runs for all to authenticated
  using (public.current_app_role() = 'admin') with check (public.current_app_role() = 'admin');

revoke all on public.ingestion_runs from anon;
grant select, insert, update, delete on public.ingestion_runs to authenticated;
