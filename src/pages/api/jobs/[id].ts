import { env } from 'cloudflare:workers'
import { z } from 'zod'

import { pipelineStatuses } from '../../../core/job'
import { addEvent, deleteJob, getJob, getSettings, jobEvents, rateJob, setFollowUp, tailoredForJob, updateJobStatus } from '../../../server/db'
import { body, handler, HttpError, json } from '../../../server/http'

export const GET = handler(async ({ params }) => {
  const job = await getJob(env.DB, params.id!)
  if (!job) throw new HttpError(404, 'No such job')
  return json({ job, tailored: await tailoredForJob(env.DB, job.id), events: await jobEvents(env.DB, job.id) })
})

export const PATCH = handler(async ({ params, request }) => {
  const id = params.id!
  if (!(await getJob(env.DB, id))) throw new HttpError(404, 'No such job')
  const patch = await body(request, z.object({
    status: z.enum(pipelineStatuses).optional(),
    rating: z.number().int().min(-1).max(1).nullable().optional(),
    note: z.string().max(4000).optional(),
    followUpAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    log: z.string().max(2000).optional(),
  }))
  if (patch.status) await updateJobStatus(env.DB, id, patch.status, (await getSettings(env.DB)).followUpDays)
  if (patch.rating !== undefined || patch.note !== undefined) {
    const current = await getJob(env.DB, id)
    await rateJob(env.DB, id, patch.rating !== undefined ? patch.rating : current!.myRating, patch.note)
  }
  if (patch.followUpAt !== undefined) await setFollowUp(env.DB, id, patch.followUpAt)
  if (patch.log) await addEvent(env.DB, id, 'note', patch.log)
  return json({ job: await getJob(env.DB, id) })
})

export const DELETE = handler(async ({ params }) => {
  await deleteJob(env.DB, params.id!)
  return json({ ok: true })
})
