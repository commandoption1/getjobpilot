import { z } from 'zod'

import { weightsSchema } from './scoring'
import { ATS_KINDS, BOARD_KINDS } from './sources/types'

const sourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.enum(ATS_KINDS), token: z.string().min(1), company: z.string().optional() }),
  z.object({ kind: z.literal('remoteok'), tags: z.array(z.string()).optional() }),
  z.object({ kind: z.literal('remotive'), search: z.string().optional() }),
  z.object({ kind: z.enum(BOARD_KINDS), search: z.string().optional(), country: z.string().optional() }),
  z.object({ kind: z.literal('hn'), thread: z.enum(['hiring', 'freelancer', 'jobs']) }),
  z.object({ kind: z.literal('rss'), url: z.url(), label: z.string().optional() }),
])

export const settingsSchema = z.object({
  weights: weightsSchema.default(weightsSchema.parse({})),
  /** Board sources. Companies with a detected ATS are added on top of these on every run. */
  sources: z.array(sourceSchema).default([
    { kind: 'hn', thread: 'freelancer' },
    { kind: 'hn', thread: 'hiring' },
    { kind: 'hn', thread: 'jobs' },
    { kind: 'remotive', search: '' },
    { kind: 'remoteok', tags: [] },
    { kind: 'himalayas', search: '' },
    { kind: 'jobicy', search: '' },
    { kind: 'workingnomads', search: 'development' },
    { kind: 'arbeitnow', search: '' },
    { kind: 'rss', url: 'https://weworkremotely.com/categories/remote-full-stack-programming-jobs.rss', label: 'wwr' },
    { kind: 'rss', url: 'https://weworkremotely.com/categories/remote-front-end-programming-jobs.rss', label: 'wwr-frontend' },
    { kind: 'rss', url: 'https://weworkremotely.com/categories/remote-back-end-programming-jobs.rss', label: 'wwr-backend' },
  ]),
  /** Jobs scoring under autoSkipBelow are dropped instead of stored as skipped, so big boards don't fill the database. */
  keepLowScores: z.boolean().default(false),
  /** Finding companies to watch, on top of the ones added by hand on the Companies page. */
  discovery: z.object({
    /** Add the company behind any Greenhouse, Lever, Ashby, Recruitee or Breezy link seen in a job post. */
    fromJobLinks: z.boolean().default(true),
    /** Add Y Combinator startups of this team size (all from the last two years, older ones only when hiring), then look for their job board. */
    ycStartups: z.boolean().default(true),
    /** Add startups from "Launch HN" posts, the newest YC companies. */
    launchHn: z.boolean().default(true),
    minTeam: z.number().int().min(1).max(10000).default(2),
    maxTeam: z.number().int().min(1).max(10000).default(15),
    /** Startups whose job board is looked for on each run. Each look costs up to 6 requests. */
    probesPerRun: z.number().int().min(0).max(200).default(60),
  }).default({ fromJobLinks: true, ycStartups: true, launchHn: true, minTeam: 2, maxTeam: 15, probesPerRun: 60 }),
  /** Jobs scoring under this are filed as skipped automatically. 0 keeps everything. */
  autoSkipBelow: z.number().min(0).max(100).default(25),
  /** Phrases to ban on top of the defaults in src/core/style.ts. */
  bannedPhrases: z.array(z.string()).default([]),
  /** Days after applying before a follow-up reminder shows. */
  followUpDays: z.number().min(1).max(60).default(6),
  /** The daily routine: how many applications and direct pitches to aim for, and the day's start in the user's time zone. */
  routine: z.object({
    applicationsPerDay: z.number().int().min(0).max(100).default(5),
    pitchesPerDay: z.number().int().min(0).max(100).default(3),
    /** Hours ahead of UTC. For example 7 for UTC+7, -5 for New York in winter. */
    utcOffset: z.number().min(-12).max(14).default(0),
    /** Jobs under this score stay out of the apply queue unless rated thumbs up or saved. */
    queueMinScore: z.number().min(0).max(100).default(55),
    /** Days after a pitch is sent before it shows as a follow-up. */
    pitchFollowUpDays: z.number().int().min(1).max(60).default(5),
  }).default({ applicationsPerDay: 5, pitchesPerDay: 3, utcOffset: 0, queueMinScore: 55, pitchFollowUpDays: 5 }),
  /** Morning message on Telegram (needs the TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID secrets). */
  digest: z.object({
    enabled: z.boolean().default(true),
    /** Local hour (0 to 23, in routine.utcOffset) the digest is sent. The cron checks once an hour. */
    hour: z.number().int().min(0).max(23).default(8),
    minScore: z.number().min(0).max(100).default(60),
    maxJobs: z.number().int().min(1).max(30).default(10),
  }).default({ enabled: true, hour: 8, minScore: 60, maxJobs: 10 }),
  ai: z.object({
    model: z.string().default(''),
    effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).default('high'),
    /** How many times the writer may fix its own draft after the checks fail. */
    repairRounds: z.number().min(0).max(3).default(2),
  }).default({ model: '', effort: 'high', repairRounds: 2 }),
})

export type Settings = z.infer<typeof settingsSchema>
export const defaultSettings = (): Settings => settingsSchema.parse({})
