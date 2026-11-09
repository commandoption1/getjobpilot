import { describe, expect, it } from 'vitest'

import { digestText, fillTemplate, findEmails, localDate, localDayStart, orderQueue, replyStats, scoreBand, siteDomain, unknownFields } from '../src/core/outreach'
import { checkText, hasErrors } from '../src/core/resume'
import { buildDigest, localHour, runDigest } from '../src/server/digest'
import { doneSince, followUpsDue, getPitch, pitchTargets, queueCandidates, savePitch, setPitchStatus } from '../src/server/db'
import { checkTemplate, useTemplate } from '../src/server/letters'
import { fakeD1 } from './fake-d1'
import { sampleProfile } from './fixtures'

describe('templates', () => {
  it('fills placeholders and reports missing or unknown ones', () => {
    expect(fillTemplate('{{greeting}} I can help {{company}} with the {{ role }} work.', { greeting: 'Hi Anna,', company: 'Acme', role: 'Vue' }))
      .toEqual({ text: 'Hi Anna, I can help Acme with the Vue work.', missing: [] })
    expect(fillTemplate('For {{company}} as {{role}}', { company: 'Acme' }).missing).toEqual(['role'])
    expect(unknownFields('Hi {{compnay}} and {{company}}')).toEqual(['compnay'])
  })

  it('checks a template like a cover letter', () => {
    const profile = sampleProfile()
    const good = checkTemplate(profile, { name: 'a', kind: 'pitch', subject: 'Vue contractor for {{company}}', body: '{{greeting}}\n\nI rebuilt a checkout in Vue 3 and moved an API to Cloudflare Workers. Could I help {{company}} with a small paid task first?\n\nSam' }, [])
    expect(hasErrors(good)).toBe(false)
    const bad = checkTemplate(profile, { name: 'b', kind: 'letter', subject: '', body: 'I am excited to join {{compnay}}. I have 12 years of React experience!' }, [])
    const text = bad.map((c) => c.message).join(' | ')
    expect(text).toContain('{{compnay}}')
    expect(text).toContain('12')
    expect(text).toContain('React')
    expect(text).toContain('i am excited to')
    expect(text).toContain('exclamation')
  })

  it('lets the company name and role through but nothing else new', () => {
    const profile = sampleProfile()
    const filled = useTemplate(profile, { subject: '', body: 'I would like to help {{company}} as a {{role}}.' }, { company: 'Web3 Labs 42', role: 'Vue Developer' }, [])
    expect(filled.checks.filter((c) => c.severity === 'error')).toEqual([])
    expect(hasErrors(useTemplate(profile, { subject: '', body: 'Hi {{first_name}}, I know Rust.' }, {}, []).checks)).toBe(true)
  })

  it('checkText flags invented numbers and skills in a pitch', () => {
    const issues = checkText(sampleProfile(), 'Pitch', 'I cut page load from 4.1s to 1.3s and served 900 merchants with Kubernetes.')
    expect(issues.map((i) => i.message).join(' ')).toMatch(/900/)
    expect(issues.map((i) => i.message).join(' ')).toMatch(/Kubernetes/i)
    expect(issues.map((i) => i.message).join(' ')).not.toMatch(/4\.1/)
  })
})

describe('contact emails', () => {
  it('keeps only the company domain, best address first, and skips junk', () => {
    const html = `<a href="mailto:jane@acme.io">Jane</a> hello&#64;acme.io <img src="logo@2x.png"> support@intercom.io noreply@acme.io founders@acme.io`
    expect(findEmails(html, 'acme.io')).toEqual(['founders@acme.io', 'hello@acme.io', 'jane@acme.io'])
    expect(siteDomain('www.Acme.io/about')).toBe('acme.io')
  })
})

describe('days in a UTC+7 time zone', () => {
  it('starts the day at local midnight', () => {
    // 2026-11-08 18:00 UTC is already 01:00 on the 9th in UTC+7.
    const now = new Date('2026-11-08T18:00:00Z')
    expect(localDayStart(7, now)).toBe('2026-11-08T17:00:00Z')
    expect(localDate(7, now)).toBe('2026-11-09')
    expect(localDayStart(7, new Date('2026-11-08T16:00:00Z'))).toBe('2026-11-07T17:00:00Z')
  })
})

