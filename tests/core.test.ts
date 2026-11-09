import { describe, expect, it } from 'vitest'

import { wordDiff } from '../src/core/diff'
import { dedupeKey, detectEngagement, detectRate, detectRemote, htmlToText, jobInputSchema } from '../src/core/job'
import { findTerms, keywordCoverage } from '../src/core/keywords'
import { profileProblems } from '../src/core/profile'
import { baseResume, checkResume, hasErrors, profileDraft, type TailoredResume } from '../src/core/resume'
import { scoreJob } from '../src/core/scoring'
import { lintBullets, lintText } from '../src/core/style'
import { sampleProfile } from './fixtures'

const job = (over: Partial<ReturnType<typeof jobInputSchema.parse>> = {}) => jobInputSchema.parse({ source: 'test', externalId: 'x', title: 'Frontend Engineer', description: '', ...over })

describe('job text', () => {
  it('reads rates', () => {
    expect(detectRate('Pay: $90-120/hr, remote')).toMatchObject({ rateMin: 90, rateMax: 120, rateUnit: 'hour', currency: 'USD' })
    expect(detectRate('€600 per day')).toMatchObject({ rateMin: 600, rateUnit: 'day', currency: 'EUR' })
    expect(detectRate('$150k - $180k')).toMatchObject({ rateMin: 150000, rateMax: 180000, rateUnit: 'year' })
    expect(detectRate('We have 5 offices')).toMatchObject({ rateMin: null })
  })
  it('reads work type and remote', () => {
    expect(detectEngagement('6-month contract, B2B')).toBe('contract')
    expect(detectEngagement('Looking for a freelancer')).toBe('freelance')
    expect(detectEngagement('Full-time with benefits')).toBe('full-time')
    expect(detectRemote('Fully remote team')).toBe(true)
    expect(detectRemote('On-site only in Berlin')).toBe(false)
  })
  it('strips html and decodes entities, including double-escaped Greenhouse content', () => {
    expect(htmlToText('&lt;p&gt;Hello &amp;amp; welcome&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Vue&lt;/li&gt;&lt;/ul&gt;')).toBe('Hello & welcome\n- Vue')
  })
  it('dedupes the same role across boards', () => {
    expect(dedupeKey({ company: 'Acme, Inc.', title: 'Senior Engineer' })).toBe(dedupeKey({ company: 'acme', title: 'Senior engineer!' }))
  })
})

describe('keywords', () => {
  it('finds terms with the spelling the post used', () => {
    const hits = findTerms('We use Vue.js, TypeScript and Postgres. C# is a plus.')
    expect(hits.map((h) => h.asWritten)).toEqual(expect.arrayContaining(['Vue.js', 'TypeScript', 'Postgres', 'C#']))
  })
  it('does not match inside other words', () => {
    expect(findTerms('We are a gorgeous team').map((h) => h.canonical)).not.toContain('go')
  })
  it('measures coverage', () => {
    const cov = keywordCoverage(findTerms('Vue, Node.js, Kubernetes'), 'Built apps in Vue and Node')
    expect(cov.missing).toEqual(['Kubernetes'])
  })
})

describe('scoring', () => {
  const profile = sampleProfile()
  it('ranks a remote Vue contract above an on-site Java job', () => {
    const good = scoreJob(job({ title: 'Senior Frontend Engineer (contract)', engagement: 'contract', remote: true, description: 'Vue 3, TypeScript, Cloudflare Workers. $110/hr. Fintech.', rateMin: 110, rateMax: 110, rateUnit: 'hour', currency: 'USD' }), profile)
    const bad = scoreJob(job({ title: 'Java Developer', engagement: 'full-time', remote: false, description: 'Java, Kotlin, Spring. Office in Paris.' }), profile)
    expect(good.score).toBeGreaterThan(80)
    expect(bad.score).toBe(0)
    expect(bad.blocked).toBe(true)
  })
  it('blocks excluded words and flags red flags', () => {
    const r = scoreJob(job({ description: 'Unpaid trial project first. Rockstar wanted.', remote: true }), profile)
    expect(r.blocked).toBe(true)
    expect(r.flags).toContain('Vague or hype wording')
  })
  it('scores a rate under the floor low', () => {
    const r = scoreJob(job({ remote: true, engagement: 'contract', rateMin: 30, rateMax: 30, rateUnit: 'hour', description: 'Vue' }), profile)
    expect(r.parts.find((p) => p.key === 'rate')!.value).toBeLessThan(0.1)
  })
})

describe('style rules', () => {
  it('catches AI-sounding phrases and dashes', () => {
    const rules = lintText('I spearheaded a robust platform — leveraging cutting-edge tech!').map((i) => i.rule)
    expect(rules).toEqual(expect.arrayContaining(['banned-phrase', 'dash', 'exclamation']))
  })
  it('passes plain writing', () => {
    expect(lintText('Rebuilt the checkout in Vue 3, cutting page load from 4.1s to 1.3s.')).toEqual([])
  })
  it('flags bullets that all open with the same verb', () => {
    expect(lintBullets(['Built a', 'Built b', 'Built c']).some((i) => i.rule === 'same-opening')).toBe(true)
  })
})

