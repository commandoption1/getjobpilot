import type { JobInput } from '../job'
import { fetchAshby, fetchBreezy, fetchGreenhouse, fetchLever, fetchRecruitee } from './ats'
import { fetchArbeitnow, fetchHimalayas, fetchJobicy, fetchRemoteOk, fetchRemotive, fetchMyCareersFuture, fetchRss, fetchWorkingNomads } from './boards'
import { fetchHn } from './hn'
import type { Fetcher, SourceConfig } from './types'

export type { SourceConfig, Fetcher, AtsKind, BoardKind } from './types'
export { ATS_KINDS, BOARD_KINDS, isAtsKind, sourceCost } from './types'
export { detectAts, findAtsLinks, POLLED_ATS, probeAts, tokenCandidates } from './ats'
export { fetchLaunchHn, fetchYcStartups, parseLaunchHn, parseYcCompanies, pickWindow, sizeBucket, type StartupCandidate } from './yc'

const boardNames = { himalayas: 'Himalayas', jobicy: 'Jobicy', arbeitnow: 'Arbeitnow', workingnomads: 'Working Nomads', mycareersfuture: 'MyCareersFuture (Singapore)' } as const

export function sourceLabel(s: SourceConfig): string {
  switch (s.kind) {
    case 'greenhouse': case 'lever': case 'ashby': case 'workable': case 'smartrecruiters': case 'recruitee': case 'breezy':
      return `${s.company || s.token} (${s.kind})`
    case 'remoteok': return `RemoteOK${s.tags?.length ? ` [${s.tags.join(', ')}]` : ''}`
    case 'remotive': return `Remotive${s.search ? ` "${s.search}"` : ''}`
    case 'himalayas': case 'jobicy': case 'arbeitnow': case 'workingnomads': case 'mycareersfuture':
      return `${boardNames[s.kind]}${s.country ? ` [${s.country}]` : ''}${s.search ? ` "${s.search}"` : ''}`
    case 'hn': return s.thread === 'hiring' ? 'HN Who is hiring' : s.thread === 'jobs' ? 'HN job posts (YC startups)' : 'HN Seeking freelancer'
    case 'rss': return s.label || s.url
  }
}

export async function fetchSource(fetcher: Fetcher, s: SourceConfig): Promise<JobInput[]> {
  switch (s.kind) {
    case 'greenhouse': return fetchGreenhouse(fetcher, s.token, s.company)
    case 'lever': return fetchLever(fetcher, s.token, s.company)
    case 'ashby': return fetchAshby(fetcher, s.token, s.company)
    case 'recruitee': return fetchRecruitee(fetcher, s.token, s.company)
    case 'breezy': return fetchBreezy(fetcher, s.token, s.company)
    // Detected so the extension knows the form, but their sites ask robots not to read the job APIs.
    case 'workable': case 'smartrecruiters': return []
    case 'remoteok': return fetchRemoteOk(fetcher, s.tags)
    case 'remotive': return fetchRemotive(fetcher, s.search)
    case 'himalayas': return fetchHimalayas(fetcher, s.search, s.country)
    case 'jobicy': return fetchJobicy(fetcher, s.search, s.country)
    case 'mycareersfuture': return fetchMyCareersFuture(fetcher, s.search)
    case 'arbeitnow': return fetchArbeitnow(fetcher, s.search)
    case 'workingnomads': return fetchWorkingNomads(fetcher, s.search)
    case 'hn': return fetchHn(fetcher, s.thread)
    case 'rss': return fetchRss(fetcher, s.url, s.label || 'rss')
  }
}
