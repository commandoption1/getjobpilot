// Worker entry (wrangler.jsonc `main`). Astro handles requests. Two crons: every 4 hours the next window of job sources
// is fetched, and every hour the digest checks whether it is the hour set in Settings and, if so, goes to Telegram.
import { handle } from '@astrojs/cloudflare/handler'

import { runDigest } from './server/digest'
import { fetchBudget, runIngest } from './server/ingest'

/** Must match the second cron in wrangler.jsonc. */
const DIGEST_CRON = '0 * * * *'

const log = (event: string) => (result: unknown) => console.log(JSON.stringify({ event, ...(result as object) }))
const warn = (event: string) => (error: unknown) => console.warn(JSON.stringify({ event, error: error instanceof Error ? error.message : String(error) }))

export default {
  fetch: handle,
  async scheduled(controller, env, ctx) {
    if (controller.cron === DIGEST_CRON) {
      ctx.waitUntil(runDigest(env).then(({ sent, reason }) => { if (sent || reason !== 'Not the digest hour yet') log('digest')({ sent, reason }) }).catch(warn('digest-error')))
      return
    }
    ctx.waitUntil(runIngest(env.DB, fetch, fetchBudget(env.INGEST_FETCH_BUDGET)).then(log('ingest')).catch(warn('ingest-error')))
  },
} satisfies ExportedHandler<Env>
