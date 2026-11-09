// Pulls job sources, stores new jobs and scores them, and finds companies to watch. Runs from the cron
// (src/worker.ts) and from the "Fetch new jobs now" button.
//
// Cloudflare limits how much one run may do: 50 outside requests on the Workers Free plan (10,000 on Paid), and a cap
// on D1 calls. So each run takes the next window of sources up to a request budget and rotates through the rest on
// later runs, and every D1 read and write goes out in a few batches instead of one call per job.
import { companyFit } from '../core/company'
import { dedupeKey, enrichJob, type JobInput, jobInputSchema } from '../core/job'
import { scoreJob } from '../core/scoring'
import {
  fetchLaunchHn, fetchSource, fetchYcStartups, findAtsLinks, isAtsKind, pickWindow, POLLED_ATS, probeAts, sizeBucket, sourceCost, sourceLabel, tokenCandidates,
  type Fetcher, type SourceConfig, type StartupCandidate,
} from '../core/sources'
import {
  companiesToProbe, currentProfile, existingDedupeKeys, existingExternalIds, getMeta, getSettings, insertCompanyStatement, insertJobStatement,
  linkAllJobsStatement, listCompanies, logIngestStatement, type NewJob, probedStatement, setMetaStatement,
} from './db'

export type IngestSummary = { source: string; found: number; added: number; error: string | null }[]
export type IngestResult = {
  summary: IngestSummary
  /** Sources fetched this run, and how many there are in total. */
  fetched: number
  total: number
  /** True when this run reached the end of the source list, so every source has been fetched once. */
  wrapped: boolean
  companiesAdded: number
  boardsFound: number
}

/** Default outside-request budget per run: safe on the Workers Free plan. Raise INGEST_FETCH_BUDGET on Paid. */
export const DEFAULT_FETCH_BUDGET = 40
const PER_SOURCE_CAP = 300
const DAY = 864e5

const careersLink = (kind: string, token: string) => ({
  greenhouse: `https://boards.greenhouse.io/${token}`, lever: `https://jobs.lever.co/${token}`, ashby: `https://jobs.ashbyhq.com/${token}`,
  recruitee: `https://${token}.recruitee.com`, breezy: `https://${token}.breezy.hr`, workable: `https://apply.workable.com/${token}`,
  smartrecruiters: `https://jobs.smartrecruiters.com/${token}`,
}[kind] ?? '')

