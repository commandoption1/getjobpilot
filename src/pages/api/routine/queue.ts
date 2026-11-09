import { env } from 'cloudflare:workers'

import { localDayStart, orderQueue } from '../../../core/outreach'
import { doneSince, getSettings, queueCandidates } from '../../../server/db'
import { handler, json } from '../../../server/http'

/** Today's apply queue and how far along the day's goal is. */
export const GET = handler(async () => {
  const settings = await getSettings(env.DB)
  const r = settings.routine
  const [candidates, today] = await Promise.all([queueCandidates(env.DB), doneSince(env.DB, localDayStart(r.utcOffset))])
  // Twice the goal, so a skipped job has a next one waiting.
  const jobs = orderQueue(candidates, r.queueMinScore, Math.max(10, r.applicationsPerDay * 2))
  return json({ jobs, today, goal: { applications: r.applicationsPerDay, pitches: r.pitchesPerDay } })
})
