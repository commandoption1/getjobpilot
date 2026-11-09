// Saved letters and pitches: the user's own text with placeholders. A template is checked like a cover letter when saved
// (with sample values filled in), and the filled text is checked again for every job or company it is used for.
import { z } from 'zod'

import { fillTemplate, unknownFields, type TemplateVars } from '../core/outreach'
import type { Profile } from '../core/profile'
import { checkText, type CheckIssue } from '../core/resume'

export const templateInput = z.object({
  name: z.string().min(1).max(120),
  kind: z.enum(['letter', 'pitch']).default('letter'),
  subject: z.string().max(200).default(''),
  body: z.string().min(1).max(6000),
})

const SAMPLE: TemplateVars = { company: 'Acme', role: 'Frontend Developer', name: 'Alex Lee', first_name: 'Alex', greeting: 'Hi Alex,' }

export function checkTemplate(profile: Profile, t: z.infer<typeof templateInput>, banned: string[]): CheckIssue[] {
  const issues: CheckIssue[] = []
  for (const f of unknownFields(`${t.subject}\n${t.body}`)) issues.push({ severity: 'error', where: 'Template', message: `Unknown placeholder {{${f}}}. Use company, role, name, first_name or greeting.` })
  const context = Object.values(SAMPLE) as string[]
  issues.push(...checkText(profile, 'Template', fillTemplate(t.body, SAMPLE).text, banned, context))
  if (t.subject) issues.push(...checkText(profile, 'Subject', fillTemplate(t.subject, SAMPLE).text, banned, context))
  return issues
}

/** Fills a template for one job or company and checks the result. Missing values are errors, so "{{role}}" can't be sent. */
export function useTemplate(profile: Profile, t: { subject: string; body: string }, vars: TemplateVars, banned: string[]) {
  const body = fillTemplate(t.body, vars)
  const subject = fillTemplate(t.subject, vars)
  const context = (Object.values(vars) as string[]).filter(Boolean)
  const checks: CheckIssue[] = [
    ...[...new Set([...body.missing, ...subject.missing])].map((f) => ({ severity: 'error' as const, where: 'Template', message: `No value for {{${f}}}. Fill it in by hand.` })),
    ...checkText(profile, 'Letter', body.text, banned, context),
    ...(subject.text ? checkText(profile, 'Subject', subject.text, banned, context) : []),
  ]
  return { subject: subject.text, body: body.text, checks }
}

export const greeting = (firstName: string) => (firstName ? `Hi ${firstName},` : 'Hi,')
