# Changes since the audit

What was changed in answer to the project audit, by audit finding. `docs/AUDIT.md` is the
original audit of the frontend as received and is unchanged.

| Audit finding | What changed | Where to check |
|---|---|---|
| Demo scenario calibrated to 1,250 | Calibration removed. The generator no longer imports the engine or the mapping tables; a test fails if it does. No test asserts a demo number; one recomputes the pair independently from the stored rows. | `scripts/pilot/generate-raw.ts`, `tests/pilot.test.ts` |
| Groups "balanced" on the net gap | A group reports seats short and seats spare separately and takes its headline from them, never from the net. | `lib/intelligence/aggregate.ts`, methodology §10 |
| Group priority a different quantity | A group shows its highest-scoring pair, named, and a count of high-priority pairs. Rankings use that. | same |
| Confidence one constant per horizon | Each pair's own model interval is scaled by a factor measured in a rolling-origin backtest; hold-out coverage is reported. Confidence now differs between pairs. | `lib/intelligence/forecast.ts`, `engine.ts`, methodology §7–8 |
| Group confidence contradicted its interval | Group interval combines pair intervals with the measured error correlation; confidence follows from it. | `aggregate.ts` |
| Forecast breakdown did not add up | One inclusion rule for total, chart, capacity line and breakdown; rounding shown as its own term. | `lib/server/views.ts`, `tests/server.test.ts` |
| District planner received all-state aggregates | The map is limited to the session's scope. | `views.ts`, `tests/routes.test.ts` |
| Employer got recommendations via the trade route | The trade route applies the recommendations rule. | `app/api/trade/[id]/route.ts` |
| "No export" for employers was cosmetic | Rule removed: anyone exports what they can see; recommendations export follows the recommendations rule. | `app/api/export/route.ts` |
| RLS never in the request path | For signed-in users the database is asked, as that user, which districts the policies allow; nothing outside is returned. README corrected. | `lib/server/db-scope.ts`, `0003_ingestion_access.sql` |
| New sign-ups got the national view | Accounts need approval; unapproved accounts read nothing, in the app and in the policies. | `0002_auth_rls.sql` |
| Open in production without Supabase | A production build needs `DEMO_MODE=on` to run without sign-in. | `lib/config/env.ts` |
| Database TLS unverified by default | Verified by default; opting out is explicit. | `lib/repository/ssl.ts` |
| No rate limiting | Per-client limit in the API wrapper (in memory, per instance). | `lib/server/http.ts` |
| Normalization offline only, no ingestion path | One ingestion module used by the seed build, a command and an upload endpoint with a dry run; every load recorded; values carry the load that wrote them. | `lib/ingest/`, `app/api/ingest/route.ts` |
| Exact-match only; doc examples rejected | Qualifier stripping, containment and close-spelling matches with scores, ambiguity and code-only rejection; the documented date and place forms now work and are tested. | `lib/intelligence/normalization/normalize.ts` |
| 100% mapping was circular | Generator writes its own wording; about 9% of portal rows are rejected. Still the same author: stated in methodology §15. A hand-typed fixture has row-by-row expected results. | `tests/ingest.test.ts` |
| Map was three dots, always green | Real outlines of the pilot states, coloured by headline. | `components/charts/state-map.tsx` |
| Group numbers unexplained | Every Overview figure opens its definition, how it adds up and the pairs behind it; evidence panel has a Data tab with stored rows, months used, arithmetic and load lineage. | `components/pages/overview.tsx`, `skill-intelligence.tsx`, `/api/evidence` |
| Thresholds restated as fixed text | Text takes its numbers from the configuration through the API. | `lib/i18n/messages/*` |
| "Updated" date a typed constant | Each source shows the date of its latest load; a real load sets a real timestamp. The pilot's date is the day the extracts were generated. | `lib/ingest/apply.ts` |
| Derived tables write-only and stale | Still not read by the app, now said plainly; refreshed automatically after each load, with a timestamp. | `lib/server/derived-write.ts`, README |
| Tests circular or missing | 277 tests: hand-worked expected values for the interval, the bands and a hand-typed file; route tests for every role; optional database tests; a browser script in the repo. | `tests/`, `scripts/e2e.mjs` |

