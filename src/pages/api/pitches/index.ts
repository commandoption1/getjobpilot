import { env } from 'cloudflare:workers'
import { z } from 'zod'

import { claude, DEFAULT_MODEL, writePitch } from '../../../server/ai'
import { currentProfile, getCompany, getSettings, getTemplate, listPitches, newId, pitchTargets, savePitch, setCompanyContact } from '../../../server/db'
import { findContact } from '../../../server/contacts'
import { body, handler, HttpError, json } from '../../../server/http'
import { greeting, useTemplate } from '../../../server/letters'

export const GET = handler(async () => {
  const [pitches, targets] = await Promise.all([listPitches(env.DB), pitchTargets(env.DB, 40)])
  return json({ pitches, targets })
})

/**
 * Drafts a pitch to one company: from a saved pitch template (free), or written by Claude (a cent or so) when
 * `templateId` is left out. Either way the text goes through the same checks as a cover letter. Nothing is sent:
 * The user sends it from their own mailbox and marks it sent.
 */
export const POST = handler(async ({ request }) => {
  const input = await body(request, z.object({ companyId: z.string(), templateId: z.string().optional(), firstName: z.string().max(60).default(''), findEmail: z.boolean().default(true) }))
  const company = await getCompany(env.DB, input.companyId)
  if (!company) throw new HttpError(404, 'No such company')
  const [{ profile }, settings] = await Promise.all([currentProfile(env.DB), getSettings(env.DB)])

  let toEmail = company.contactEmail
  if (!toEmail && input.findEmail && company.website) {
    toEmail = (await findContact(fetch, company.website)).email
    await setCompanyContact(env.DB, company.id, toEmail)
  }

  let draft: { subject: string; body: string; checks: import('../../../core/resume').CheckIssue[] }
  let writtenBy: string
  if (input.templateId) {
    const template = await getTemplate(env.DB, input.templateId)
    if (!template) throw new HttpError(404, 'No such template')
    draft = useTemplate(profile, template, { company: company.name, first_name: input.firstName, name: input.firstName, greeting: greeting(input.firstName) }, settings.bannedPhrases)
    writtenBy = template.name
  } else {
    if (!profile.experience.length) throw new HttpError(400, 'Fill in your profile first.')
    const model = settings.ai.model || env.CLAUDE_MODEL || DEFAULT_MODEL
    draft = await writePitch(claude(env.ANTHROPIC_API_KEY), profile, company, settings, model)
    writtenBy = model
  }
  const id = newId()
  await savePitch(env.DB, { id, companyId: company.id, toEmail, ...draft, writtenBy })
  return json({ id, toEmail, ...draft })
})
