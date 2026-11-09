// The master profile: every true fact about the user's work, in one structured document. Tailored resumes, cover
// letters, scoring and the browser extension's form filling all read from it. Nothing else is a source of truth.
import { z } from 'zod'

const id = z.string().min(1).max(64)
/** "2024-03" (month precision) or "present". */
export const monthOrPresent = z.string().regex(/^(\d{4}-(0[1-9]|1[0-2])|present)$/, 'Use YYYY-MM or "present"')
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM')

export const bulletSchema = z.object({
  id,
  text: z.string().min(1).max(400),
  /** Skills and tools this achievement shows, e.g. ["vue", "cloudflare workers"]. Used to pick bullets per job. */
  skills: z.array(z.string()).default([]),
  /** Free tags such as an industry ("fintech") or a theme ("performance", "leadership"). */
  tags: z.array(z.string()).default([]),
})

export const experienceSchema = z.object({
  id,
  company: z.string().min(1),
  title: z.string().min(1),
  location: z.string().default(''),
  engagement: z.enum(['employee', 'contract', 'freelance', 'founder']).default('employee'),
  start: month,
  end: monthOrPresent,
  /** One line about the company or the client, shown under the title when there's room. */
  context: z.string().default(''),
  stack: z.array(z.string()).default([]),
  bullets: z.array(bulletSchema).default([]),
})

export const projectSchema = z.object({
  id,
  name: z.string().min(1),
  url: z.string().default(''),
  description: z.string().default(''),
  stack: z.array(z.string()).default([]),
  bullets: z.array(bulletSchema).default([]),
})

export const skillSchema = z.object({
  name: z.string().min(1),
  level: z.enum(['strong', 'working', 'learning']).default('strong'),
  years: z.number().min(0).max(60).optional(),
  /** Other names job posts use for the same skill, e.g. "Workers" for "Cloudflare Workers". */
  aliases: z.array(z.string()).default([]),
})

export const educationSchema = z.object({
  id,
  school: z.string().min(1),
  degree: z.string().default(''),
  field: z.string().default(''),
  start: z.string().default(''),
  end: z.string().default(''),
})

export const preferencesSchema = z.object({
  targetRoles: z.array(z.string()).default([]),
  /** Work types in order of preference. */
  engagements: z.array(z.enum(['contract', 'freelance', 'full-time', 'part-time'])).default(['contract', 'freelance']),
  currency: z.string().default('USD'),
  rateUnit: z.enum(['hour', 'day']).default('hour'),
  minRate: z.number().min(0).default(0),
  targetRate: z.number().min(0).default(0),
  /** Yearly salary floor for full-time roles, in the same currency. */
  minSalary: z.number().min(0).default(0),
  remote: z.enum(['remote-only', 'remote-or-hybrid', 'any']).default('remote-only'),
  /** Where the user can legally work, as country names or codes. */
  workRights: z.array(z.string()).default([]),
  /** Countries whose companies and jobs the user wants most. Jobs limited to them are not marked down, and they get a small bonus. */
  targetCountries: z.array(z.string()).default([]),
  /** Countries to leave out: jobs limited to them are skipped. */
  avoidCountries: z.array(z.string()).default([]),
  timezone: z.string().default(''),
  /** Hours of overlap the user can do with a client's working day. */
  overlapHours: z.number().min(0).max(24).default(4),
  industries: z.array(z.string()).default([]),
  avoidIndustries: z.array(z.string()).default([]),
  companySizes: z.array(z.enum(['solo', 'startup', 'scaleup', 'midsize', 'enterprise'])).default(['startup', 'scaleup']),
  /** Words that must not appear in a job (e.g. "unpaid", "commission only"). */
  excludeKeywords: z.array(z.string()).default([]),
})

export const profileSchema = z.object({
  basics: z.object({
    name: z.string().default(''),
    headline: z.string().default(''),
    email: z.string().default(''),
    phone: z.string().default(''),
    location: z.string().default(''),
    website: z.string().default(''),
    github: z.string().default(''),
    linkedin: z.string().default(''),
  }).default({ name: '', headline: '', email: '', phone: '', location: '', website: '', github: '', linkedin: '' }),
  /** Two to four sentences in the user's own words. Tailoring keeps its voice. */
  summary: z.string().default(''),
  experience: z.array(experienceSchema).default([]),
  projects: z.array(projectSchema).default([]),
  skills: z.array(skillSchema).default([]),
  education: z.array(educationSchema).default([]),
  certifications: z.array(z.object({ id, name: z.string().min(1), issuer: z.string().default(''), year: z.string().default('') })).default([]),
  languages: z.array(z.object({ name: z.string().min(1), level: z.string().default('') })).default([]),
  /** A few sentences the user actually wrote (emails, posts, old cover letters). The writer copies their rhythm. */
  writingSamples: z.array(z.string()).default([]),
  preferences: preferencesSchema.default(preferencesSchema.parse({})),
})

export type Bullet = z.infer<typeof bulletSchema>
export type Experience = z.infer<typeof experienceSchema>
export type Project = z.infer<typeof projectSchema>
export type Profile = z.infer<typeof profileSchema>
export type Preferences = z.infer<typeof preferencesSchema>

export const emptyProfile = (): Profile => profileSchema.parse({})

/** Problems that make a profile unsafe to tailor from: duplicate ids, end before start, overlapping dates. */
export function profileProblems(profile: Profile): string[] {
  const problems: string[] = []
  const seen = new Set<string>()
  const allBullets = [...profile.experience.flatMap((e) => e.bullets), ...profile.projects.flatMap((p) => p.bullets)]
  for (const item of [...profile.experience, ...profile.projects, ...profile.education, ...allBullets]) {
    if (seen.has(item.id)) problems.push(`Duplicate id "${item.id}". Every entry needs its own id.`)
    seen.add(item.id)
  }
  for (const job of profile.experience) {
    if (job.end !== 'present' && job.end < job.start) problems.push(`${job.title} at ${job.company} ends (${job.end}) before it starts (${job.start}).`)
  }
  const today = new Date().toISOString().slice(0, 7)
  for (const job of profile.experience) {
    if (job.start > today) problems.push(`${job.title} at ${job.company} starts in the future (${job.start}).`)
  }
  return problems
}

/** Every skill name the user has, lower-cased, including aliases and the stacks of each job and project. */
export function profileSkillSet(profile: Profile): Set<string> {
  const names = new Set<string>()
  const add = (value: string) => {
    const clean = value.trim().toLowerCase()
    if (!clean) return
    names.add(clean)
    // "Cloudflare Workers" also covers a post that just says "Cloudflare".
    const head = clean.split(/\s+/)[0]
    if (head && head !== clean && head.length > 2) names.add(head)
  }
  for (const skill of profile.skills) {
    add(skill.name)
    skill.aliases.forEach(add)
  }
  for (const item of [...profile.experience, ...profile.projects]) {
    item.stack.forEach(add)
    item.bullets.forEach((bullet) => bullet.skills.forEach(add))
  }
  return names
}

export const formatMonth = (value: string) => {
  if (value === 'present') return 'Present'
  const [year, mon] = value.split('-')
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return mon ? `${names.at(Number(mon) - 1) ?? ''} ${year}` : value
}
