import { env } from 'cloudflare:workers'
import { z } from 'zod'

import { listProfileVersions, profileVersion, saveProfile } from '../../../server/db'
import { body, handler, HttpError, json } from '../../../server/http'

export const GET = handler(async () => json(await listProfileVersions(env.DB)))

/** Restores an old version by saving a copy of it as the newest. Nothing is ever overwritten. */
export const POST = handler(async ({ request }) => {
  const { id } = await body(request, z.object({ id: z.number().int().positive() }))
  const old = await profileVersion(env.DB, id)
  if (!old) throw new HttpError(404, 'No such version')
  return json({ id: await saveProfile(env.DB, old.profile, `Restored version ${id}`) })
})
