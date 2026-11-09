// Plain helpers for the daily routine: letter templates, finding a contact email on a company site, the daily digest
// text, the apply queue order and reply stats. No network or Cloudflare code here, so all of it is tested directly.

// ---------- letter and pitch templates ----------

/** Placeholders a template may use. Anything else in {{ }} is an error, so a typo can't reach a client. */
export const TEMPLATE_FIELDS = ['company', 'role', 'name', 'first_name', 'greeting'] as const
export type TemplateVars = Partial<Record<(typeof TEMPLATE_FIELDS)[number], string>>

export function templateFields(body: string): string[] {
  return [...body.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/gi)].map((m) => m[1]!.toLowerCase())
}

export function unknownFields(body: string): string[] {
  return [...new Set(templateFields(body).filter((f) => !(TEMPLATE_FIELDS as readonly string[]).includes(f)))]
}

/** Fills {{company}}, {{role}} and the rest. Returns the text and any placeholder that had no value. */
export function fillTemplate(body: string, vars: TemplateVars): { text: string; missing: string[] } {
  const missing: string[] = []
  const text = body.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (whole, key: string) => {
    const value = vars[key.toLowerCase() as keyof TemplateVars]
    if (value === undefined || value === '') { missing.push(key.toLowerCase()); return whole }
    return value
  })
  return { text, missing: [...new Set(missing)] }
}

// ---------- contact email on a company site ----------

const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi
const JUNK = /(noreply|no-reply|donotreply|example\.|sentry|wixpress|@sentry|privacy|abuse|legal|unsubscribe|\.png$|\.jpg$|\.svg$|\.webp$|\.gif$)/i
// Addresses a founder or team actually reads, best first.
const PREFERRED = ['founders', 'founder', 'hello', 'hi', 'team', 'jobs', 'careers', 'contact', 'info']

