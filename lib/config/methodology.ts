/**
 * SkillPulse methodology configuration — the single place where weights,
 * thresholds and model parameters live.
 *
 * Everything here is a PROTOTYPE, CONFIGURABLE assumption. None of it is an
 * official government rule. Changing a value here changes every screen, API
 * response, export and test expectation that depends on it.
 */

export const METHODOLOGY_VERSION = 'prototype-0.1'

export const DEMAND_INDEX = {
  /** Weights of the four normalised demand components. Must sum to 1. */
  weights: {
    jobPostings: 0.4,
    hiringSignal: 0.25,
    employmentRegistrations: 0.2,
    industryDemandSignal: 0.15,
  },
  /** Months averaged to get the "current" value of each component. */
  smoothingMonths: 3,
} as const

export const SUPPLY_INDEX = {
  /** Weights of the four normalised supply components. Must sum to 1. */
  weights: {
    seats: 0.4,
    utilization: 0.25,
    completion: 0.2,
    placement: 0.15,
  },
} as const

export const NORMALIZATION = {
  /**
   * Count components (postings, registrations, seats) are scaled to 0–100 on
   * a log scale against this percentile of the same component across every
   * district–trade cell in the dataset. Values above the reference cap at 100.
   */
  referencePercentile: 95,
} as const

export const GAP_THRESHOLDS = {
  /** Gap % (relative to supply) at or above which a cell is a severe shortage. */
  severeShortage: 30,
  shortage: 15,
  /** Gap % at or below which a cell is in oversupply. */
  oversupply: -15,
  severeOversupply: -30,
} as const

export const FORECAST = {
  modelVersion: 'baseline-trend-v1',
  horizons: { '3M': 3, '6M': 6, '12M': 12 },
  /** Months averaged for the baseline (rolling average). */
  baselineWindow: 3,
  /** Months used for the linear trend. */
  trendWindow: 12,
  /** Share of the slope taken from the 12-month trend; the rest is recent growth. */
  trendWeight: 0.6,
  /** Monthly damping applied to the recent-growth component. */
  growthDamping: 0.85,
  /** z-value of the prediction interval (1.28 ≈ 80% interval). */
  intervalZ: 1.28,
  /** Fewer observed months than this in the trend window: no forecast. */
  minMonthsBaseline: 3,
  /** Fewer than this: baseline estimate only (no trend), low confidence. */
  minMonthsTrend: 6,
  /** The latest observation may be at most this many months old. */
  staleAfterMonths: 3,
  confidence: {
    /** Relative half-width of the interval at which confidence reaches 0. */
    zeroAtRelativeWidth: 0.5,
    high: 75,
    medium: 50,
    /** Caps applied when history is short. */
    capBaselineEstimate: 35,
    capLimitedHistory: 60,
  },
} as const

export const SUPPLY_FORECAST = {
  modelVersion: 'capacity-trend-v1',
  /** Year-on-year changes averaged to project capacity. */
  maxChangesForTrend: 2,
  /** Capacity older than this many years is treated as missing. */
  maxAgeYears: 1,
} as const

export const PRIORITY = {
  /** Weights of the five priority components. Must sum to 1. */
  weights: {
    gapSeverity: 0.35,
    demandGrowth: 0.25,
    employmentSignal: 0.15,
    capacityPressure: 0.15,
    forecastConfidence: 0.1,
  },
  /** |Gap %| at which gap severity reaches 100. */
  gapSaturationPct: 60,
  /** Annualised demand trend (%) at which the growth component reaches 100. */
  growthSaturationPct: 30,
  bands: { high: 70, medium: 45 },
  /** Horizon used for priority, warnings and recommendations. */
  planningHorizon: '12M',
} as const

export const ALERTS = {
  /** Annualised demand trend (%) counted as "increasing rapidly". */
  rapidDemandGrowthPct: 15,
  /** Capacity change (%) at or below which capacity counts as "flat". */
  flatCapacityPct: 5,
  /** Capacity change (%) counted as "capacity increasing". */
  capacityGrowthPct: 10,
  /** Annualised demand trend (%) counted as "demand declining". */
  demandDeclinePct: -5,
  /** A balanced cell this close (in gap % points) to a threshold is watched. */
  monitorMarginPct: 5,
  /** Horizon used for "within 6 months" rules. */
  lookaheadHorizon: '6M',
} as const

export const RECOMMENDATIONS = {
  /** Below this enrolment utilisation (%), fill existing seats before adding more. */
  lowUtilizationPct: 70,
  /** Below these outcome rates (%), flag a quality review alongside the action. */
  lowCompletionPct: 65,
  lowPlacementPct: 50,
} as const

export const METHODOLOGY = {
  version: METHODOLOGY_VERSION,
  demandIndex: DEMAND_INDEX,
  supplyIndex: SUPPLY_INDEX,
  normalization: NORMALIZATION,
  gapThresholds: GAP_THRESHOLDS,
  forecast: FORECAST,
  supplyForecast: SUPPLY_FORECAST,
  priority: PRIORITY,
  alerts: ALERTS,
  recommendations: RECOMMENDATIONS,
} as const

export type Methodology = typeof METHODOLOGY
