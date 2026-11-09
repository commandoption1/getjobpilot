// All D1 access. Rows are mapped to the core types here and nowhere else.
import { dedupeKey, type Job, type JobInput, type PipelineStatus } from '../core/job'
import { emptyProfile, type Profile, profileSchema } from '../core/profile'
import { defaultWeights, scoreJob, type ScoreResult } from '../core/scoring'
import { defaultSettings, type Settings, settingsSchema } from '../core/settings'
import type { CheckIssue, TailoredResume } from '../core/resume'
import type { Coverage } from '../core/keywords'

export const newId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 16)
const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')

// ---------- profile ----------

export type ProfileVersion = { id: number; profile: Profile; note: string; createdAt: string }

export async function currentProfile(db: D1Database): Promise<ProfileVersion> {
  const row = await db.prepare('SELECT id, data, note, created_at FROM profile_versions ORDER BY id DESC LIMIT 1').first<{ id: number; data: string; note: string; created_at: string }>()
  if (!row) return { id: 0, profile: emptyProfile(), note: '', createdAt: '' }
  return { id: row.id, profile: profileSchema.parse(JSON.parse(row.data)), note: row.note, createdAt: row.created_at }
}

export async function profileVersion(db: D1Database, id: number): Promise<ProfileVersion | null> {
  const row = await db.prepare('SELECT id, data, note, created_at FROM profile_versions WHERE id = ?').bind(id).first<{ id: number; data: string; note: string; created_at: string }>()
  return row ? { id: row.id, profile: profileSchema.parse(JSON.parse(row.data)), note: row.note, createdAt: row.created_at } : null
}

export async function listProfileVersions(db: D1Database) {
  const { results } = await db.prepare('SELECT id, note, created_at FROM profile_versions ORDER BY id DESC LIMIT 100').all<{ id: number; note: string; created_at: string }>()
  return results.map((r) => ({ id: r.id, note: r.note, createdAt: r.created_at }))
}

/** Saves a new version only when something changed. Returns the version id that is now current. */
export async function saveProfile(db: D1Database, profile: Profile, note = ''): Promise<number> {
  const data = JSON.stringify(profileSchema.parse(profile))
  const last = await db.prepare('SELECT id, data FROM profile_versions ORDER BY id DESC LIMIT 1').first<{ id: number; data: string }>()
  if (last && last.data === data) return last.id
  const res = await db.prepare('INSERT INTO profile_versions (data, note) VALUES (?, ?) RETURNING id').bind(data, note.slice(0, 200)).first<{ id: number }>()
  return res!.id
}

// ---------- settings ----------

export async function getSettings(db: D1Database): Promise<Settings> {
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'app'").first<{ value: string }>()
  if (!row) return defaultSettings()
  const parsed = settingsSchema.safeParse(JSON.parse(row.value))
  return parsed.success ? parsed.data : defaultSettings()
}

export async function saveSettings(db: D1Database, settings: Settings) {
  const value = JSON.stringify(settingsSchema.parse(settings))
  await db.prepare("INSERT INTO settings (key, value) VALUES ('app', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = ?").bind(value, now()).run()
}

// ---------- jobs ----------

type JobRow = {
  id: string; source: string; external_id: string; url: string; apply_url: string; title: string; company: string; location: string
  remote: number | null; engagement: string; description: string; rate_min: number | null; rate_max: number | null; rate_unit: string | null
  currency: string | null; ats: string | null; posted_at: string | null; status: string; score: number | null; score_detail: string | null
  my_rating: number | null; my_note: string; applied_at: string | null; follow_up_at: string | null; created_at: string; updated_at: string
}

export type JobRecord = Job & { appliedAt: string | null; followUpAt: string | null; detail: ScoreResult | null }

