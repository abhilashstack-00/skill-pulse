# SkillPulse — technical audit of the frontend prototype

Audit of `skillpulse_frontend.zip` as received, made before any backend work.
It records what existed, what was missing, and the plan that was then followed.

## 1. Current architecture

| Item | Finding |
|---|---|
| Framework | Next.js 16.3 (App Router, Turbopack), React 19 |
| Language | TypeScript 5.7, `strict` |
| Package manager | pnpm 12 |
| Styling | One hand-written stylesheet (`app/globals.css`) with design tokens as CSS variables; Tailwind 4 is imported for its reset only |
| Charts | Recharts 3 (line and area charts), plus two hand-built HTML charts (bubble radar, state map) |
| Icons | lucide-react |
| Font | Inter, self-hosted through `@fontsource-variable/inter` |
| State | React context only (`lib/filters-context.tsx`); no state library |
| Backend | None. No API routes, no database client, no environment variables, no authentication |

## 2. Data flow as received

```
lib/data/*.ts  (hand-typed mock values)
      ↓
lib/services/skillpulse.ts  (async functions with a simulated delay)
      ↓
lib/hooks/use-service.ts  (loading / error / ready)
      ↓
components/pages/*.tsx
```

The service boundary was already clean: no screen imported mock data directly.
That made it possible to replace the layer underneath without redesigning screens.

## 3. Routes

`/`, `/market-explorer`, `/skill-intelligence`, `/gap-analysis`, `/forecasts`,
`/action-center`, `/methodology`, `/data-sources` — each a thin `page.tsx` that
renders one client component from `components/pages/`.

## 4. Mock data found

| File | Content | Problem for a real system |
|---|---|---|
| `lib/data/market.ts` | 15 skills, one record each, with typed-in demand index, supply index, growth and forecast values | Final scores were typed in, not calculated |
| `lib/data/recommendations.ts` | 12 hand-written actions | Not derived from data |
| `lib/data/sources.ts` | 5 sources | No raw data behind them |
| `lib/data/methodology.ts` | Weights and thresholds | Displayed only; nothing used them to calculate |
| `lib/services/skillpulse.ts` | Monthly series interpolated from the typed-in anchors | Presentation scaffolding, not a forecast |

Gap was "demand index − supply index" in index points, one location per skill,
three statuses. The brief requires gap in persons from forecasts, a percentage
of supply, five classes, and district × trade granularity.

## 5. Components kept untouched (structure and styling)

`AppShell`, `Sidebar`, `PageHeader`, `Select`, `Drawer`, `SectionCard`,
`KpiCard`, `Pill`, `Button`, `SearchInput`, `Tabs`, loading / empty / error
states, the chart tooltip and legend, the table styles, and the whole
stylesheet (including the responsive changes made after the design stage).

## 6. Components that needed data integration

All eight page components, the filter bar (new fields, cascading options from
the API, role scope), the two Recharts charts (merged into one demand-and-supply
chart), the bubble radar and the state map.

## 7. Missing backend functionality

Database schema · seed data · normalisation of heterogeneous sources · Demand
Index · Supply Index · gap and classification · forecasting · priority score ·
early warnings · recommendations · API · export · authentication and roles ·
tests · provenance labelling · multilingual text.

## 8. Database structure chosen

The tables listed in the brief, in `supabase/migrations/0001_schema.sql`:
`states`, `districts`, `sectors`, `trades`, `training_centres`,
`training_capacity`, `labour_demand`, `data_sources`, and the derived
`demand_forecasts`, `supply_forecasts`, `gap_analysis`. Two additions:
`dataset_meta` (one row: label, synthetic flag, as-of month) and `profiles`
(role and scope for each Supabase Auth user). Row level security is in
`0002_auth_rls.sql`.

## 9. API structure chosen

Next.js route handlers under `app/api/`, no separate server:
`dashboard/summary`, `demand`, `supply`, `gaps`, `forecasts`, `priority`,
`alerts`, `recommendations`, `drilldown`, `states`, `districts`, `sectors`,
`trades`, `trade/[id]`, `district/[id]`, `export`, `methodology`, `sources`,
`meta`. Every response carries a provenance block (data label, synthetic flag,
as-of month, methodology version).

## 10. Implementation order followed

1. Audit (this document).
2. Schema and row level security.
3. Pilot dataset: synthetic raw extracts in five source formats.
4. Ingest script: raw extracts → normalisation → `dataset.json` and `seed.sql`.
5. Normalisation layer with one central mapping file.
6. Demand Index. 7. Supply Index. 8. Gap engine. 9. Forecast engine with
   backtest. 10. Priority engine. 11. Early-warning and recommendation engines.
12. Repositories, snapshot cache, API routes, export.
13–17. Screens connected, shared filters, charts, drill-down, explainability.
18. Supabase Auth, roles and scope. 19. Automated tests. 20. End-to-end run of
    the Warangal Solar Technician scenario.

## What changed in the frontend, and why

- `lib/data/` and `lib/services/` (mock layer) were deleted; `lib/client/api.ts`
  now calls the API.
- KPI cards on the Overview show the eight figures the brief lists.
- Status has five classes plus "insufficient data"; severe classes carry an
  outline as well as a different label.
- New elements, all in the existing visual language: horizon filter, drill-down
  table with breadcrumb, calculation drawers, early-warning and recommendation
  lists, provenance tag in the header, language switch and account block in the
  sidebar, sign-in page.
