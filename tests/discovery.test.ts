import { describe, expect, it } from 'vitest'

import { profileSchema } from '../src/core/profile'
import { regionsAllow, scoreJob } from '../src/core/scoring'
import { detectAts, findAtsLinks, parseLaunchHn, parseYcCompanies, pickWindow, probeAts, sizeBucket, tokenCandidates } from '../src/core/sources'
import { fetchBreezy, fetchRecruitee } from '../src/core/sources/ats'
import { parseHnJobs } from '../src/core/sources/hn'
import { fetchArbeitnow, fetchHimalayas, fetchJobicy, fetchWorkingNomads } from '../src/core/sources/boards'
import { runIngest } from '../src/server/ingest'
import { fakeD1 } from './fake-d1'

const fake = (body: unknown) => async () => new Response(JSON.stringify(body), { status: 200 })

describe('more ATS boards', () => {
  it('detects every supported ATS from careers and job links', () => {
    expect(detectAts('https://job-boards.greenhouse.io/acme/jobs/1')).toEqual({ kind: 'greenhouse', token: 'acme' })
    expect(detectAts('https://boards.greenhouse.io/embed/job_board?for=Acme')).toEqual({ kind: 'greenhouse', token: 'acme' })
    expect(detectAts('https://apply.workable.com/acme/j/ABC123/')).toEqual({ kind: 'workable', token: 'acme' })
    expect(detectAts('https://acme.recruitee.com/o/frontend-dev')).toEqual({ kind: 'recruitee', token: 'acme' })
    expect(detectAts('https://acme.breezy.hr/p/123-dev')).toEqual({ kind: 'breezy', token: 'acme' })
    expect(detectAts('https://jobs.smartrecruiters.com/Acme/123')).toEqual({ kind: 'smartrecruiters', token: 'acme' })
    expect(detectAts('https://www.breezy.hr/pricing')).toBeNull()
    expect(detectAts('https://app.ashbyhq.com/login')).toBeNull()
  })
  it('finds ATS links inside a post', () => {
    const text = 'Apply at https://jobs.ashbyhq.com/tinyco/123. Or see https://jobs.lever.co/other, and https://example.com.'
    expect(findAtsLinks(text)).toEqual([{ kind: 'ashby', token: 'tinyco' }, { kind: 'lever', token: 'other' }])
  })
  it('reads Recruitee offers', async () => {
    const jobs = await fetchRecruitee(fake({ offers: [{ id: 7, title: 'Vue Developer', description: '<p>Contract</p>', remote: true, employment_type_code: 'contract', careers_url: 'https://acme.recruitee.com/o/vue', status: 'published', salary: { min: 40, max: 60, currency: 'EUR', period: 'hour' } }] }), 'acme', 'Acme')
    expect(jobs[0]).toMatchObject({ title: 'Vue Developer', remote: true, engagement: 'contract', rateMin: 40, rateUnit: 'hour', ats: 'recruitee', company: 'Acme' })
  })
  it('reads Breezy jobs without a description', async () => {
    const jobs = await fetchBreezy(fake([{ id: 'x1', friendly_id: 'x1-dev', name: 'Node Developer', url: 'https://acme.breezy.hr/p/x1-dev', type: { name: 'Contract' }, location: { name: 'Remote', is_remote: true } }]), 'acme')
    expect(jobs[0]).toMatchObject({ title: 'Node Developer', engagement: 'contract', remote: true, ats: 'breezy' })
  })
})

describe('more boards', () => {
  it('reads Himalayas and keeps the allowed countries in the location', async () => {
    const jobs = await fetchHimalayas(fake({ jobs: [{ title: 'Vue Engineer', companyName: 'Acme', employmentType: 'Contractor', locationRestrictions: ['United States'], description: '<p>Vue</p>', pubDate: 1793678642, guid: 'https://himalayas.app/x', applicationLink: 'https://himalayas.app/x/apply', minSalary: 5000, maxSalary: 6000, salaryPeriod: 'monthly', currency: 'USD' }] }))
    expect(jobs[0]).toMatchObject({ company: 'Acme', location: 'Remote (United States)', engagement: 'contract', rateMin: 60000, rateUnit: 'year' })
    expect(jobs[0]!.postedAt).toMatch(/^2026-/)
  })
  it('reads Jobicy', async () => {
    const jobs = await fetchJobicy(fake({ jobs: [{ id: 1, url: 'https://jobicy.com/jobs/1', jobTitle: 'Frontend Dev', companyName: 'Acme', jobType: ['Contract'], jobGeo: 'Anywhere', jobDescription: '<p>Vue</p>', salaryMin: 50, salaryMax: 70, salaryCurrency: 'USD', salaryPeriod: 'hourly' }] }))
    expect(jobs[0]).toMatchObject({ location: 'Remote, anywhere', engagement: 'contract', rateMin: 50, rateUnit: 'hour' })
  })
  it('filters Working Nomads and Arbeitnow by search word', async () => {
    const nomads = await fetchWorkingNomads(fake([{ url: 'https://w/1', title: 'Vue dev', category_name: 'Development', company_name: 'A' }, { url: 'https://w/2', title: 'Recruiter', category_name: 'Human Resources' }]), 'development')
    expect(nomads.map((j) => j.title)).toEqual(['Vue dev'])
    const arbeit = await fetchArbeitnow(fake({ data: [{ slug: 'a', title: 'Vue Entwickler', url: 'https://a', tags: ['vue'], remote: true, created_at: 1794098413 }, { slug: 'b', title: 'Koch', url: 'https://b' }] }), 'vue')
    expect(arbeit).toHaveLength(1)
  })
})