const toJob = (r: JobRow): JobRecord => ({
  id: r.id, source: r.source, externalId: r.external_id, url: r.url, applyUrl: r.apply_url, title: r.title, company: r.company,
  location: r.location, remote: r.remote === null ? null : r.remote === 1, engagement: r.engagement as Job['engagement'],
  description: r.description, rateMin: r.rate_min, rateMax: r.rate_max, rateUnit: r.rate_unit as Job['rateUnit'], currency: r.currency,
  ats: r.ats as Job['ats'], postedAt: r.posted_at, status: r.status as PipelineStatus, score: r.score, scoreDetail: r.score_detail,
  detail: r.score_detail ? JSON.parse(r.score_detail) as ScoreResult : null,
  myRating: r.my_rating, myNote: r.my_note, appliedAt: r.applied_at, followUpAt: r.follow_up_at, createdAt: r.created_at, updatedAt: r.updated_at,
})

export async function getJob(db: D1Database, id: string): Promise<JobRecord | null> {
  const row = await db.prepare('SELECT * FROM jobs WHERE id = ?').bind(id).first<JobRow>()
  return row ? toJob(row) : null
}

export type JobFilter = { status?: PipelineStatus | 'active' | 'all'; minScore?: number; engagement?: string; q?: string; limit?: number }

export async function listJobs(db: D1Database, filter: JobFilter = {}): Promise<JobRecord[]> {
  const where: string[] = []
  const args: unknown[] = []
  const status = filter.status ?? 'new'
  if (status === 'active') where.push("status IN ('saved', 'applied', 'interview', 'offer')")
  else if (status !== 'all') { where.push('status = ?'); args.push(status) }
  if (filter.minScore) { where.push('score >= ?'); args.push(filter.minScore) }
  if (filter.engagement) { where.push('engagement = ?'); args.push(filter.engagement) }
  if (filter.q) { where.push('(title LIKE ? OR company LIKE ? OR description LIKE ?)'); const q = `%${filter.q.slice(0, 40).replace(/[%_]/g, '')}%`; args.push(q, q, q) }
  const sql = `SELECT * FROM jobs ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY COALESCE(my_rating, 0) DESC, score DESC, created_at DESC LIMIT ?`
  args.push(Math.min(filter.limit ?? 100, 500))
  const { results } = await db.prepare(sql).bind(...args).all<JobRow>()
  return results.map(toJob)
}

export async function countByStatus(db: D1Database): Promise<Record<string, number>> {
  const { results } = await db.prepare('SELECT status, COUNT(*) AS n FROM jobs GROUP BY status').all<{ status: string; n: number }>()
  return Object.fromEntries(results.map((r) => [r.status, r.n]))
}

/**
 * Inserts a job or refreshes the text of one already stored. A job already stored under another source with the same
 * company and title is skipped, so the same role from two boards shows once. Returns the id and whether it is new.
 */
