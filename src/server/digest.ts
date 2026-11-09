// The morning message: best new jobs, follow-ups due, yesterday against the daily goal, and on Mondays the week's
// reply numbers. Sent to Telegram from the daily cron (src/worker.ts). Costs no AI calls.
import { digestText, localDate, localDayStart, replyStats } from '../core/outreach'
import { money } from '../components/api'
import { appliedRows, doneSince, followUpsDue, getSettings, newJobsSince, pitchCounts } from './db'

export type DigestEnv = { DB: D1Database; TELEGRAM_BOT_TOKEN?: string; TELEGRAM_CHAT_ID?: string; APP_URL?: string }

export async function buildDigest(db: D1Database, appUrl: string, now = new Date()): Promise<string> {
  const settings = await getSettings(db)
  const offset = settings.routine.utcOffset
  const todayStart = localDayStart(offset, now)
  const yesterdayStart = new Date(Date.parse(todayStart) - 864e5).toISOString().replace(/\.\d{3}Z$/, 'Z')
  const weekAgo = new Date(now.getTime() - 7 * 864e5).toISOString().replace(/\.\d{3}Z$/, 'Z')
  const isMonday = new Date(now.getTime() + offset * 36e5).getUTCDay() === 1
  const [jobs, due, yesterday] = await Promise.all([
    newJobsSince(db, yesterdayStart, settings.digest.minScore, settings.digest.maxJobs),
    followUpsDue(db, localDate(offset, now)),
    doneSince(db, yesterdayStart, todayStart),
  ])
  let weekly
  if (isMonday) {
    const [rows, pitches] = await Promise.all([appliedRows(db, weekAgo), pitchCounts(db, weekAgo)])
    const bySource = replyStats(rows, (r) => r.source).filter((s) => s.replied > 0)
    weekly = { applied: rows.length, replied: rows.filter((r) => ['interview', 'offer', 'won'].includes(r.status)).length, pitched: pitches.sent, pitchReplies: pitches.replied, bestSource: bySource[0]?.key ?? null }
  }
  return digestText({
    appUrl,
    jobs: jobs.map((j) => ({ id: j.id, title: j.title, company: j.company, score: j.score, engagement: j.engagement, rate: money(j) })),
    followUps: due.jobs, pitchFollowUps: due.pitches,
    yesterday, goal: { applications: settings.routine.applicationsPerDay, pitches: settings.routine.pitchesPerDay }, weekly,
  })
}

export async function sendTelegram(fetcher: typeof fetch, token: string, chatId: string, text: string) {
  // Telegram caps a message at 4096 characters.
  const res = await fetcher(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4000), disable_web_page_preview: true }),
  })
  if (!res.ok) throw new Error(`Telegram said ${res.status}: ${(await res.text()).slice(0, 200)}`)
}

/** Returns what happened, for the log and for the "Send a test digest" button. */
/** The local hour (0 to 23) at `now` in a fixed UTC offset. */
export const localHour = (offsetHours: number, now = new Date()) => new Date(now.getTime() + offsetHours * 36e5).getUTCHours()

/**
 * The cron calls this every hour; it sends only in the hour set in Settings (digest.hour, in routine.utcOffset), so
 * anyone in any time zone gets it in their morning. `force` (the "Send a test digest" button) skips both checks.
 * `appUrl` is the fallback for links when the APP_URL variable is empty: the test button passes the page's origin.
 */
export async function runDigest(env: DigestEnv, fetcher: typeof fetch = fetch, opts: { force?: boolean; now?: Date; appUrl?: string } = {}): Promise<{ sent: boolean; reason?: string; text: string }> {
  const settings = await getSettings(env.DB)
  const now = opts.now ?? new Date()
  if (!opts.force && !settings.digest.enabled) return { sent: false, reason: 'The digest is off in Settings', text: '' }
  if (!opts.force && localHour(settings.routine.utcOffset, now) !== settings.digest.hour) return { sent: false, reason: 'Not the digest hour yet', text: '' }
  const text = await buildDigest(env.DB, (env.APP_URL || opts.appUrl || '').replace(/\/+$/, ''), now)
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return { sent: false, reason: 'Set the TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID secrets first', text }
  await sendTelegram(fetcher, env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID, text)
  return { sent: true, text }
}
