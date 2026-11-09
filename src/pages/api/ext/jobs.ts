// "Save this job" from the extension: the page's URL, title and visible text. Claude reads it into fields when a key
// is set; otherwise the text is stored as it is and scored from the raw text.
import { env } from 'cloudflare:workers'
import { z } from 'zod'

import { detectEngagement, detectRate, detectRemote, enrichJob, type JobInput } from '../../../core/job'
import { claude, DEFAULT_MODEL, extractJob } from '../../../server/ai'
import { addEvent, currentProfile, getSettings, upsertJob } from '../../../server/db'
import { body, handler, json } from '../../../server/http'

export const POST = handler(async ({ request }) => {
  const input = await body(request, z.object({ url: z.url(), title: z.string().max(500).default(''), text: z.string().min(20).max(150000) }))
  const settings = await getSettings(env.DB)
  let job: JobInput
  if (env.ANTHROPIC_API_KEY) {
    job = await extractJob(claude(env.ANTHROPIC_API_KEY), settings.ai.model || env.CLAUDE_MODEL || DEFAULT_MODEL, input.text, input.url)
    job.source = 'extension'
  } else {
    job = {
      source: 'extension', externalId: `url:${input.url}`, url: input.url, applyUrl: input.url, title: input.title || 'Saved job', company: '',
      location: '', remote: detectRemote(input.text), engagement: detectEngagement(input.text), description: input.text.slice(0, 30000),
      ...detectRate(input.text), postedAt: null, ats: null,
    }
  }
  const { profile } = await currentProfile(env.DB)
  const res = await upsertJob(env.DB, enrichJob(job), profile, { ...settings, autoSkipBelow: 0 })
  if (res.added) await addEvent(env.DB, res.id, 'note', 'Saved from the browser')
  return json({ ...res, title: job.title, company: job.company })
})
