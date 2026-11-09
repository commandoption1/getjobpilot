import { env } from 'cloudflare:workers'

import { letterPdf, resumePdf } from '../../core/pdf'
import { hasErrors } from '../../core/resume'
import { getJob, getTailored, profileVersion } from '../../server/db'
import { handler, HttpError } from '../../server/http'
import { paperFrom, pdfResponse } from '../../server/pdf'

/**
 * Downloads a tailored resume, or its cover letter with ?part=letter. Only an approved version can be downloaded,
 * so a draft with a failing check can't be sent by accident.
 */
export const GET = handler(async ({ params, url }) => {
  const t = await getTailored(env.DB, params.id!)
  if (!t) throw new HttpError(404, 'No such resume')
  if (t.status !== 'approved' || hasErrors(t.checks)) throw new HttpError(409, 'Approve this resume on the job page first.')
  const [version, job] = await Promise.all([profileVersion(env.DB, t.profileVersion), getJob(env.DB, t.jobId)])
  if (!version) throw new HttpError(404, 'The profile version behind this resume is gone')
  const { profile } = version
  if (url.searchParams.get('part') === 'letter') {
    if (!t.resume.coverLetter.trim()) throw new HttpError(404, 'This version has no cover letter')
    return pdfResponse(await letterPdf(profile, t.resume.coverLetter, paperFrom(url)), profile.basics.name, 'Cover letter', job?.company)
  }
  return pdfResponse(await resumePdf(profile, t.resume, paperFrom(url)), profile.basics.name, 'Resume', job?.company)
})
