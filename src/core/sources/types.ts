import type { JobInput } from '../job'

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>

/** Applicant-tracking systems with a public job board API. Each company has a board token in its careers link. */
export const ATS_KINDS = ['greenhouse', 'lever', 'ashby', 'workable', 'smartrecruiters', 'recruitee', 'breezy'] as const
export type AtsKind = (typeof ATS_KINDS)[number]
export const isAtsKind = (value: unknown): value is AtsKind => (ATS_KINDS as readonly unknown[]).includes(value)

/** Remote job boards with a public JSON API and no settings beyond an optional search word. */
export const BOARD_KINDS = ['himalayas', 'jobicy', 'arbeitnow', 'workingnomads', 'mycareersfuture'] as const
export type BoardKind = (typeof BOARD_KINDS)[number]

/** One configured source, as stored in Settings. `token` is the company's board name for the ATS sources. */
export type SourceConfig =
  | { kind: AtsKind; token: string; company?: string }
  | { kind: 'remoteok'; tags?: string[] }
  | { kind: 'remotive'; search?: string }
  | { kind: BoardKind; search?: string; country?: string }
  | { kind: 'hn'; thread: 'hiring' | 'freelancer' | 'jobs' }
  | { kind: 'rss'; url: string; label?: string }

/** External requests one run of a source makes. The ingest budget counts these. */
export const sourceCost = (s: SourceConfig): number => (s.kind === 'hn' && s.thread !== 'jobs' ? 2 : 1)

export const UA = 'jobpilot/1.0 (personal job search tool)'

export async function getJson<T>(fetcher: Fetcher, url: string): Promise<T> {
  const res = await fetcher(url, { headers: { accept: 'application/json', 'user-agent': UA } })
  if (!res.ok) throw new Error(`${new URL(url).hostname} answered ${res.status}`)
  return (await res.json()) as T
}

export type SourceResult = { jobs: JobInput[] }
