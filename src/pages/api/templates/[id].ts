import { env } from 'cloudflare:workers'

import { hasErrors } from '../../../core/resume'
import { currentProfile, deleteTemplate, getSettings, saveTemplate } from '../../../server/db'
import { body, handler, HttpError, json } from '../../../server/http'
import { checkTemplate, templateInput } from '../../../server/letters'

export const PUT = handler(async ({ params, request }) => {
  const input = await body(request, templateInput)
  const [{ profile }, settings] = await Promise.all([currentProfile(env.DB), getSettings(env.DB)])
  const checks = checkTemplate(profile, input, settings.bannedPhrases)
  if (hasErrors(checks)) throw new HttpError(422, checks.filter((c) => c.severity === 'error').map((c) => c.message).join('; '))
  await saveTemplate(env.DB, { id: params.id!, ...input })
  return json({ ok: true, checks })
})

export const DELETE = handler(async ({ params }) => {
  await deleteTemplate(env.DB, params.id!)
  return json({ ok: true })
})
