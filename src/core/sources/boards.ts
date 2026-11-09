// Remote job boards with public feeds. RemoteOK asks for a link back to the post, which the feed keeps.
import { detectEngagement, detectRate, detectRemote, htmlToText, type JobInput } from '../job'
import { getJson, UA, type Fetcher } from './types'

type RemoteOkJob = { id?: string; slug?: string; company?: string; position?: string; tags?: string[]; description?: string; location?: string; salary_min?: number; salary_max?: number; url?: string; apply_url?: string; date?: string; legal?: string }

export async function fetchRemoteOk(fetcher: Fetcher, tags: string[] = []): Promise<JobInput[]> {
  const url = `https://remoteok.com/api${tags.length ? `?tags=${encodeURIComponent(tags.join(','))}` : ''}`
  const data = await getJson<RemoteOkJob[]>(fetcher, url)
  return data.filter((j) => j.id && j.position).map((j) => {
    const description = htmlToText(j.description ?? '')
    const rate = j.salary_min ? { rateMin: j.salary_min, rateMax: j.salary_max || j.salary_min, rateUnit: 'year' as const, currency: 'USD' } : detectRate(description)
    return {
      source: 'remoteok', externalId: `remoteok:${j.id}`, url: j.url ?? '', applyUrl: j.apply_url ?? j.url ?? '',
      title: j.position!, company: j.company ?? '', location: j.location ?? 'Remote', remote: true,
      engagement: detectEngagement(`${j.position} ${(j.tags ?? []).join(' ')} ${description}`), description, ...rate,
      postedAt: j.date ?? null, ats: null,
    }
  })
}

type RemotiveJob = { id: number; url: string; title: string; company_name: string; job_type?: string; candidate_required_location?: string; salary?: string; description?: string; publication_date?: string }

export async function fetchRemotive(fetcher: Fetcher, search = ''): Promise<JobInput[]> {
  const data = await getJson<{ jobs: RemotiveJob[] }>(fetcher, `https://remotive.com/api/remote-jobs?limit=100${search ? `&search=${encodeURIComponent(search)}` : ''}`)
  return data.jobs.map((j) => {
    const description = htmlToText(j.description ?? '')
    const type = (j.job_type ?? '').toLowerCase()
    return {
      source: 'remotive', externalId: `remotive:${j.id}`, url: j.url, applyUrl: j.url, title: j.title, company: j.company_name,
      location: j.candidate_required_location ?? 'Remote', remote: true,
      engagement: type === 'contract' ? 'contract' : type === 'freelance' ? 'freelance' : type === 'part_time' ? 'part-time' : type === 'full_time' ? 'full-time' : detectEngagement(description),
      description, ...detectRate(`${j.salary ?? ''}\n${description}`), postedAt: j.publication_date ?? null, ats: null,
    }
  })
}

/** Any RSS feed of jobs, e.g. a We Work Remotely category: https://weworkremotely.com/categories/remote-full-stack-programming-jobs.rss */
export async function fetchRss(fetcher: Fetcher, url: string, label = 'rss'): Promise<JobInput[]> {
  const res = await fetcher(url, { headers: { 'user-agent': UA, accept: 'application/rss+xml, application/xml, text/xml' } })
  if (!res.ok) throw new Error(`${new URL(url).hostname} answered ${res.status}`)
  return parseRss(await res.text(), label)
}