describe('apply queue', () => {
  it('puts thumbs-up, then approved, then saved, then score first, and drops low and thumbs-down', () => {
    const j = (id: string, over: object) => ({ id, score: 60, myRating: null, status: 'new', createdAt: '2026-11-01', hasApproved: false, ...over })
    const order = orderQueue([
      j('low', { score: 20 }), j('down', { score: 99, myRating: -1 }), j('mid', { score: 70 }), j('top', { score: 95 }),
      j('liked', { score: 30, myRating: 1 }), j('ready', { score: 56, hasApproved: true }), j('saved', { score: 10, status: 'saved' }), j('applied', { score: 99, status: 'applied' }),
    ], 55, 10).map((x) => x.id)
    expect(order).toEqual(['liked', 'ready', 'saved', 'top', 'mid'])
  })
})

describe('reply stats and digest', () => {
  it('groups replies by source and score band', () => {
    const rows = [
      { source: 'hn', score: 85, status: 'interview' }, { source: 'hn', score: 70, status: 'applied' },
      { source: 'remotive', score: 50, status: 'lost' }, { source: 'remotive', score: 90, status: 'applied' },
    ]
    expect(replyStats(rows, (r) => r.source)).toEqual([
      { key: 'hn', applied: 2, replied: 1, rate: 0.5 }, { key: 'remotive', applied: 2, replied: 0, rate: 0 },
    ])
    expect(scoreBand(85)).toBe('80-100')
    expect(scoreBand(null)).toBe('no score')
  })

  it('writes a plain digest with links', () => {
    const text = digestText({
      appUrl: 'https://job.example.com/', jobs: [{ id: 'j1', title: 'Vue dev', company: 'Acme', score: 88, engagement: 'contract', rate: 'USD 50/hour' }],
      followUps: [{ id: 'j2', title: 'Node dev', company: 'Beta' }], pitchFollowUps: [{ company: 'Gamma' }],
      yesterday: { applied: 4, pitched: 1 }, goal: { applications: 5, pitches: 3 },
    })
    expect(text).toContain('88 Vue dev at Acme, USD 50/hour (contract): https://job.example.com/jobs/j1')
    expect(text).toContain('Follow up today (2)')
    expect(text).toContain('Pitch to Gamma')
    expect(text).toContain('Yesterday: 4 applied, 1 pitched.')
    expect(text).not.toMatch(/[—–]/)
  })
})

