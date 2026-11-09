import { env } from 'cloudflare:workers'

import { currentProfile, getSettings, rescoreAll } from '../../server/db'
import { handler, json } from '../../server/http'

export const POST = handler(async () => json({ rescored: await rescoreAll(env.DB, (await currentProfile(env.DB)).profile, await getSettings(env.DB)) }))