export async function upsertJob(db: D1Database, input: JobInput, profile: Profile, settings: Settings): Promise<{ id: string; added: boolean }> {
  const existing = await db.prepare('SELECT id FROM jobs WHERE external_id = ?').bind(input.externalId).first<{ id: string }>()
  const result = scoreJob(input, profile, settings.weights ?? defaultWeights())
  if (existing) {
    await db.prepare(`UPDATE jobs SET title = ?, description = ?, location = ?, url = ?, apply_url = ?, score = ?, score_detail = ?, updated_at = ? WHERE id = ?`)
      .bind(input.title, input.description, input.location, input.url, input.applyUrl, result.score, JSON.stringify(result), now(), existing.id).run()
    return { id: existing.id, added: false }
  }
  const key = dedupeKey(input)
  if (input.company) {
    const twin = await db.prepare('SELECT id FROM jobs WHERE dedupe_key = ? LIMIT 1').bind(key).first<{ id: string }>()
    if (twin) return { id: twin.id, added: false }
  }
  const id = newId()
  const status = result.blocked || (settings.autoSkipBelow && result.score < settings.autoSkipBelow) ? 'skipped' : 'new'
  await db.prepare(`INSERT INTO jobs (id, source, external_id, dedupe_key, url, apply_url, title, company, location, remote, engagement, description,
      rate_min, rate_max, rate_unit, currency, ats, posted_at, status, score, score_detail)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, input.source, input.externalId, key, input.url, input.applyUrl, input.title, input.company, input.location,
      input.remote === null ? null : input.remote ? 1 : 0, input.engagement, input.description, input.rateMin, input.rateMax,
      input.rateUnit, input.currency, input.ats, input.postedAt, status, result.score, JSON.stringify(result)).run()
  return { id, added: true }
}

export async function updateJobStatus(db: D1Database, id: string, status: PipelineStatus, followUpDays: number) {
  const stamp = now()
  if (status === 'applied') {
    const follow = new Date(Date.now() + followUpDays * 864e5).toISOString().slice(0, 10)
    await db.prepare('UPDATE jobs SET status = ?, applied_at = COALESCE(applied_at, ?), follow_up_at = ?, updated_at = ? WHERE id = ?').bind(status, stamp, follow, stamp, id).run()
  } else {
    const clearFollow = ['won', 'lost', 'skipped', 'offer'].includes(status)
    await db.prepare(`UPDATE jobs SET status = ?, ${clearFollow ? 'follow_up_at = NULL,' : ''} updated_at = ? WHERE id = ?`).bind(status, stamp, id).run()
  }
  await addEvent(db, id, 'status', status)
}

export async function rateJob(db: D1Database, id: string, rating: number | null, note?: string) {
  await db.prepare('UPDATE jobs SET my_rating = ?, my_note = COALESCE(?, my_note), updated_at = ? WHERE id = ?').bind(rating, note ?? null, now(), id).run()
}

export async function setFollowUp(db: D1Database, id: string, date: string | null) {
  await db.prepare('UPDATE jobs SET follow_up_at = ?, updated_at = ? WHERE id = ?').bind(date, now(), id).run()
}

export async function rescoreAll(db: D1Database, profile: Profile, settings: Settings): Promise<number> {
  const { results } = await db.prepare("SELECT * FROM jobs WHERE status IN ('new', 'saved', 'skipped')").all<JobRow>()
  const statements = results.map((row) => {
    const result = scoreJob(toJob(row), profile, settings.weights)
    return db.prepare('UPDATE jobs SET score = ?, score_detail = ? WHERE id = ?').bind(result.score, JSON.stringify(result), row.id)
  })
  for (let i = 0; i < statements.length; i += 50) await db.batch(statements.slice(i, i + 50))
  return statements.length
}

export async function deleteJob(db: D1Database, id: string) {
  await db.prepare('DELETE FROM jobs WHERE id = ?').bind(id).run()
}

// ---------- events ----------

export async function addEvent(db: D1Database, jobId: string | null, kind: string, detail: string) {
  await db.prepare('INSERT INTO events (job_id, kind, detail) VALUES (?, ?, ?)').bind(jobId, kind, detail.slice(0, 2000)).run()
}

export async function jobEvents(db: D1Database, jobId: string) {
  const { results } = await db.prepare('SELECT kind, detail, created_at FROM events WHERE job_id = ? ORDER BY id DESC LIMIT 50').bind(jobId).all<{ kind: string; detail: string; created_at: string }>()
  return results
}

// ---------- tailored resumes ----------

export type TailoredRecord = {
  id: string; jobId: string; profileVersion: number; resume: TailoredResume; checks: CheckIssue[]; coverage: Coverage
  status: 'draft' | 'approved'; model: string; createdAt: string; updatedAt: string
}
type TailoredRow = { id: string; job_id: string; profile_version: number; data: string; checks: string; coverage: string; status: string; model: string; created_at: string; updated_at: string }
const toTailored = (r: TailoredRow): TailoredRecord => ({
  id: r.id, jobId: r.job_id, profileVersion: r.profile_version, resume: JSON.parse(r.data), checks: JSON.parse(r.checks), coverage: JSON.parse(r.coverage),
  status: r.status as TailoredRecord['status'], model: r.model, createdAt: r.created_at, updatedAt: r.updated_at,
})

export async function saveTailored(db: D1Database, t: Omit<TailoredRecord, 'createdAt' | 'updatedAt'>) {
  await db.prepare(`INSERT INTO tailored (id, job_id, profile_version, data, checks, coverage, status, model) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET data = excluded.data, checks = excluded.checks, coverage = excluded.coverage, status = excluded.status, updated_at = ?`)
    .bind(t.id, t.jobId, t.profileVersion, JSON.stringify(t.resume), JSON.stringify(t.checks), JSON.stringify(t.coverage), t.status, t.model, now()).run()
}

export async function getTailored(db: D1Database, id: string): Promise<TailoredRecord | null> {
  const row = await db.prepare('SELECT * FROM tailored WHERE id = ?').bind(id).first<TailoredRow>()
  return row ? toTailored(row) : null
}

export async function tailoredForJob(db: D1Database, jobId: string): Promise<TailoredRecord[]> {
  const { results } = await db.prepare('SELECT * FROM tailored WHERE job_id = ? ORDER BY created_at DESC').bind(jobId).all<TailoredRow>()
  return results.map(toTailored)
}

// ---------- companies ----------

export type Company = {
  id: string; name: string; website: string; careersUrl: string; ats: string | null; atsToken: string | null; industry: string; size: string
  stage: string; location: string; stack: string; notes: string; status: string; fit: number | null; watchJobs: boolean; openJobs?: number
  /** manual, job-link (found in a job post) or yc (Y Combinator directory). */
  source?: string; teamSize?: number | null; probedAt?: string | null
}
type CompanyRow = { id: string; name: string; website: string; careers_url: string; ats: string | null; ats_token: string | null; industry: string; size: string; stage: string; location: string; stack: string; notes: string; status: string; fit: number | null; watch_jobs: number; open_jobs?: number; source?: string; team_size?: number | null; probed_at?: string | null }
const toCompany = (r: CompanyRow): Company => ({
  id: r.id, name: r.name, website: r.website, careersUrl: r.careers_url, ats: r.ats, atsToken: r.ats_token, industry: r.industry, size: r.size,
  stage: r.stage, location: r.location, stack: r.stack, notes: r.notes, status: r.status, fit: r.fit, watchJobs: r.watch_jobs === 1, openJobs: r.open_jobs,
  source: r.source ?? 'manual', teamSize: r.team_size ?? null, probedAt: r.probed_at ?? null,
})

export async function listCompanies(db: D1Database): Promise<Company[]> {
  const { results } = await db.prepare(`SELECT c.*, (SELECT COUNT(*) FROM jobs j WHERE j.company_id = c.id AND j.status NOT IN ('skipped', 'lost')) AS open_jobs
    FROM companies c ORDER BY COALESCE(c.fit, 0) DESC, c.name`).all<CompanyRow>()
  return results.map(toCompany)
}

export async function saveCompany(db: D1Database, c: Omit<Company, 'openJobs'>) {
  await db.prepare(`INSERT INTO companies (id, name, website, careers_url, ats, ats_token, industry, size, stage, location, stack, notes, status, fit, watch_jobs)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, website = excluded.website, careers_url = excluded.careers_url, ats = excluded.ats,
        ats_token = excluded.ats_token, industry = excluded.industry, size = excluded.size, stage = excluded.stage, location = excluded.location,
        stack = excluded.stack, notes = excluded.notes, status = excluded.status, fit = excluded.fit, watch_jobs = excluded.watch_jobs, updated_at = ?`)
    .bind(c.id, c.name, c.website, c.careersUrl, c.ats, c.atsToken, c.industry, c.size, c.stage, c.location, c.stack, c.notes, c.status, c.fit, c.watchJobs ? 1 : 0, now()).run()
}

export async function deleteCompany(db: D1Database, id: string) {
  await db.prepare('DELETE FROM companies WHERE id = ?').bind(id).run()
}

export async function linkJobsToCompany(db: D1Database, companyId: string, name: string) {
  await db.prepare('UPDATE jobs SET company_id = ? WHERE company_id IS NULL AND lower(company) = lower(?)').bind(companyId, name).run()
}

// ---------- ingest log ----------

export async function logIngest(db: D1Database, source: string, found: number, added: number, error: string | null) {
  await db.prepare('INSERT INTO ingest_runs (source, found, added, error) VALUES (?, ?, ?, ?)').bind(source, found, added, error).run()
}

export async function lastIngestRuns(db: D1Database) {
  const { results } = await db.prepare(`SELECT source, found, added, error, created_at FROM ingest_runs
    WHERE id IN (SELECT MAX(id) FROM ingest_runs GROUP BY source) ORDER BY source`).all<{ source: string; found: number; added: number; error: string | null; created_at: string }>()
  return results
}

// ---------- batched ingest helpers ----------
// A Worker may only make a limited number of D1 calls per run, and one db.batch() counts as one, so ingest reads and
// writes through these.

/** Splits a list of values into IN (...) lookups of at most 90, run as one batch. Returns the values that exist. */
async function existing(db: D1Database, sql: (marks: string) => string, values: string[]): Promise<Set<string>> {
  const unique = [...new Set(values)].filter(Boolean)
  if (!unique.length) return new Set()
  const statements: D1PreparedStatement[] = []
  for (let i = 0; i < unique.length; i += 90) {
    const chunk = unique.slice(i, i + 90)
    statements.push(db.prepare(sql(chunk.map(() => '?').join(','))).bind(...chunk))
  }
  const results = await db.batch<{ v: string }>(statements)
  return new Set(results.flatMap((r) => r.results.map((row) => row.v)))
}

export const existingExternalIds = (db: D1Database, ids: string[]) =>
  existing(db, (m) => `SELECT external_id AS v FROM jobs WHERE external_id IN (${m})`, ids)
export const existingDedupeKeys = (db: D1Database, keys: string[]) =>
  existing(db, (m) => `SELECT dedupe_key AS v FROM jobs WHERE dedupe_key IN (${m})`, keys)

export type NewJob = { input: JobInput; score: ScoreResult; status: PipelineStatus }

export function insertJobStatement(db: D1Database, { input, score, status }: NewJob): D1PreparedStatement {
  return db.prepare(`INSERT OR IGNORE INTO jobs (id, source, external_id, dedupe_key, url, apply_url, title, company, location, remote, engagement, description,
      rate_min, rate_max, rate_unit, currency, ats, posted_at, status, score, score_detail)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(newId(), input.source, input.externalId, dedupeKey(input), input.url, input.applyUrl, input.title, input.company, input.location,
      input.remote === null ? null : input.remote ? 1 : 0, input.engagement, input.description, input.rateMin, input.rateMax,
      input.rateUnit, input.currency, input.ats, input.postedAt, status, score.score, JSON.stringify(score))
}

export function insertCompanyStatement(db: D1Database, c: {
  name: string; website?: string; careersUrl?: string; ats?: string | null; atsToken?: string | null; industry?: string; size?: string; stage?: string
  location?: string; notes?: string; source: string; teamSize?: number | null; fit?: number | null
}): D1PreparedStatement {
  return db.prepare(`INSERT INTO companies (id, name, website, careers_url, ats, ats_token, industry, size, stage, location, notes, source, team_size, fit)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(newId(), c.name, c.website ?? '', c.careersUrl ?? '', c.ats ?? null, c.atsToken ?? null, c.industry ?? '', c.size ?? '', c.stage ?? '',
      c.location ?? '', c.notes ?? '', c.source, c.teamSize ?? null, c.fit ?? null)
}

/** Startups from the directory whose job board hasn't been looked for yet, oldest first. */
export async function companiesToProbe(db: D1Database, limit: number): Promise<Company[]> {
  if (limit <= 0) return []
  const { results } = await db.prepare(`SELECT * FROM companies WHERE ats IS NULL AND probed_at IS NULL AND source = 'yc' AND status != 'not-a-fit'
    ORDER BY created_at LIMIT ?`).bind(limit).all<CompanyRow>()
  return results.map(toCompany)
}

export function probedStatement(db: D1Database, id: string, found: { kind: string; token: string; careersUrl: string } | null): D1PreparedStatement {
  return found
    ? db.prepare('UPDATE companies SET ats = ?, ats_token = ?, careers_url = CASE WHEN careers_url = \'\' THEN ? ELSE careers_url END, probed_at = ?, updated_at = ? WHERE id = ?')
      .bind(found.kind, found.token, found.careersUrl, now(), now(), id)
    : db.prepare('UPDATE companies SET probed_at = ?, updated_at = ? WHERE id = ?').bind(now(), now(), id)
}

/** Small values kept between runs (the source rotation cursor, when the startup list was last read). */
export async function getMeta(db: D1Database, key: string): Promise<string | null> {
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(`meta:${key}`).first<{ value: string }>()
  return row?.value ?? null
}
export function setMetaStatement(db: D1Database, key: string, value: string): D1PreparedStatement {
  return db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
    .bind(`meta:${key}`, value)
}
export function logIngestStatement(db: D1Database, source: string, found: number, added: number, error: string | null): D1PreparedStatement {
  return db.prepare('INSERT INTO ingest_runs (source, found, added, error) VALUES (?, ?, ?, ?)').bind(source, found, added, error)
}
/** Links every unlinked job to the company with the same name, in one statement. */
export function linkAllJobsStatement(db: D1Database): D1PreparedStatement {
  return db.prepare(`UPDATE jobs SET company_id = (SELECT c.id FROM companies c WHERE lower(c.name) = lower(jobs.company) LIMIT 1)
    WHERE company_id IS NULL AND company != '' AND EXISTS (SELECT 1 FROM companies c WHERE lower(c.name) = lower(jobs.company))`)
}

// ---------- templates ----------

export type Template = { id: string; name: string; kind: 'letter' | 'pitch'; subject: string; body: string; updatedAt: string }
type TemplateRow = { id: string; name: string; kind: string; subject: string; body: string; updated_at: string }
const toTemplate = (r: TemplateRow): Template => ({ id: r.id, name: r.name, kind: r.kind as Template['kind'], subject: r.subject, body: r.body, updatedAt: r.updated_at })

export async function listTemplates(db: D1Database, kind?: Template['kind']): Promise<Template[]> {
  const { results } = await (kind
    ? db.prepare('SELECT * FROM templates WHERE kind = ? ORDER BY name').bind(kind)
    : db.prepare('SELECT * FROM templates ORDER BY kind, name')).all<TemplateRow>()
  return results.map(toTemplate)
}

export async function getTemplate(db: D1Database, id: string): Promise<Template | null> {
  const row = await db.prepare('SELECT * FROM templates WHERE id = ?').bind(id).first<TemplateRow>()
  return row ? toTemplate(row) : null
}

export async function saveTemplate(db: D1Database, t: Omit<Template, 'updatedAt'>) {
  await db.prepare(`INSERT INTO templates (id, name, kind, subject, body) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, kind = excluded.kind, subject = excluded.subject, body = excluded.body, updated_at = ?`)
    .bind(t.id, t.name, t.kind, t.subject, t.body, now()).run()
}

export async function deleteTemplate(db: D1Database, id: string) {
  await db.prepare('DELETE FROM templates WHERE id = ?').bind(id).run()
}

// ---------- pitches ----------

export type Pitch = {
  id: string; companyId: string; company: string; website: string; toEmail: string; subject: string; body: string; checks: CheckIssue[]
  status: 'draft' | 'sent' | 'replied' | 'no-reply'; writtenBy: string; sentAt: string | null; followUpAt: string | null; createdAt: string
}
type PitchRow = {
  id: string; company_id: string; company: string; website: string; to_email: string; subject: string; body: string; checks: string; status: string
  written_by: string; sent_at: string | null; follow_up_at: string | null; created_at: string
}
const toPitch = (r: PitchRow): Pitch => ({
  id: r.id, companyId: r.company_id, company: r.company, website: r.website, toEmail: r.to_email, subject: r.subject, body: r.body, checks: JSON.parse(r.checks),
  status: r.status as Pitch['status'], writtenBy: r.written_by, sentAt: r.sent_at, followUpAt: r.follow_up_at, createdAt: r.created_at,
})
const PITCH_SELECT = 'SELECT p.*, c.name AS company, c.website AS website FROM pitches p JOIN companies c ON c.id = p.company_id'

export async function listPitches(db: D1Database): Promise<Pitch[]> {
  const { results } = await db.prepare(`${PITCH_SELECT} ORDER BY CASE p.status WHEN 'draft' THEN 0 WHEN 'sent' THEN 1 ELSE 2 END, p.updated_at DESC LIMIT 300`).all<PitchRow>()
  return results.map(toPitch)
}

export async function getPitch(db: D1Database, id: string): Promise<Pitch | null> {
  const row = await db.prepare(`${PITCH_SELECT} WHERE p.id = ?`).bind(id).first<PitchRow>()
  return row ? toPitch(row) : null
}

export async function savePitch(db: D1Database, p: { id: string; companyId: string; toEmail: string; subject: string; body: string; checks: CheckIssue[]; writtenBy: string }) {
  await db.prepare(`INSERT INTO pitches (id, company_id, to_email, subject, body, checks, written_by) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET to_email = excluded.to_email, subject = excluded.subject, body = excluded.body, checks = excluded.checks, updated_at = ?`)
    .bind(p.id, p.companyId, p.toEmail, p.subject, p.body, JSON.stringify(p.checks), p.writtenBy, now()).run()
}

/** Moves a pitch along, and the company with it: sent makes it "pitched", a reply makes it "talking". */
export async function setPitchStatus(db: D1Database, id: string, status: Pitch['status'], followUpDays: number) {
  const pitch = await getPitch(db, id)
  if (!pitch) return
  const stamp = now()
  const follow = status === 'sent' ? new Date(Date.now() + followUpDays * 864e5).toISOString().slice(0, 10) : null
  const companyStatus = status === 'sent' ? 'pitched' : status === 'replied' ? 'talking' : null
  await db.batch([
    db.prepare('UPDATE pitches SET status = ?, sent_at = CASE WHEN ? = \'sent\' THEN COALESCE(sent_at, ?) ELSE sent_at END, follow_up_at = ?, updated_at = ? WHERE id = ?')
      .bind(status, status, stamp, follow, stamp, id),
    ...(companyStatus ? [db.prepare("UPDATE companies SET status = ?, updated_at = ? WHERE id = ? AND status NOT IN ('client')").bind(companyStatus, stamp, pitch.companyId)] : []),
  ])
}

export async function setPitchFollowUp(db: D1Database, id: string, date: string | null) {
  await db.prepare('UPDATE pitches SET follow_up_at = ?, updated_at = ? WHERE id = ?').bind(date, now(), id).run()
}

export async function deletePitch(db: D1Database, id: string) {
  await db.prepare('DELETE FROM pitches WHERE id = ?').bind(id).run()
}

/** Companies worth a direct pitch: no job board found, not ruled out, not pitched yet. Best fit first. */
export async function pitchTargets(db: D1Database, limit: number): Promise<Company[]> {
  const { results } = await db.prepare(`SELECT c.* FROM companies c
    WHERE c.status = 'watching' AND c.website != '' AND NOT EXISTS (SELECT 1 FROM pitches p WHERE p.company_id = c.id)
      AND (c.ats IS NULL OR c.ats NOT IN ('greenhouse', 'lever', 'ashby', 'recruitee', 'breezy'))
    ORDER BY (c.contact_email != '') DESC, COALESCE(c.fit, 0) DESC, COALESCE(c.team_size, 99), c.created_at DESC LIMIT ?`).bind(limit).all<CompanyRow & { contact_email: string }>()
  return results.map((r) => ({ ...toCompany(r), contactEmail: r.contact_email }))
}

export async function getCompany(db: D1Database, id: string): Promise<(Company & { contactEmail: string }) | null> {
  const row = await db.prepare('SELECT * FROM companies WHERE id = ?').bind(id).first<CompanyRow & { contact_email: string }>()
  return row ? { ...toCompany(row), contactEmail: row.contact_email } : null
}

export async function setCompanyContact(db: D1Database, id: string, email: string) {
  await db.prepare('UPDATE companies SET contact_email = ?, contact_checked_at = ?, updated_at = ? WHERE id = ?').bind(email, now(), now(), id).run()
}

// ---------- the daily routine ----------

/** How many applications and pitches went out since `since` (an ISO time). */
export async function doneSince(db: D1Database, since: string, until?: string): Promise<{ applied: number; pitched: number }> {
  const end = until ?? '9999'
  const [a, p] = await db.batch<{ n: number }>([
    db.prepare('SELECT COUNT(*) AS n FROM jobs WHERE applied_at >= ? AND applied_at < ?').bind(since, end),
    db.prepare('SELECT COUNT(*) AS n FROM pitches WHERE sent_at >= ? AND sent_at < ?').bind(since, end),
  ])
  return { applied: a!.results[0]?.n ?? 0, pitched: p!.results[0]?.n ?? 0 }
}

/** Candidates for the apply queue, with whether each already has an approved resume. */
export async function queueCandidates(db: D1Database): Promise<(JobRecord & { hasApproved: boolean })[]> {
  const { results } = await db.prepare(`SELECT j.*, EXISTS (SELECT 1 FROM tailored t WHERE t.job_id = j.id AND t.status = 'approved') AS has_approved
    FROM jobs j WHERE j.status IN ('new', 'saved') AND COALESCE(j.my_rating, 0) >= 0 ORDER BY COALESCE(j.my_rating, 0) DESC, j.score DESC LIMIT 300`).all<JobRow & { has_approved: number }>()
  return results.map((r) => ({ ...toJob(r), hasApproved: r.has_approved === 1 }))
}

export async function newJobsSince(db: D1Database, since: string, minScore: number, limit: number): Promise<JobRecord[]> {
  const { results } = await db.prepare("SELECT * FROM jobs WHERE status = 'new' AND created_at >= ? AND score >= ? ORDER BY score DESC LIMIT ?").bind(since, minScore, limit).all<JobRow>()
  return results.map(toJob)
}

export async function followUpsDue(db: D1Database, date: string) {
  const [jobs, pitches] = await db.batch<{ id: string; title?: string; company: string }>([
    db.prepare("SELECT id, title, company FROM jobs WHERE follow_up_at <= ? AND status IN ('applied', 'interview') ORDER BY follow_up_at").bind(date),
    db.prepare("SELECT p.id, c.name AS company FROM pitches p JOIN companies c ON c.id = p.company_id WHERE p.follow_up_at <= ? AND p.status = 'sent' ORDER BY p.follow_up_at").bind(date),
  ])
  return { jobs: jobs!.results as { id: string; title: string; company: string }[], pitches: pitches!.results }
}

/** Every job applied to since `since`, for reply stats. */
export async function appliedRows(db: D1Database, since: string) {
  const { results } = await db.prepare('SELECT source, score, status FROM jobs WHERE applied_at >= ?').bind(since).all<{ source: string; score: number | null; status: string }>()
  return results
}

export async function pitchCounts(db: D1Database, since: string) {
  const { results } = await db.prepare("SELECT status, COUNT(*) AS n FROM pitches WHERE sent_at >= ? GROUP BY status").bind(since).all<{ status: string; n: number }>()
  const by = Object.fromEntries(results.map((r) => [r.status, r.n]))
  const sent = results.reduce((n, r) => n + r.n, 0)
  return { sent, replied: by.replied ?? 0 }
}
