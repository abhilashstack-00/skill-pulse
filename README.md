# SkillPulse

Labour-market intelligence and skill demand–supply forecasting prototype for SIH problem
statement 26246 (Ministry of Skill Development and Entrepreneurship).

**All data in this repository is synthetic pilot data.** No government or commercial
source is connected. The interface, the API and every export say so.

## Run it

Requires Node 22+ and pnpm.

```bash
pnpm install
pnpm dev            # http://localhost:3000
```

With no configuration the app reads the bundled pilot dataset and shows a **demo role**
switch in the sidebar instead of a sign-in page.

```bash
pnpm typecheck
pnpm test                          # 239 tests; 8 more run when TEST_DATABASE_URL is set
pnpm build && DEMO_MODE=on pnpm start
```

A production build refuses to serve data without sign-in unless `DEMO_MODE=on` is set, so an
open demo is always a deliberate choice. Demo mode can read but not change stored data
unless `DEMO_WRITES=on` is also set (for a throw-away database only).

## Architecture

```
Screens (components/pages)            English and Hindi
      │  typed fetchers (lib/client/api.ts)
      ▼
API routes (app/api/**)               sign-in → approval → role → scope from the database → filters
      │
      ▼
Views and export (lib/server)         select and shape engine results; nothing is recalculated
      │
      ▼
Intelligence layer (lib/intelligence) indices, forecasts with calibrated intervals, gap,
      │                               priority, warnings, recommendations, group summaries
      ▼
Repository (lib/repository)           PostgreSQL · Supabase REST · bundled file
      ▲
Ingestion (lib/ingest)                source file → matching → stored rows + a recorded load
```

All weights and thresholds are in `lib/config/methodology.ts`. `docs/METHODOLOGY.md` has
every formula and, in section 12, what the method does not do.

### What reads what

The application computes from the **fact tables** (`labour_demand`, `training_capacity`) on
every snapshot. It loads them whole into memory; there is no SQL aggregation, which is fine
for a pilot of a few thousand rows and would need changing for national scale.

`demand_forecasts`, `supply_forecasts` and `gap_analysis` are a **copy of the results for SQL
and BI clients**. The application writes them (after every data load, and with
`pnpm pipeline`) and never reads them. `dataset_meta.derived_at` says when they were written.

`training_centres` is reference data shown by `/api/district/:id`; no calculation uses it.

## Load data

Every file goes through the same ingestion code and is recorded as a load.

- **In the app** (signed-in administrator, database mode): Data Sources → choose a source →
  "Check file" shows what would be mapped, held for review and rejected, and how much of the
  file's volume would reach the dataset → "Load into the database". Results on every screen
  change without a restart. Files up to 5 MB and 100,000 rows.
- **Command line**: `pnpm ingest --source job-portals --file path.csv [--replace] [--real] [--count-loose] [--month-first] [--dry-run]`.
  Writes to the database when `DATABASE_URL` is set, otherwise to the bundled file.

Rows matched by a looser rule (a close spelling, a known title with a qualifier) are **held
for review by default** and only counted if you say so. Months in the future are rejected.
**Merge replaces a month, it does not add to it**: loading the same file twice changes
nothing, and a big file is split by month, never within one. "Check file" says how many
stored values would be replaced.
- **Rebuild the pilot**: `pnpm data:build` regenerates the synthetic extracts and reloads them.

Sources and their columns are in `lib/ingest/sources.ts`. Rows that cannot be mapped are
rejected and listed with the reason and the volume they carried. If under 95% of a demand
source's volume was mapped, the Overview shows a warning and every "reduce capacity" style
recommendation says to check the demand data first.

To accept a title or place name that was rejected, add it to
`lib/intelligence/normalization/mappings.ts` and load the file again. There is no screen for this.

## Connect Supabase

1. Create a project. Copy `.env.example` to `.env.local` and fill it in. For the database
   connection either set `DATABASE_CA_CERT` (certificate from the Supabase dashboard) or,
   for a quick demo only, `DATABASE_SSL=no-verify`.
2. `pnpm db:setup` — all migrations in one transaction, and the pilot seed if the database is
   empty. It never removes loaded data; `pnpm db:setup --reset` replaces everything with the seed.
   Set the Supabase variables **before** `pnpm build`: the two `NEXT_PUBLIC_` ones are compiled in.