describe('resume checks', () => {
  const profile = sampleProfile()
  const draft = (): TailoredResume => ({
    headline: 'Frontend engineer for Vue and Cloudflare', summary: profile.summary,
    experience: [
      { experienceId: 'exp-1', bullets: [{ sourceIds: ['b1'], text: 'Rebuilt the Vue 3 checkout, cutting page load from 4.1s to 1.3s' }, { sourceIds: ['b2'], text: 'Moved the API to Cloudflare Workers and D1, lowering hosting costs by 60%' }] },
      { experienceId: 'exp-2', bullets: [{ sourceIds: ['b4'], text: 'Built an order export service in Node.js and PostgreSQL used by 300 merchants' }] },
    ],
    projects: [], skills: ['Vue', 'TypeScript', 'Cloudflare Workers'], coverLetter: '',
  })
  it('passes an honest rewrite', () => {
    expect(checkResume(profile, draft()).filter((i) => i.severity === 'error')).toEqual([])
  })
  it('passes the untouched base resume', () => {
    expect(hasErrors(checkResume(profile, baseResume(profile)))).toBe(false)
  })
  it('catches an invented metric', () => {
    const d = draft()
    d.experience[0]!.bullets[0]!.text = 'Rebuilt the Vue 3 checkout, raising conversion by 25%'
    expect(checkResume(profile, d).some((i) => i.message.includes('25%'))).toBe(true)
  })
  it('catches a skill the user does not have', () => {
    const d = draft()
    d.experience[0]!.bullets[1]!.text = 'Moved the API to Kubernetes and D1, lowering hosting costs by 60%'
    d.skills.push('React')
    const issues = checkResume(profile, d)
    expect(issues.some((i) => i.message.includes('Kubernetes'))).toBe(true)
    expect(issues.some((i) => i.message.includes('"React"'))).toBe(true)
  })
  it('catches a bullet moved to another job or a made-up id', () => {
    const d = draft()
    d.experience[1]!.bullets.push({ sourceIds: ['b1'], text: 'Rebuilt the checkout' })
    d.experience[0]!.bullets.push({ sourceIds: ['nope'], text: 'Did things' })
    const msgs = checkResume(profile, d).map((i) => i.message)
    expect(msgs.some((m) => m.includes('different experience'))).toBe(true)
    expect(msgs.some((m) => m.includes("doesn't exist"))).toBe(true)
  })
  it('catches banned phrases in the cover letter, including custom ones', () => {
    const d = draft()
    d.coverLetter = 'I am thrilled to apply. I love synergy-free teams. Pineapple.'
    const msgs = checkResume(profile, d, ['pineapple']).map((i) => i.message)
    expect(msgs.some((m) => m.includes('i am thrilled'))).toBe(true)
    expect(msgs.some((m) => m.includes('pineapple'))).toBe(true)
  })
  it('warns when a recent job is left out', () => {
    const d = draft()
    d.experience.pop()
    expect(checkResume(profile, d).some((i) => i.severity === 'warning' && i.message.includes('gap'))).toBe(true)
  })
})

describe('profile', () => {
  it('finds duplicate ids and bad dates', () => {
    const p = sampleProfile()
    p.experience[1]!.bullets[0]!.id = 'b1'
    p.experience[1]!.end = '2019-01'
    const problems = profileProblems(p)
    expect(problems.some((x) => x.includes('Duplicate id "b1"'))).toBe(true)
    expect(problems.some((x) => x.includes('ends'))).toBe(true)
  })
})

describe('diff', () => {
  it('marks added and removed words', () => {
    const parts = wordDiff('Built the API', 'Built the REST API')
    expect(parts.filter((p) => p.kind === 'added').map((p) => p.text.trim())).toEqual(['REST'])
  })
})

describe('draft without AI', () => {
  it('keeps every bullet, moves matching ones up, lists the asked-for skills first, and passes the checks', () => {
    const profile = sampleProfile()
    const draft = profileDraft(profile, 'Contract backend role: Cloudflare Workers and D1, some PostgreSQL.')
    expect(draft.experience[0]!.bullets.map((b) => b.sourceIds[0])).toEqual(['b2', 'b1', 'b3'])
    expect(draft.skills.slice(0, 2)).toEqual(['Cloudflare Workers', 'PostgreSQL'])
    expect(draft.coverLetter).toBe('')
    expect(hasErrors(checkResume(profile, draft))).toBe(false)
  })
})

describe('example profile', () => {
  it('is valid and safe to tailor from', async () => {
    const { readFileSync } = await import('node:fs')
    const { profileSchema } = await import('../src/core/profile')
    const profile = profileSchema.parse(JSON.parse(readFileSync(new URL('../examples/profile.example.json', import.meta.url), 'utf8')))
    expect(profileProblems(profile)).toEqual([])
    expect(hasErrors(checkResume(profile, baseResume(profile)))).toBe(false)
  })
})
