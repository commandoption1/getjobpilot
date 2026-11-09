// The first-pass fit score, 0 to 100. It is deterministic and free: no AI call, so every job in the feed gets one and
// the same job always gets the same score. Your own thumbs up or down sits beside it and wins in the feed's order.
import { z } from 'zod'

import type { JobInput } from './job'
import { canonicalTerm, findTerms } from './keywords'
import { type Profile, profileSkillSet } from './profile'

export const weightsSchema = z.object({
  skills: z.number().min(0).default(35),
  engagement: z.number().min(0).default(20),
  rate: z.number().min(0).default(20),
  location: z.number().min(0).default(15),
  company: z.number().min(0).default(10),
})
export type Weights = z.infer<typeof weightsSchema>
export const defaultWeights = (): Weights => weightsSchema.parse({})

export type ScorePart = { key: keyof Weights; label: string; value: number; weight: number; note: string }
export type ScoreResult = {
  score: number
  parts: ScorePart[]
  flags: string[]
  matchedSkills: string[]
  missingSkills: string[]
  /** True when an exclude keyword or a hard mismatch means the user never wants to see it. */
  blocked: boolean
}

const RED_FLAGS: [RegExp, string][] = [
  [/\bunpaid\b|\bfor exposure\b|\bequity[- ]only\b/i, 'Unpaid or equity-only'],
  [/\bcommission[- ]only\b/i, 'Commission only'],
  [/\b(test|trial) (task|project|period) (is )?unpaid\b|\bfree (test|trial) project\b/i, 'Unpaid trial work'],
  [/\brock ?star\b|\bninja\b|\bwear many hats\b|\bwork hard,? play hard\b/i, 'Vague or hype wording'],
  [/\b(24\/7|always available|available at all times)\b/i, 'Always-on availability'],
  [/\bbudget:? ?(tbd|negotiable|low)\b/i, 'Unclear budget'],
]

const clamp = (n: number) => Math.max(0, Math.min(1, n))

/** Rough conversion so an hourly floor can be compared with a day rate or a salary. */
function toHourly(value: number, unit: JobInput['rateUnit'] | 'hour' | 'day'): number | null {
  if (unit === 'hour') return value
  if (unit === 'day') return value / 8
  if (unit === 'year') return value / 1800
  return null
}

/** Regions a country belongs to, for posts that say "EMEA", "APAC" or "LATAM" instead of naming countries. */
const APAC = ['apac', 'asia-pacific', 'asia pacific']
const ASIA = ['asia', ...APAC]
const SEA = [...ASIA, 'southeast asia', 'south east asia', 'sea']
const EUROPE = ['europe', 'emea', 'eu', 'european union', 'eea']
const EUROPE_NON_EU = ['europe', 'emea']
const LATAM = ['latam', 'latin america', 'south america', 'americas']
const NORTH_AMERICA = ['north america', 'americas', 'na']
const MIDDLE_EAST = ['emea', 'middle east', 'mena']
const AFRICA = ['emea', 'africa']
const EU_COUNTRIES = ['austria', 'belgium', 'bulgaria', 'croatia', 'cyprus', 'czechia', 'czech republic', 'denmark', 'estonia', 'finland', 'france', 'germany', 'greece', 'hungary', 'ireland', 'italy', 'latvia', 'lithuania', 'luxembourg', 'malta', 'netherlands', 'poland', 'portugal', 'romania', 'slovakia', 'slovenia', 'spain', 'sweden']
const REGIONS: Record<string, string[]> = {
  ...Object.fromEntries(EU_COUNTRIES.map((c) => [c, EUROPE])),
  'united kingdom': [...EUROPE_NON_EU, 'uk', 'great britain', 'england'], uk: [...EUROPE_NON_EU, 'united kingdom'],
  norway: EUROPE_NON_EU, switzerland: EUROPE_NON_EU, iceland: EUROPE_NON_EU, serbia: EUROPE_NON_EU, ukraine: EUROPE_NON_EU,
  turkey: [...EUROPE_NON_EU, 'türkiye', 'turkiye'], türkiye: [...EUROPE_NON_EU, 'turkey'],
  'united states': [...NORTH_AMERICA, 'usa', 'us', 'u.s.'], usa: [...NORTH_AMERICA, 'united states', 'us'],
  canada: [...NORTH_AMERICA, 'ca'], mexico: [...NORTH_AMERICA, ...LATAM],
  brazil: LATAM, argentina: LATAM, colombia: LATAM, chile: LATAM, peru: LATAM, uruguay: LATAM, 'costa rica': LATAM,
  india: [...ASIA, 'south asia'], pakistan: [...ASIA, 'south asia'], bangladesh: [...ASIA, 'south asia'], 'sri lanka': [...ASIA, 'south asia'],
  vietnam: SEA, thailand: SEA, indonesia: SEA, philippines: SEA, malaysia: [...SEA, 'my'], singapore: [...SEA, 'sg'],
  'hong kong': [...ASIA, 'hk', 'hong-kong'], japan: [...ASIA, 'jp', 'tokyo'], taiwan: [...ASIA, 'tw', 'taipei'],
  'south korea': [...ASIA, 'korea', 'kr', 'seoul'], china: ASIA,
  australia: [...APAC, 'oceania', 'anz', 'au', 'sydney', 'melbourne'], 'new zealand': [...APAC, 'oceania', 'anz', 'nz', 'auckland', 'wellington'],
  'united arab emirates': [...MIDDLE_EAST, 'uae', 'dubai'], israel: MIDDLE_EAST, egypt: [...MIDDLE_EAST, ...AFRICA],
  'south africa': AFRICA, nigeria: AFRICA, kenya: AFRICA, morocco: [...AFRICA, 'mena'],
}
const ANYWHERE = /\b(anywhere|worldwide|global|international|all countries)\b/i

