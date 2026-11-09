// The applicant-tracking systems most startups use publish open jobs through public JSON APIs. Each company has a
// board token, e.g. https://boards.greenhouse.io/<token>, https://jobs.lever.co/<token>, https://jobs.ashbyhq.com/<token>,
// https://<token>.recruitee.com, https://<token>.breezy.hr. Workable and SmartRecruiters are only detected (so the
// extension knows the form), not polled: their sites ask robots not to read the job APIs.
import { detectEngagement, detectRate, detectRemote, htmlToText, type JobInput } from '../job'
import { getJson, UA, type AtsKind, type Fetcher } from './types'

type GreenhouseJob = { id: number; title: string; absolute_url: string; location?: { name?: string }; content?: string; updated_at?: string; first_published?: string; company_name?: string }

export async function fetchGreenhouse(fetcher: Fetcher, token: string, company = token): Promise<JobInput[]> {
  const data = await getJson<{ jobs: GreenhouseJob[] }>(fetcher, `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs?content=true`)
  return data.jobs.map((j) => {
    const description = htmlToText(j.content ?? '')
    return {
      source: 'greenhouse', externalId: `greenhouse:${token}:${j.id}`, url: j.absolute_url, applyUrl: j.absolute_url,
      title: j.title, company: j.company_name ?? company, location: j.location?.name ?? '', remote: null, engagement: 'unknown',
      description, ...detectRate(description), postedAt: j.first_published ?? j.updated_at ?? null, ats: 'greenhouse',
    }
  })
}

type LeverJob = {
  id: string; text: string; hostedUrl: string; applyUrl?: string; createdAt?: number; workplaceType?: string
  categories?: { location?: string; commitment?: string; team?: string }
  descriptionPlain?: string; additionalPlain?: string; lists?: { text: string; content: string }[]
  salaryRange?: { min?: number; max?: number; currency?: string; interval?: string }
}

export async function fetchLever(fetcher: Fetcher, token: string, company = token): Promise<JobInput[]> {
  const data = await getJson<LeverJob[]>(fetcher, `https://api.lever.co/v0/postings/${encodeURIComponent(token)}?mode=json`)
  return data.map((j) => {
    const description = [j.descriptionPlain ?? '', ...(j.lists ?? []).map((l) => `${l.text}\n${htmlToText(l.content)}`), j.additionalPlain ?? ''].join('\n\n').trim()
    const commitment = (j.categories?.commitment ?? '').toLowerCase()
    const interval = (j.salaryRange?.interval ?? '').toLowerCase()
    const rate = j.salaryRange?.min
      ? { rateMin: j.salaryRange.min, rateMax: j.salaryRange.max ?? j.salaryRange.min, currency: j.salaryRange.currency ?? null, rateUnit: interval.includes('hour') ? 'hour' as const : interval.includes('day') ? 'day' as const : 'year' as const }
      : detectRate(description)
    return {
      source: 'lever', externalId: `lever:${token}:${j.id}`, url: j.hostedUrl, applyUrl: j.applyUrl ?? j.hostedUrl,
      title: j.text, company, location: j.categories?.location ?? '',
      remote: j.workplaceType ? j.workplaceType === 'remote' : null,
      engagement: commitment.includes('contract') ? 'contract' : commitment.includes('freelance') ? 'freelance' : commitment.includes('part') ? 'part-time' : commitment.includes('full') ? 'full-time' : 'unknown',
      description, ...rate, postedAt: j.createdAt ? new Date(j.createdAt).toISOString() : null, ats: 'lever',
    }
  })
}

type AshbyJob = {
  id: string; title: string; location?: string; isRemote?: boolean; workplaceType?: string; employmentType?: string
  descriptionPlain?: string; descriptionHtml?: string; jobUrl: string; applyUrl?: string; publishedAt?: string
  compensation?: { compensationTierSummary?: string }
}

export async function fetchAshby(fetcher: Fetcher, token: string, company = token): Promise<JobInput[]> {
  const data = await getJson<{ jobs: AshbyJob[] }>(fetcher, `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(token)}?includeCompensation=true`)
  return data.jobs.map((j) => {
    const description = j.descriptionPlain ?? htmlToText(j.descriptionHtml ?? '')
    const type = (j.employmentType ?? '').toLowerCase()
    return {
      source: 'ashby', externalId: `ashby:${token}:${j.id}`, url: j.jobUrl, applyUrl: j.applyUrl ?? j.jobUrl,
      title: j.title, company, location: j.location ?? '',
      remote: j.isRemote ?? (j.workplaceType ? j.workplaceType.toLowerCase() === 'remote' : null),
      engagement: type.includes('contract') ? 'contract' : type.includes('part') ? 'part-time' : type.includes('full') ? 'full-time' : type.includes('intern') ? 'unknown' : 'unknown',
      description, ...detectRate(`${j.compensation?.compensationTierSummary ?? ''}\n${description}`), postedAt: j.publishedAt ?? null, ats: 'ashby',
    }
  })
}