describe('startups and rotation', () => {
  const yc = [
    { name: 'Tiny', slug: 'tiny', team_size: 6, isHiring: true, status: 'Active', regions: ['Remote', 'Fully Remote'], website: 'https://tiny.dev', batch: 'Summer 2021' },
    { name: 'Big', slug: 'big', team_size: 300, isHiring: true, status: 'Active', regions: ['Remote'], batch: 'Winter 2026' },
    { name: 'Office', slug: 'office', team_size: 8, isHiring: true, status: 'Active', regions: ['United States of America'], batch: 'Summer 2020' },
    { name: 'Fresh', slug: 'fresh', team_size: 3, isHiring: false, status: 'Active', regions: [], batch: 'Fall 2025' },
    { name: 'Gone', slug: 'gone', team_size: 4, isHiring: false, status: 'Inactive', batch: 'Winter 2026' },
  ]
  const now = new Date('2026-11-08')
  it('keeps every recent startup in the size range, and older ones only when hiring (remote when asked)', () => {
    expect(parseYcCompanies(yc, { minTeam: 2, maxTeam: 15, remoteOnly: true, now }).map((c) => c.name)).toEqual(['Tiny', 'Fresh'])
    expect(parseYcCompanies(yc, { minTeam: 2, maxTeam: 15, remoteOnly: false, now }).map((c) => c.name)).toEqual(['Tiny', 'Office', 'Fresh'])
    expect(sizeBucket(6)).toBe('startup')
  })
  it('reads Launch HN posts as new startups', () => {
    const list = parseLaunchHn([
      { title: 'Launch HN: Momentic (YC W24) – Agents that catch bugs by using your app', url: 'https://momentic.ai/', objectID: '1' },
      { title: 'Launch HN: Rivet (YC W23) – Scale agents', url: 'https://github.com/rivet-dev/rivet', objectID: '2' },
      { title: 'Show HN: not a launch', url: 'https://x.dev' },
    ])
    expect(list.map((c) => [c.name, c.website, c.batch])).toEqual([['Momentic', 'https://momentic.ai', 'YC W24'], ['Rivet', '', 'YC W23']])
  })
  it('reads HN job posts', () => {
    const jobs = parseHnJobs([{ objectID: '9', title: 'Truemetrics (YC S23) Is Hiring in Berlin – GTM Lead', url: 'https://www.ycombinator.com/companies/truemetrics/jobs/bIQQ7' }, { objectID: '10', title: 'Acme (YC W25) is hiring a founding full-stack engineer (remote)' }])
    expect(jobs[0]).toMatchObject({ company: 'Truemetrics', title: 'GTM Lead', source: 'hn-jobs' })
    expect(jobs[1]).toMatchObject({ company: 'Acme', title: 'founding full-stack engineer (remote)', remote: true })
  })
  it('rotates through sources within the budget', () => {
    const items = ['a', 'b', 'c', 'd', 'e']
    expect(pickWindow(items, 0, 2)).toEqual({ picked: ['a', 'b'], next: 2, wrapped: false })
    expect(pickWindow(items, 4, 2)).toEqual({ picked: ['e', 'a'], next: 1, wrapped: true })
    expect(pickWindow(items, 0, 99).picked).toHaveLength(5)
  })
  it('probes Ashby, Greenhouse and Lever and needs at least one job', async () => {
    const calls: string[] = []
    const fetcher = async (url: string) => {
      calls.push(url)
      if (url.includes('ashbyhq') ) return new Response(JSON.stringify({ jobs: [] }), { status: 200 })
      if (url.includes('greenhouse')) return new Response('{}', { status: 404 })
      return new Response(JSON.stringify([{ id: 1 }]), { status: 200 })
    }
    expect(await probeAts(fetcher, ['tiny'])).toEqual({ found: { kind: 'lever', token: 'tiny' }, used: 3 })
    expect(tokenCandidates('Tiny Labs', '', 'https://www.tinylabs.io')).toEqual(['tinylabs', 'tiny-labs'])
  })
})

