# SkillPulse methodology

Version `prototype-0.1` · demand model `baseline-trend-v1` · supply model `capacity-trend-v1`

Everything on this page is a **prototype methodology**. The weights and thresholds are
configurable assumptions, not official government rules, and the pilot data is synthetic.
Every parameter lives in one file, `lib/config/methodology.ts`; the Methodology screen and
this document describe what that file contains.

No language model or other black box takes part in any calculation. Each figure in the
interface can be recomputed by hand from the stored rows using the formulas below, and the
test suite does exactly that (`tests/pilot.test.ts`, "every number can be reproduced").

## 1. Unit of analysis

One **pair** = one district × one trade. Every index, forecast, gap, score, warning and
recommendation is computed per pair. Sector, district, state and national figures are sums
of pairs, so a filtered total always equals the sum of the rows beneath it.

## 2. From raw records to stored rows

`scripts/ingest.ts` reads the raw extracts in `data/pilot/raw/` and passes every row through
the mapping layer in `lib/intelligence/normalization/`:

| Raw value | Mapped to | Rule |
|---|---|---|
| Job title ("Sr. Solar PV Installer – urgent") | trade | noise words removed, then alias table |
| NCO-2015 unit group code | trade | code table (indicative codes) |
| District spelling ("Bangalore", "Bengaluru (U)") | district | alias table |
| Sector name | sector | alias table |
| Month ("Sep-26", "2026/09", "September 2026") | `YYYY-MM` | parser |

Rows that cannot be mapped are **rejected and counted**, never guessed. The counts appear
on the Data Sources screen and in `data/pilot/ingest-report.json`. Counts from several rows
for the same pair and month are added; scores are averaged.

## 3. Demand Index (0–100)

| Component | Weight | Source column |
|---|---|---|
| Job postings | 0.40 | `job_postings` |
| Hiring signal | 0.25 | `hiring_signal` (already 0–100) |
| Employment registrations | 0.20 | `employment_registrations` |
| Industry demand signal | 0.15 | `industry_demand_score` (already 0–100) |

Each component is the average of the last 3 months. Counts are put on 0–100 with a log
scale against the 95th-percentile pair in the dataset:

```
scaled = 100 × ln(1 + value) ÷ ln(1 + reference),  capped at 100
```

If a component has no data, **the index is not produced**. Missing components are never
replaced by an assumed value.

## 4. Supply Index (0–100)

| Component | Weight | Definition |
|---|---|---|
| Available training seats | 0.40 | allocated seats, log-scaled as above |
| Enrolment utilisation | 0.25 | enrolled ÷ allocated seats |
| Completion output | 0.20 | completed ÷ enrolled |
| Placement output | 0.15 | placed ÷ completed |

Raw values, normalised values and the index are all kept and shown.

The two indices describe the *strength of the signal*. They are not subtracted from each
other; the gap is measured in people and seats (section 7).

## 5. Demand forecast

Monthly demand for a pair = job postings + employment registrations.

```
forecast(month k) = baseline
                  + 0.6 × trend slope × distance
                  + 0.4 × recent slope × damped distance
```

- **baseline**: mean of the last 3 observed months
- **trend slope**: least-squares slope over the last 12 months
- **recent slope**: change between the last two 3-month averages, per month, damped by 0.85 each month
- **distance**: months from the centre of the baseline window to month k

The 3, 6 or 12-month forecast is the sum of the monthly forecasts, floored at zero.

**Interval (80%).** Combines month-to-month noise, the uncertainty of the baseline average
and the uncertainty of the trend slope:

```
half-width = 1.28 × √( H·σ² + H²·σ²/3 + (0.6 · se(slope) · Σdistance)² )
```

and is never narrower than the 80th-percentile error measured in the backtest at that
horizon (section 6), so stated uncertainty cannot be smaller than observed error.

**Confidence** is derived from the interval, not asserted:
`score = 100 × (1 − relative half-width ÷ 0.5)`, clamped to 0–100. High ≥ 75, medium ≥ 50.

**Short history.**

| Months of history | Result |
|---|---|
| fewer than 3, or newest month older than 3 months | no forecast: "insufficient data" |
| 3 to 5 | baseline estimate only (no trend), confidence capped at 35 |
| 6 to 11 | full formula, confidence capped at 60 |
| 12 or more | full method |

The same inputs always give the same output. There is no random element.

## 6. Backtest

For each pair the last *H* months are hidden, the forecast is made from the earlier months
and compared with what was observed. On the pilot data:

| Horizon | Pairs | Typical error (WAPE) | 80% of errors within |
|---|---|---|---|
| 3 months | 92 | 4.8% | ±6.4% |
| 6 months | 92 | 6.2% | ±10.7% |
| 12 months | 92 | 7.2% | ±14.1% |

Because the data is synthetic, this shows that the method behaves as designed. It says
nothing about accuracy on real labour-market data, which has to be measured again once
real sources are connected.

## 7. Supply forecast and gap

```
projected annual capacity = latest allocated seats + average yearly change × (H ÷ 12)
supply over H months      = projected annual capacity × (H ÷ 12)
```

The yearly change is averaged over up to two year-on-year changes. With a single year of
data, capacity is held flat. With no current-cycle data there is no supply forecast.

```
Gap   = forecast demand − forecast supply
Gap % = (forecast demand − forecast supply) ÷ forecast supply × 100
```

| Classification | Gap % |
|---|---|
| Severe shortage | ≥ +30% |
| Shortage | +15% to below +30% |
| Balanced | above −15% to below +15% |
| Oversupply | above −30% to −15% |
| Severe oversupply | ≤ −30% |

"Current" compares demand at the present rate (last 3 months × 4) with this cycle's seats.
If either side is missing the pair is shown as **insufficient data** and left out of totals;
the screens say how many pairs were left out.

A stated limitation: this compares vacancies with training seats. It does not yet count
the existing workforce, migration or people trained outside the listed centres.

## 8. Priority score (0–100)

| Component | Weight | Scale |
|---|---|---|
| Gap severity | 0.35 | \|gap %\| ÷ 60 × 100, capped at 100 |
| Demand growth | 0.25 | annualised demand trend ÷ 30 × 100, capped |
| Employment signal | 0.15 | employment-registration component of the Demand Index |
| Capacity pressure | 0.15 | enrolment utilisation |
| Forecast confidence | 0.10 | confidence score |

Components are measured in the direction of the gap, so an oversupplied pair scores high
when demand is falling and seats stand empty. High ≥ 70, medium ≥ 45. If any input is
missing there is no score. It is a decision-support ordering, not an official ranking.

## 9. Early warnings

| Type | Rule | Severity |
|---|---|---|
| Acute shortage | already a severe shortage at the current rate | critical |
| Upcoming shortage | the 6-month forecast moves the pair into, or deeper into, shortage | high if severe, else medium |
| Emerging shortage | demand trend ≥ +15% a year, capacity change ≤ +5%, 12-month gap positive | high if trend ≥ +30%, else medium |
| Saturation | already a severe oversupply | high |
| Upcoming saturation | the 6-month forecast moves the pair into, or deeper into, oversupply | high if severe, else medium |
| Oversupply risk | capacity up ≥ 10% while demand trend ≤ −5% | medium |
| Monitor | gap forecast to close, or a balanced pair within 5 points of a threshold | low |

Each warning carries its type, severity, district, sector, trade, reason, the evidence
figures that triggered it and a recommended action.

## 10. Recommendations

Chosen by rule from the 12-month classification:

| Situation | Recommendation |
|---|---|
| Shortage, utilisation ≥ 70% | Increase training capacity |
| Shortage, utilisation below 70% | Fill existing seats first |
| Shortage and completion below 65% or placement below 50% | adds "review training quality" |
| Oversupply | Review seat allocation |
| Severe oversupply | Reduce or redirect capacity |
| Balanced | Maintain (not listed in the action queue) |
| Insufficient data | Collect data |

Every recommendation lists the figures it was derived from.

## 11. The pilot dataset

Three states, seven districts, seven sectors, fourteen trades, 94 district–trade pairs,
24 months of demand and three training years. It is produced by a deterministic generator
(`scripts/pilot/generate-raw.ts`, a fixed hash, no random seed), so it is identical on
every machine. It is labelled "Prototype synthetic data" in the interface, in every API
response and in every export.

Two things about it should be said plainly:

- The Warangal × Solar Technician series was **calibrated** so that the engine's 12-month
  forecast comes to 1,250 against 800 seats, matching the demonstration scenario. The value
  1,250 is not stored anywhere; the engine computes it from the 24 monthly rows. But the
  rows were chosen to make it land there.
- Four pairs are deliberately incomplete (short history, missing training data, a missing
  survey) to show how missing data is handled.

## 12. Sources

No external system is connected. The pilot extracts stand in for job-portal postings,
employment-exchange vacancies, an industry hiring signal, an industry survey and training
capacity records. NCS, e-Shram, PLFS and scheme MIS systems are listed as **planned** on
the Data Sources screen with "Not connected". NCO-2015 codes and NSQF levels on the pilot
trades are indicative and need checking against the official classification.