3. `pnpm pipeline`
4. `DEMO_USER_PASSWORD='…' pnpm demo:users` — one approved user per role.
5. `DEMO_USER_PASSWORD='…' pnpm verify:supabase` — signs in as each user and checks what
   they can read and write.
6. In Supabase → Authentication, turn off open sign-ups unless you want them. A user who
   signs up on their own sees nothing until an administrator approves them. There is no
   screen for that yet; in the Supabase SQL editor:
   `update public.profiles set role = 'state_planner', state_id = 'TG', approved = true where id = '<user id>';`

| Configured | The app reads from |
|---|---|
| `DATABASE_URL` | PostgreSQL directly |
| Supabase URL + service-role key, no `DATABASE_URL` | Supabase REST API |
| neither | bundled pilot file (read-only) |

### What has and has not been verified

No Supabase project was reachable while this was built.

| Part | Status |
|---|---|
| Schema, seed, pipeline, ingestion, database-backed app | Run on local PostgreSQL 16. `tests/db.integration.test.ts` passes. |
| Row level security policies | Checked on local PostgreSQL for approved and unapproved users of every role with `supabase/tests/rls-check.sql`, using a stand-in for Supabase's `auth` schema. |
| Scope taken from the database per user (direct connection) | Run on local PostgreSQL through the same stand-in. |
| Loading a file through the app into the database | Run on local PostgreSQL in demo mode with `DEMO_WRITES=on`: results, derived tables and load history changed without a restart. Not run as a signed-in administrator. |
| Sign-in gate | With placeholder settings: signed-out pages redirect to `/login`, API routes answer 401. |
| Actual sign-in, session refresh, sign-out | Written against the documented `@supabase/ssr` API. **Never run.** |
| Supabase REST reader; scope from the database through an RPC as the user | Unit-tested with fake clients (`tests/server.test.ts`, `tests/db-scope.test.ts`). **Never run against Supabase.** |
| `pnpm demo:users`, `pnpm verify:supabase` | **Never run.** `verify:supabase` exists to close exactly this gap: run it first. |

Local verification:

```bash
createdb skillpulse_test
export DATABASE_URL=postgres://localhost/skillpulse_test
pnpm db:setup --local-shim && pnpm pipeline && pnpm db:check-rls
TEST_DATABASE_URL=$DATABASE_URL pnpm test        # this database is re-seeded by the tests
```

## Access control

| Role | Sees | Recommendations | Load data |
|---|---|---|---|
| admin | everything | yes | yes |
| national_planner | everything | yes | no |
| state_planner | their state | yes | no |
| district_planner | their district | yes | no |
| employer | everything (market view) | no | no |
| any role, not approved | nothing | no | no |

Anyone can export what they can see; the recommendations export follows the recommendations
rule.

How it is enforced:

1. **In the API**, for every route, by one wrapper (`lib/server/http.ts`): sign-in, approval,
   role, scope. A planner with no area assigned and an unknown role both get nothing.
