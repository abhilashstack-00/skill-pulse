-- Row level security check for a LOCAL PostgreSQL database set up with
--   pnpm db:setup --local-shim
-- Run:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rls-check.sql
-- It creates five throw-away users, checks what each can read and write, raises an
-- exception on the first wrong answer, and rolls everything back.
begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'admin@example.test'),
  ('00000000-0000-0000-0000-000000000002', 'national@example.test'),
  ('00000000-0000-0000-0000-000000000003', 'telangana@example.test'),
  ('00000000-0000-0000-0000-000000000004', 'warangal@example.test'),
  ('00000000-0000-0000-0000-000000000005', 'employer@example.test');
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-000000000001';
update public.profiles set role = 'national_planner' where id = '00000000-0000-0000-0000-000000000002';
update public.profiles set role = 'state_planner', state_id = 'TG' where id = '00000000-0000-0000-0000-000000000003';
update public.profiles set role = 'district_planner', state_id = 'TG', district_id = 'warangal' where id = '00000000-0000-0000-0000-000000000004';

create temp table expected on commit drop as
select (select count(*) from public.labour_demand) as everything,
       (select count(*) from public.labour_demand d join public.districts x on x.id = d.district_id where x.state_id = 'TG') as telangana,
       (select count(*) from public.labour_demand where district_id = 'warangal') as warangal;
grant select on expected to authenticated;

create function pg_temp.expect(label text, actual bigint, wanted bigint) returns void language plpgsql as $$
begin
  if actual is distinct from wanted then raise exception 'FAIL %: got %, expected %', label, actual, wanted; end if;
  raise notice 'ok   %: %', label, actual;
end $$;

-- A new sign-up gets the least privileged role.
select pg_temp.expect('new user defaults to employer', (select count(*) from public.profiles where id = '00000000-0000-0000-0000-000000000005' and role = 'employer'), 1);

set local role authenticated;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
select pg_temp.expect('national planner reads every demand row', (select count(*) from public.labour_demand), (select everything from expected));

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);
select pg_temp.expect('state planner reads only Telangana', (select count(*) from public.labour_demand), (select telangana from expected));
select pg_temp.expect('state planner: training capacity outside Telangana', (select count(*) from public.training_capacity c join public.districts x on x.id = c.district_id where x.state_id <> 'TG'), 0);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
select pg_temp.expect('district planner reads only Warangal', (select count(*) from public.labour_demand), (select warangal from expected));
select pg_temp.expect('district planner: gap rows outside Warangal', (select count(*) from public.gap_analysis where district_id <> 'warangal'), 0);
select pg_temp.expect('district planner sees only their own profile', (select count(*) from public.profiles), 1);
select pg_temp.expect('reference tables stay readable', (select count(*) from public.trades), 14);

-- Writes: only an administrator may change data or grant roles.
do $$
declare changed bigint;
begin
  update public.labour_demand set job_postings = 0 where district_id = 'warangal';
  get diagnostics changed = row_count;
  if changed <> 0 then raise exception 'FAIL district planner changed % demand rows', changed; end if;
  update public.profiles set role = 'admin' where id = auth.uid();
  get diagnostics changed = row_count;
  if changed <> 0 then raise exception 'FAIL district planner promoted themselves'; end if;
  begin
    insert into public.states (id, name, name_hi, code) values ('ZZ', 'Nowhere', 'कहीं नहीं', 'ZZ');
    raise exception 'FAIL district planner inserted a state';
  exception when insufficient_privilege then null;
  end;
  raise notice 'ok   non-admin cannot write, insert or self-promote';
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
do $$
declare changed bigint;
begin
  update public.labour_demand set job_postings = job_postings where district_id = 'warangal';
  get diagnostics changed = row_count;
  if changed = 0 then raise exception 'FAIL admin could not update demand rows'; end if;
  raise notice 'ok   admin can write (% rows touched)', changed;
end $$;

reset role;

-- Signed-out visitors get nothing at all.
set local role anon;
do $$
begin
  begin
    perform count(*) from public.labour_demand;
    raise exception 'FAIL anon could read labour_demand';
  exception when insufficient_privilege then raise notice 'ok   anon is denied';
  end;
end $$;
reset role;

rollback;