describe('work rights', () => {
  it('knows which regions include a country', () => {
    expect(regionsAllow('APAC', ['Thailand'])).toBe(true)
    expect(regionsAllow('Worldwide', ['Thailand'])).toBe(true)
    expect(regionsAllow('USA, Canada', ['Thailand'])).toBe(false)
    expect(regionsAllow('Thailand, Vietnam', ['Thailand'])).toBe(true)
    expect(regionsAllow('EMEA', ['Germany'])).toBe(true)
    expect(regionsAllow('EU only', ['United Kingdom'])).toBe(false)
    expect(regionsAllow('LATAM', ['Brazil'])).toBe(true)
    expect(regionsAllow('North America', ['Canada'])).toBe(true)
  })
  it('lowers remote jobs limited to other countries', () => {
    const profile = profileSchema.parse({ skills: [{ name: 'Vue.js' }], preferences: { workRights: ['Thailand'] } })
    const base = { source: 't', externalId: 'x', url: '', applyUrl: '', title: 'Vue Developer', company: 'A', remote: true, engagement: 'contract' as const, description: 'Vue', rateMin: null, rateMax: null, rateUnit: null, currency: null, postedAt: null, ats: null }
    const open = scoreJob({ ...base, location: 'Remote, anywhere' }, profile)
    const us = scoreJob({ ...base, location: 'Remote (USA)' }, profile)
    expect(us.score).toBeLessThan(open.score)
  })
})

describe('ingest', () => {
  const profile = { skills: [{ name: 'Vue.js' }, { name: 'Node.js' }], preferences: { targetRoles: ['vue developer'], workRights: ['Germany'] } }

  async function setup(settings: Record<string, unknown>) {
    const d1 = fakeD1()
    d1.sqlite.prepare('INSERT INTO profile_versions (data) VALUES (?)').run(JSON.stringify(profileSchema.parse(profile)))
    d1.sqlite.prepare("INSERT INTO settings (key, value) VALUES ('app', ?)").run(JSON.stringify(settings))
    return d1
  }

  it('stores good jobs, drops low scores, adds companies from job links, in a few D1 calls', async () => {
    const d1 = await setup({ sources: [{ kind: 'jobicy', search: '' }], discovery: { ycStartups: false } })
    const jobs = Array.from({ length: 120 }, (_, i) => ({ id: i + 1, url: `https://jobicy.com/jobs/${i}`, jobTitle: i % 2 ? 'Vue Developer' : 'Sales Manager', companyName: `Co${i}`, jobType: ['Contract'], jobGeo: 'Anywhere', jobDescription: i % 2 ? `Vue.js and Node.js. Apply: https://jobs.ashbyhq.com/co${i}` : 'Cold calling, commission only' }))
    const result = await runIngest(d1.db, fake({ jobs }) as any, 40)
    expect(result.summary[0]).toMatchObject({ found: 120, error: null })
    const stored = d1.sqlite.prepare('SELECT COUNT(*) AS n FROM jobs').get() as { n: number }
    expect(stored.n).toBe(result.summary[0]!.added)
    expect(stored.n).toBeGreaterThan(0)
    expect(stored.n).toBeLessThanOrEqual(60)
    expect(result.companiesAdded).toBe(stored.n)
    expect(d1.calls()).toBeLessThan(15)
    // A second run finds the same jobs and adds nothing.
    const again = await runIngest(d1.db, fake({ jobs }) as any, 40)
    expect(again.summary[0]!.added).toBe(0)
  })

  it('reads startups once a day and probes their boards within the budget', async () => {
    const d1 = await setup({ sources: [], discovery: { ycStartups: true, fromJobLinks: true, probesPerRun: 2 } })
    let requests = 0
    const fetcher = async (url: string) => {
      requests++
      if (url.includes('yc-oss')) return new Response(JSON.stringify([
        { name: 'Tiny', slug: 'tiny', team_size: 5, isHiring: true, status: 'Active', regions: ['Remote'], website: 'https://tiny.dev', batch: 'Winter 2026' },
        { name: 'Small', slug: 'small', team_size: 12, isHiring: true, status: 'Active', regions: ['Remote'], website: 'https://small.io', batch: 'Winter 2026' },
      ]))
      if (url.includes('Launch%20HN')) return new Response(JSON.stringify({ hits: [{ title: 'Launch HN: Newco (YC F26) – Does things', url: 'https://newco.ai', objectID: '5' }] }))
      if (url.includes('api.ashbyhq.com/posting-api/job-board/tiny')) return new Response(JSON.stringify({ jobs: [{ id: 'j' }] }))
      return new Response('', { status: 404 })
    }
    const first = await runIngest(d1.db, fetcher as any, 40)
    expect(first.companiesAdded).toBe(3)
    const second = await runIngest(d1.db, fetcher as any, 40)
    expect(second.summary.some((s) => s.source === 'Y Combinator startups')).toBe(false)
    expect(first.boardsFound + second.boardsFound).toBe(1)
    const tiny = d1.sqlite.prepare("SELECT ats, ats_token, size, team_size FROM companies WHERE name = 'Tiny'").get()
    expect(tiny).toMatchObject({ ats: 'ashby', ats_token: 'tiny', size: 'startup', team_size: 5 })
    expect(requests).toBeLessThanOrEqual(2 + 3 * 6)
  })
})

