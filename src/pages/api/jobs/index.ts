import { env } from 'cloudflare:workers'
import { z } from 'zod'

import { detectEngagement, detectRate, detectRemote, enrichJob, jobInputSchema, pipelineStatuses, type JobInput } from '../../../core/job'
import { claude, DEFAULT_MODEL, extractJob } from '../../../server/ai'
import { addEvent, currentProfile, getSettings, listJobs, upsertJob } from '../../../server/db'
import { body, handler, json } from '../../../server/http'

export const GET = handler(async ({ url }) => {
  const p = url.searchParams
  const status = p.get('status') ?? 'new'
  const jobs = await listJobs(env.DB, {
    status: (['all', 'active', ...pipelineStatuses] as string[]).includes(status) ? status as never : 'new',
    minScore: Number(p.get('minScore') ?? 0) || undefined,
    engagement: p.get('engagement') || undefined,
    q: p.get('q') || undefined,
  })
  // The feed doesn't need full descriptions.
  return json(jobs.map((j) => ({ ...j, description: j.description.slice(0, 400) })))
})

const addSchema = z.union([
  z.object({ text: z.string().min(40).max(100000), url: z.string().default('') }),
  z.object({ job: jobInputSchema.partial({ source: true, externalId: true }) }),
])

/** Without a Claude key, a pasted post is stored as it is: first line as the title, the rest read by plain code. */
function pastedJob(text: string, url: string): JobInput {
  const title = text.trim().split('\n')[0]!.trim().slice(0, 200) || 'Pasted job'
  return {
    source: 'manual', externalId: url ? `url:${url}` : `manual:${crypto.randomUUID()}`, url, applyUrl: url, title, company: '',
    location: '', remote: detectRemote(text), engagement: detectEngagement(text), description: text.slice(0, 30000),
    ...detectRate(text), postedAt: null, ats: null,
  }
}

/** Adds a job by hand: either pasted text (read by Claude when a key is set) or fields filled in the form. */
export const POST = handler(async ({ request }) => {
  const input = await body(request, addSchema)
  const settings = await getSettings(env.DB)
  const job = 'text' in input
    ? env.ANTHROPIC_API_KEY
      ? await extractJob(claude(env.ANTHROPIC_API_KEY), settings.ai.model || env.CLAUDE_MODEL || DEFAULT_MODEL, input.text, input.url)
      : pastedJob(input.text, input.url)
    : jobInputSchema.parse({ source: 'manual', externalId: input.job.url ? `url:${input.job.url}` : `manual:${crypto.randomUUID()}`, ...input.job })
  const { profile } = await currentProfile(env.DB)
  // Added by hand means the user wants to see it, so it is never auto-skipped.
  const res = await upsertJob(env.DB, enrichJob(job), profile, { ...settings, autoSkipBelow: 0 })
  if (res.added) await addEvent(env.DB, res.id, 'note', 'Added by hand')
  return json(res)
})