type RecruiteeOffer = {
  id: number; slug?: string; title: string; description?: string; requirements?: string; location?: string; city?: string; country?: string
  remote?: boolean; hybrid?: boolean; on_site?: boolean; employment_type_code?: string; careers_url?: string; careers_apply_url?: string
  published_at?: string; created_at?: string; company_name?: string; status?: string
  salary?: { min?: number | string | null; max?: number | string | null; currency?: string | null; period?: string | null }
}

export async function fetchRecruitee(fetcher: Fetcher, token: string, company = token): Promise<JobInput[]> {
  const data = await getJson<{ offers: RecruiteeOffer[] }>(fetcher, `https://${encodeURIComponent(token)}.recruitee.com/api/offers/`)
  return (data.offers ?? []).filter((o) => o.title && (!o.status || o.status === 'published')).map((o) => {
    const description = [htmlToText(o.description ?? ''), htmlToText(o.requirements ?? '')].filter(Boolean).join('\n\n')
    const type = (o.employment_type_code ?? '').toLowerCase()
    const min = Number(o.salary?.min) || null
    const period = (o.salary?.period ?? '').toLowerCase()
    const rate = min
      ? { rateMin: min, rateMax: Number(o.salary?.max) || min, currency: o.salary?.currency ?? null, rateUnit: period.includes('hour') ? 'hour' as const : period.includes('day') ? 'day' as const : 'year' as const }
      : detectRate(description)
    const url = o.careers_url ?? `https://${token}.recruitee.com/o/${o.slug ?? o.id}`
    return {
      source: 'recruitee', externalId: `recruitee:${token}:${o.id}`, url, applyUrl: o.careers_apply_url ?? url,
      title: o.title, company: o.company_name || company, location: o.location ?? [o.city, o.country].filter(Boolean).join(', '),
      remote: o.remote === true ? true : o.on_site || o.hybrid ? false : null,
      engagement: type.includes('contract') || type.includes('freelance') ? 'contract' : type.includes('part') ? 'part-time' : type.includes('full') ? 'full-time' : detectEngagement(description),
      description, ...rate, postedAt: o.published_at ?? o.created_at ?? null, ats: 'recruitee',
    }
  })
}

type BreezyJob = {
  id?: string; friendly_id?: string; name?: string; url?: string; published_date?: string; type?: { id?: string; name?: string }
  location?: { name?: string; city?: string; country?: { name?: string } | string; is_remote?: boolean }; salary?: string; department?: string
  company?: { name?: string }
}

/** Breezy's public list has no description; the job is scored on title, type, location and salary until opened. */
export async function fetchBreezy(fetcher: Fetcher, token: string, company = token): Promise<JobInput[]> {
  const data = await getJson<BreezyJob[]>(fetcher, `https://${encodeURIComponent(token)}.breezy.hr/json`)
  return (Array.isArray(data) ? data : []).filter((j) => j.name && (j.id || j.friendly_id)).map((j) => {
    const type = (j.type?.name ?? j.type?.id ?? '').toLowerCase()
    const location = j.location?.name ?? [j.location?.city, typeof j.location?.country === 'string' ? j.location.country : j.location?.country?.name].filter(Boolean).join(', ')
    const text = [j.name, j.type?.name, location, j.salary, j.department].filter(Boolean).join('\n')
    const url = j.url ?? `https://${token}.breezy.hr/p/${j.friendly_id ?? j.id}`
    return {
      source: 'breezy', externalId: `breezy:${token}:${j.id ?? j.friendly_id}`, url, applyUrl: url,
      title: j.name!, company: j.company?.name || company, location,
      remote: j.location?.is_remote ?? detectRemote(location),
      engagement: type.includes('contract') || type.includes('freelance') ? 'contract' : type.includes('part') ? 'part-time' : type.includes('full') ? 'full-time' : detectEngagement(text),
      description: text, ...detectRate(j.salary ?? ''), postedAt: j.published_date ?? null, ats: 'breezy',
    }
  })
}

