import { env } from 'cloudflare:workers'
import { z } from 'zod'

import { fillTemplate } from '../../../../core/outreach'
import { getJob, getTemplate } from '../../../../server/db'
import { body, handler, HttpError, json } from '../../../../server/http'
import { greeting } from '../../../../server/letters'

/** Fills a saved letter for this job. No AI call. The editor puts it in the cover letter box and runs the usual checks. */
export const POST = handler(async ({ params, request }) => {
  const { templateId, firstName } = await body(request, z.object({ templateId: z.string(), firstName: z.string().max(60).default('') }))
  const [job, template] = await Promise.all([getJob(env.DB, params.id!), getTemplate(env.DB, templateId)])
  if (!job) throw new HttpError(404, 'No such job')
  if (!template) throw new HttpError(404, 'No such template')
  const filled = fillTemplate(template.body, { company: job.company, role: job.title, first_name: firstName, name: firstName, greeting: greeting(firstName) })
  return json(filled)
})
