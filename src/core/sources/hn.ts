// Hacker News "Who is hiring?" and "Freelancer? Seeking freelancer?" threads, posted monthly by the whoishiring
// account, read through the public Algolia HN API. Each top-level comment is one company's post.
import { detectEngagement, detectRate, detectRemote, htmlToText, type JobInput } from '../job'
import { getJson, type Fetcher } from './types'

type Hit = { objectID: string; title: string; created_at: string }
type Item = { id: number; text?: string | null; created_at: string; author?: string; children?: Item[] }

export async function latestHnThread(fetcher: Fetcher, which: 'hiring' | 'freelancer'): Promise<Hit | null> {
  const data = await getJson<{ hits: Hit[] }>(fetcher, 'https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&hitsPerPage=10')
  const wanted = which === 'hiring' ? /who is hiring/i : /freelancer\? seeking freelancer/i
  return data.hits.find((h) => wanted.test(h.title)) ?? null
}

export async function fetchHn(fetcher: Fetcher, which: 'hiring' | 'freelancer' | 'jobs'): Promise<JobInput[]> {
  if (which === 'jobs') {
    const data = await getJson<{ hits: JobHit[] }>(fetcher, 'https://hn.algolia.com/api/v1/search_by_date?tags=job&hitsPerPage=100')
    return parseHnJobs(data.hits ?? [])
  }
  const thread = await latestHnThread(fetcher, which)
  if (!thread) return []
  const item = await getJson<Item>(fetcher, `https://hn.algolia.com/api/v1/items/${thread.objectID}`)
  return parseHnComments(item.children ?? [], which)
}

export function parseHnComments(children: Item[], which: 'hiring' | 'freelancer'): JobInput[] {
  const jobs: JobInput[] = []
  for (const c of children) {
    if (!c.text) continue
    const text = htmlToText(c.text)
    // In the freelancer thread, people offering themselves start with "SEEKING FREELANCER" vs "SEEKING WORK". Keep only clients.
    if (which === 'freelancer' && !/^\s*seeking freelancer/i.test(text)) continue
    const firstLine = text.split('\n')[0] ?? ''
    // The convention is "Company | Role | Location | Remote | Pay".
    const parts = firstLine.split('|').map((p) => p.trim()).filter(Boolean)
    const company = which === 'freelancer' ? (parts[1] ?? '') : (parts[0] ?? '')
    const title = (which === 'freelancer' ? parts[2] : parts[1]) ?? firstLine.slice(0, 120)
    jobs.push({
      source: which === 'hiring' ? 'hn-hiring' : 'hn-freelancer', externalId: `hn:${c.id}`,
      url: `https://news.ycombinator.com/item?id=${c.id}`, applyUrl: `https://news.ycombinator.com/item?id=${c.id}`,
      title: title.slice(0, 200), company: company.slice(0, 120), location: parts.slice(2).join(' | ').slice(0, 200),
      remote: detectRemote(firstLine) ?? detectRemote(text), engagement: which === 'freelancer' ? 'freelance' : detectEngagement(text),
      description: text, ...detectRate(text), postedAt: c.created_at, ats: null,
    })
  }
  return jobs
}

type JobHit = { objectID: string; title?: string; url?: string | null; created_at?: string; story_text?: string | null }

/**
 * HN job posts are YC startups hiring: "Acme (YC S23) Is Hiring a Founding Engineer". Only the title is in the feed,
 * so they are scored on it until opened.
 */
export function parseHnJobs(hits: JobHit[]): JobInput[] {
  return hits.filter((h) => h.title).map((h) => {
    const title = h.title!
    const m = /^(.+?)\s*\((YC [A-Z]+\d{2,4})\)\s*(?:is\s+)?hiring\s*(?:an?\s+)?(.*)$/i.exec(title)
    const role = (m?.[3] ?? '').replace(/^[–—:\-\s]+/, '').replace(/^in\s+[^–—-]+[–—-]\s*/i, '').trim()
    const description = htmlToText(h.story_text ?? '') || title
    const url = h.url || `https://news.ycombinator.com/item?id=${h.objectID}`
    return {
      source: 'hn-jobs', externalId: `hn:${h.objectID}`, url, applyUrl: url, title: (role || title).slice(0, 200),
      company: (m?.[1] ?? '').trim().slice(0, 120), location: '', remote: detectRemote(title), engagement: detectEngagement(description),
      description: `${title}\n\n${description}`.trim(), ...detectRate(description), postedAt: h.created_at ?? null, ats: null,
    }
  })
}
