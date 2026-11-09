-- Single-user database. Every editable thing keeps its history so a change can be undone.

-- The master profile. Each save adds a version; the newest one is current.
CREATE TABLE profile_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  data TEXT NOT NULL,             -- profile JSON (src/core/profile.ts)
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- Settings: score weights, sources, extra banned phrases, AI options. One JSON row per key.
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE companies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  website TEXT NOT NULL DEFAULT '',
  careers_url TEXT NOT NULL DEFAULT '',
  ats TEXT,                       -- greenhouse | lever | ashby, when detected
  ats_token TEXT,
  industry TEXT NOT NULL DEFAULT '',
  size TEXT NOT NULL DEFAULT '',  -- solo | startup | scaleup | midsize | enterprise
  stage TEXT NOT NULL DEFAULT '', -- e.g. seed, series A
  location TEXT NOT NULL DEFAULT '',
  stack TEXT NOT NULL DEFAULT '', -- comma-separated
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'watching', -- watching | pitched | talking | client | not-a-fit
  fit INTEGER,                    -- 0-100 from preferences
  watch_jobs INTEGER NOT NULL DEFAULT 1,   -- pull its ATS board on every run
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  external_id TEXT NOT NULL UNIQUE,
  dedupe_key TEXT NOT NULL,
  url TEXT NOT NULL DEFAULT '',
  apply_url TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  company TEXT NOT NULL DEFAULT '',
  company_id TEXT REFERENCES companies(id) ON DELETE SET NULL,
  location TEXT NOT NULL DEFAULT '',
  remote INTEGER,                 -- 1, 0 or NULL when unknown
  engagement TEXT NOT NULL DEFAULT 'unknown',
  description TEXT NOT NULL DEFAULT '',
  rate_min REAL,
  rate_max REAL,
  rate_unit TEXT,
  currency TEXT,
  ats TEXT,
  posted_at TEXT,
  status TEXT NOT NULL DEFAULT 'new',   -- new | saved | skipped | applied | interview | offer | won | lost
  score INTEGER,
  score_detail TEXT,              -- JSON ScoreResult
  my_rating INTEGER,              -- -1, 0, 1
  my_note TEXT NOT NULL DEFAULT '',
  applied_at TEXT,
  follow_up_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX jobs_status_score ON jobs (status, score DESC);
CREATE INDEX jobs_dedupe ON jobs (dedupe_key);
CREATE INDEX jobs_follow_up ON jobs (follow_up_at);

-- Every tailored resume for a job. Approved ones are what was sent; drafts can be regenerated or edited.
CREATE TABLE tailored (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  profile_version INTEGER NOT NULL REFERENCES profile_versions(id),
  data TEXT NOT NULL,             -- TailoredResume JSON (src/core/resume.ts)
  checks TEXT NOT NULL,           -- JSON CheckIssue[] from the last check
  coverage TEXT NOT NULL,         -- JSON keyword coverage
  status TEXT NOT NULL DEFAULT 'draft', -- draft | approved
  model TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX tailored_job ON tailored (job_id, created_at DESC);

-- What happened to each application, newest first on the job page.
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT REFERENCES jobs(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,             -- status | note | ingest | error
  detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX events_job ON events (job_id, id DESC);

-- One row per source per run, so Settings can show what each source last returned.
CREATE TABLE ingest_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  found INTEGER NOT NULL DEFAULT 0,
  added INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
