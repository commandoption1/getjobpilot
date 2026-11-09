// Claude API calls. Two jobs only: read a job post into fields, and write a tailored resume from the profile.
// Every tailored draft is checked by plain code (src/core/resume.ts, src/core/style.ts). When a check fails, the exact
// problems go back to the writer to fix, up to `repairRounds` times. Whatever still fails is shown to the user and blocks
// approval, so a draft with an invented number or a banned phrase can't be sent by accident.
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'

import { detectEngagement, detectRate, type JobInput } from '../core/job'
import { findTerms, keywordCoverage, type Coverage } from '../core/keywords'
import { type Profile, profileSkillSet } from '../core/profile'
import { checkResume, checkText, hasErrors, resumeText, tailoredResumeSchema, type CheckIssue, type TailoredResume } from '../core/resume'
import type { Settings } from '../core/settings'
import { DEFAULT_BANNED_PHRASES } from '../core/style'

export const DEFAULT_MODEL = 'claude-opus-5-5'

export function claude(apiKey: string | undefined) {
  if (!apiKey) throw new Error('This needs a Claude API key, which is optional. Add one with `npx wrangler secret put ANTHROPIC_API_KEY`, or use the free option: a saved template, or "Draft from my profile".')
  return new Anthropic({ apiKey, maxRetries: 2 })
}

/** Messages on the beta path so the server-side refusal fallback can be turned on. */
/**
 * `user` is the stable part of the prompt (profile and job) and is cached, so repair rounds, which resend it with the
 * draft and the problems in `extra`, pay about a tenth of the input price for it.
 */
async function parse<T extends z.ZodType>(client: Anthropic, args: { model: string; effort: Settings['ai']['effort']; system: string; user: string; extra?: string; schema: T; maxTokens?: number }): Promise<z.infer<T>> {
  const response = await client.beta.messages.parse({
    model: args.model,
    max_tokens: args.maxTokens ?? 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: args.effort, format: zodOutputFormat(args.schema) },
    system: args.system,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: args.user, cache_control: { type: 'ephemeral' } },
        ...(args.extra ? [{ type: 'text' as const, text: args.extra }] : []),
      ],
    }],
  })
  const u = response.usage
  console.log(JSON.stringify({ event: 'claude-usage', model: response.model, input: u.input_tokens, cacheRead: u.cache_read_input_tokens, cacheWrite: u.cache_creation_input_tokens, output: u.output_tokens }))
  if (response.stop_reason === 'refusal') throw new Error('The model declined this request.')
  if (response.stop_reason === 'max_tokens') throw new Error('The answer was cut off. Try again, or shorten the job text.')
  if (!response.parsed_output) throw new Error('The model returned something that did not match the expected format.')
  return response.parsed_output as z.infer<T>
}

// ---------- reading a job post ----------

const extractedJobSchema = z.object({
  title: z.string(),
  company: z.string(),
  location: z.string(),
  remote: z.enum(['yes', 'no', 'unknown']),
  engagement: z.enum(['contract', 'freelance', 'full-time', 'part-time', 'unknown']),
  rateMin: z.number(),
  rateMax: z.number(),
  rateUnit: z.enum(['hour', 'day', 'year', 'project', 'unknown']),
  currency: z.string(),
  /** The post's own text with page chrome (menus, cookie banners, other listings) removed. Not summarized. */
  description: z.string(),
})

/** Turns a pasted job post, or the text of a page the extension saved, into job fields. */
export async function extractJob(client: Anthropic, model: string, raw: string, url: string): Promise<JobInput> {
  const text = raw.slice(0, 60000)
  const out = await parse(client, {
    model, effort: 'low', schema: extractedJobSchema, maxTokens: 16000,
    system: 'You read job posts and return their fields exactly as the post states them. Never guess: use "unknown", an empty string, or 0 when the post does not say. Copy the description text from the post itself, keeping its wording and line breaks, and drop only page chrome such as menus, footers, cookie notices and other job listings.',
    user: `Page URL: ${url || 'none'}\n\n<post>\n${text}\n</post>`,
  })
  const fallbackRate = detectRate(out.description)
  return {
    source: 'manual',
    externalId: url ? `url:${url}` : `manual:${crypto.randomUUID()}`,
    url, applyUrl: url, title: out.title || 'Untitled role', company: out.company, location: out.location,
    remote: out.remote === 'yes' ? true : out.remote === 'no' ? false : null,
    engagement: out.engagement === 'unknown' ? detectEngagement(out.description) : out.engagement,
    description: out.description || text,
    ...(out.rateMin > 0
      ? { rateMin: out.rateMin, rateMax: out.rateMax || out.rateMin, rateUnit: out.rateUnit === 'unknown' ? null : out.rateUnit, currency: out.currency || null }
      : fallbackRate),
    postedAt: null,
    ats: /greenhouse\.io/.test(url) ? 'greenhouse' : /lever\.co/.test(url) ? 'lever' : /ashbyhq\.com/.test(url) ? 'ashby' : /workable\.com/.test(url) ? 'workable' : null,
  }
}