describe('outreach in the database', () => {
  const setup = () => {
    const d1 = fakeD1()
    d1.sqlite.prepare("INSERT INTO companies (id, name, website, status, fit, contact_email) VALUES ('c1', 'Acme', 'https://acme.io', 'watching', 80, ''), ('c2', 'Beta', 'https://beta.io', 'watching', 90, 'hi@beta.io'), ('c3', 'Gamma', '', 'watching', 99, ''), ('c4', 'Delta', 'https://delta.io', 'watching', 99, '')").run()
    d1.sqlite.prepare("UPDATE companies SET ats = 'greenhouse', ats_token = 'delta' WHERE id = 'c4'").run()
    return d1
  }

  it('lists pitch targets with a website and no board, contact first, and moves a pitch through its states', async () => {
    const { db, sqlite } = setup()
    expect((await pitchTargets(db, 10)).map((c) => c.name)).toEqual(['Beta', 'Acme'])

    await savePitch(db, { id: 'p1', companyId: 'c1', toEmail: 'hello@acme.io', subject: 'Hi', body: 'Body', checks: [], writtenBy: 'test' })
    expect((await pitchTargets(db, 10)).map((c) => c.name)).toEqual(['Beta'])

    await setPitchStatus(db, 'p1', 'sent', 5)
    const sent = await getPitch(db, 'p1')
    expect(sent?.status).toBe('sent')
    expect(sent?.sentAt).toBeTruthy()
    expect(sent?.followUpAt).toBe(new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10))
    expect((sqlite.prepare("SELECT status FROM companies WHERE id = 'c1'").get() as { status: string }).status).toBe('pitched')
    expect((await doneSince(db, '2000-01-01T00:00:00Z')).pitched).toBe(1)
    expect((await followUpsDue(db, '2999-01-01')).pitches).toEqual([{ id: 'p1', company: 'Acme' }])

    await setPitchStatus(db, 'p1', 'replied', 5)
    expect((sqlite.prepare("SELECT status FROM companies WHERE id = 'c1'").get() as { status: string }).status).toBe('talking')
  })

  it('counts applications and marks jobs with an approved resume', async () => {
    const { db, sqlite } = setup()
    sqlite.prepare(`INSERT INTO jobs (id, source, external_id, dedupe_key, title, status, score, applied_at, created_at) VALUES
      ('j1', 'hn', 'e1', 'k1', 'A', 'new', 70, NULL, '2026-11-08T00:00:00Z'),
      ('j2', 'hn', 'e2', 'k2', 'B', 'applied', 80, '2026-11-08T03:00:00Z', '2026-11-07T00:00:00Z'),
      ('j3', 'hn', 'e3', 'k3', 'C', 'saved', 40, NULL, '2026-11-08T00:00:00Z')`).run()
    sqlite.prepare("INSERT INTO profile_versions (id, data) VALUES (1, '{}')").run()
    sqlite.prepare("INSERT INTO tailored (id, job_id, profile_version, data, checks, coverage, status) VALUES ('t1', 'j3', 1, '{}', '[]', '{}', 'approved')").run()
    expect(await doneSince(db, '2026-11-07T17:00:00Z')).toEqual({ applied: 1, pitched: 0 })
    expect(await doneSince(db, '2026-11-08T17:00:00Z')).toEqual({ applied: 0, pitched: 0 })
    const queue = await queueCandidates(db)
    expect(queue.map((j) => [j.id, j.hasApproved])).toEqual([['j1', false], ['j3', true]])
  })

  it('builds the digest from the database without any AI call', async () => {
    const { db, sqlite } = setup()
    sqlite.prepare(`INSERT INTO jobs (id, source, external_id, dedupe_key, title, company, status, score, created_at, follow_up_at, engagement) VALUES
      ('j1', 'hn', 'e1', 'k1', 'Vue dev', 'Acme', 'new', 88, '2026-11-08T05:00:00Z', NULL, 'contract'),
      ('j2', 'hn', 'e2', 'k2', 'Low', 'Acme', 'new', 20, '2026-11-08T05:00:00Z', NULL, 'contract'),
      ('j3', 'hn', 'e3', 'k3', 'Node dev', 'Beta', 'applied', 70, '2026-11-01T00:00:00Z', '2026-11-08', 'contract')`).run()
    const text = await buildDigest(db, 'https://job.example.com', new Date('2026-11-09T01:00:00Z'))
    expect(text).toContain('88 Vue dev at Acme')
    expect(text).not.toContain('Low at Acme')
    expect(text).toContain('Node dev at Beta')
    // 2026-11-09 is a Monday (UTC, the default offset), so the weekly line is there.
    expect(text).toContain('Last 7 days')
  })

  it('sends only in the digest hour set in Settings, unless forced', async () => {
    const { db } = setup()
    const sent: string[] = []
    const fakeFetch = (async (_url: string, init: RequestInit) => { sent.push(String(init.body)); return new Response('{}') }) as unknown as typeof fetch
    const env = { DB: db, TELEGRAM_BOT_TOKEN: 't', TELEGRAM_CHAT_ID: '1', APP_URL: 'https://job.example.com' }
    // Default: 08:00 at UTC+0.
    expect((await runDigest(env, fakeFetch, { now: new Date('2026-11-09T07:00:00Z') })).reason).toBe('Not the digest hour yet')
    expect((await runDigest(env, fakeFetch, { now: new Date('2026-11-09T08:00:00Z') })).sent).toBe(true)
    expect((await runDigest(env, fakeFetch, { now: new Date('2026-11-09T03:00:00Z'), force: true })).sent).toBe(true)
    expect(sent).toHaveLength(2)
    expect((await runDigest({ DB: db }, fakeFetch, { force: true })).reason).toContain('TELEGRAM_BOT_TOKEN')
  })

  it('works out the local hour for any offset', () => {
    expect(localHour(7, new Date('2026-11-09T01:00:00Z'))).toBe(8)
    expect(localHour(-5, new Date('2026-11-09T13:00:00Z'))).toBe(8)
    expect(localHour(5.5, new Date('2026-11-09T02:30:00Z'))).toBe(8)
  })
})
