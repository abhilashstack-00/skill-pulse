-- Roles, account approval and row level security.
-- Users live in Supabase Auth (auth.users); their role and scope live here.
-- Safe to run more than once, and on its own: nothing here is looser than what
-- a later migration sets, so re-running this file alone cannot open anything up.

create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text,
  role        text not null default 'employer'
              check (role in ('admin', 'national_planner', 'state_planner', 'district_planner', 'employer')),
  state_id    text references public.states (id),      -- required for state_planner
  district_id text references public.districts (id),   -- required for district_planner
  approved    boolean not null default false,          -- nothing is readable until an administrator sets this
  created_at  timestamptz not null default now(),
  check (role <> 'state_planner' or state_id is not null),
  check (role <> 'district_planner' or district_id is not null)
);

-- A database created before approval existed gets the column, with every account unapproved.
-- Approving is always an explicit act by an administrator; no migration does it.
alter table public.profiles add column if not exists approved boolean not null default false;

-- Helpers. SECURITY DEFINER so policies can read profiles without recursion.
-- An account that is not approved has no role as far as any policy is concerned.

create or replace function public.current_app_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and approved
$$;

create or replace function public.can_see_district(target_district text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.profiles p
    join public.districts d on d.id = target_district
    where p.id = auth.uid()
      and p.approved
      and (
        p.role in ('admin', 'national_planner', 'employer')
        or (p.role = 'state_planner' and d.state_id = p.state_id)
        or (p.role = 'district_planner' and p.district_id = d.id)
      )
  )
$$;

-- Reference tables: any approved user may read; only admins may write.
do $$
declare t text;
begin
  foreach t in array array['dataset_meta', 'states', 'districts', 'sectors', 'trades', 'data_sources'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.current_app_role() is not null)', t || '_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin_write', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.current_app_role() = ''admin'') with check (public.current_app_role() = ''admin'')', t || '_admin_write', t);
  end loop;
end $$;

-- Fact and derived tables: any approved user, limited to the districts in their scope.
-- (What each role may do with them — planner actions, export — is enforced by the API.)
do $$
declare t text;
begin
  foreach t in array array['labour_demand', 'training_centres', 'training_capacity', 'demand_forecasts', 'supply_forecasts', 'gap_analysis'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.can_see_district(district_id))', t || '_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin_write', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.current_app_role() = ''admin'') with check (public.current_app_role() = ''admin'')', t || '_admin_write', t);
  end loop;
end $$;

-- Profiles: a user reads their own row; admins read and manage all rows.
alter table public.profiles enable row level security;
drop policy if exists profiles_self_read on public.profiles;
create policy profiles_self_read on public.profiles for select to authenticated
  using (id = auth.uid() or public.current_app_role() = 'admin');
drop policy if exists profiles_admin_write on public.profiles;
create policy profiles_admin_write on public.profiles for all to authenticated
  using (public.current_app_role() = 'admin') with check (public.current_app_role() = 'admin');

-- New sign-ups get the least-privileged role, unapproved, until an admin changes it.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.email))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Table privileges. RLS above decides which rows; anonymous visitors get nothing.
revoke all on all tables in schema public from anon;
grant select on all tables in schema public to authenticated;
grant insert, update, delete on all tables in schema public to authenticated;