// ---------- tailoring ----------

const WRITER_RULES = `You tailor a resume for one job from a master profile. The profile is the only source of facts.

What you may do:
- Choose which jobs, projects and bullets to include, and their order inside each section.
- Reword a bullet so it uses the job post's own terms for a skill the bullet already shows (for example "Workers" becomes "Cloudflare Workers" if that is the post's wording).
- Merge two bullets from the same job into one line, listing both ids in sourceIds.
- Write a headline (under 12 words) and a summary (2 to 4 sentences, under 80 words) from facts in the profile.
- Write a short cover letter or freelance proposal (120 to 220 words) when asked.

What you must never do:
- Add any number, metric, percentage, team size, date, duration, client, tool, skill or responsibility that is not in the profile. If a bullet has no number, the new line has no number.
- Claim a skill the profile does not list, even if the job asks for it. Missing skills stay missing.
- Change a company name, job title, date or school. Those are filled in from the profile by id, not by you.
- Use ids that are not in the profile, or attach a bullet to a different job than the one it belongs to.

How it must read:
- Like a capable person wrote it plainly: concrete verbs, specific objects, varied sentence length. No filler, no hype, no adjectives about yourself.
- Keep the candidate's own wording wherever it already fits the job. Change only what the job needs. Copy the rhythm of the writing samples.
- Plain ASCII punctuation: straight quotes, commas and periods. No em dashes, en dashes, exclamation marks or emoji, and at most one semicolon in the whole document.
- Start each bullet with a past-tense verb (present tense for a current job). Do not start three bullets in a row with the same word.
- Never use any phrase from the banned list.
- First person in the cover letter, no "I am excited", no restating the job post back to the reader. Say what the candidate did that matches the work, and offer a next step.

Selection:
- Every job from the last 6 years stays in, even if only with one bullet, so there is no gap.
- 3 to 6 bullets for the most relevant jobs, 1 to 2 for the rest. Most relevant bullet first.
- Skills list: only names from the profile, most relevant to this job first, 8 to 16 items, using the job post's spelling where it is the same skill.`

function tailorPrompt(profile: Profile, job: JobInput, wantLetter: boolean, banned: string[]) {
  const mine = profileSkillSet(profile)
  const asked = findTerms(`${job.title}\n${job.description}`, [...mine])
  const have = asked.filter((t) => mine.has(t.canonical) || [...mine].some((m) => m === t.asWritten.toLowerCase())).map((t) => t.asWritten)
  const lacking = asked.filter((t) => !have.includes(t.asWritten)).map((t) => t.asWritten)
  const { preferences: _prefs, ...facts } = profile
  return `<profile>
${JSON.stringify(facts, null, 1)}
</profile>

<job>
Title: ${job.title}
Company: ${job.company}
Work type: ${job.engagement}
Location: ${job.location}

${job.description.slice(0, 30000)}
</job>

Skills the job names that the profile has (use these exact spellings where they fit): ${have.join(', ') || 'none detected'}
Skills the job names that the profile does NOT have (never claim these): ${lacking.join(', ') || 'none'}

Banned phrases: ${[...DEFAULT_BANNED_PHRASES, ...banned].join('; ')}

${wantLetter ? `Write the coverLetter as ${job.engagement === 'freelance' || job.source.includes('freelancer') ? 'a short freelance proposal' : 'a short cover letter'} signed with the name in basics.` : 'Leave coverLetter as an empty string.'}`
}

