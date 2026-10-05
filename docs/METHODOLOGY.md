# SkillPulse methodology

Version `prototype-0.3` · demand model `baseline-trend-v2` · supply model `capacity-trend-v1`

Everything on this page is a **prototype methodology**. The weights and thresholds are
configurable assumptions, not official government rules, and the pilot data is synthetic.
Every parameter lives in one file, `lib/config/methodology.ts`. The Methodology screen reads
that file through the API; this document describes it. Where a number below is a parameter,
the name in brackets is its key in that file.

No language model or other black box takes part in any calculation.

## 1. Unit of analysis

One **pair** = one district × one trade. Every index, forecast, gap, score, warning and
recommendation is computed per pair, once, in `lib/intelligence/engine.ts`.

## 2. From a source file to stored rows

Every file, whether a pilot extract, a file loaded on the Data Sources screen or one loaded
with `pnpm ingest`, goes through the same code (`lib/ingest/`) and is recorded as a **load**
(`ingestion_runs`): what was read, mapped, matched loosely and refused, and why.
Each stored value keeps the number of the load that wrote it.

Matching rules (`lib/intelligence/normalization/`):

| Step | Example | Result |
|---|---|---|
| Exact alias | "Software Engineer" | accepted, score 1 |
| Alias after dropping seniority and contract words | "Sr. Software Engineer (Urgent)" | accepted, score 1 |
| A known title followed by a marked-off qualifier ("- …", "(…)", ", …"), or "X cum Y" where both are the same trade | "Solar Technician - Rooftop", "Electrician cum Wireman" | **loose match**, score 0.85 |
| Close spelling: similarity ≥ 0.88 and clearly closer than any other trade | "Sofware Developer" | **loose match**, with its score |
| A known title inside a longer one | "Electrician Helper", "Auto electrician specialist" | **rejected**: a helper is not an electrician |
| The qualifier names another trade, or a different job | "Welder / Electrician", "Electrician (Helper)", "Mason (not required)" | **rejected**: ambiguous, or unknown |
| Close as a string but a different word | "Window Technician" (not "Wind…"), "CEO Executive" (not "SEO…") | **rejected**: each word must itself be ≥ 0.75 similar |
| Two trades named | "Welder cum Electrician" | **rejected**: ambiguous |
| Not in the tables | "Java Developer", "Software Engg" | **rejected**: unknown |
| No title, only a four-digit NCO unit group | code 7412 | accepted, score 0.7 |
| Unknown title with only a unit-group code | "Tractor mechanic", 7233 | **rejected**: a unit group covers several occupations |
| Title and code disagree | "Electrician", 7412 | the title is used; the conflict is counted |

**Loose matches are held by default.** A row matched by a looser rule is a suggestion, not a
fact. Unless the person loading the file chooses "count rows matched by a looser rule", those
rows are left out and listed for review, with the volume they carry. The bundled pilot was
built with that option on, after reading the nine kinds of loose match it produced (they are
listed on the Data Sources screen for an administrator).

Places follow the same pattern ("Bangalore", "Bengaluru (U)", "Mysore District",
"Hyderabad, Telangana" are accepted; "Chennai" and "Mysooru" are rejected). A row whose
place and state column disagree ("Pune", "Karnataka") is rejected; a qualifier
that cannot be checked ("Hyderabad, Sindh" with no state column) makes the match loose.

