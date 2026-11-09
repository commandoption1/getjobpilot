import { describe, expect, it } from 'vitest'

import { detectAts } from '../src/core/sources'
import { fetchAshby, fetchGreenhouse, fetchLever } from '../src/core/sources/ats'
import { parseRss } from '../src/core/sources/boards'
import { parseHnComments } from '../src/core/sources/hn'

const fake = (body: unknown) => async () => new Response(JSON.stringify(body), { status: 200 })

describe('ATS sources', () => {
  it('reads Greenhouse', async () => {
    const jobs = await fetchGreenhouse(fake({ jobs: [{ id: 1, title: 'Vue Developer', absolute_url: 'https://boards.greenhouse.io/acme/jobs/1', location: { name: 'Remote' }, content: '&lt;p&gt;Contract role, $100/hr&lt;/p&gt;' }] }), 'acme', 'Acme')
    expect(jobs[0]).toMatchObject({ title: 'Vue Developer', company: 'Acme', ats: 'greenhouse', rateMin: 100, description: 'Contract role, $100/hr' })
  })
  it('reads Lever, including commitment and salary range', async () => {
    const jobs = await fetchLever(fake([{ id: 'a', text: 'Engineer', hostedUrl: 'https://jobs.lever.co/acme/a', categories: { commitment: 'Contract', location: 'Remote' }, workplaceType: 'remote', descriptionPlain: 'Build things', salaryRange: { min: 80, max: 95, currency: 'USD', interval: 'per-hour-wage' } }]), 'acme')
    expect(jobs[0]).toMatchObject({ engagement: 'contract', remote: true, rateMin: 80, rateMax: 95, rateUnit: 'hour' })
  })
  it('reads Ashby', async () => {
    const jobs = await fetchAshby(fake({ jobs: [{ id: 'z', title: 'Dev', jobUrl: 'https://jobs.ashbyhq.com/acme/z', isRemote: true, employmentType: 'Contract', descriptionPlain: 'Node' }] }), 'acme', 'Acme')
    expect(jobs[0]).toMatchObject({ engagement: 'contract', remote: true, ats: 'ashby' })
  })
  it('detects the ATS from a careers link', () => {
    expect(detectAts('https://jobs.lever.co/acme')).toEqual({ kind: 'lever', token: 'acme' })
    expect(detectAts('https://boards.greenhouse.io/acme/jobs/123')).toEqual({ kind: 'greenhouse', token: 'acme' })
    expect(detectAts('https://jobs.ashbyhq.com/acme')).toEqual({ kind: 'ashby', token: 'acme' })
    expect(detectAts('https://acme.com/careers')).toBeNull()
  })
})

describe('feeds', () => {
  it('reads We Work Remotely style RSS', () => {
    const xml = `<rss><channel><item><title>Acme: Senior Vue Developer</title><link>https://weworkremotely.com/x</link><guid>https://weworkremotely.com/x</guid><description><![CDATA[<p>Contract, $90/hr</p>]]></description><pubDate>Mon, 02 Nov 2026 10:00:00 +0000</pubDate></item></channel></rss>`
    expect(parseRss(xml, 'wwr')[0]).toMatchObject({ company: 'Acme', title: 'Senior Vue Developer', engagement: 'contract', rateMin: 90 })
  })
  it('keeps only client posts from the HN freelancer thread', () => {
    const jobs = parseHnComments([
      { id: 1, created_at: '2026-11-01', text: 'SEEKING WORK | Vue dev | Remote' },
      { id: 2, created_at: '2026-11-01', text: 'SEEKING FREELANCER | Acme | Vue frontend | Remote<p>Budget $100/hr' },
    ], 'freelancer')
    expect(jobs).toHaveLength(1)
    expect(jobs[0]).toMatchObject({ company: 'Acme', title: 'Vue frontend', engagement: 'freelance', rateMin: 100 })
  })
})
