-- The daily routine: saved letter templates, direct pitches to companies, and a contact address per company.

CREATE TABLE templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'letter',   -- letter (cover letter or proposal) | pitch (cold email to a company)
  subject TEXT NOT NULL DEFAULT '',      -- pitch templates only
  body TEXT NOT NULL,                    -- the user's own text with {{company}}, {{role}}, {{greeting}} placeholders
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE pitches (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  to_email TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  checks TEXT NOT NULL DEFAULT '[]',     -- JSON CheckIssue[] from the last check
  status TEXT NOT NULL DEFAULT 'draft',  -- draft | sent | replied | no-reply
  written_by TEXT NOT NULL DEFAULT '',   -- template name, or the model when Claude wrote it
  sent_at TEXT,
  follow_up_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX pitches_company ON pitches (company_id);
CREATE INDEX pitches_status ON pitches (status, sent_at);

ALTER TABLE companies ADD COLUMN contact_email TEXT NOT NULL DEFAULT '';
ALTER TABLE companies ADD COLUMN contact_checked_at TEXT;
CREATE INDEX jobs_applied ON jobs (applied_at);