/** True when a list like "USA, Canada" or "APAC" includes a country the user can work from. */
export function regionsAllow(listed: string, workRights: string[]): boolean {
  if (ANYWHERE.test(listed)) return true
  const parts = listed.toLowerCase().split(/[,/;|]|\band\b/).map((p) => p.trim()).filter(Boolean)
  return workRights.some((right) => {
    const r = right.trim().toLowerCase()
    const names = [r, ...(REGIONS[r] ?? [])]
    return parts.some((p) => names.some((n) => p === n || p.includes(n) && n.length > 3))
  })
}

export function scoreJob(job: JobInput, profile: Profile, weights: Weights = defaultWeights()): ScoreResult {
  const prefs = profile.preferences
  const text = `${job.title}\n${job.location}\n${job.description}`
  const lower = text.toLowerCase()
  const flags: string[] = []
  let blocked = false

  // Skills: share of the post's tech terms the user has. Posts with no detectable terms score in the middle.
  const mine = new Set([...profileSkillSet(profile)].map(canonicalTerm))
  const asked = findTerms(text, [...mine])
  const matchedSkills = asked.filter((t) => mine.has(t.canonical)).map((t) => t.asWritten)
  const missingSkills = asked.filter((t) => !mine.has(t.canonical)).map((t) => t.asWritten)
  const titleHit = prefs.targetRoles.some((role) => role && lower.includes(role.toLowerCase()))
  const skillsValue = asked.length ? clamp(matchedSkills.length / Math.min(asked.length, 12) + (titleHit ? 0.15 : 0)) : titleHit ? 0.7 : 0.4
  // Big boards mix in sales, support and marketing jobs. A post that names no tech at all and whose title is not a
  // software role is capped low, so those don't crowd the feed.
  const softwareTitle = /\b(develop|engineer|programm|software|front[- ]?end|back[- ]?end|full[- ]?stack|web|devops|sre|architect|cto|technical lead|tech lead|coder)/i.test(job.title)
  const offTopic = !asked.length && !titleHit && !softwareTitle
  const skillsNote = asked.length ? `${matchedSkills.length} of ${asked.length} skills match${titleHit ? ', title matches a target role' : ''}` : 'No clear skill list in the post'

  // Engagement: the first preference scores 1, the next 0.8, and so on. Unknown sits at 0.5.
  let engagementValue = 0.5
  let engagementNote = 'Work type not stated'
  if (job.engagement !== 'unknown') {
    const rank = prefs.engagements.indexOf(job.engagement as (typeof prefs.engagements)[number])
    engagementValue = rank === -1 ? 0 : clamp(1 - rank * 0.2)
    engagementNote = rank === -1 ? `${job.engagement} is not a work type you want` : `${job.engagement} (your choice #${rank + 1})`
  }

  // Rate: compared in hourly terms against the floor and the target. Missing pay sits at 0.5.
  let rateValue = 0.5
  let rateNote = 'Pay not stated'
  const floor = prefs.minRate ? toHourly(prefs.minRate, prefs.rateUnit) : null
  const target = prefs.targetRate ? toHourly(prefs.targetRate, prefs.rateUnit) : null
  const offered = job.rateMax !== null && job.rateUnit ? toHourly(job.rateMax, job.rateUnit) : null
  if (offered !== null && (floor !== null || target !== null)) {
    const sameCurrency = !job.currency || job.currency === prefs.currency
    if (floor !== null && offered < floor) {
      rateValue = clamp(offered / floor - 0.5)
      rateNote = `About ${Math.round(offered)}/h, under your floor of ${Math.round(floor)}/h`
    } else {
      rateValue = target !== null ? clamp(0.7 + 0.3 * (offered / target)) : 0.85
      rateNote = `About ${Math.round(offered)}/h${target !== null ? ` vs your target of ${Math.round(target)}/h` : ''}`
    }
    if (!sameCurrency) rateNote += ` (in ${job.currency}, not converted)`
  }

  // Location: remote preference and work rights.
  let locationValue = 0.6
  let locationNote = 'Remote status unclear'
  if (job.remote === true) {
    locationValue = 1
    locationNote = 'Remote'
    const restricted = /\b(us|usa|united states|uk|eu|europe|canada)[- ]only\b|\bmust (be located|reside) in\b/i.exec(text)
    // Boards like Himalayas and Jobicy list the allowed countries in the location: "Remote (USA, Canada)".
    const listed = /^remote \((.+)\)$/i.exec(job.location.trim())?.[1]
    const allowed = [...prefs.workRights, ...prefs.targetCountries]
    if (listed && prefs.targetCountries.length && regionsAllow(listed, prefs.targetCountries) && !ANYWHERE.test(listed)) {
      locationNote = `Remote, open to ${listed} (a country you want)`
    } else if (listed && allowed.length && !regionsAllow(listed, allowed)) {
      locationValue = 0.2
      locationNote = `Remote, but only for ${listed}`
    } else if (restricted && allowed.length && !allowed.some((r) => restricted[0].toLowerCase().includes(r.toLowerCase()))) {
      locationValue = 0.3
      locationNote = `Remote, but limited: "${restricted[0]}"`
    }
  } else if (job.remote === false) {
    locationValue = prefs.remote === 'remote-only' ? 0 : prefs.remote === 'remote-or-hybrid' ? 0.4 : 0.8
    locationNote = `On-site${job.location ? ` in ${job.location}` : ''}`
  }

  // Countries the user leaves out: a job limited to them is blocked; a target country in the location adds a little.
  const place = `${job.location}`.toLowerCase()
  const onlyAvoided = prefs.avoidCountries.length > 0 && (() => {
    const listedPlaces = (/^remote \((.+)\)$/i.exec(job.location.trim())?.[1] ?? job.location).toLowerCase().split(/[,/;|]/).map((p) => p.trim()).filter(Boolean)
    return listedPlaces.length > 0 && listedPlaces.every((p) => prefs.avoidCountries.some((c) => p.includes(c.toLowerCase())))
  })()
  if (onlyAvoided) {
    blocked = true
    locationNote = `Only for ${job.location}, a country you leave out`
  }
  const targetBonus = prefs.targetCountries.some((c) => c && place.includes(c.toLowerCase())) ? 0.05 : 0

  // Company: industries the user likes or avoids, found in the post.
  let companyValue = 0.5
  let companyNote = 'No industry signal'
  const liked = prefs.industries.find((i) => i && lower.includes(i.toLowerCase()))
  const avoided = prefs.avoidIndustries.find((i) => i && lower.includes(i.toLowerCase()))
  if (avoided) {
    companyValue = 0
    companyNote = `Mentions ${avoided}, which you avoid`
  } else if (liked) {
    companyValue = 1
    companyNote = `Mentions ${liked}`
  }

  for (const [pattern, label] of RED_FLAGS) if (pattern.test(text)) flags.push(label)
  for (const word of prefs.excludeKeywords) {
    if (word && lower.includes(word.toLowerCase())) {
      flags.push(`Contains "${word}" (excluded)`)
      blocked = true
    }
  }
  if (prefs.remote === 'remote-only' && job.remote === false) blocked = true

  const parts: ScorePart[] = [
    { key: 'skills', label: 'Skills match', value: skillsValue, weight: weights.skills, note: skillsNote },
    { key: 'engagement', label: 'Work type', value: engagementValue, weight: weights.engagement, note: engagementNote },
    { key: 'rate', label: 'Rate', value: rateValue, weight: weights.rate, note: rateNote },
    { key: 'location', label: 'Location and hours', value: locationValue, weight: weights.location, note: locationNote },
    { key: 'company', label: 'Company fit', value: companyValue, weight: weights.company, note: companyNote },
  ]
  const totalWeight = parts.reduce((sum, p) => sum + p.weight, 0) || 1
  const raw = parts.reduce((sum, p) => sum + p.value * p.weight, 0) / totalWeight
  const penalty = Math.min(0.3, flags.length * 0.08)
  if (offTopic) flags.push('Not a software role')
  const score = blocked ? 0 : Math.min(offTopic ? 15 : 100, Math.round(clamp(raw - penalty + targetBonus) * 100))
  return { score, parts, flags, matchedSkills, missingSkills, blocked }
}
