/**
 * Central mapping layer.
 *
 * Every source describes occupations, places, sectors and dates in its own
 * words. This file is the ONLY place where those words are mapped onto
 * SkillPulse entities. Adding a source (NCS, e-Shram, PLFS, a job portal)
 * means adding aliases here, not editing the engines or the screens.
 *
 * NCO codes are NCO-2015 unit groups chosen as indicative matches for the
 * pilot trades. They are a prototype mapping and need validation against the
 * official NCO/NSQF registers before real use.
 */

/** Occupation titles as they appear in sources → trade id. */
export const TRADE_ALIASES: Record<string, string[]> = {
  'software-developer': ['software developer', 'software engineer', 'frontend developer', 'backend developer', 'full stack developer', 'application developer', 'programmer'],
  'data-entry-operator': ['data entry operator', 'data entry clerk', 'deo', 'back office executive', 'computer operator'],
  'digital-marketing-executive': ['digital marketing executive', 'digital marketer', 'seo executive', 'social media executive'],
  'healthcare-assistant': ['healthcare assistant', 'general duty assistant', 'gda', 'patient care assistant', 'nursing assistant'],
  'phlebotomy-technician': ['phlebotomy technician', 'phlebotomist', 'lab collection technician'],
  'cnc-operator': ['cnc operator', 'cnc machinist', 'cnc turner', 'vmc operator'],
  'welder': ['welder', 'arc welder', 'mig welder', 'welding technician'],
  'warehouse-associate': ['warehouse associate', 'warehouse executive', 'picker packer', 'inventory associate'],
  'logistics-coordinator': ['logistics coordinator', 'dispatch coordinator', 'transport coordinator', 'fleet coordinator'],
  'electrician': ['electrician', 'wireman', 'electrical technician', 'building electrician'],
  'mason': ['mason', 'bricklayer', 'mason general', 'tile mason'],
  'retail-sales-associate': ['retail sales associate', 'retail associate', 'sales associate', 'store associate', 'counter sales executive'],
  'solar-technician': ['solar technician', 'solar pv installer', 'solar panel installer', 'solar pv technician', 'rooftop solar installer'],
  'wind-turbine-technician': ['wind turbine technician', 'wind technician', 'wtg technician'],
}

/** NCO-2015 unit group → trade id, for sources that carry occupation codes. */
export const NCO_TO_TRADE: Record<string, string> = {
  '2512': 'software-developer',
  '4132': 'data-entry-operator',
  '2431': 'digital-marketing-executive',
  '5321': 'healthcare-assistant',
  '3212': 'phlebotomy-technician',
  '7223': 'cnc-operator',
  '7212': 'welder',
  '4321': 'warehouse-associate',
  '4323': 'logistics-coordinator',
  '7411': 'electrician',
  '7112': 'mason',
  '5223': 'retail-sales-associate',
  '7412': 'solar-technician',
  '7233': 'wind-turbine-technician',
}

/** Place names as they appear in sources → district id. */
export const DISTRICT_ALIASES: Record<string, string[]> = {
  hyderabad: ['hyderabad', 'hyd', 'secunderabad', 'hyderabad city'],
  rangareddy: ['rangareddy', 'ranga reddy', 'rr district', 'k v rangareddy', 'gachibowli', 'shamshabad'],
  warangal: ['warangal', 'warangal urban', 'hanamkonda', 'hanumakonda'],
  'bengaluru-urban': ['bengaluru urban', 'bengaluru', 'bangalore', 'bangalore urban', 'blr'],
  mysuru: ['mysuru', 'mysore'],
  pune: ['pune', 'poona', 'pimpri chinchwad', 'pcmc'],
  nagpur: ['nagpur', 'nagpur city'],
}

/** Sector or industry labels as they appear in sources → sector id. */
export const SECTOR_ALIASES: Record<string, string[]> = {
  'it-digital': ['it & digital', 'it', 'it ites', 'it/ites', 'information technology', 'software', 'digital'],
  healthcare: ['healthcare', 'health care', 'hospitals', 'health'],
  manufacturing: ['manufacturing', 'capital goods', 'engineering', 'automotive manufacturing'],
  logistics: ['logistics', 'supply chain', 'warehousing', 'transport & logistics'],
  construction: ['construction', 'real estate', 'infrastructure', 'building'],
  retail: ['retail', 'retail trade', 'organised retail'],
  'renewable-energy': ['renewable energy', 'green jobs', 'solar', 'power renewable', 'green energy'],
}

/** Words that describe seniority or contract, not the occupation. */
export const TITLE_NOISE = ['senior', 'sr', 'junior', 'jr', 'trainee', 'fresher', 'urgent', 'immediate joiner', 'contract', 'apprentice']

export const MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
