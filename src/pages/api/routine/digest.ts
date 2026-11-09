import { env } from 'cloudflare:workers'

import { runDigest } from '../../../server/digest'
import { handler, json } from '../../../server/http'

/** The "Send a test digest" button: builds today's message and sends it, even when the daily digest is off. */
export const POST = handler(async ({ url }) => json(await runDigest(env, fetch, { force: true, appUrl: url.origin })))
