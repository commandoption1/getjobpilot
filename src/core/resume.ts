// A tailored resume is a selection from the profile, not a free-form document. The AI picks which jobs and bullets to
// show, may reword a bullet, and writes a headline and summary. Companies, titles, dates, schools and contact details
// always come from the profile by id, so the AI can't get them wrong.
import { z } from 'zod'

import { findTerms, canonicalTerm } from './keywords'
import { type Profile, profileSkillSet } from './profile'
import { lintBullets, lintText, type StyleIssue } from './style'

export const tailoredBulletSchema = z.object({
  /** The profile bullet(s) this line is written from. Merging two bullets is fine; inventing one is not. */
  sourceIds: z.array(z.string()).min(1),
  text: z.string().min(1),
})

export const tailoredResumeSchema = z.object({
  headline: z.string(),
  summary: z.string(),
  experience: z.array(z.object({ experienceId: z.string(), bullets: z.array(tailoredBulletSchema) })),
  projects: z.array(z.object({ projectId: z.string(), bullets: z.array(tailoredBulletSchema) })),
  /** Skill names to list, most relevant first. Each must be one the user has. */
  skills: z.array(z.string()),
  coverLetter: z.string(),
})
export type TailoredResume = z.infer<typeof tailoredResumeSchema>

/** The untailored resume: every job, project and bullet, in profile order. */
export function baseResume(profile: Profile): TailoredResume {
  return {
    headline: profile.basics.headline,
    summary: profile.summary,
    experience: profile.experience.map((e) => ({ experienceId: e.id, bullets: e.bullets.map((b) => ({ sourceIds: [b.id], text: b.text })) })),
    projects: profile.projects.map((p) => ({ projectId: p.id, bullets: p.bullets.map((b) => ({ sourceIds: [b.id], text: b.text })) })),
    skills: profile.skills.filter((s) => s.level !== 'learning').map((s) => s.name),
    coverLetter: '',
  }
}

/**
 * A tailored draft made without any AI call, for when no Claude API key is set (or to save money). It is still only a
 * selection from the profile: every job and bullet stays in, bullets that mention more of the job's terms move up,
 * and skills the job asks for are listed first. You then trim and edit it in the editor, where the same checks run.
 */
export function profileDraft(profile: Profile, jobText: string): TailoredResume {
  const base = baseResume(profile)
  const jobTerms = new Set(findTerms(jobText, [...profileSkillSet(profile)]).map((t) => t.canonical))
  const hits = (text: string) => findTerms(text, [...jobTerms]).filter((t) => jobTerms.has(t.canonical)).length
  const rank = <T extends { text: string }>(bullets: T[]) =>
    bullets.map((b, i) => ({ b, i, n: hits(b.text) })).sort((x, y) => y.n - x.n || x.i - y.i).map((x) => x.b)
  const skillHit = (name: string) => jobTerms.has(canonicalTerm(name))
  return {
    ...base,
    experience: base.experience.map((e) => ({ ...e, bullets: rank(e.bullets) })),
    projects: base.projects.map((p) => ({ ...p, bullets: rank(p.bullets) })),
    skills: [...base.skills.filter(skillHit), ...base.skills.filter((s) => !skillHit(s))].slice(0, 16),
  }
}

export type CheckIssue = { severity: 'error' | 'warning'; where: string; message: string }

const NUMBER = /(?<![a-z])\d+(?:[.,]\d+)?\s?(?:%|x|k|m|\+)?/gi
const normNum = (s: string) => s.toLowerCase().replace(/\s/g, '').replace(/,/g, '')

/** Numbers in `text` that don't appear in any of the sources. A made-up metric is the worst mistake a resume can have. */
function newNumbers(text: string, sources: string[]): string[] {
  const allowed = new Set(sources.flatMap((s) => (s.match(NUMBER) ?? []).map(normNum)))
  const bare = new Set([...allowed].map((n) => n.replace(/[%xkm+]$/, '')))
  return (text.match(NUMBER) ?? []).map(normNum).filter((n) => !allowed.has(n) && !bare.has(n.replace(/[%xkm+]$/, '')))
}

