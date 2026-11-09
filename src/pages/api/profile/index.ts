import { env } from 'cloudflare:workers'
import { z } from 'zod'

import { profileProblems, profileSchema } from '../../../core/profile'
import { currentProfile, getSettings, profileVersion, rescoreAll, saveProfile } from '../../../server/db'
import { body, handler, HttpError, json } from '../../../server/http'

export const GET = handler(async ({ url }) => {
  const id = Number(url.searchParams.get('version') ?? 0)
  const v = id ? await profileVersion(env.DB, id) : await currentProfile(env.DB)
  if (!v) throw new HttpError(404, 'No such version')
  return json({ ...v, problems: profileProblems(v.profile) })
})

export const PUT = handler(async ({ request }) => {
  const { profile, note } = await body(request, z.object({ profile: profileSchema, note: z.string().max(200).default('') }))
  const problems = profileProblems(profile)
  const id = await saveProfile(env.DB, profile, note)
  // Preferences and skills feed the score, so every open job is scored again.
  const rescored = await rescoreAll(env.DB, profile, await getSettings(env.DB))
  return json({ id, problems, rescored })
})
