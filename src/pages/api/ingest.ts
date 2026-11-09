import { env } from 'cloudflare:workers'

import { handler, json } from '../../server/http'
import { fetchBudget, runIngest } from '../../server/ingest'

/** One window of sources. The dashboard calls this again until `wrapped` is true, so a click covers every source. */
export const POST = handler(async () => json(await runIngest(env.DB, fetch, fetchBudget(env.INGEST_FETCH_BUDGET))))