/** Tech terms in `text` that the user doesn't have and that the sources don't mention. */
function newSkills(text: string, sources: string[], mine: Set<string>): string[] {
  const sourceTerms = new Set(findTerms(sources.join('\n')).map((t) => t.canonical))
  return findTerms(text).filter((t) => !mine.has(t.canonical) && !sourceTerms.has(t.canonical)).map((t) => t.asWritten)
}

/** Every piece of text in the profile that free text (summary, letter, pitch) may take numbers and terms from. */
function profileFacts(profile: Profile): string[] {
  return [
    profile.summary, profile.basics.headline,
    ...profile.experience.flatMap((e) => [...e.bullets.map((b) => b.text), e.context, e.title, e.company, e.start, e.end]),
    ...profile.projects.flatMap((p) => [...p.bullets.map((b) => b.text), p.description]),
    ...profile.skills.map((s) => `${s.name} ${s.years ?? ''}`),
    ...profile.education.map((e) => `${e.degree} ${e.field} ${e.start} ${e.end}`),
    ...profile.certifications.map((c) => `${c.name} ${c.year}`),
  ]
}

function freeTextIssues(where: string, text: string, facts: string[], mine: Set<string>, extraBanned: string[]): CheckIssue[] {
  if (!text) return []
  const issues: CheckIssue[] = []
  const nums = newNumbers(text, facts)
  if (nums.length) issues.push({ severity: 'error', where, message: `Has numbers not in your profile: ${nums.join(', ')}` })
  const skills = newSkills(text, facts, mine)
  if (skills.length) issues.push({ severity: 'error', where, message: `Mentions skills you haven't listed: ${skills.join(', ')}` })
  for (const s of lintText(text, extraBanned)) issues.push({ severity: 'error', where, message: `${s.message}${s.excerpt ? `: "${s.excerpt}"` : ''}` })
  return issues
}

/**
 * The same checks a cover letter gets, for any other text sent in the user's name (a pitch email, a saved letter template).
 * `context` is text that may also supply numbers and terms, such as the company's name and the job title.
 */
export function checkText(profile: Profile, where: string, text: string, extraBanned: string[] = [], context: string[] = []): CheckIssue[] {
  const mine = new Set([...profileSkillSet(profile)].map(canonicalTerm))
  const issues = freeTextIssues(where, text, [...profileFacts(profile), ...context], mine, extraBanned)
  if (text.split(/\s+/).length > 300) issues.push({ severity: 'warning', where, message: 'Over 300 words' })
  return issues
}

/**
 * Every check that must pass before a tailored resume can be approved. Errors block approval; warnings are shown.
 * The checks are plain code, so they hold no matter what the AI wrote.
 */
