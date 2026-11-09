import { env } from 'cloudflare:workers'

import { resumePdf } from '../../core/pdf'
import { baseResume } from '../../core/resume'
import { currentProfile } from '../../server/db'
import { handler } from '../../server/http'
import { paperFrom, pdfResponse } from '../../server/pdf'

/** The untailored resume from the current profile, as a PDF download. */
export const GET = handler(async ({ url }) => {
  const { profile } = await currentProfile(env.DB)
  return pdfResponse(await resumePdf(profile, baseResume(profile), paperFrom(url)), profile.basics.name, 'Resume')
})
