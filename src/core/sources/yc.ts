// Small startups to watch, from the Y Combinator company directory (yc-oss, a public mirror updated daily). Only
// companies marked as hiring are listed there. Their own job board is found later by probing their ATS.
import { getJson, type Fetcher } from './types'

export const YC_ALL_URL = 'https://yc-oss.github.io/api/companies/all.json'
export const LAUNCH_HN_URL = 'https://hn.algolia.com/api/v1/search_by_date?query=%22Launch%20HN%22&tags=story&hitsPerPage=100'

type YcCompany = {
  name?: string; slug?: string; website?: string; one_liner?: string; team_size?: number | null; industry?: string; subindustry?: string
  all_locations?: string; regions?: string[]; stage?: string; status?: string; isHiring?: boolean; batch?: string; url?: string; tags?: string[]
}

export type StartupCandidate = {
  name: string; slug: string; website: string; oneLiner: string; teamSize: number | null; industry: string; location: string
  stage: string; batch: string; ycUrl: string; remote: boolean; hiring: boolean
}

/**
 * remoteOnly applies to older companies. Startups from the last two years of batches are kept whether or not they say
 * remote or list jobs: they are the ones most likely to take a contractor, and are worth pitching directly.
 */
export type StartupFilter = { minTeam: number; maxTeam: number; remoteOnly: boolean; now?: Date }

/** "Winter 2026" -> 2026. */
const batchYear = (batch: string) => Number(/(\d{4})/.exec(batch)?.[1] ?? 0)

export function parseYcCompanies(list: unknown, filter: StartupFilter): StartupCandidate[] {
  if (!Array.isArray(list)) return []
  return (list as YcCompany[])
    .filter((c) => c && c.name && c.slug && (c.status ?? 'Active') === 'Active')
    .map((c) => {
      const regions = (c.regions ?? []).map((r) => r.toLowerCase())
      return {
        name: c.name!, slug: c.slug!, website: c.website ?? '', oneLiner: c.one_liner ?? '', teamSize: typeof c.team_size === 'number' ? c.team_size : null,
        industry: c.industry ?? '', location: c.all_locations ?? '', stage: c.stage ?? '', batch: c.batch ?? '', ycUrl: c.url ?? '',
        remote: regions.some((r) => r.includes('remote')), hiring: c.isHiring === true,
      }
    })
    .filter((c) => c.teamSize !== null && c.teamSize >= filter.minTeam && c.teamSize <= filter.maxTeam)
    .filter((c) => {
      const recent = batchYear(c.batch) >= (filter.now ?? new Date()).getUTCFullYear() - 1
      return recent || (c.hiring && (!filter.remoteOnly || c.remote))
    })
}

export async function fetchYcStartups(fetcher: Fetcher, filter: StartupFilter): Promise<StartupCandidate[]> {
  return parseYcCompanies(await getJson<unknown>(fetcher, YC_ALL_URL), filter)
}

type LaunchHit = { title?: string; url?: string | null; created_at?: string; objectID?: string }

/** "Launch HN: Acme (YC W26) – What it does" posts: the newest YC startups, usually a handful of people. */
export function parseLaunchHn(hits: LaunchHit[]): StartupCandidate[] {
  const out: StartupCandidate[] = []
  for (const h of hits) {
    const m = /^Launch HN:\s*(.+?)\s*\((YC [A-Z]+\d{2,4})\)\s*[–—-]?\s*(.*)$/i.exec(h.title ?? '')
    if (!m) continue
    const name = m[1]!.trim()
    let website = ''
    try { if (h.url) { const u = new URL(h.url); if (!/github\.com$|ycombinator\.com$/.test(u.hostname)) website = `${u.protocol}//${u.hostname}` } } catch { /* no site */ }
    out.push({
      name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), website, oneLiner: m[3]?.trim() ?? '', teamSize: null,
      industry: '', location: '', stage: 'Early', batch: m[2]!, ycUrl: h.objectID ? `https://news.ycombinator.com/item?id=${h.objectID}` : '',
      remote: false, hiring: false,
    })
  }
  return out
}

export async function fetchLaunchHn(fetcher: Fetcher): Promise<StartupCandidate[]> {
  return parseLaunchHn((await getJson<{ hits?: LaunchHit[] }>(fetcher, LAUNCH_HN_URL)).hits ?? [])
}

/** The company size bucket used across the app. */
export function sizeBucket(teamSize: number | null): '' | 'solo' | 'startup' | 'scaleup' | 'midsize' | 'enterprise' {
  if (teamSize === null) return ''
  if (teamSize <= 1) return 'solo'
  if (teamSize <= 50) return 'startup'
  if (teamSize <= 250) return 'scaleup'
  if (teamSize <= 1000) return 'midsize'
  return 'enterprise'
}

/** Which sources to fetch this run: a window of the full list, rotating so every source is reached in turn. */
export function pickWindow<T>(items: T[], cursor: number, budget: number, cost: (item: T) => number = () => 1): { picked: T[]; next: number; wrapped: boolean } {
  if (!items.length) return { picked: [], next: 0, wrapped: true }
  const start = ((cursor % items.length) + items.length) % items.length
  const picked: T[] = []
  let spent = 0
  let i = 0
  while (i < items.length) {
    const item = items[(start + i) % items.length]!
    const c = cost(item)
    if (picked.length && spent + c > budget) break
    picked.push(item)
    spent += c
    i++
  }
  return { picked, next: (start + i) % items.length, wrapped: start + i >= items.length }
}
