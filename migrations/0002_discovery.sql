-- Company discovery: where a company came from, its team size, and when its ATS was last looked for.
ALTER TABLE companies ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';  -- manual | job-link | yc
ALTER TABLE companies ADD COLUMN team_size INTEGER;
ALTER TABLE companies ADD COLUMN probed_at TEXT;                          -- last time we looked for its ATS board
CREATE INDEX companies_ats ON companies (ats, ats_token);
CREATE INDEX companies_probe ON companies (ats, probed_at);
CREATE INDEX companies_name ON companies (lower(name));