Dates: `2026-09`, `2026-09-15`, `2026-09-15T10:30:00Z`, `2026/09`, `09/2026`, `Sep-2026`,
`Sep-26`, `September 2026`, `15 Sep 2026`, `15/09/2026`, `15/09/26` (day first unless the
file is declared month first). Quarters, "FY" forms and days that do not exist (31/09) are
rejected. `2011-12` is read as December 2011, as ISO writes it: a financial-year column must
not be loaded as a month. **A month later than the month of loading is rejected**, and a
training year more than one year ahead.
Numbers must be plain digits, optionally with Western or Indian thousands separators; "1e12",
"0x10" and "1,25" are not numbers, and a count written with a decimal point ("1.000") is
refused because it means a thousand to some writers and one to others. A file with an
unclosed quote, text after a closing quote, or a repeated column name is refused whole; a
quote in the middle of a value (6" pipe) is an ordinary character. The sector named in a file is compared with the mapped trade's sector and
mismatches are counted; it is not used to decide the trade.

Counts for the same pair and month are added; 0–100 scores are averaged. Identical rows are
**kept** and counted: two real postings can be identical, and the loader cannot tell them
from a file pasted twice. Training rows where more people completed than enrolled, or were
placed than completed, are rejected.

**Merge replaces, it does not add.** Loading a file in merge mode sets this source's value
for every district, trade and month the file contains, and leaves other months alone. So
loading the same file twice changes nothing, and a large file must be split **by month**,
never within one: the second part would replace the first. "Check file" says how many stored
values a load would replace.

**The as-of month** is the newest month in which at least half as many pairs have a complete
demand figure as in the busiest month [`AS_OF_COVERAGE_SHARE`]. One row for one pair in a
later month does not move "today" for everyone else. The current training year follows the
same rule.

**Completeness.** Each load records how many rows it read and mapped and, for count sources,
the total of the value column and the part that was mapped. These are added up over every
load since the source was last replaced, so a clean file loaded on top of a lossy one does
not clear the loss. A source is flagged when under 95% of its volume, or of its rows, reached
the dataset [`minVolumeSharePct`] (rows matter because a row whose number could not be read
carries no volume to miss), or when one rejected value alone carries 1% or more
[`largeRejectSharePct`]. While any source is flagged, the Overview says so and every
oversupply recommendation carries "check the demand data first": missing demand makes a
trade look oversupplied, and cutting seats on that basis is the expensive mistake. What this
cannot do is say *which* district or trade the missing volume belonged to: a row that could
not be mapped has, by definition, no pair.

What this does **not** do: remove the same vacancy posted on two portals, or on a portal and
an exchange. See section 12.

## 3. The recent window

"Recent" means the last 3 observed months [`RECENT_WINDOW_MONTHS`], none older than 5 months,
and only if the newest is under 3 months old [`staleAfterMonths`]. The Demand Index, the
forecast baseline and the "current" rate all use this one window.

## 4. Demand Index (0–100)

| Component | Weight | Source column |
|---|---|---|
| Job postings | 0.40 | `job_postings` |
| Hiring signal | 0.25 | `hiring_signal` (already 0–100) |
| Employment registrations | 0.20 | `employment_registrations` |
| Industry demand signal | 0.15 | `industry_demand_signal` (already 0–100) |

Each component is its recent average. Counts are put on 0–100 with a log scale against the
pair at the 95th percentile of the dataset [`referencePercentile`]:

```
scaled = 100 × ln(1 + value) ÷ ln(1 + reference),  capped at 100
```

If a component has no recent data, **the index is not produced**.

## 5. Supply Index (0–100)

| Component | Weight | Definition |
|---|---|---|
| Available training seats | 0.40 | allocated seats, log-scaled as above |
| Enrolment utilisation | 0.25 | enrolled ÷ allocated seats |
| Completion output | 0.20 | completed ÷ enrolled |
| Placement output | 0.15 | placed ÷ completed |

**What the indices are for.** They summarise the strength of the signals for a reader. They
are not used to compute the gap, which is measured in people and seats. One component of the
Demand Index (employment registrations) enters the priority score. The hiring signal and the
industry survey currently change no gap, forecast, warning or recommendation: they are
context, shown as such.

## 6. Demand forecast

Monthly demand for a pair = job postings + employment registrations.

```
forecast(month k) = baseline
                  + 0.6 × trend slope × distance
                  + 0.4 × recent slope × damped distance        (never below 0)
```

- **baseline**: mean of the recent window
- **trend slope**: least-squares slope over the last 12 months [`trendWindow`]
- **recent slope**: change between the last two 3-month averages, per month, damped by 0.85 a month
- **distance**: months from the centre of the baseline window to month k

The 3, 6 or 12-month forecast is the sum of the monthly forecasts. Its four parts (baseline,
trend, recent growth, and an adjustment when a falling series is held at zero) add up to the
forecast before rounding, and are shown.

| Months of history | Result |
|---|---|
| fewer than 3, or nothing recent | no forecast: "insufficient data" |
| 3 to 5 | baseline estimate only, confidence capped at 35 |
| 6 to 11 | full formula, confidence capped at 60 |
| 12 or more | full method |

The same inputs always give the same output.

## 7. Interval and confidence

Each pair gets its **own model interval**:

```
variance = H·σ²                                 month-to-month noise
         + H²·σ² ÷ 3                            uncertainty of the 3-month baseline
         + (0.6 · se(slope) · Σdistance)²       uncertainty of the trend slope
         + (0.5 · (trend + recent growth))²     uncertainty of extrapolating at all
model half-width = 1.2816 × √variance           (never under 1% of the forecast)
```

So a noisy pair, or one whose forecast leans on a steep trend, has a wider interval than a
steady one.

The model interval alone is too narrow, so it is **calibrated**. In the backtest (section 8)
every error is divided by that forecast's own model half-width; the calibration factor is the
80th percentile [`coverage`] of those ratios. Every model interval at that horizon is
multiplied by the factor:

```
half-width = model half-width × calibration factor
```

**Confidence** is read off the result: `100 × (1 − relative half-width ÷ 0.5)`, between 0 and
100. High ≥ 75, medium ≥ 50. Because the model half-width differs from pair to pair,
confidence does too.

What each kind of evidence does to the score, and where to see it (evidence panel → Forecast):

| Evidence | Effect |
|---|---|
| History volume | under 12 observed months in the trend window caps the score at 60; under 6 at 35; under 3 there is no forecast |
| Completeness | a month with either volume source missing is not an observation, so gaps in the series count as missing history |
| Freshness | newest observation 3 or more months old: no forecast |
| Noise and trend uncertainty | widen the model interval, which lowers the score |
| Reliance on extrapolation | half of the projected change is added to the interval as uncertainty |
| Forecast error in the backtest | the calibration factor widens every interval at that horizon |
| Source reliability | **not measured.** All sources are synthetic; nothing here says how far a real source can be trusted |

Each forecast carries this basis (`confidenceBasis`: months observed, age of the newest
month, relative half-width, the score the interval gives and any cap applied), and a test
checks that the published score equals what the basis implies.

Honest reading of the factor: on the pilot data it is between 2 and 3. The model's own
interval misses that much of the real error, mostly the difference between a straight-line
trend and how demand actually moves. The factor is an empirical correction, not a derivation.

## 8. Backtest

For every pair, every start month that has a full year of history behind it and the whole
horizon observed after it is forecast and compared with what followed ("rolling origins").
At the time of writing, on the pilot data:

| Horizon | Pairs | Forecasts tested | Typical error (WAPE) | Interval factor | Forward check (target 80%) | Error correlation: measured → used |
|---|---|---|---|---|---|---|
| 3 months | 84 | 818 | 5.0% | × 2.01 | 88.3% of 573 | −0.01 → 0.10 |
| 6 months | 82 | 569 | 6.3% | × 2.62 | 92.5% of 80 | −0.03 → 0.10 |
| 12 months | 80 | 80 | 7.2% | × 3.01 | **not possible** | −0.02 → 0.10 |

The Methodology screen shows the live values.

- **The factor proves nothing by itself.** It is the 80th percentile of the errors it is then
  applied to, so it contains 80% of them by construction.
- **Forward check**: the test that can fail. For each later start month, the factor is set
  only from forecasts whose outcome was already known at that month (at least 30 of them
  [`minForwardSamples`]), and that month's forecasts are counted in or out of the widened
  interval. On the pilot the intervals come out wider than they need to be (88% and 93%
  against a target of 80%). For 6 months there is a single test month.
- **12 months cannot be checked.** With 24 months of data there is one start month and
  nothing earlier to learn from. The 12-month interval and its confidence are therefore
  **unverified**; the Forecasts screen marks that confidence "provisional". Since priority,
  warnings and recommendations use the 12-month view, this is the main statistical weakness
  of the prototype, and only more history removes it.
- **Error correlation**: how much the errors of different pairs moved together in the same
  start month. The measured value is reported as it is (slightly negative here). For group
  totals the value used is never below 0.10 [`minErrorCorrelation`]: see section 10.

Limits that should be said out loud: the data is synthetic and smooth, so these figures show
that the method is internally consistent. They say nothing about accuracy on real
labour-market data.

## 9. Supply forecast and the gap of a pair

```
projected annual capacity = latest allocated seats + average yearly change × (H ÷ 12)
supply over H months      = projected annual capacity × (H ÷ 12)

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

"Current" compares demand at the recent rate × 12 with this cycle's seats. If either side is
missing the pair is **insufficient data** and is left out of totals; screens say how many.

**Does the classification hold across the interval?** A pair is classified from its forecast
alone. The gap is then recomputed at the low and the high end of the demand interval; if
either end lands on another side of the balanced band, the classification is **not firm**
(shortage and severe shortage count as the same side). On the pilot at 12 months, 7 of the
28 shortage pairs (4,551 of 14,902 seats short) and 14 of the 33 oversupply pairs (16,605 of
22,051 seats spare) are firm. The Overview shows both figures, the gap export has a
`holds_across_interval` column, and a recommendation resting on a classification that is not
firm, or on a low-confidence forecast, is marked **tentative** (42 of the 61 on the pilot). The intervals are wide because the
12-month factor is 3.0 and unverified (section 8): this is the honest size of what the
prototype knows at that horizon.

## 10. Groups of pairs

A district, a state, a sector or the whole pilot is a group of pairs
(`lib/intelligence/aggregate.ts`). A group of one pair is that pair.

- **Totals** (demand, supply) are sums of pairs that have both figures.
- **A group is never classified by its net gap.** A spare seat in one trade does not train the
  missing person in another. A group reports **seats short** (summed over its shortage pairs)
  and **seats spare** (summed over its oversupply pairs) separately.
  `seats short + seats spare + net of balanced pairs = net gap`, and the net is labelled net.
- **Headline**: seats short, and seats spare, each count as *material* when they are at least
  2% of the group's supply [`materialSharePct`]. One material: "mostly shortage" or "mostly
  oversupply". Both: "mixed" (its own colour, purple). Neither: "largely balanced".
  "Balanced" only when no pair is outside the balanced band. On the pilot all three states
  are "mixed", which is what the data says; the map prints both figures on each state.
- **Priority**: the score of the group's highest-scoring pair, named, plus how many pairs are
  high priority. There is no blended group score. Groups are ranked by number of
  high-priority pairs, then highest pair score, then seats short.
- **Index**: the average of the pairs' indices weighted by size (monthly demand, or seats).
  Raw counts shown beside it are totals for scale; no scaling reference is claimed.
- **Interval**: pairs' half-widths `h` combined with an error correlation ρ:
  `√((1 − ρ)·Σh² + ρ·(Σh)²)`. ρ = 0 is the independent case, ρ = 1 adds them.
  ρ is the value measured in the backtest, **but never below 0.10**. The synthetic pairs are
  generated independently, so the measured value is about zero, and with ρ = 0 the total of
  92 pairs would look almost certain for no reason other than how the data was made. Real
  labour markets share shocks. 0.10 is an assumption, stated as one; on the pilot it doubles
  the half-width of the national total (±9,218 instead of ±4,520).
  **Confidence** follows from that interval by the same formula as for a pair, and is still
  high for large totals (89 for the pilot as a whole): relative error does shrink when many
  pairs are added, but how much depends on ρ, which this data cannot tell us. When more than
  half of a group's forecast demand comes from pairs forecast without the full method
  [`shortHistoryShare`], its confidence is capped at 60 like a short-history pair's (Mysuru
  on the pilot).

## 11. Priority score of a pair (0–100)

| Component | Weight | Scale |
|---|---|---|
| Gap severity | 0.35 | \|gap %\| ÷ 60 × 100, capped at 100 |
| Demand growth | 0.25 | annualised demand trend ÷ 30 × 100, capped |
| Employment signal | 0.15 | employment-registration component of the Demand Index |
| Capacity pressure | 0.15 | enrolment utilisation |
| Forecast confidence | 0.10 | confidence score |

Components are measured in the direction of the gap, so a pair very close to a zero gap can
flip between "shortage" and "oversupply" direction on a small change in the data; its score
is low either way. High ≥ 70, medium ≥ 45. **A pair forecast to be balanced is never shown
above medium** [`balancedBandCap`], whatever its score: fast growth and full seats are worth
watching, but there is no mismatch to act on. A missing input means no score. Priority is always scored on the 12-month planning view [`planningHorizon`],
whichever window is selected on screen. A decision-support ordering, not an official ranking.

## 12. What the method does not do

- **Supply is allocated seats.** Not completions, not placements. In the pilot 68% of seats
  end in a completion and 43% in a placement, so shortages are understated and surpluses
  overstated by about that much. Using expected completions is the obvious next step.
- **Demand adds two sources.** A vacancy listed on a portal and on an exchange is counted
  twice. There is no de-duplication across sources.
- **A flow is compared with a stock.** Openings over a period against seats in a training
  year. The existing workforce, migration and people trained elsewhere are not counted.
- **Unmapped demand cannot be attributed.** The completeness check (section 2) says a source
  lost volume, not where. One mis-spelt district loses only that district's demand.
- **The 12-month interval is unverified** (section 8).
- **Mapping tables are code.** Adding an alias means editing
  `lib/intelligence/normalization/mappings.ts` and reloading the file. There is no screen for it.
- **Scaling is relative to the dataset.** Adding a much larger district changes every index.

## 13. Early warnings

| Type | Rule | Severity |
|---|---|---|
| Acute shortage | already a severe shortage at the current rate | critical |
| Upcoming shortage | the 6-month forecast moves the pair into, or deeper into, shortage (worded "forecast to deepen" when it is already short) | high if severe, else medium |
| Emerging shortage | demand trend ≥ +15% a year, capacity change ≤ +5%, 12-month gap positive | high if trend ≥ +30%, else medium |
| Saturation | already a severe oversupply | high |
| Upcoming saturation | the 6-month forecast moves the pair into, or deeper into, oversupply | high if severe, else medium |
| Oversupply risk | capacity up ≥ 10% while demand trend ≤ −5% | medium |
| Monitor | gap forecast to close, or a balanced pair within 5 points of a threshold | low |

Every warning is computed on request from the pair's figures; none is stored. Each carries
its severity, trade and district, the reason, the figures that made the rule fire, and what
it rests on: the current rate (acute shortage, saturation), a forecast (upcoming shortage,
upcoming saturation and monitor on the 6-month forecast; emerging shortage on the 12-month
one), or the observed trend alone (oversupply risk). Only a warning that rests on a forecast
quotes a forecast confidence.

## 14. Recommendations

| Situation (12-month classification) | Recommendation |
|---|---|
| Shortage, utilisation ≥ 70% | Increase training capacity |
| Shortage, utilisation below 70% | Fill existing seats first |
| Shortage and completion below 65% or placement below 50% | adds "review training quality" |
| Oversupply | Review seat allocation |
| Severe oversupply | Reduce or redirect capacity |
| Balanced | Maintain (not listed in the action queue) |
| Insufficient data | Collect data |
| Oversupply or severe oversupply while a demand source is flagged (section 2) | adds "check the demand data first" |
| Any action on a low-confidence forecast, or whose classification does not hold across the interval (section 9) | marked "tentative": monitor the next refresh before reallocating |

**Expected effect** is arithmetic on the same forecast and seats, not a second model:

```
add seats      fewest extra seats with gap % under +15:   floor(demand ÷ 1.15) + 1 − supply
release seats  fewest seats to redirect with gap % above −15:   supply − (ceil(demand ÷ 0.85) − 1)
fill seats     allocated seats nobody is enrolled in:   seats − enrolled
```

The seat count is the smallest that works, so the gap after the change sits just inside the
threshold; it is shown to two decimals and cut, not rounded, so it never prints as the
threshold itself. With no demand forecast at all, every seat is spare and no percentage is
quoted. It holds only "if demand comes in as forecast", and the text says so. Filling seats does not
move the gap shown, because supply is counted as allocated seats; the text says that too.
The Action Center shows, for each recommendation: the problem (classification, forecast
demand against seats), the evidence list, the action, the expected effect and the confidence.

Warnings are findings and every role sees them. The suggested action on a warning, and
recommendations, are planner advice: employers do not receive them, on any route or export.

## 15. The pilot dataset

Three states, seven districts, seven sectors, fourteen trades, 94 pairs, 24 months of demand
and four training years. Produced by a deterministic generator
(`scripts/pilot/generate-raw.ts`: a fixed hash, no random seed).

- **Nothing is calibrated to a result.** The generator does not import the forecast engine or
  the mapping tables, and a test fails if it ever does. It sets inputs (a growth rate, a seat
  ratio) and the engine's output is whatever it comes to.
- Two pairs are shaped by hand to show specific situations: Warangal × Solar Technician
  (fast-rising demand, flat seats) and Hyderabad × Data Entry Operator (falling demand,
  growing seats). Only their inputs are set.
- The generator writes job titles and place names in its own words, so some are not
  recognised. In the portal extract 11% of rows are rejected and 15% are matched by a looser
  rule; **94.0% of its volume reaches the dataset**, so the pilot itself is flagged for data
  quality and the Overview says so. The largest single loss is the title "Java Developer"
  (3.2% of portal volume), which the mapping table deliberately does not guess at.
- **Mysuru is visibly damaged by this, and that is left in.** About one portal row in eight
  for Mysuru uses the spelling "Mysooru", which is rejected. Where that removes every portal
  row of a pair in a month, the month has no demand figure (nothing is filled in), and eight
  Mysuru pairs are forecast as "limited history" instead of the full method; in other months
  their demand is understated. An earlier version of the generator rotated spellings in a way
  that happened to remove more volume from recent months and so manufactured a decline; the
  rare spelling is now chosen by a hash with no time pattern. Treat every Mysuru figure in
  the pilot as an illustration of what an unmapped place name does.
- **Because the same person wrote the generator and the mapping tables, this is still not an
  independent test of matching**; `tests/fixtures/portal_handwritten.csv` is a separate
  hand-typed file with the expected result worked out row by row, and real source files are
  the only real test.
- Four pairs are deliberately incomplete to show how missing data is handled.
- The four demand sources are driven by the same underlying growth parameter, so they agree
  with each other more than independent sources would.

## 16. Sources

No external system is connected. NCS, e-Shram, PLFS and scheme MIS systems are listed as
**planned**, shown as "Not connected". NCO-2015 codes and NSQF levels on the pilot trades are
indicative and need checking against the official classification.

A file loaded by a person and declared "not synthetic" is labelled **uploaded, not verified**.
A source keeps its synthetic label until such a file replaces everything it loaded before, and
the dataset as a whole is labelled synthetic while any source that feeds it is.
