# JobPilot

A private, self-hosted job search dashboard. It finds contract, freelance and full-time work from public job boards,
scores every job against your own profile, drafts a resume for each application that only uses facts you wrote,
tracks every application, and sends you a morning summary on Telegram. A Chrome extension saves jobs from any page
and fills application forms for you to check and submit.

It runs on your own Cloudflare account (Workers and D1), protected by Cloudflare Access, built with Astro and Vue.
Everything can run on free plans. The Claude API is optional: bring your own key if you want AI tailoring.

**Start here: [docs/setup.md](docs/setup.md)** (about 30 minutes, step by step).

## What it does

| Area | Page | How |
| --- | --- | --- |
| Master profile | Profile | Every job, bullet, skill and preference in one structured profile. Every save is a new version; any version can be restored. JSON import and export ([example](examples/profile.example.json)). |
| Finding work | Jobs, Settings | Reads Hacker News ("Seeking freelancer", "Who is hiring", YC job posts), Remotive, RemoteOK, Himalayas, Jobicy, Working Nomads, Arbeitnow, MyCareersFuture, We Work Remotely and any RSS feed, plus the Greenhouse, Lever, Ashby, Recruitee and Breezy boards of every company you watch. A cron runs every 4 hours. Paste any other post (email, Upwork, anywhere) to add it by hand. |
| Company discovery | Companies, Settings | Add companies by hand, or let it find them: a job post that links to a company's own job board adds that company, and Y Combinator startups in your team-size range are added once a day. Startups without a public board are listed as companies to pitch directly. |
| Scoring | Jobs | A 0 to 100 score from skills match, work type, rate, location and company fit, with red flags. Plain code, no AI call: free, and the same job always gets the same score. Weights are in Settings. Your own thumbs up or down sorts first. |
| Resume drafts | Job page | **Free:** "Draft from my profile" picks and orders your own bullets and skills for the job with plain code. **With a Claude key:** Claude picks and rewords bullets, writes a headline, summary and cover letter. Both go through the same checks (below) and you edit before approving. |
| Resume files | Job page | Download the approved resume and cover letter as PDF, or print the resume page. |
| Pipeline | Pipeline | Saved, Applied, Interview, Offer, Won, Lost. Applying sets a follow-up reminder. |
| Daily routine | Today, Dashboard | A queue of the day's best jobs with tailor, open and mark-applied buttons, and a counter against your daily goal. |
| Direct pitches | Outreach | Startups on your list with a website and no job board. Finds a contact address on their own site, drafts an email from a saved template (free) or with Claude, checks it, and opens it in your email app. Nothing is sent from JobPilot. |
| Saved letters | Outreach, Job page | Your own cover letters and pitches with `{{company}}`, `{{role}}`, `{{greeting}}` and `{{first_name}}`, checked like everything else. |
| Morning digest | Telegram | At the hour you pick: best new jobs, follow-ups due, yesterday against your goal, and on Mondays last week's reply numbers. No AI call. |
| Stats | Stats | Reply rate by source and by score band, plus pitch replies, over 7, 30 or 90 days. |
| Extension | `extension/` | Save this job; fill this application from your profile and approved resume. It never presses Submit. |

## How resumes stay honest

A resume draft is a selection from your profile, not free text. Company names, titles, dates, schools and contact
details are filled in from the profile by id, so nothing (and no AI) can change them. Every draft then goes through
`checkResume` in [src/core/resume.ts](src/core/resume.ts):

- every bullet must point to real profile bullets from the same job;
- any number (metric, percentage, count) not in those source bullets is an error;
- any skill or tool you haven't listed is an error, in bullets, summary, skills and cover letter;
- about 80 machine-sounding phrases ("spearheaded", "leveraged", "passionate about", ...), em and en dashes, smart
  quotes, emoji, exclamation marks and "not only ... but also" are errors ([src/core/style.ts](src/core/style.ts);
  add your own in Settings);
- three bullets opening with the same verb, long bullets, and leaving out a recent job are warnings.

With Claude, failed checks go back to the model to fix (up to 2 rounds). Whatever still fails is shown in red and
the Approve button stays off until you fix it. You see every change as a word diff against your own bullet.

## What it costs

| Part | Free option | When you'd pay |
| --- | --- | --- |
| Hosting | Cloudflare Workers Free: 100,000 requests a day, 2 of the 5 free cron triggers | Workers Paid ($5/month) if you hit the 10 ms CPU limit on heavy pages, or want one fetch run to read every source (see [costs and limits](docs/configuration.md#free-plan-limits)) |
| Database | Cloudflare D1 free tier (5 GB) | Not needed for one person |
| Address | `jobpilot.<you>.workers.dev` | A custom domain, if you want one |
| Login | Cloudflare Zero Trust Free (up to 50 users) | Never for one person |
| Telegram digest | Free | Never |
| AI tailoring | "Draft from my profile" and saved templates, no AI | Claude API, pay as you go, with your own key. A tailored resume is usually a few cents |

## Documentation

- [Setup guide](docs/setup.md): from clone to a working app, step by step.
- [Cloudflare Access](docs/access.md): the two ways to protect the app (free `workers.dev` or your own domain).
- [Telegram digest](docs/telegram.md): create the bot, find your chat id, pick the hour.
- [Browser extension](docs/extension.md): install, connect, and use it safely.
- [Configuration](docs/configuration.md): every variable, secret and setting, free plan limits, AI model and costs.
- [Troubleshooting](docs/troubleshooting.md): common errors and fixes.

## Platform rules

Fully automatic applying is left out on purpose. LinkedIn, Indeed and Upwork ban bots that submit applications and
suspend accounts for it. JobPilot finds, scores, drafts and fills; you review and click Submit. Job sources read
public APIs and feeds only; nothing logs in to a site as you. RemoteOK asks for a link back to each post, which every
job keeps. Use it for your own job search, and follow each job board's terms.

## Layout

```
src/core/       pure logic, tested: profile schema, job parsing, keywords, scoring, resume checks, style rules, sources
src/server/     D1 access, Claude calls, ingest, Telegram digest, Access verification
src/pages/      Astro pages and the JSON API (src/pages/api)
src/components/ Vue islands for the dashboard
extension/      Chrome extension (Manifest V3, no build step)
migrations/     D1 schema
examples/       an example profile to import
docs/           setup and reference guides
```

## Developing

```bash
npm install
cp .dev.vars.example .dev.vars   # local secrets; ALLOW_NO_ACCESS=true opens the app on your computer only
npm run db:migrate:local
npm run preview                  # builds, then serves on http://localhost:8787
npm test                         # core logic: scoring, sources, resume checks, style rules, digest
npm run typecheck
```

`src/core/` stays free of Cloudflare and network imports so it can be tested and reused. Pull requests are welcome;
CI runs `npm test`, `npm run typecheck` and `npm run build`.

## License

[MIT](LICENSE)
