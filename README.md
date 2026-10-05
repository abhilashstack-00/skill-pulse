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

With no configuration the app reads the bundled pilot dataset (`data/pilot/dataset.json`)
and shows a **demo role** switch in the sidebar instead of a sign-in page. This is the
quickest way to demonstrate it and needs no network.

```bash
pnpm test           # 133 unit tests for the calculations, API views and access rules
pnpm typecheck
pnpm build && pnpm start
```

## Architecture

```
Screens (components/pages)            unchanged layout; English and Hindi
      │  typed fetchers (lib/client/api.ts)
      ▼
API routes (app/api/**)               auth → role → scope → validated filters → view
      │
      ▼
Views and export (lib/server)         shape engine results for each screen
      │
      ▼
Intelligence layer (lib/intelligence) normalisation, indices, forecasts, gap,
      │                               priority, warnings, recommendations
      ▼
Repository (lib/repository)           PostgreSQL · Supabase REST · bundled file
      │
      ▼
Supabase PostgreSQL (supabase/migrations) with row level security
```

Screens never calculate. Engines never touch HTTP or the database. All weights and
thresholds are in `lib/config/methodology.ts`. See `docs/METHODOLOGY.md` for every formula
and `docs/AUDIT.md` for the audit of the original frontend.

## Connect Supabase

1. Create a Supabase project. Copy `.env.example` to `.env.local` and fill in
   `DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and
   `SUPABASE_SERVICE_ROLE_KEY`.
2. Create the schema, the security policies and the pilot data:
   ```bash
   pnpm db:setup
   ```
   (or paste `supabase/migrations/0001_schema.sql`, `0002_auth_rls.sql` and
   `supabase/seed.sql` into the SQL editor, in that order).
3. Fill the derived tables (`demand_forecasts`, `supply_forecasts`, `gap_analysis`):
   ```bash
   pnpm pipeline
   ```
4. Create one user per role:
   ```bash
   DEMO_USER_PASSWORD='a-password-you-choose' pnpm demo:users
   ```
5. `pnpm dev`. Because the Supabase URL and anon key are set, every page now requires
   sign-in and the demo role switch disappears.

How the data source is chosen:

| Configured | The app reads from |
|---|---|
| `DATABASE_URL` | PostgreSQL directly |
| Supabase URL + service-role key, no `DATABASE_URL` | Supabase REST API |
| neither | bundled pilot file |

### What has and has not been verified

The development sandbox could not reach Supabase, so:

| Part | Status |
|---|---|
| Schema, seed, pipeline, database-backed app | Run and verified on a local PostgreSQL 16. Results identical to the bundled file. |
| Row level security policies | Verified on local PostgreSQL for all five roles with `supabase/tests/rls-check.sql`, using a stand-in for Supabase's `auth` schema (`supabase/local/auth-shim.sql`). |
| Sign-in gate | With placeholder Supabase settings: signed-out pages redirect to `/login`, API routes return 401, and the demo role switch is disabled. Verified. |
| Actual sign-in, session refresh (`proxy.ts`), sign-out | Written against the documented `@supabase/ssr` API. **Not run against a live project.** |
| Supabase REST reader | Unit-tested with a fake client. **Not run against a live project.** |
| `pnpm demo:users` | **Not run against a live project.** |

Expect to spend a little time on the last three rows the first time you connect a real project.

To repeat the local verification:

```bash
createdb skillpulse
export DATABASE_URL=postgres://postgres@127.0.0.1:5432/skillpulse
pnpm db:setup --local-shim && pnpm pipeline && pnpm db:check-rls
```

## Roles

| Role | Sees | Recommendations and export |
|---|---|---|
| admin | everything | yes |
| national_planner | everything | yes |
| state_planner | their state | yes |
| district_planner | their district | yes |
| employer | everything (market view) | no |

Scope is enforced twice: in the API (`lib/server/access.ts`, `filters.ts`) and in the
database by row level security. A request outside a user's scope returns 403. A planner
account with no state or district assigned sees nothing. New sign-ups start as `employer`
until an administrator changes `public.profiles`.

The demo role switch exists only while Supabase Auth is not configured. It is a
demonstration aid, not security: anyone using the app in that mode can pick any role.

## API

All routes return `{ data, meta }`, where `meta` carries the data label, the synthetic
flag, the as-of month and the methodology version. All accept `stateId`, `districtId`,
`sectorId`, `tradeId`, `status` and `horizon` (`current`, `3M`, `6M`, `12M`).

```
GET /api/dashboard/summary     GET /api/states        GET /api/trade/:id
GET /api/demand                GET /api/districts     GET /api/district/:id
GET /api/supply                GET /api/sectors       GET /api/drilldown
GET /api/gaps                  GET /api/trades        GET /api/methodology
GET /api/forecasts             GET /api/alerts        GET /api/sources
GET /api/priority              GET /api/recommendations
GET /api/export?dataset=gaps|forecasts|priority|alerts|recommendations|demand|supply&format=csv|json
```

## Data

```bash
pnpm data:build     # regenerate raw extracts, normalise, rewrite dataset.json and seed.sql
```

The generator is deterministic, so this reproduces the same files. To use your own data,
replace the CSV files in `data/pilot/raw/` (same columns), run `pnpm data:ingest`, then
`pnpm db:setup` and `pnpm pipeline`. Rows that cannot be mapped to a known trade or
district are rejected and reported in `data/pilot/ingest-report.json`.

## Demonstration path

Market Explorer → Telangana → Warangal → Renewable Energy → Solar Technician.

Capacity 800, forecast demand 1,250, gap +450 (+56.25%), severe shortage, a warning that
demand is expected to exceed supply within 6 months, and the recommendation to increase
Solar Technician training capacity in Warangal. Open "View Evidence" for the calculation.
None of these values is stored or typed into the interface: the engine derives them from
24 monthly demand rows and three training-capacity rows. The synthetic series for this
pair was calibrated so that the result matches the scenario (see `docs/METHODOLOGY.md`, section 11).

## Known limits

- Synthetic data only; backtest figures describe the method, not real-world accuracy.
- Demand is compared with training seats. Existing workforce and migration are not modelled.
- NCO-2015 codes and NSQF levels on pilot trades are indicative.
- Hindi text was written without native-speaker review.
- "Review Action" in the Action Center is kept for the browser session only; there is no
  approval workflow or audit trail yet.
- The computed snapshot is cached in memory for `SNAPSHOT_TTL_SECONDS` (default 300), so
  new rows appear after at most that long.