function repairPrompt(issues: CheckIssue[]) {
  return `The draft below failed these checks. Fix every one and return the whole resume again. Do not change anything that passed.\n\n${issues.filter((i) => i.severity === 'error').map((i) => `- ${i.where}: ${i.message}`).join('\n')}`
}

export type TailorResult = { resume: TailoredResume; checks: CheckIssue[]; coverage: Coverage; rounds: number; model: string }

export async function tailorResume(client: Anthropic, profile: Profile, job: JobInput, settings: Settings, opts: { model: string; coverLetter: boolean }): Promise<TailorResult> {
  const user = tailorPrompt(profile, job, opts.coverLetter, settings.bannedPhrases)
  let resume = await parse(client, { model: opts.model, effort: settings.ai.effort, system: WRITER_RULES, user, schema: tailoredResumeSchema })
  let checks = checkResume(profile, resume, settings.bannedPhrases)
  let rounds = 0
  while (hasErrors(checks) && rounds < settings.ai.repairRounds) {
    rounds++
    resume = await parse(client, {
      model: opts.model, effort: settings.ai.effort, system: WRITER_RULES, schema: tailoredResumeSchema,
      user, extra: `<draft>\n${JSON.stringify(resume, null, 1)}\n</draft>\n\n${repairPrompt(checks)}`,
    })
    checks = checkResume(profile, resume, settings.bannedPhrases)
  }
  const jobTerms = findTerms(`${job.title}\n${job.description}`, [...profileSkillSet(profile)])
  return { resume, checks, coverage: keywordCoverage(jobTerms, resumeText(profile, resume)), rounds, model: opts.model }
}

// ---------- direct pitches ----------

const PITCH_RULES = `You write a short cold email from a freelance developer to a small startup that has no job posting. The profile is the only source of facts about the sender.

Rules:
- 70 to 130 words in the body. A subject line under 8 words, plain, no clickbait.
- Open with one sentence about the company from the facts given (what it makes), not flattery.
- Then one or two things the sender has actually built that are closest to the company's work, taken from the profile.
- Say they work as a contractor and can start with a small paid task. End with one simple question.
- Never add a number, skill, tool, client or result that is not in the profile. Never claim to know the company's stack or problems beyond the facts given.
- Plain ASCII punctuation, no em or en dashes, no exclamation marks, no emoji. No "I hope this finds you well", no "I am excited", nothing from the banned list.
- Sign with the name in basics and the website or GitHub link from basics if there is one.`

const pitchSchema = z.object({ subject: z.string(), body: z.string() })

export type PitchCompany = { name: string; website: string; industry: string; stage: string; notes: string; teamSize?: number | null }

export async function writePitch(client: Anthropic, profile: Profile, company: PitchCompany, settings: Settings, model: string): Promise<{ subject: string; body: string; checks: CheckIssue[] }> {
  const { preferences: _prefs, ...facts } = profile
  const user = `<profile>\n${JSON.stringify(facts)}\n</profile>\n\n<company>\nName: ${company.name}\nWebsite: ${company.website}\nIndustry: ${company.industry || 'unknown'}\nStage: ${company.stage || 'unknown'}\nTeam size: ${company.teamSize ?? 'unknown'}\nWhat it does: ${company.notes.slice(0, 1500) || 'unknown'}\n</company>\n\nBanned phrases: ${[...DEFAULT_BANNED_PHRASES, ...settings.bannedPhrases].join('; ')}`
  const context = [company.name, company.website]
  let out = await parse(client, { model, effort: 'low', system: PITCH_RULES, user, schema: pitchSchema, maxTokens: 4000 })
  let checks = [...checkText(profile, 'Subject', out.subject, settings.bannedPhrases, context), ...checkText(profile, 'Pitch', out.body, settings.bannedPhrases, context)]
  for (let round = 0; hasErrors(checks) && round < settings.ai.repairRounds; round++) {
    out = await parse(client, { model, effort: 'low', system: PITCH_RULES, user, schema: pitchSchema, maxTokens: 4000, extra: `<draft>\n${JSON.stringify(out)}\n</draft>\n\n${repairPrompt(checks)}` })
    checks = [...checkText(profile, 'Subject', out.subject, settings.bannedPhrases, context), ...checkText(profile, 'Pitch', out.body, settings.bannedPhrases, context)]
  }
  return { ...out, checks }
}