describe('target and avoided countries', () => {
  const profile = profileSchema.parse({ skills: [{ name: 'Vue.js' }], preferences: { workRights: ['Thailand'], targetCountries: ['Singapore', 'Japan', 'Australia'], avoidCountries: ['Atlantis'] } })
  const base = { source: 't', externalId: 'x', url: '', applyUrl: '', title: 'Vue Developer', company: 'A', remote: true, engagement: 'contract' as const, description: 'Vue', rateMin: null, rateMax: null, rateUnit: null, currency: null, postedAt: null, ats: null }
  it('treats target countries as open, leaves out avoided ones', () => {
    const sg = scoreJob({ ...base, location: 'Remote (Singapore)' }, profile)
    const us = scoreJob({ ...base, location: 'Remote (USA)' }, profile)
    const avoided = scoreJob({ ...base, location: 'Remote (Atlantis)' }, profile)
    expect(sg.score).toBeGreaterThan(us.score)
    expect(avoided.blocked).toBe(true)
    expect(scoreJob({ ...base, location: 'Remote (Atlantis, Singapore)' }, profile).blocked).toBe(false)
  })
  it('asks Himalayas and Jobicy for one country', async () => {
    const urls: string[] = []
    const fetcher = async (url: string) => { urls.push(url); return new Response(JSON.stringify({ jobs: [] })) }
    await fetchHimalayas(fetcher, '', 'SG')
    await fetchJobicy(fetcher, '', 'apac')
    expect(urls[0]).toContain('/jobs/api/search?sort=recent&country=SG&exclude_worldwide=true')
    expect(urls[1]).toContain('&geo=apac')
  })
  it('reads MyCareersFuture and keeps only the telecommuting flag as remote', async () => {
    const { fetchMyCareersFuture } = await import('../src/core/sources/boards')
    const jobs = await fetchMyCareersFuture(fake({ results: [{ uuid: 'u1', title: 'Senior Full Stack Engineer | Vue 3', description: '<p>Vue</p>', flexibleWorkArrangements: [{ flexibleWorkArrangement: 'Telecommuting' }], employmentTypes: [{ employmentType: 'Contract' }], postedCompany: { name: 'Acme' }, metadata: { createdAt: '2026-11-04T08:30:11.000Z', jobDetailsUrl: 'https://www.mycareersfuture.gov.sg/job/x' }, salary: { minimum: 8000, maximum: 12000, type: { salaryType: 'Monthly' } } }] }))
    expect(jobs[0]).toMatchObject({ remote: true, location: 'Remote (Singapore)', engagement: 'contract', rateMin: 96000, currency: 'SGD', company: 'Acme' })
  })
})

describe('extension job lookup', () => {
  it('matches a long application link to its saved job without LIKE', () => {
    const { sqlite } = fakeD1()
    const url = 'https://jobs.ashbyhq.com/some-company-with-a-long-name/0f6b2a3c-1234-4567-89ab-cdef01234567'
    sqlite.prepare("INSERT INTO jobs (id, source, external_id, dedupe_key, url, apply_url, title) VALUES ('j1', 't', 'e1', 'k1', ?, ?, 'Dev')").run(url, url)
    const row = sqlite.prepare(`SELECT id FROM jobs WHERE url = ? OR apply_url = ?
        OR (url != '' AND substr(?, 1, length(url)) = url) OR (apply_url != '' AND substr(?, 1, length(apply_url)) = apply_url)
        ORDER BY length(url) DESC LIMIT 1`).get('x', 'x', `${url}/application?utm_source=x`, `${url}/application?utm_source=x`) as { id: string }
    expect(row.id).toBe('j1')
  })
})
