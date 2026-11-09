// Fit of a company the user might pitch, from preferences alone. Open jobs are scored separately.
import { canonicalTerm } from './keywords'
import { type Profile, profileSkillSet } from './profile'

export type CompanyFacts = { industry: string; size: string; stack: string; location: string }

export function companyFit(c: CompanyFacts, profile: Profile): { fit: number; reasons: string[] } {
  const prefs = profile.preferences
  const reasons: string[] = []
  let points = 0
  let max = 0
  const industry = c.industry.toLowerCase()
  if (industry) {
    max += 35
    if (prefs.avoidIndustries.some((i) => i && industry.includes(i.toLowerCase()))) { reasons.push(`Industry you avoid (${c.industry})`); return { fit: 0, reasons } }
    if (prefs.industries.some((i) => i && industry.includes(i.toLowerCase()))) { points += 35; reasons.push(`Industry you like (${c.industry})`) }
    else points += 12
  }
  if (c.size) {
    max += 25
    if ((prefs.companySizes as string[]).includes(c.size)) { points += 25; reasons.push(`Size fits (${c.size})`) }
  }
  const stack = c.stack.split(',').map((s) => canonicalTerm(s)).filter(Boolean)
  if (stack.length) {
    max += 40
    const mine = new Set([...profileSkillSet(profile)].map(canonicalTerm))
    const shared = stack.filter((s) => mine.has(s))
    points += Math.round(40 * Math.min(1, shared.length / Math.min(stack.length, 4)))
    reasons.push(shared.length ? `Shares your stack: ${shared.join(', ')}` : 'No shared stack')
  }
  if (!max) return { fit: 50, reasons: ['Add industry, size or stack to score this company'] }
  return { fit: Math.round((points / max) * 100), reasons }
}
