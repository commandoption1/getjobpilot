# Troubleshooting

To see what the Worker is doing, run `npx wrangler tail` in the project folder and use the app in another window, or
open the Worker in the Cloudflare dashboard, **Observability**. Every error is logged as an `api-error`,
`ingest-error` or `digest-error` event with its message.

## Deploying

**`database_id` error, or "Couldn't find a D1 DB with the name or binding 'DB'"**
You haven't replaced `REPLACE_WITH_YOUR_DATABASE_ID` in `wrangler.jsonc`. Run `npx wrangler d1 list` to see your
database's id and paste it in. Keep `"binding": "DB"`.

**"no such table: jobs" (or any other table)**
The migrations haven't been applied to the remote database: `npm run db:migrate:remote`. For local runs:
`npm run db:migrate:local`.

**`wrangler` says you're not logged in, or uses the wrong account**
`npx wrangler logout`, then `npx wrangler login`. With several accounts, set `account_id` in `wrangler.jsonc`.

**Build fails on Node**
Use Node 22 or newer (`node -v`; the version is in `.nvmrc`). Delete `node_modules` and run `npm install` again.

## Signing in

**"Sign in through Cloudflare Access to use this app." after you signed in**
The Worker got a request without a valid Access token. Check:

- `ACCESS_AUD` is the AUD tag of the application that covers this exact address (a `workers.dev` app and a custom
  domain app have different tags);
- `ACCESS_TEAM_DOMAIN` is `yourteam.cloudflareaccess.com`, without `https://` or a slash;
- you ran `npm run deploy` after changing them.

**You see JobPilot without being asked to sign in**
Access isn't in front of that address. Enable it (see [access.md](access.md)). If you also see data, check that
`ALLOW_NO_ACCESS` is `"false"` in `wrangler.jsonc`.

**"Cross-origin request refused"**
A write came from another site. Open the app from its own address, not through another page or a proxy.

## Finding jobs

**"Fetch new jobs now" finds nothing**
Look at Settings, Job sources, Last run: each source shows how many jobs it found and any error. Some boards
are empty for some search words; remove the word to read everything. Jobs scoring under the auto-skip score are
dropped unless "Keep low scores" is on, so a new profile with few skills may drop most jobs. Fill in your skills,
or lower the auto-skip score.

**Every job scores low**
Your profile has few skills, or the preferences rule things out: a minimum rate above what posts offer, remote
only, or work rights that don't match where jobs are open. Saving the profile or Settings scores every job again.

**"Too many subrequests"**
`INGEST_FETCH_BUDGET` is above what your plan allows. Use `40` on Workers Free.

## Resumes

**"Fill in your profile first" or "Fix your profile first"**
Drafting needs at least one job with bullets, unique ids, and dates in `YYYY-MM` form that don't end before they
start.

**A check keeps failing**
The message says exactly what's wrong: a number not in your bullets, a skill you haven't listed, a banned phrase.
Fix the text in the editor, or add the real fact or skill to your profile first. The checks are there so nothing
invented reaches a resume; they can't be turned off.

**"This needs a Claude API key"**
You used an AI feature without `ANTHROPIC_API_KEY`. Add one (`npx wrangler secret put ANTHROPIC_API_KEY`), or use
"Draft from my profile (no AI)" and saved templates.

**Claude errors (401, 429, "credit balance too low")**
401: the key is wrong or revoked. 429: rate limit; wait a minute. Credit balance: add credit in the Claude Console.

**PDF download fails with error 1102 or "exceeded CPU time limit"**
On Workers Free, a long resume can go over 10 ms of CPU. Open the resume page and use your browser's Print, Save as
PDF, or move to Workers Paid. See [free plan limits](configuration.md#free-plan-limits).

## Telegram digest

**"Not sent: Set the TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID secrets first"**
One or both secrets are missing: `npx wrangler secret list`.

**"Telegram said 400: chat not found"**
The chat id is wrong, or you never sent the bot a message. Send it a message and look at `getUpdates` again.

**"Telegram said 401: Unauthorized"**
The bot token is wrong. Get it again from @BotFather (`/mybots`, your bot, API Token).

**The test works but no daily message arrives**
Check that "Send the digest" is on, the hour and time zone are what you expect, and that the Worker's crons are
listed in the dashboard (Worker, Settings, Trigger events). A digest with no new jobs is still sent, so silence
means the cron didn't run or failed: look for `digest-error` in the logs.

**Links in the digest don't open the app**
Set `APP_URL` in `wrangler.jsonc` and deploy.

## Extension

**"Bad or missing extension token"**
The token in the extension options doesn't match the `EXTENSION_TOKEN` secret, or the secret is shorter than 24
characters. Set it again on both sides.

**"Cloudflare Access blocked the request"**
Access is answering the extension's request with its login page. Add a Bypass application for `/api/ext/`, or a
service token with a Service Auth policy, and paste the service token into the options. See
[extension.md](extension.md#connect-it-to-your-jobpilot).

**"Fill this application" fills nothing**
Some forms load inside a frame from another site, or use custom widgets; fill those by hand. Fields that already
have text are left alone on purpose.

## Starting over

To wipe your data and start fresh, delete and recreate the database:

```bash
npx wrangler d1 delete jobpilot
npx wrangler d1 create jobpilot     # paste the new database_id into wrangler.jsonc
npm run db:migrate:remote
npm run deploy
```

This deletes your profile, jobs and history for good. Export your profile as JSON first (Profile, Import / export
JSON).
