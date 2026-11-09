# Configuration

JobPilot has three places for settings:

1. **Variables** in `wrangler.jsonc` (`vars`): non-secret values. Change, then `npm run deploy`.
2. **Secrets**, set with `npx wrangler secret put NAME`: keys and tokens. They never go in a file you commit and take
   effect without a deploy. For local runs, put them in `.dev.vars`.
3. **Settings** inside the app: everything about how jobs are found, scored and written. Stored in D1; editable any
   time on the Settings page.

Your profile (Profile page) is the fourth: every fact a resume can use.

## Variables (`wrangler.jsonc`)

| Name | Default | What it does |
| --- | --- | --- |
| `ACCESS_TEAM_DOMAIN` | empty | Your Zero Trust team domain, `yourteam.cloudflareaccess.com`. See [access.md](access.md). |
| `ACCESS_AUD` | empty | The AUD tag of the Access application in front of the Worker. Until both are set, every request is refused. |
| `ALLOW_NO_ACCESS` | `"false"` | `"true"` skips the Access check while `ACCESS_AUD` is empty. Only for local development (`.dev.vars`). |
| `CLAUDE_MODEL` | `claude-opus-5-5` | Default model when a Claude key is set. Settings, AI overrides it. |
| `INGEST_FETCH_BUDGET` | `"40"` | Outside requests one fetch run may make. 40 fits Workers Free (50 per run). On Workers Paid use 2000. |
| `APP_URL` | empty | Your app's address, for links in the Telegram digest. |

Other things in `wrangler.jsonc` you may change:

- `name`: the Worker's name, which is part of the `workers.dev` address.
- `triggers.crons`: `"15 */4 * * *"` fetches jobs every 4 hours (make it `"15 */2 * * *"` for every 2 hours);
  `"0 * * * *"` checks the digest hour. If you change the second one, change `DIGEST_CRON` in `src/worker.ts` to match.

## Secrets

| Name | Needed for | How to get it |
| --- | --- | --- |
| `EXTENSION_TOKEN` | The browser extension | `openssl rand -hex 32` (at least 24 characters) |
| `ANTHROPIC_API_KEY` | Optional: AI tailoring, reading pasted posts, AI pitches | https://platform.claude.com, API keys |
| `TELEGRAM_BOT_TOKEN` | Optional: the morning digest | @BotFather, see [telegram.md](telegram.md) |
| `TELEGRAM_CHAT_ID` | Optional: the morning digest | `getUpdates`, see [telegram.md](telegram.md) |

`npx wrangler secret list` shows which are set (never their values). Settings, Setup in the app shows the same.

## Settings in the app

| Section | What you set |
| --- | --- |
| Setup | Read-only: which variables and secrets are set, and whether the fetch budget fits the free plan. |
| Score weights | How much skills (35), work type (20), rate (20), location and hours (15) and company fit (10) count, the auto-skip score (25), and days before a follow-up reminder (6). |
| Job sources | The boards to read. Add search words for your field and country filters (Himalayas takes a country code such as `DE`; Jobicy a region such as `europe`, `apac` or `usa`). "Add recommended sources" restores the defaults. Companies on the Companies page with a Greenhouse, Lever, Ashby, Recruitee or Breezy link are read too. |
| Finding companies | Watch companies from job-post links, add Y Combinator startups and "Launch HN" startups in a team-size range, and how many startups are checked for a job board per run. |
| Daily routine | Applications and pitches per day, the apply queue's lowest score, pitch follow-up days, and **your time zone** (hours from UTC). |
| Morning digest | On or off, the hour to send, lowest score and number of jobs. |
| Writing rules | Phrases the writer must never use, on top of the built-in list. |
| AI | Model, effort and how many repair rounds Claude gets (only used with a key). |

Saving Settings scores every stored job again with the new weights and preferences.

## Your profile drives the score

The Preferences part of the Profile page matters as much as Settings:

- **Target roles, work types, rates and salary**: jobs below your minimum rate lose points; your target rate earns
  full marks.
- **Remote**: remote only, remote or hybrid, or any.
- **Work rights**: countries you can legally work from. A job limited to other countries is marked down.
- **Target countries / avoid countries**: a small bonus, or skip jobs limited to those countries.
- **Industries / avoid industries / exclude keywords**: words such as "unpaid" or "commission only" hide a job.

## Claude API (optional)

Without a key, everything works except three things, each with a free alternative:

| Needs a key | Free alternative |
| --- | --- |
| Tailor my resume for this job | **Draft from my profile (no AI)**: your own bullets, ordered by how well they match the job, skills the job asks for listed first. You trim and edit. |
| Reading a pasted post into fields | The post is stored as pasted (first line as the title) and scored from its text. Edit the fields by hand. |
| A pitch written by Claude | A saved pitch template with `{{company}}` and `{{first_name}}`. |

With a key:

- Settings, AI picks the model. `claude-opus-5-5` (the default) writes the best drafts. `claude-sonnet-5-5` costs
  about half as much and is a good choice if you tailor a lot. Effort `high` is the default; `medium` or `low` cost
  less.
- A tailored resume with a cover letter usually costs a few cents; reading a pasted post or writing a pitch, about a
  cent. The profile and job are cached between repair rounds, so fixes cost little.
- Set a monthly spend limit for your key in the Claude Console so a mistake can't run up a bill.
- Every Claude call is logged (`claude-usage` events with token counts) in the Worker's logs:
  `npx wrangler tail` or the Workers dashboard, Observability.

Whatever writes the draft, `checkResume` and the style rules run on it, and failed checks block approval.

## Free plan limits

Everything in JobPilot runs on free plans. The limits that matter:

| Limit (Workers Free) | Effect on JobPilot | If you hit it |
| --- | --- | --- |
| 100,000 requests a day | Far more than one person uses. | Nothing to do. |
| 50 outside requests per run | Each fetch run reads about 40 sources, then the next run carries on where it stopped. "Fetch new jobs now" keeps calling until it has read them all. | Fine as is; on Workers Paid set `INGEST_FETCH_BUDGET` to `2000` to read everything in one run. |
| 10 ms CPU per request | Most pages are well under it, and Cloudflare allows occasional bursts. The heaviest work is PDF downloads, saving Settings with many stored jobs (everything is scored again), and fetch runs over big boards. | If you see error 1102 or "Worker exceeded CPU time limit": print the resume page to PDF from your browser instead, lower `INGEST_FETCH_BUDGET` to 20, keep "Keep low scores" off, or move to Workers Paid ($5/month, 30 s CPU). |
| 5 cron triggers per account | JobPilot uses 2. | Remove a cron from another Worker, or merge them. |

D1's free tier (5 GB of storage and millions of row reads a day) is plenty for one person; with "Keep low scores"
off, jobs under the auto-skip score are never stored.

## Changing the code

- Resume look: `src/components/ResumeDocument.astro` (web) and `src/core/pdf.ts` (PDF).
- Scoring: `src/core/scoring.ts`.
- Writing rules: `src/core/style.ts`; the writer's instructions in `src/server/ai.ts`.
- A new job source: add a fetcher in `src/core/sources/` and a test in `tests/`.
- Database changes: add a new numbered file in `migrations/`, never edit an applied one.

Before pushing: `npm test`, `npm run typecheck` and `npm run build` (CI runs the same).