/** Works out the ATS and board token from a careers page or job link, so adding a company is one paste. */
export function detectAts(url: string): { kind: AtsKind; token: string } | null {
  let u: URL
  try { u = new URL(url) } catch { return null }
  const host = u.hostname.toLowerCase()
  const segments = u.pathname.split('/').filter(Boolean)
  const first = segments[0]
  const clean = (token: string | null | undefined) => {
    const t = (token ?? '').trim().toLowerCase()
    return /^[a-z0-9][a-z0-9._-]{0,80}$/.test(t) ? t : null
  }
  const pick = (kind: AtsKind, token: string | null | undefined) => {
    const t = clean(token)
    return t ? { kind, token: t } : null
  }
  const sub = (domain: string) => {
    if (!host.endsWith(`.${domain}`)) return null
    const name = host.slice(0, -domain.length - 1)
    return name.includes('.') || ['www', 'app', 'api', 'jobs', 'careers', 'apply'].includes(name) ? null : name
  }
  if (/(^|\.)greenhouse\.io$/.test(host)) {
    // boards.greenhouse.io/<token>, job-boards.greenhouse.io/<token>, boards.greenhouse.io/embed/job_board?for=<token>
    return pick('greenhouse', u.searchParams.get('for') ?? (first === 'embed' ? null : first))
  }
  if (/(^|\.)lever\.co$/.test(host)) return pick('lever', first)
  if (/(^|\.)ashbyhq\.com$/.test(host)) return host === 'jobs.ashbyhq.com' || host === 'ashbyhq.com' ? pick('ashby', first) : null
  if (host === 'apply.workable.com') return first === 'j' ? null : pick('workable', first)
  if (sub('workable.com')) return pick('workable', sub('workable.com'))
  if (host === 'jobs.smartrecruiters.com' || host === 'careers.smartrecruiters.com') return pick('smartrecruiters', first)
  if (sub('recruitee.com')) return pick('recruitee', sub('recruitee.com'))
  if (sub('breezy.hr')) return pick('breezy', sub('breezy.hr'))
  return null
}

/** The ATS boards that can be polled for jobs. */
export const POLLED_ATS: readonly AtsKind[] = ['greenhouse', 'lever', 'ashby', 'recruitee', 'breezy']

/** Every ATS board linked from a job post or its apply button. Used to find companies to watch. */
export function findAtsLinks(...texts: string[]): { kind: AtsKind; token: string }[] {
  const found = new Map<string, { kind: AtsKind; token: string }>()
  for (const text of texts) {
    for (const m of text.matchAll(/https?:\/\/[^\s"'<>)\]]+/gi)) {
      const hit = detectAts(m[0].replace(/[.,;:!?]+$/, ''))
      if (hit) found.set(`${hit.kind}:${hit.token}`, hit)
    }
  }
  return [...found.values()]
}

/** Board token guesses for a company: its slug, its name without spaces, and its website's first label. */
export function tokenCandidates(name: string, slug = '', website = ''): string[] {
  const out = new Set<string>()
  const add = (t: string) => { const c = t.toLowerCase().replace(/[^a-z0-9-]/g, ''); if (c.length >= 2) out.add(c) }
  if (slug) add(slug)
  add(name.replace(/\s+/g, ''))
  add(name.trim().replace(/\s+/g, '-'))
  try { if (website) add(new URL(website).hostname.replace(/^www\./, '').split('.')[0] ?? '') } catch { /* not a URL */ }
  return [...out].slice(0, 3)
}

const probeUrl: Partial<Record<AtsKind, (t: string) => string>> = {
  ashby: (t) => `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(t)}`,
  greenhouse: (t) => `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(t)}/jobs`,
  lever: (t) => `https://api.lever.co/v0/postings/${encodeURIComponent(t)}?mode=json&limit=1`,
}

/**
 * Looks for a company's job board by trying each token on Ashby, Greenhouse and Lever, the three systems most small
 * startups use. A board only counts when it lists at least one job, so an unrelated company with the same name and an
 * empty board is not picked. Stops at `maxRequests` and reports how many it used.
 */
export async function probeAts(fetcher: Fetcher, tokens: string[], maxRequests = 6): Promise<{ found: { kind: AtsKind; token: string } | null; used: number }> {
  let used = 0
  for (const token of tokens) {
    for (const kind of ['ashby', 'greenhouse', 'lever'] as const) {
      if (used >= maxRequests) return { found: null, used }
      used++
      try {
        const res = await fetcher(probeUrl[kind]!(token), { headers: { accept: 'application/json', 'user-agent': UA } })
        if (!res.ok) continue
        const data = (await res.json()) as { jobs?: unknown[] } | unknown[]
        const count = Array.isArray(data) ? data.length : Array.isArray(data?.jobs) ? data.jobs.length : 0
        if (count > 0) return { found: { kind, token }, used }
      } catch { /* network error: try the next one */ }
    }
  }
  return { found: null, used }
}
