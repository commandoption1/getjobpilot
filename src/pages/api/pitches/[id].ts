import { env } from 'cloudflare:workers'
import { z } from 'zod'

import { checkText, hasErrors } from '../../../core/resume'
import { currentProfile, deletePitch, getPitch, getSettings, savePitch, setPitchFollowUp, setPitchStatus } from '../../../server/db'
import { body, handler, HttpError, json } from '../../../server/http'

/** Saves edits and checks them again. Marking a pitch sent is refused while a check fails. */
export const PUT = handler(async ({ params, request }) => {
  const pitch = await getPitch(env.DB, params.id!)
  if (!pitch) throw new HttpError(404, 'No such pitch')
  const input = await body(request, z.object({
    toEmail: z.string().max(200).optional(), subject: z.string().max(300).optional(), body: z.string().max(6000).optional(),
    status: z.enum(['draft', 'sent', 'replied', 'no-reply']).optional(), followUpAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  }))
  const [{ profile }, settings] = await Promise.all([currentProfile(env.DB), getSettings(env.DB)])
  const next = { ...pitch, toEmail: input.toEmail ?? pitch.toEmail, subject: input.subject ?? pitch.subject, body: input.body ?? pitch.body }
  const context = [pitch.company, pitch.website]
  const checks = [...checkText(profile, 'Subject', next.subject, settings.bannedPhrases, context), ...checkText(profile, 'Pitch', next.body, settings.bannedPhrases, context)]
  await savePitch(env.DB, { ...next, checks })
  if (input.status === 'sent' && hasErrors(checks)) throw new HttpError(422, 'Fix the errors before marking this sent.')
  if (input.status && input.status !== pitch.status) await setPitchStatus(env.DB, pitch.id, input.status, settings.routine.pitchFollowUpDays)
  if (input.followUpAt !== undefined) await setPitchFollowUp(env.DB, pitch.id, input.followUpAt)
  return json({ pitch: await getPitch(env.DB, pitch.id), checks })
})

export const DELETE = handler(async ({ params }) => {
  await deletePitch(env.DB, params.id!)
  return json({ ok: true })
})
