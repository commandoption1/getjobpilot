import { env } from 'cloudflare:workers'
import { z } from 'zod'

import { findTerms, keywordCoverage } from '../../../core/keywords'
import { profileSkillSet } from '../../../core/profile'
import { checkResume, hasErrors, resumeText, tailoredResumeSchema } from '../../../core/resume'
import { addEvent, getJob, getSettings, getTailored, profileVersion, saveTailored } from '../../../server/db'
import { body, handler, HttpError, json } from '../../../server/http'

export const GET = handler(async ({ params }) => {
  const t = await getTailored(env.DB, params.id!)
  if (!t) throw new HttpError(404, 'No such resume')
  return json(t)
})

/** Saves the user's edits, runs every check again, and approves only when nothing fails. */
export const PUT = handler(async ({ params, request }) => {
  const t = await getTailored(env.DB, params.id!)
  if (!t) throw new HttpError(404, 'No such resume')
  const { resume, approve } = await body(request, z.object({ resume: tailoredResumeSchema, approve: z.boolean().default(false) }))
  const [version, job, settings] = await Promise.all([profileVersion(env.DB, t.profileVersion), getJob(env.DB, t.jobId), getSettings(env.DB)])
  if (!version || !job) throw new HttpError(404, 'The profile version or job behind this resume is gone')
  const checks = checkResume(version.profile, resume, settings.bannedPhrases)
  const coverage = keywordCoverage(findTerms(`${job.title}\n${job.description}`, [...profileSkillSet(version.profile)]), resumeText(version.profile, resume))
  if (approve && hasErrors(checks)) {
    await saveTailored(env.DB, { ...t, resume, checks, coverage, status: 'draft' })
    throw new HttpError(422, 'Fix the errors before approving.')
  }
  await saveTailored(env.DB, { ...t, resume, checks, coverage, status: approve ? 'approved' : t.status === 'approved' ? 'draft' : t.status })
  if (approve) await addEvent(env.DB, job.id, 'note', 'Tailored resume approved')
  return json({ checks, coverage, status: approve ? 'approved' : 'draft' })
})
