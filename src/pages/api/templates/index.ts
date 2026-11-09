import { env } from 'cloudflare:workers'

import { hasErrors } from '../../../core/resume'
import { currentProfile, getSettings, listTemplates, newId, saveTemplate } from '../../../server/db'
import { body, handler, HttpError, json } from '../../../server/http'
import { checkTemplate, templateInput } from '../../../server/letters'

export const GET = handler(async () => json(await listTemplates(env.DB)))

/** Saves a template only when it passes the same checks as a cover letter. */
export const POST = handler(async ({ request }) => {
  const input = await body(request, templateInput)
  const [{ profile }, settings] = await Promise.all([currentProfile(env.DB), getSettings(env.DB)])
  const checks = checkTemplate(profile, input, settings.bannedPhrases)
  if (hasErrors(checks)) throw new HttpError(422, checks.filter((c) => c.severity === 'error').map((c) => c.message).join('; '))
  const id = newId()
  await saveTemplate(env.DB, { id, ...input })
  return json({ id, checks })
})
