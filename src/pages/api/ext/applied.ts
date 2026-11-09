import { env } from 'cloudflare:workers'
import { z } from 'zod'

import { addEvent, getJob, getSettings, updateJobStatus } from '../../../server/db'
import { body, handler, HttpError, json } from '../../../server/http'

/** The extension marks a job applied after the user clicks submit on the real form. */
export const POST = handler(async ({ request }) => {
  const { jobId } = await body(request, z.object({ jobId: z.string().min(1) }))
  if (!(await getJob(env.DB, jobId))) throw new HttpError(404, 'No such job')
  await updateJobStatus(env.DB, jobId, 'applied', (await getSettings(env.DB)).followUpDays)
  await addEvent(env.DB, jobId, 'note', 'Marked applied from the browser')
  return json({ ok: true })
})