2. **A second check against the database, for signed-in users.** The application computes
   from one shared snapshot using a connection that bypasses row level security, so the
   policies cannot filter those reads. Before answering, it asks the database **as that
   user** which districts the policies let them read (`visible_district_ids()`, in a
   transaction switched to the `authenticated` role, or an RPC with the user's own token) and
   never returns anything outside that set. If application code and the policies disagree,
   the narrower one wins. What this is and is not: both checks read the same `profiles` row,
   so this catches a bug in the application's scope code or a policy that is tighter than
   the code; it does not protect against a wrong role in that row. The answer is cached per
   user for 60 seconds.
3. **By row level security directly**, for anyone who queries the Supabase API with their own
   token instead of going through this app.

`tests/routes.test.ts` calls every route as every role and searches each response for any
district or state outside that role's area.

Things every approved role receives regardless of area, because they describe the pilot as a
whole and not a place: the scaling references on the Methodology screen (95th-percentile
postings, registrations and seats), the backtest table, the data-quality figures and the
number of rows in each load. Who loaded a file, its name, and the rejected or loosely matched
values (which quote text from the file) are for administrators; planners see the file name;
employers see counts only. Employers see warnings but not the suggested action on them.

What this is not: in **demo mode** there are no users, so only point 1 applies and anyone can
pick any role. Demo mode is for demonstrations.

Other limits: rate limiting is per server instance, in memory, first by client address and
then by user. The address comes from `X-Forwarded-For`, which only means something behind a
proxy that sets it; without one, a client can send any value and all clients without the
header share one allowance. It slows a runaway script; it is not a defence. The snapshot is
cached in memory for `SNAPSHOT_TTL_SECONDS` (default 300). The content security policy covers
framing, form targets and plugins only; it does not restrict scripts.

## API

All routes return `{ data, meta }`; `meta` carries the data label, the synthetic flag, the
as-of month and the methodology version. Filters: `stateId`, `districtId`, `sectorId`,
`tradeId`, `status`, `horizon` (`current`, `3M`, `6M`, `12M`).

Used by the screens:

```
GET /api/meta                 GET /api/gaps              GET /api/trade/:id
GET /api/dashboard/summary    GET /api/forecasts         GET /api/evidence?districtId&tradeId
GET /api/drilldown            GET /api/alerts            GET /api/methodology
GET /api/recommendations      GET /api/sources           GET|POST /api/ingest
GET /api/export?dataset=gaps|forecasts|priority|alerts|recommendations|demand|supply&format=csv|json
```

For other systems only (no screen calls them): `/api/demand`, `/api/supply`, `/api/priority`,
`/api/states`, `/api/districts`, `/api/sectors`, `/api/trades`, `/api/district/:id`.

## Demonstration path

Market Explorer → Telangana → Warangal → Renewable Energy → Solar Technician → View Evidence
→ Data.

The pair has fast-rising demand against flat seats. It is already a shortage at the current
rate, so the engine classifies the 12-month view a severe shortage, warns that "the shortage
is forecast to deepen within 6 months" and recommends increasing capacity, **marked
tentative** because the low end of the forecast interval would be classified balanced. **The figures are whatever the engine computes from the stored rows;
none is targeted or typed in.** At the time of writing: 440 seats, forecast demand 690
(437 to 942), gap +250 (+56.8%), confidence low (27) because the forecast leans on a steep
trend; the low end of the interval is just under the seats available, and the 12-month
interval is the one that could not be checked forward in time (methodology §8). For a pair
whose shortage holds across its whole interval, open Nagpur → Manufacturing → CNC Operator.
The Data tab shows the 24 stored monthly rows, which three set the baseline, the arithmetic,
and which file load each value came from.

A browser check of this path and of role scoping is in `scripts/e2e.mjs` (`pnpm e2e`; needs
Playwright, see the top of that file).

## Known limits

- Synthetic data only. Backtest figures describe the method's consistency, not real accuracy.
- Supply is allocated seats; demand adds two sources without de-duplication. Section 12 of
  the methodology.
- The model's own interval is two to three times too narrow and is widened by a factor
  measured in the backtest. Checked forward in time for 3 and 6 months; **for 12 months, the
  horizon every recommendation uses, the history is too short to check it at all.**
- The pilot's own data is flagged for quality: 6% of portal volume is not mapped, and Mysuru
  in particular is degraded by an unmapped spelling. Left in on purpose; methodology §15.
- Group totals assume a minimum error correlation of 0.10 between pairs. An assumption.
- Most classifications do not hold across their own 12-month interval: 7 of 28 shortage pairs
  and 14 of 33 oversupply pairs do, and 40 of 61 recommendations are marked tentative. The
  screens say which. This is what a 24-month history supports, not a display problem.
- Matching was tested on wording written by the same author as the mapping tables, plus one
  hand-typed file. Real files are the real test. Mapping tables are code, not data.
- No screen for approving accounts or editing mappings.
- NCO-2015 codes and NSQF levels on pilot trades are indicative.
- Hindi text was written without native-speaker review. No accessibility audit has been done.
- "Review Action" in the Action Center is kept for the browser session only.
- The problem statement says "AI-enabled". The forecast is a transparent statistical method;
  there is no machine learning in it.
- No deployment configuration or CI is included.

Map outlines: [@svg-maps/india](https://github.com/VictorCazanave/svg-maps), CC BY 4.0. Only
the pilot states are drawn.
