import { env } from 'cloudflare:workers'
import { z } from 'zod'

import { claude, DEFAULT_MODEL, tailorResume } from '../../../../server/ai'
import { addEvent, currentProfile, getJob, getSettings, newId, saveTailored } from '../../../../server/db'
import { body, handler, HttpError, json } from '../../../../server/http'
import { profileProblems, profileSkillSet } from '../../../../core/profile'
import { checkResume, profileDraft, resumeText } from '../../../../core/resume'
import { findTerms, keywordCoverage } from '../../../../core/keywords'

export const POST = handler(async ({ params, request }) => {
  // `ai: false` (or no ANTHROPIC_API_KEY) builds the draft from the profile alone: free, no network call.
  const { coverLetter, ai } = await body(request, z.object({ coverLetter: z.boolean().default(true), ai: z.boolean().default(true) }))
  const job = await getJob(env.DB, params.id!)
  if (!job) throw new HttpError(404, 'No such job')
  const [{ id: versionId, profile }, settings] = await Promise.all([currentProfile(env.DB), getSettings(env.DB)])
  if (!versionId || !profile.experience.length) throw new HttpError(400, 'Fill in your profile first: tailoring needs at least one job with bullets.')
  const problems = profileProblems(profile)
  if (problems.length) throw new HttpError(400, `Fix your profile first: ${problems.join(' ')}`)
  const useAi = ai && Boolean(env.ANTHROPIC_API_KEY)
  const model = useAi ? settings.ai.model || env.CLAUDE_MODEL || DEFAULT_MODEL : 'none'
  const result = useAi
    ? await tailorResume(claude(env.ANTHROPIC_API_KEY), profile, job, settings, { model, coverLetter })
    : (() => {
        const resume = profileDraft(profile, `${job.title}\n${job.description}`)
        const jobTerms = findTerms(`${job.title}\n${job.description}`, [...profileSkillSet(profile)])
        return { resume, checks: checkResume(profile, resume, settings.bannedPhrases), coverage: keywordCoverage(jobTerms, resumeText(profile, resume)), rounds: 0, model }
      })()
  const id = newId()
  await saveTailored(env.DB, { id, jobId: job.id, profileVersion: versionId, resume: result.resume, checks: result.checks, coverage: result.coverage, status: 'draft', model })
  await addEvent(env.DB, job.id, 'note', `${useAi ? 'Tailored resume drafted' : 'Resume drafted from the profile, no AI'} (${result.checks.filter((c) => c.severity === 'error').length} errors after ${result.rounds} fix rounds)`)
  return json({ id, ...result })
})