## Second review ("judge attack")

After the changes above, the project was reviewed again by a reader told to break it. What
it found and what was done. Methodology version is now `prototype-0.3`.

| Finding | What changed |
|---|---|
| A rotating place spelling in the generator removed more volume from recent months, manufacturing a decline in Mysuru and "reduce" recommendations | The rare spelling is chosen by a hash with no time pattern. Each load records how much of its volume was mapped; a source under 95% is flagged on the Overview and oversupply recommendations say to check the demand data. The remaining damage to Mysuru is left in and described (methodology §15). |
| One future-dated row moved the as-of month to 2099 and blanked every screen | Future months are rejected. The as-of month needs at least half the pairs to have data for it. |
| In demo mode with a database, anyone could load or replace data | Demo mode cannot write unless `DEMO_WRITES=on`. |
| A large file of unknown titles froze the server | Matching is memoised and skips impossible candidates; 100,000-row and 5 MB limits are checked before the work. 20,000 unknown titles are tested to finish in seconds. |
| "Hold-out coverage" was not out of sample in time; correlation was clamped at zero; group confidence was high by construction | Replaced by a forward check in time (not possible for 12 months, and said so; that confidence is marked provisional). Measured correlation reported as it is; group totals use at least 0.10, as a stated assumption. |
| "Mostly shortage" for trivial amounts; "mixed" shown in the interface's accent blue | Headline uses materiality against supply (2%); new "largely balanced"; "mixed" has its own colour; the map prints seats short and spare on each state. |
| Load history showed file text to every role | Detail by role in the app; administrators only in the database policy. |
| Employers received the suggested action inside warnings | Removed for roles without planner advice, on every route and export. |
| README said the database "decides" scope | Reworded: it is a second check on the same profile row. Unit tests added for that module. |
| Re-running migration 0002 alone loosened access; re-running setup wiped loaded data and failed once users existed; 0003 re-approved accounts | Approval now lives in 0002; no migration approves anyone; the seed updates reference rows in place; `db:setup` seeds only an empty database unless `--reset`. |
| Rate limit applied after the session lookup, by one key | By address before the lookup, then by user. Its limits are written down. |
| Any title containing a known one was accepted ("Electrician Helper") | Only a known title with a marked-off qualifier; loose matches are held unless the loader opts in. |
| Dates, numbers and CSV edge cases ("1e12", unclosed quotes, repeated headers, exact duplicates dropped) | Strict numbers; unreadable files refused whole; more date forms; duplicates kept and counted. |
| A balanced pair could be "high priority" | Capped at medium, and the screen says when that happened. |
| "Expected to exceed supply" on a pair already short | Worded "forecast to deepen". |
| Horizon lengths typed into text | Every message takes them from the configuration; a test fails on "6 months" typed into a message. |
| `Origin: null` caused a 500 | Refused with 403. |
| One-pair group showed an interval one person different from the pair's own | A group of one uses the pair's bounds exactly. Found by the browser check. |
| As-of query failed on PostgreSQL after the coverage rule was added | Fixed; found by the database tests once they were run again. |

A third reader then checked the documents against the code and attacked the loader again.
Every number quoted in the documents matched what the code computes. What it still found:

| Finding | What changed |
|---|---|
| Merge overwrote a pair-month while the screen said "add" and errors said "split the file" | Merge still replaces (so loading a file twice is harmless), but the label, the errors and the documents now say so, and "Check file" reports how many stored values would be replaced. |
| A one-row clean file cleared the data-quality warning | Completeness is totalled over every load since the source was last replaced. |
| Rows rejected for an unreadable number were invisible to the volume check; "1.000" was read as 1 | The share of rows mapped is checked as well; a count written with a decimal point is refused. |
| One row for a later training cycle put every other pair out of date | The current training year follows the same coverage rule as the as-of month. |
| Classifications, seat totals and recommendations ignored the engine's own interval | Each classification is checked at both ends of its interval; the firm subtotal is shown beside the total and recommendations that rest on a classification that is not firm are marked tentative. |
| Mysuru showed "high" group confidence while most of its pairs were short-history | Group confidence is capped when most of its demand comes from pairs without the full method. |
| A stray quote (6" pipe) swallowed following rows silently | A quote opens a quoted value only at the start of a field; text after a closing quote refuses the file. |
| "Welder / Electrician", "Electrician (Helper)", "Window Technician" matched loosely | The qualifier is read: another trade is ambiguous, a role-changing word is unknown; in a spelling match each word must itself be close. |
| README quoted the wrong warning text; "31/09/2026" accepted; financial years said to be rejected | Corrected; impossible days rejected; the document now says `2011-12` is read as December 2011. |

Left as limits, not fixed: the 12-month interval is unverified; unmapped volume cannot be
attributed to a place; mapping tables and account approval have no screen; table rows that
open a drawer are keyboard-reachable but are not buttons; the unused v0 placeholder images
in `public/` were left alone.

## Version 3 hardening

The project was audited again against a brief for a traceable, end-to-end prototype. Most of
it was already in place; these are the gaps that were found and closed.

| Gap | What changed | Where to check |
|---|---|---|
| Warnings did not say over what period they held or how sure the forecast was | Each warning carries the view it rests on, its length in months and that forecast's confidence, and shows the figures that fired the rule. | `lib/intelligence/alerts.ts`, `components/ui/intelligence.tsx` |
| Recommendations had no expected effect | Each capacity action carries the seats it would take to reach the balanced band (or to fill, or to redirect), computed from the same demand and seats. The Action Center shows problem, action, expected effect and confidence. | `lib/intelligence/recommendations.ts`, methodology §14 |
| Low confidence did not change the advice | An action on a low-confidence forecast is tentative ("monitor before reallocating"), as is one whose classification changes within the interval. | same |
| Confidence could not be explained beyond a formula | Every forecast carries the basis of its score; the evidence panel shows it; a table in methodology §7 maps each kind of evidence to its effect. | `lib/intelligence/forecast.ts` |
| Data Sources lacked status, category and integration method columns | Columns are now source, category and coverage, status, last refresh, data type, integration method and feeds. Planned sources read "Planned integration · None yet: no connection exists". A data-quality line totals records processed, valid, rejected and completeness. The synthetic-data statement is on the page. | `components/pages/data-sources.tsx` |
| Methodology page had no normalization, confidence or limitations sections | Added, with numbers taken from the configuration and the dataset. | `components/pages/methodology.tsx` |
| The main export had no recommendation | The `gaps` export now has the interval, confidence label, warnings, recommended action, text and seats for roles that get advice. | `lib/server/export.ts` |
| API names in the brief did not all exist | `/api/summary`, `/api/priorities`, `/api/data-sources` added as the same handlers. | `app/api/*` |
| No linter | ESLint with the Next.js rules; `pnpm lint` passes with no warnings. Of six hook-rule errors, four were fixed and two are kept with a stated reason, as are four warnings about full-page navigation after sign-in or a role change. | `eslint.config.mjs` |
| Text contrast below WCAG AA (368 elements) | Status colours get darker text-only variants and secondary text is one step darker; fills, dots and charts keep the original palette. Two structural findings fixed. Scan now reports none. | `app/globals.css` |
| A reviewer of this round found: the effect's gap could print as exactly ±15.0%; a release with zero forecast demand went negative; "oversupply risk" quoted a forecast confidence although its rule uses no forecast | The gap after the change is cut to two decimals and shown with two; zero demand releases every seat and quotes no percentage; each warning states its basis (current rate, forecast or trend) and only forecast-based ones quote a confidence. A grid test covers every small demand and supply. | `lib/intelligence/recommendations.ts`, `alerts.ts`, `tests/priority-alerts.test.ts` |
| No test that a source change reaches the screen | `tests/chain.test.ts` loads a file for one quiet pair and checks stored rows, index, forecast, gap, priority, warning, recommendation, views and export all move, and that no other pair does. Filter consistency is tested across 13 filter combinations for every view. | `tests/chain.test.ts`, `tests/server.test.ts` |

## Not changed

- Supply is still allocated seats, and demand still adds two sources. Documented as limits
  (methodology §12), not fixed.
- The hiring signal and the industry survey still drive no decision. Documented.
- No real data has been loaded and Supabase has still never been connected.
- The whole dataset is still loaded into memory.
