// A job or contract from any source, normalized to one shape before it is stored and scored.
import { z } from 'zod'

export const engagementValues = ['contract', 'freelance', 'full-time', 'part-time', 'unknown'] as const

export const jobInputSchema = z.object({
  source: z.string().min(1),
  /** The source's own id, so a re-fetch updates the row instead of adding a copy. */
  externalId: z.string().min(1),
  url: z.string().default(''),
  /** Where to apply, when it differs from the post's page. */
  applyUrl: z.string().default(''),
  title: z.string().min(1),
  company: z.string().default(''),
  location: z.string().default(''),
  remote: z.boolean().nullable().default(null),
  engagement: z.enum(engagementValues).default('unknown'),
  /** Plain text of the post. HTML is stripped before this point. */
  description: z.string().default(''),
  rateMin: z.number().nullable().default(null),
  rateMax: z.number().nullable().default(null),
  rateUnit: z.enum(['hour', 'day', 'year', 'project']).nullable().default(null),
  currency: z.string().nullable().default(null),
  postedAt: z.string().nullable().default(null),
  /** Which ATS hosts the application form, when known. The extension uses it to fill the form. */
  ats: z.enum(['greenhouse', 'lever', 'ashby', 'workable', 'smartrecruiters', 'recruitee', 'breezy', 'other']).nullable().default(null),
})

export type JobInput = z.infer<typeof jobInputSchema>

export type Job = JobInput & {
  id: string
  status: PipelineStatus
  score: number | null
  scoreDetail: string | null
  myRating: number | null
  myNote: string
  createdAt: string
  updatedAt: string
}

export const pipelineStatuses = ['new', 'saved', 'skipped', 'applied', 'interview', 'offer', 'won', 'lost'] as const
export type PipelineStatus = (typeof pipelineStatuses)[number]

/** Strip tags and decode the common entities, keeping paragraph breaks. Good enough for job posts. */
export function htmlToText(html: string): string {
  const decoded = decodeEntities(html)
  return decodeEntities(
    decoded
      .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '')
      .replace(/<\s*br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h[1-6]|ul|ol|tr)>/gi, '\n')
      .replace(/<li[^>]*>/gi, '- ')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function decodeEntities(text: string): string {
  const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '-', mdash: '-', rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', hellip: '...' }
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
    if (code[0] === '#') {
      const value = code[1]?.toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
      return Number.isFinite(value) ? String.fromCodePoint(value) : match
    }
    return named[code.toLowerCase()] ?? match
  })
}

/** Guess the engagement type from the title and text. Contract words win over full-time words. */
export function detectEngagement(text: string): JobInput['engagement'] {
  const t = text.toLowerCase()
  if (/\b(freelance|freelancer)\b/.test(t)) return 'freelance'
  if (/\b(contract|contractor|c2c|corp[- ]to[- ]corp|1099|b2b contract|fixed[- ]term|consultant|consulting engagement)\b/.test(t)) return 'contract'
  if (/\bpart[- ]time\b/.test(t)) return 'part-time'
  if (/\b(full[- ]time|permanent|fte|salary|benefits|401k|equity)\b/.test(t)) return 'full-time'
  return 'unknown'
}

export function detectRemote(text: string): boolean | null {
  const t = text.toLowerCase()
  if (/\b(on[- ]?site only|no remote|in[- ]office \d|must be on[- ]?site)\b/.test(t)) return false
  if (/\b(remote|work from anywhere|distributed team|wfh)\b/.test(t)) return true
  return null
}

const MONEY = /(?:(usd|eur|gbp|cad|aud|\$|€|£)\s?)(\d{1,3}(?:[,.]\d{3})*(?:\.\d+)?)(\s?k)?(?:\s?(?:-|–|to)\s?(?:usd|eur|gbp|\$|€|£)?\s?(\d{1,3}(?:[,.]\d{3})*(?:\.\d+)?)(\s?k)?)?\s*(?:\/|per|an|a)?\s*(hour|hr|h|day|year|yr|annum|annual|project)?/i

/** Pull the first pay figure out of a post: "$90-120/hr", "€600 per day", "$150k - $180k". */
export function detectRate(text: string): Pick<JobInput, 'rateMin' | 'rateMax' | 'rateUnit' | 'currency'> {
  const none = { rateMin: null, rateMax: null, rateUnit: null, currency: null }
  const m = MONEY.exec(text)
  if (!m) return none
  const symbol = (m[1] ?? '').toLowerCase()
  const currency = ({ $: 'USD', usd: 'USD', '€': 'EUR', eur: 'EUR', '£': 'GBP', gbp: 'GBP', cad: 'CAD', aud: 'AUD' } as Record<string, string>)[symbol] ?? null
  const num = (raw: string | undefined, k: string | undefined) => {
    if (!raw) return null
    const value = Number(raw.replace(/,/g, ''))
    return Number.isFinite(value) ? value * (k ? 1000 : 1) : null
  }
  const rateMin = num(m[2], m[3])
  const rateMax = num(m[4], m[5] ?? m[3]) ?? rateMin
  const unitWord = (m[6] ?? '').toLowerCase()
  let rateUnit: JobInput['rateUnit'] = null
  if (['hour', 'hr', 'h'].includes(unitWord)) rateUnit = 'hour'
  else if (unitWord === 'day') rateUnit = 'day'
  else if (['year', 'yr', 'annum', 'annual'].includes(unitWord)) rateUnit = 'year'
  else if (unitWord === 'project') rateUnit = 'project'
  else if (rateMin !== null) rateUnit = rateMin >= 20000 ? 'year' : rateMin >= 300 ? 'day' : 'hour'
  if (rateMin === null || rateMin < 10) return none
  return { rateMin, rateMax, rateUnit, currency }
}

/** Same company + same title (ignoring case, punctuation and seniority noise) is the same job. */
export function dedupeKey(job: Pick<JobInput, 'company' | 'title'>): string {
  const norm = (s: string) => s.toLowerCase().replace(/\b(inc|llc|ltd|gmbh|corp|co)\b\.?/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
  return `${norm(job.company)}|${norm(job.title)}`
}

/** Fill engagement, remote and rate from the text when the source didn't give them. */
export function enrichJob(job: JobInput): JobInput {
  const text = `${job.title}\n${job.location}\n${job.description}`
  const rate = job.rateMin === null ? detectRate(text) : {}
  return {
    ...job,
    engagement: job.engagement === 'unknown' ? detectEngagement(text) : job.engagement,
    remote: job.remote ?? detectRemote(`${job.location}\n${job.title}\n${job.description.slice(0, 2000)}`),
    ...rate,
  }
}