export const siteDomain = (website: string) => {
  try { return new URL(/^https?:\/\//.test(website) ? website : `https://${website}`).hostname.replace(/^www\./, '').toLowerCase() } catch { return '' }
}

/** Every email address on a page that belongs to the company's own domain, best first. */
export function findEmails(html: string, domain: string): string[] {
  const decoded = html.replace(/&#64;|&commat;|\[at\]|\(at\)/gi, '@').replace(/%40/g, '@')
  const found = [...new Set((decoded.match(EMAIL) ?? []).map((e) => e.toLowerCase().replace(/^mailto:/, '')))]
    .filter((e) => !JUNK.test(e))
    .filter((e) => !domain || e.endsWith(`@${domain}`) || e.endsWith(`.${domain}`))
  const rank = (e: string) => { const i = PREFERRED.indexOf(e.split('@')[0]!); return i === -1 ? PREFERRED.length : i }
  return found.sort((a, b) => rank(a) - rank(b))
}

/** Pages worth reading for a contact address, in order. */
export function contactPages(website: string): string[] {
  const domain = siteDomain(website)
  if (!domain) return []
  const base = `https://${domain}`
  return [base, `${base}/contact`, `${base}/about`, `${base}/team`]
}

// ---------- dates in the user's own time zone ----------

/** Midnight today in a fixed UTC offset, as an ISO time in UTC. For example +7 is UTC+7. */
export function localDayStart(offsetHours: number, now = new Date()): string {
  const local = new Date(now.getTime() + offsetHours * 36e5)
  local.setUTCHours(0, 0, 0, 0)
  return new Date(local.getTime() - offsetHours * 36e5).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

export const localDate = (offsetHours: number, now = new Date()) => new Date(now.getTime() + offsetHours * 36e5).toISOString().slice(0, 10)

// ---------- apply queue ----------

export type QueueJob = { id: string; score: number | null; myRating: number | null; status: string; createdAt: string; hasApproved?: boolean }

/** Today's queue: thumbs-up first, then jobs already tailored, then score, then newest. Thumbs-down never shows. */
export function orderQueue<T extends QueueJob>(jobs: T[], minScore: number, size: number): T[] {
  return jobs
    .filter((j) => (j.status === 'new' || j.status === 'saved') && (j.myRating ?? 0) >= 0 && ((j.score ?? 0) >= minScore || j.myRating === 1 || j.status === 'saved'))
    .sort((a, b) => (b.myRating ?? 0) - (a.myRating ?? 0)
      || Number(b.hasApproved ?? false) - Number(a.hasApproved ?? false)
      || Number(b.status === 'saved') - Number(a.status === 'saved')
      || (b.score ?? 0) - (a.score ?? 0)
      || b.createdAt.localeCompare(a.createdAt))
    .slice(0, size)
}

// ---------- reply stats ----------

export type AppliedRow = { source: string; score: number | null; status: string }

/** A reply is anything past "applied": an interview, an offer, a win, or a rejection that came after an interview. */
export const REPLIED = new Set(['interview', 'offer', 'won'])

export type StatLine = { key: string; applied: number; replied: number; rate: number }

export const scoreBand = (score: number | null) => (score === null ? 'no score' : score >= 80 ? '80-100' : score >= 60 ? '60-79' : score >= 40 ? '40-59' : '0-39')

export function replyStats(rows: AppliedRow[], by: (r: AppliedRow) => string): StatLine[] {
  const map = new Map<string, { applied: number; replied: number }>()
  for (const r of rows) {
    const key = by(r)
    const line = map.get(key) ?? { applied: 0, replied: 0 }
    line.applied++
    if (REPLIED.has(r.status)) line.replied++
    map.set(key, line)
  }
  return [...map].map(([key, v]) => ({ key, ...v, rate: v.applied ? v.replied / v.applied : 0 }))
    .sort((a, b) => b.rate - a.rate || b.applied - a.applied)
}

// ---------- daily digest ----------

export type DigestInput = {
  appUrl: string
  jobs: { id: string; title: string; company: string; score: number | null; engagement: string; rate: string }[]
  followUps: { id: string; title: string; company: string }[]
  pitchFollowUps: { company: string }[]
  yesterday: { applied: number; pitched: number }
  goal: { applications: number; pitches: number }
  weekly?: { applied: number; replied: number; pitched: number; pitchReplies: number; bestSource: string | null }
}

/** The Telegram message. Plain text, so nothing needs escaping. */
export function digestText(d: DigestInput): string {
  const lines: string[] = []
  const app = d.appUrl.replace(/\/$/, '')
  lines.push(`JobPilot: ${d.goal.applications} applications and ${d.goal.pitches} pitches today.`)
  lines.push(`Yesterday: ${d.yesterday.applied} applied, ${d.yesterday.pitched} pitched.`)
  if (d.followUps.length || d.pitchFollowUps.length) {
    lines.push('', `Follow up today (${d.followUps.length + d.pitchFollowUps.length}):`)
    for (const f of d.followUps) lines.push(`- ${f.title} at ${f.company || 'unknown'}: ${app}/jobs/${f.id}`)
    for (const p of d.pitchFollowUps) lines.push(`- Pitch to ${p.company}: ${app}/outreach`)
  }
  if (d.jobs.length) {
    lines.push('', `Best new jobs (${d.jobs.length}):`)
    for (const j of d.jobs) lines.push(`- ${j.score ?? '-'} ${j.title} at ${j.company || 'unknown'}${j.rate ? `, ${j.rate}` : ''} (${j.engagement}): ${app}/jobs/${j.id}`)
  } else {
    lines.push('', 'No new jobs above your digest score since yesterday.')
  }
  if (d.weekly) {
    const w = d.weekly
    lines.push('', `Last 7 days: ${w.applied} applied, ${w.replied} replies, ${w.pitched} pitches, ${w.pitchReplies} pitch replies.${w.bestSource ? ` Most replies came from ${w.bestSource}.` : ''}`)
  }
  lines.push('', `Start: ${app}/queue`)
  return lines.join('\n')
}