export function checkResume(profile: Profile, resume: TailoredResume, extraBanned: string[] = []): CheckIssue[] {
  const issues: CheckIssue[] = []
  const mine = new Set([...profileSkillSet(profile)].map(canonicalTerm))
  const bulletText = new Map<string, string>()
  const owner = new Map<string, string>()
  for (const e of profile.experience) for (const b of e.bullets) { bulletText.set(b.id, b.text); owner.set(b.id, e.id) }
  for (const p of profile.projects) for (const b of p.bullets) { bulletText.set(b.id, b.text); owner.set(b.id, p.id) }
  const allProfileText = profileFacts(profile)
  const issue = (severity: CheckIssue['severity'], where: string, message: string) => issues.push({ severity, where, message })
  const style = (where: string, found: StyleIssue[]) => found.forEach((s) => issue('error', where, `${s.message}${s.excerpt ? `: "${s.excerpt}"` : ''}`))

  const checkLines = (kind: 'experience' | 'project', parentId: string, label: string, bullets: TailoredResume['experience'][number]['bullets']) => {
    bullets.forEach((bullet, i) => {
      const where = `${label}, bullet ${i + 1}`
      const sources: string[] = []
      for (const sid of bullet.sourceIds) {
        const text = bulletText.get(sid)
        if (text === undefined) issue('error', where, `Points to a profile bullet that doesn't exist (${sid})`)
        else if (owner.get(sid) !== parentId) issue('error', where, `Uses a bullet from a different ${kind} (${sid})`)
        else sources.push(text)
      }
      if (!sources.length) return
      const nums = newNumbers(bullet.text, sources)
      if (nums.length) issue('error', where, `Has numbers not in your profile: ${nums.join(', ')}`)
      const skills = newSkills(bullet.text, sources, mine)
      if (skills.length) issue('error', where, `Mentions skills you haven't listed: ${skills.join(', ')}`)
      if (bullet.text.length > 260) issue('warning', where, `Long bullet (${bullet.text.length} characters). Aim for under 220.`)
      if (/^(i|we|my)\b/i.test(bullet.text.trim())) issue('warning', where, 'Start bullets with a verb, not "I" or "we"')
    })
    style(label, lintBullets(bullets.map((b) => b.text), extraBanned))
  }

  const seenExp = new Set<string>()
  for (const item of resume.experience) {
    const job = profile.experience.find((e) => e.id === item.experienceId)
    if (!job) { issue('error', 'Experience', `Unknown job id ${item.experienceId}`); continue }
    if (seenExp.has(job.id)) issue('error', job.company, 'This job appears twice')
    seenExp.add(job.id)
    checkLines('experience', job.id, `${job.title} at ${job.company}`, item.bullets)
    if (!item.bullets.length) issue('warning', job.company, 'Listed with no bullets')
  }
  // Leaving a job out makes a gap an ATS or a recruiter will notice; only warn, the user may want that.
  for (const job of profile.experience) {
    if (!seenExp.has(job.id) && job.end >= String(new Date().getFullYear() - 6)) issue('warning', job.company, `${job.title} at ${job.company} is left out, which leaves a gap in recent years`)
  }
  for (const item of resume.projects) {
    const project = profile.projects.find((p) => p.id === item.projectId)
    if (!project) { issue('error', 'Projects', `Unknown project id ${item.projectId}`); continue }
    checkLines('project', project.id, project.name, item.bullets)
  }

  for (const skill of resume.skills) {
    if (!mine.has(canonicalTerm(skill))) issue('error', 'Skills', `"${skill}" is not in your profile`)
  }
  if (new Set(resume.skills.map(canonicalTerm)).size !== resume.skills.length) issue('warning', 'Skills', 'A skill is listed twice')

  for (const [where, text] of [['Headline', resume.headline], ['Summary', resume.summary], ['Cover letter', resume.coverLetter]] as const) {
    issues.push(...freeTextIssues(where, text, allProfileText, mine, extraBanned))
  }
  if (resume.summary.split(/\s+/).length > 90) issue('warning', 'Summary', 'Summary is over 90 words')
  if (resume.coverLetter && resume.coverLetter.split(/\s+/).length > 300) issue('warning', 'Cover letter', 'Cover letter is over 300 words')
  return issues
}

export const hasErrors = (issues: CheckIssue[]) => issues.some((i) => i.severity === 'error')

/** Plain text of the resume, for keyword coverage and for pasting into forms that want text. */
export function resumeText(profile: Profile, resume: TailoredResume): string {
  const lines = [profile.basics.name, resume.headline, resume.summary]
  for (const item of resume.experience) {
    const job = profile.experience.find((e) => e.id === item.experienceId)
    if (!job) continue
    lines.push(`${job.title}, ${job.company}`, ...item.bullets.map((b) => `- ${b.text}`))
  }
  for (const item of resume.projects) {
    const p = profile.projects.find((x) => x.id === item.projectId)
    if (p) lines.push(p.name, ...item.bullets.map((b) => `- ${b.text}`))
  }
  lines.push(`Skills: ${resume.skills.join(', ')}`)
  return lines.filter(Boolean).join('\n')
}