export async function runIngest(db: D1Database, fetcher: Fetcher = fetch, budget = DEFAULT_FETCH_BUDGET): Promise<IngestResult> {
  const [{ profile }, settings, companies, cursorRaw, ycReadAt] = await Promise.all([
    currentProfile(db), getSettings(db), listCompanies(db), getMeta(db, 'ingest-cursor'), getMeta(db, 'yc-read-at'),
  ])
  const discovery = settings.discovery
  const writes: D1PreparedStatement[] = []

  // 1. Startup discovery gets a small slice of the budget: reading the directory once a day, then a few board looks.
  let remaining = Math.max(1, budget)
  const readYc = (discovery.ycStartups || discovery.launchHn) && (!ycReadAt || Date.now() - Date.parse(ycReadAt) > DAY) && remaining > 10
  if (readYc) remaining -= 2
  const probeBudget = discovery.ycStartups || discovery.launchHn ? Math.min(discovery.probesPerRun * 6, Math.floor(remaining / 3)) : 0
  remaining -= probeBudget

  // 2. Sources: the boards in Settings, then every watched company with a pollable ATS board.
  const all: SourceConfig[] = [...settings.sources]
  const seenBoards = new Set(all.filter((s) => isAtsKind(s.kind)).map((s) => `${s.kind}:${(s as { token: string }).token}`))
  for (const c of companies) {
    if (!c.watchJobs || !c.ats || !c.atsToken || !isAtsKind(c.ats) || !POLLED_ATS.includes(c.ats)) continue
    const key = `${c.ats}:${c.atsToken}`
    if (seenBoards.has(key)) continue
    seenBoards.add(key)
    all.push({ kind: c.ats, token: c.atsToken, company: c.name })
  }
  const window = pickWindow(all, Number(cursorRaw) || 0, remaining, sourceCost)
  writes.push(setMetaStatement(db, 'ingest-cursor', String(window.next)))

  // 3. Fetch, six at a time.
  const fetched: { source: SourceConfig; jobs: JobInput[]; error: string | null }[] = []
  for (let i = 0; i < window.picked.length; i += 6) {
    fetched.push(...await Promise.all(window.picked.slice(i, i + 6).map(async (source) => {
      try {
        // A board that changes its format must not stop the run: anything that doesn't parse as a job is dropped.
        const jobs = (await fetchSource(fetcher, source)).slice(0, PER_SOURCE_CAP).flatMap((j) => {
          const parsed = jobInputSchema.safeParse(j)
          if (!parsed.success) return []
          try { return [enrichJob(parsed.data)] } catch { return [] }
        })
        return { source, jobs, error: null }
      }
      catch (error) { return { source, jobs: [], error: error instanceof Error ? error.message : String(error) } }
    })))
  }

  // 4. Score, drop low scores unless kept, and keep only jobs not stored yet.
  const allJobs = fetched.flatMap((f) => f.jobs)
  const [knownIds, knownKeys] = await Promise.all([
    existingExternalIds(db, allJobs.map((j) => j.externalId)),
    existingDedupeKeys(db, allJobs.filter((j) => j.company).map((j) => dedupeKey(j))),
  ])
  const summary: IngestSummary = []
  const links = new Map<string, { kind: string; token: string; company: string; from: string }>()
  for (const f of fetched) {
    const label = sourceLabel(f.source)
    let added = 0
    for (const job of f.jobs) {
      if (discovery.fromJobLinks) {
        for (const hit of findAtsLinks(job.applyUrl, job.url, job.description.slice(0, 20000))) {
          if (POLLED_ATS.includes(hit.kind)) links.set(`${hit.kind}:${hit.token}`, { ...hit, company: job.company, from: label })
        }
      }
      if (knownIds.has(job.externalId)) continue
      const key = dedupeKey(job)
      if (job.company && knownKeys.has(key)) continue
      const score = scoreJob(job, profile, settings.weights)
      const low = score.blocked || (settings.autoSkipBelow > 0 && score.score < settings.autoSkipBelow)
      if (low && !settings.keepLowScores) continue
      knownIds.add(job.externalId)
      if (job.company) knownKeys.add(key)
      const record: NewJob = { input: job, score, status: low ? 'skipped' : 'new' }
      writes.push(insertJobStatement(db, record))
      added++
    }
    summary.push({ source: label, found: f.jobs.length, added, error: f.error })
    writes.push(logIngestStatement(db, label, f.jobs.length, added, f.error?.slice(0, 500) ?? null))
  }

  // 5. Companies seen through job links, and hiring startups from the directory.
  const knownNames = new Set(companies.map((c) => c.name.trim().toLowerCase()))
  let companiesAdded = 0
  for (const link of links.values()) {
    if (seenBoards.has(`${link.kind}:${link.token}`)) continue
    seenBoards.add(`${link.kind}:${link.token}`)
    const name = link.company.trim() || link.token
    if (knownNames.has(name.toLowerCase())) continue
    knownNames.add(name.toLowerCase())
    writes.push(insertCompanyStatement(db, {
      name, careersUrl: careersLink(link.kind, link.token), ats: link.kind, atsToken: link.token, source: 'job-link',
      notes: `Found through a job post on ${link.from}.`,
    }))
    companiesAdded++
  }
  if (readYc) {
    const reads: [string, boolean, () => Promise<StartupCandidate[]>][] = [
      ['Y Combinator startups', discovery.ycStartups, () => fetchYcStartups(fetcher, { minTeam: discovery.minTeam, maxTeam: discovery.maxTeam, remoteOnly: profile.preferences.remote === 'remote-only' })],
      ['Launch HN startups', discovery.launchHn, () => fetchLaunchHn(fetcher)],
    ]
    for (const [label, enabled, read] of reads) {
      if (!enabled) continue
      try {
        const startups = await read()
        let added = 0
        for (const s of startups) {
          if (knownNames.has(s.name.trim().toLowerCase())) continue
          knownNames.add(s.name.trim().toLowerCase())
          const size = s.teamSize === null ? 'startup' : sizeBucket(s.teamSize)
          const fit = companyFit({ industry: s.industry, size, stack: '', location: s.location }, profile).fit
          writes.push(insertCompanyStatement(db, {
            name: s.name, website: s.website, industry: s.industry, size, stage: s.stage, location: s.location, teamSize: s.teamSize, fit, source: 'yc',
            notes: [s.oneLiner, `Y Combinator ${s.batch}${s.teamSize ? `, ${s.teamSize} people` : ''}${s.hiring ? ', hiring' : ''}.`, s.ycUrl].filter(Boolean).join(' '),
          }))
          added++
        }
        companiesAdded += added
        summary.push({ source: label, found: startups.length, added, error: null })
      } catch (error) {
        summary.push({ source: label, found: 0, added: 0, error: error instanceof Error ? error.message : String(error) })
      }
    }
    writes.push(setMetaStatement(db, 'yc-read-at', new Date().toISOString()))
  }

  // 6. Look for the job boards of startups added earlier. Found boards are fetched from the next run on.
  let boardsFound = 0
  let probeLeft = probeBudget
  const toProbe = await companiesToProbe(db, Math.min(discovery.probesPerRun, Math.floor(probeBudget / 6)))
  // Ten companies at a time; each look makes at most six requests, so the budget holds.
  for (let i = 0; i < toProbe.length && probeLeft > 0; i += 10) {
    const chunk = toProbe.slice(i, i + 10)
    const results = await Promise.all(chunk.map((c) => probeAts(fetcher, tokenCandidates(c.name, '', c.website), 6)))
    results.forEach(({ found, used }, j) => {
      probeLeft -= used
      writes.push(probedStatement(db, chunk[j]!.id, found ? { ...found, careersUrl: careersLink(found.kind, found.token) } : null))
      if (found) boardsFound++
    })
  }

  if (summary.some((s) => s.added) || companiesAdded) writes.push(linkAllJobsStatement(db))
  // Each batch is one D1 call; chunks keep a single batch from running too long.
  for (let i = 0; i < writes.length; i += 400) await db.batch(writes.slice(i, i + 400))

  return { summary, fetched: window.picked.length, total: all.length, wrapped: window.wrapped, companiesAdded, boardsFound }
}

/** Reads the INGEST_FETCH_BUDGET var. 40 fits the Workers Free plan's 50 outside requests per run; Paid allows 10,000. */
export function fetchBudget(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) && n >= 5 ? Math.min(Math.floor(n), 5000) : DEFAULT_FETCH_BUDGET
}