export function parseRss(xml: string, label: string): JobInput[] {
  const items = xml.match(/<item[\s>][\s\S]*?<\/item>/g) ?? []
  const tag = (item: string, name: string) => {
    const m = new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`).exec(item)
    return m ? m[1]!.replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, '$1').trim() : ''
  }
  return items.map((item) => {
    const rawTitle = htmlToText(tag(item, 'title'))
    // We Work Remotely titles are "Company: Job title".
    const split = rawTitle.indexOf(': ')
    const company = split > 0 ? rawTitle.slice(0, split) : ''
    const title = split > 0 ? rawTitle.slice(split + 2) : rawTitle
    const description = htmlToText(tag(item, 'description'))
    const link = htmlToText(tag(item, 'link'))
    const region = htmlToText(tag(item, 'region'))
    const pub = tag(item, 'pubDate')
    return {
      source: label, externalId: `${label}:${tag(item, 'guid') || link}`, url: link, applyUrl: link, title, company,
      location: region || 'Remote', remote: true, engagement: detectEngagement(`${title}\n${description}`), description,
      ...detectRate(description), postedAt: pub ? new Date(pub).toISOString() : null, ats: null,
    }
  }).filter((j) => j.title)
}

// ---------- Himalayas, Jobicy, Arbeitnow, Working Nomads: free remote boards with JSON APIs ----------

const unixToIso = (value: unknown): string | null => {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return typeof value === 'string' && value ? value : null
  return new Date(n < 1e12 ? n * 1000 : n).toISOString()
}

const typeToEngagement = (type: string, text: string): JobInput['engagement'] => {
  const t = type.toLowerCase()
  if (t.includes('contract') || t.includes('freelance') || t.includes('temporary')) return t.includes('freelance') ? 'freelance' : 'contract'
  if (t.includes('part')) return 'part-time'
  if (t.includes('full')) return 'full-time'
  return detectEngagement(text)
}

const salaryUnit = (period: string | undefined): 'hour' | 'day' | 'year' | null => {
  const p = (period ?? '').toLowerCase()
  if (p.includes('hour')) return 'hour'
  if (p.includes('day')) return 'day'
  if (p.includes('year') || p.includes('annual')) return 'year'
  return null
}

type HimalayasJob = {
  title: string; excerpt?: string; companyName?: string; employmentType?: string; minSalary?: number | null; maxSalary?: number | null
  salaryPeriod?: string; currency?: string; locationRestrictions?: string[]; timezoneRestrictions?: number[]; categories?: string[]
  parentCategories?: string[]; description?: string; pubDate?: number; applicationLink?: string; guid?: string
}

/**
 * Himalayas lists every remote job it knows (over 100,000), newest first; `search` narrows it, e.g. "vue", and
 * `country` (ISO code or name, e.g. "SG") keeps jobs open to that country. Its terms allow showing jobs only in your
 * own app, which this is.
 */
export async function fetchHimalayas(fetcher: Fetcher, search = '', country = ''): Promise<JobInput[]> {
  const params = new URLSearchParams({ sort: 'recent' })
  if (search) params.set('q', search)
  if (country) { params.set('country', country); params.set('exclude_worldwide', 'true') }
  const url = search || country ? `https://himalayas.app/jobs/api/search?${params}` : 'https://himalayas.app/jobs/api?limit=100'
  const data = await getJson<{ jobs: HimalayasJob[] }>(fetcher, url)
  return (data.jobs ?? []).filter((j) => j.title && (j.guid || j.applicationLink)).map((j) => {
    const description = htmlToText(j.description ?? j.excerpt ?? '')
    const restrictions = (j.locationRestrictions ?? []).filter(Boolean)
    const unit = salaryUnit(j.salaryPeriod)
    // Monthly salaries are turned into yearly ones so they compare with other posts.
    const monthly = (j.salaryPeriod ?? '').toLowerCase().includes('month')
    const rate = j.minSalary && (unit || monthly)
      ? { rateMin: monthly ? j.minSalary * 12 : j.minSalary, rateMax: (j.maxSalary || j.minSalary) * (monthly ? 12 : 1), currency: j.currency ?? null, rateUnit: monthly ? 'year' as const : unit }
      : detectRate(description)
    const link = j.guid ?? j.applicationLink ?? ''
    return {
      source: 'himalayas', externalId: `himalayas:${link}`, url: link, applyUrl: j.applicationLink ?? link, title: j.title,
      company: j.companyName ?? '', location: restrictions.length ? `Remote (${restrictions.join(', ')})` : 'Remote, anywhere', remote: true,
      engagement: typeToEngagement(j.employmentType ?? '', description), description: restrictions.length ? `Open to: ${restrictions.join(', ')}.\n\n${description}` : description,
      ...rate, postedAt: unixToIso(j.pubDate), ats: null,
    }
  })
}

type JobicyJob = {
  id: number; url: string; jobTitle: string; companyName?: string; jobIndustry?: string[]; jobType?: string[]; jobGeo?: string
  jobLevel?: string; jobExcerpt?: string; jobDescription?: string; pubDate?: string; salaryMin?: number; salaryMax?: number
  salaryCurrency?: string; salaryPeriod?: string
}

/** Jobicy asks that apply buttons go to its own job page, which `url` and `applyUrl` both do. `country` is its geo slug, e.g. "apac", "japan". */
export async function fetchJobicy(fetcher: Fetcher, search = '', country = ''): Promise<JobInput[]> {
  const data = await getJson<{ jobs?: JobicyJob[] }>(fetcher, `https://jobicy.com/api/v2/remote-jobs?count=100${search ? `&tag=${encodeURIComponent(search)}` : ''}${country ? `&geo=${encodeURIComponent(country)}` : ''}`)
  return (data.jobs ?? []).filter((j) => j.id && j.jobTitle).map((j) => {
    const description = htmlToText(j.jobDescription ?? j.jobExcerpt ?? '')
    const unit = salaryUnit(j.salaryPeriod)
    const rate = j.salaryMin && unit ? { rateMin: j.salaryMin, rateMax: j.salaryMax || j.salaryMin, currency: j.salaryCurrency ?? null, rateUnit: unit } : detectRate(description)
    const geo = j.jobGeo && !/anywhere/i.test(j.jobGeo) ? j.jobGeo : ''
    return {
      source: 'jobicy', externalId: `jobicy:${j.id}`, url: j.url, applyUrl: j.url, title: htmlToText(j.jobTitle),
      company: htmlToText(j.companyName ?? ''), location: geo ? `Remote (${geo})` : 'Remote, anywhere', remote: true,
      engagement: typeToEngagement((j.jobType ?? []).join(' '), description), description: geo ? `Open to: ${geo}.\n\n${description}` : description,
      ...rate, postedAt: j.pubDate ?? null, ats: null,
    }
  })
}

type ArbeitnowJob = { slug: string; company_name?: string; title: string; description?: string; remote?: boolean; url: string; tags?: string[]; job_types?: string[]; location?: string; created_at?: number }

/** Arbeitnow is mostly Europe (many German posts); `search` keeps only posts whose title or tags contain it. */
export async function fetchArbeitnow(fetcher: Fetcher, search = ''): Promise<JobInput[]> {
  const data = await getJson<{ data?: ArbeitnowJob[] }>(fetcher, 'https://www.arbeitnow.com/api/job-board-api')
  const needle = search.trim().toLowerCase()
  return (data.data ?? [])
    .filter((j) => j.slug && j.title && (!needle || `${j.title} ${(j.tags ?? []).join(' ')}`.toLowerCase().includes(needle)))
    .map((j) => {
      const description = htmlToText(j.description ?? '')
      return {
        source: 'arbeitnow', externalId: `arbeitnow:${j.slug}`, url: j.url, applyUrl: j.url, title: j.title, company: j.company_name ?? '',
        location: j.location ?? '', remote: j.remote ?? detectRemote(`${j.location ?? ''}\n${description}`),
        engagement: typeToEngagement((j.job_types ?? []).join(' '), description), description, ...detectRate(description),
        postedAt: unixToIso(j.created_at), ats: null,
      }
    })
}

type WorkingNomadsJob = { url: string; title: string; description?: string; company_name?: string; category_name?: string; tags?: string; location?: string; pub_date?: string }

/** Working Nomads returns its latest remote jobs in every category; `search` keeps those whose category, title or tags match. */
export async function fetchWorkingNomads(fetcher: Fetcher, search = ''): Promise<JobInput[]> {
  const data = await getJson<WorkingNomadsJob[]>(fetcher, 'https://www.workingnomads.com/api/exposed_jobs/')
  const needle = search.trim().toLowerCase()
  return (Array.isArray(data) ? data : [])
    .filter((j) => j.url && j.title && (!needle || `${j.category_name ?? ''} ${j.title} ${j.tags ?? ''}`.toLowerCase().includes(needle)))
    .map((j) => {
      const description = htmlToText(j.description ?? '')
      const location = j.location?.trim() ?? ''
      return {
        source: 'workingnomads', externalId: `workingnomads:${j.url}`, url: j.url, applyUrl: j.url, title: j.title, company: j.company_name ?? '',
        location: location ? `Remote (${location})` : 'Remote', remote: true, engagement: detectEngagement(`${j.title}\n${description}`),
        description: location ? `Open to: ${location}.\n\n${description}` : description, ...detectRate(description),
        postedAt: j.pub_date ? new Date(j.pub_date).toISOString() : null, ats: null,
      }
    })
}

// ---------- MyCareersFuture: the Singapore government job portal ----------

type McfJob = {
  uuid: string; title: string; description?: string; skills?: { skill: string }[]; flexibleWorkArrangements?: { flexibleWorkArrangement?: string }[]
  employmentTypes?: { employmentType?: string }[]; postedCompany?: { name?: string }; hiringCompany?: { name?: string } | null
  address?: { isOverseas?: boolean } | null; metadata?: { createdAt?: string; jobDetailsUrl?: string }
  salary?: { minimum?: number; maximum?: number; type?: { salaryType?: string } } | null
}

/** Singapore jobs, mostly on-site. Posts that offer telecommuting are marked remote. Salaries are SGD a month, stored per year. */
export async function fetchMyCareersFuture(fetcher: Fetcher, search = 'software developer'): Promise<JobInput[]> {
  const data = await getJson<{ results?: McfJob[] }>(fetcher, `https://api.mycareersfuture.gov.sg/v2/jobs?search=${encodeURIComponent(search || 'software developer')}&limit=100&page=0`)
  return (data.results ?? []).filter((j) => j.uuid && j.title).map((j) => {
    const skills = (j.skills ?? []).map((s) => s.skill).filter(Boolean)
    const description = [htmlToText(j.description ?? ''), skills.length ? `Skills: ${skills.join(', ')}` : ''].filter(Boolean).join('\n\n')
    const remote = (j.flexibleWorkArrangements ?? []).some((f) => /telecommut|remote|work from home/i.test(f.flexibleWorkArrangement ?? ''))
    const types = (j.employmentTypes ?? []).map((t) => t.employmentType ?? '').join(' ')
    const monthly = /month/i.test(j.salary?.type?.salaryType ?? '')
    const rate = j.salary?.minimum
      ? { rateMin: j.salary.minimum * (monthly ? 12 : 1), rateMax: (j.salary.maximum || j.salary.minimum) * (monthly ? 12 : 1), currency: 'SGD', rateUnit: 'year' as const }
      : detectRate(description)
    const url = j.metadata?.jobDetailsUrl ?? `https://www.mycareersfuture.gov.sg/job/${j.uuid}`
    return {
      source: 'mycareersfuture', externalId: `mcf:${j.uuid}`, url, applyUrl: url, title: j.title.trim(),
      company: j.hiringCompany?.name || j.postedCompany?.name || '', location: remote ? 'Remote (Singapore)' : 'Singapore', remote: remote ? true : false,
      engagement: typeToEngagement(types, description), description, ...rate, postedAt: j.metadata?.createdAt ?? null, ats: null,
    }
  })
}
