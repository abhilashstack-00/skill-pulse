-- SkillPulse schema (Supabase / PostgreSQL)
-- Stored tables hold source data; the three derived tables at the end are
-- rewritten by the pipeline (`pnpm pipeline`) from the intelligence layer.

create table if not exists public.dataset_meta (
  id                    boolean primary key default true check (id),  -- single row
  label                 text    not null,
  synthetic             boolean not null default true,
  as_of_period          date    not null,   -- last month covered by demand data
  updated_at            date    not null,
  current_training_year integer not null
);

create table if not exists public.states (
  id      text primary key,
  name    text not null,
  name_hi text,
  code    text not null unique
);

create table if not exists public.districts (
  id       text primary key,
  state_id text not null references public.states (id),
  name     text not null,
  name_hi  text,
  code     text not null unique
);

create table if not exists public.sectors (
  id      text primary key,
  name    text not null,
  name_hi text,
  code    text not null unique
);

create table if not exists public.trades (
  id         text primary key,
  sector_id  text not null references public.sectors (id),
  name       text not null,
  name_hi    text,
  nco_code   text,
  nsqf_level integer check (nsqf_level between 1 and 10)
);

create table if not exists public.training_centres (
  id          text primary key,
  name        text not null,
  district_id text not null references public.districts (id),
  sector_id   text not null references public.sectors (id),
  status      text not null check (status in ('active', 'inactive')),
  capacity    integer not null check (capacity >= 0)
);

create table if not exists public.training_capacity (
  id              bigint generated always as identity primary key,
  district_id     text    not null references public.districts (id),
  sector_id       text    not null references public.sectors (id),
  trade_id        text    not null references public.trades (id),
  year            integer not null,                       -- start year of the training cycle
  allocated_seats integer not null check (allocated_seats >= 0),
  enrolled        integer check (enrolled >= 0),          -- null = not yet known
  completed       integer check (completed >= 0),
  placed          integer check (placed >= 0),
  unique (district_id, trade_id, year)
);

create table if not exists public.labour_demand (
  id                       bigint generated always as identity primary key,
  district_id              text not null references public.districts (id),
  sector_id                text not null references public.sectors (id),
  trade_id                 text not null references public.trades (id),
  period                   date not null check (extract(day from period) = 1),  -- month
  job_postings             integer check (job_postings >= 0),                    -- count
  hiring_signal            numeric(5, 1) check (hiring_signal between 0 and 100),
  employment_registrations integer check (employment_registrations >= 0),        -- count
  industry_demand_signal   numeric(5, 1) check (industry_demand_signal between 0 and 100),
  source                   text not null,
  unique (district_id, trade_id, period)
);

create table if not exists public.data_sources (
  id             text primary key,
  name           text not null,
  description    text not null,
  source_type    text not null check (source_type in ('demand', 'supply', 'reference')),
  last_updated   date,
  status         text not null check (status in ('prototype_synthetic', 'prototype_reference', 'planned')),
  coverage       text not null,
  granularity    text not null,
  feeds          text not null,
  records_in     integer,
  records_mapped integer
);

-- Derived tables -------------------------------------------------------------

create table if not exists public.demand_forecasts (
  id               bigint generated always as identity primary key,
  district_id      text not null references public.districts (id),
  sector_id        text not null references public.sectors (id),
  trade_id         text not null references public.trades (id),
  horizon          text not null check (horizon in ('3M', '6M', '12M')),
  forecast_period  date not null,           -- last month of the forecast window
  predicted_demand integer,                 -- null = insufficient data
  lower_bound      integer,
  upper_bound      integer,
  method           text not null,
  confidence_score integer,
  model_version    text not null,
  created_at       timestamptz not null default now(),
  unique (district_id, trade_id, horizon, model_version)
);

create table if not exists public.supply_forecasts (
  id               bigint generated always as identity primary key,
  district_id      text not null references public.districts (id),
  sector_id        text not null references public.sectors (id),
  trade_id         text not null references public.trades (id),
  horizon          text not null check (horizon in ('3M', '6M', '12M')),
  forecast_period  date not null,
  predicted_supply integer,
  method           text not null,
  model_version    text not null,
  created_at       timestamptz not null default now(),
  unique (district_id, trade_id, horizon, model_version)
);

create table if not exists public.gap_analysis (
  id             bigint generated always as identity primary key,
  district_id    text not null references public.districts (id),
  sector_id      text not null references public.sectors (id),
  trade_id       text not null references public.trades (id),
  horizon        text not null check (horizon in ('current', '3M', '6M', '12M')),
  period         date not null,             -- last month the row refers to
  demand         integer,
  supply         integer,
  gap            integer,
  gap_percentage numeric(8, 2),
  status         text not null check (status in ('severe_shortage', 'shortage', 'balanced', 'oversupply', 'severe_oversupply', 'insufficient_data')),
  priority_score numeric(5, 1),
  created_at     timestamptz not null default now(),
  unique (district_id, trade_id, horizon)
);

-- Indexes on the columns every query filters by ---------------------------------

create index if not exists districts_state_idx          on public.districts (state_id);
create index if not exists trades_sector_idx            on public.trades (sector_id);
create index if not exists training_centres_district_idx on public.training_centres (district_id, sector_id);
create index if not exists training_capacity_trade_idx  on public.training_capacity (trade_id, year);
create index if not exists training_capacity_sector_idx on public.training_capacity (sector_id);
create index if not exists labour_demand_period_idx     on public.labour_demand (period);
create index if not exists labour_demand_trade_idx      on public.labour_demand (trade_id, period);
create index if not exists labour_demand_sector_idx     on public.labour_demand (sector_id, period);
create index if not exists demand_forecasts_trade_idx   on public.demand_forecasts (trade_id, horizon);
create index if not exists supply_forecasts_trade_idx   on public.supply_forecasts (trade_id, horizon);
create index if not exists gap_analysis_trade_idx       on public.gap_analysis (trade_id, horizon);
create index if not exists gap_analysis_sector_idx      on public.gap_analysis (sector_id, horizon);
create index if not exists gap_analysis_status_idx      on public.gap_analysis (horizon, status);
