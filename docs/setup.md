# Setup guide

From a fresh clone to a working JobPilot on your own Cloudflare account. Every step uses free plans. Plan for about
30 minutes; the Telegram digest and the extension are optional and have their own short guides.

What you need:

- A Cloudflare account (free): https://dash.cloudflare.com/sign-up
- Node.js 22 or newer (`node -v`) and git
- Optional: a Claude API key from https://platform.claude.com, if you want AI tailoring
- Optional: Telegram, for the morning digest

All commands run in the project folder.

## 1. Get the code

Click **Use this template** on GitHub (or fork it), then clone your copy:

```bash
git clone https://github.com/<you>/<your-repo>.git jobpilot
cd jobpilot
npm install
```

Keep your copy **private** if you plan to commit anything personal. Your profile and jobs live in your D1 database,
not in the repository, so a public copy is fine as long as you only change code and `wrangler.jsonc`.

## 2. Sign in to Cloudflare from the terminal

```bash
npx wrangler login
```

A browser window opens; allow access. `npx wrangler whoami` shows the account you are signed in to.

## 3. Create the database

```bash
npx wrangler d1 create jobpilot
```

It prints a block with a `database_id`. Open `wrangler.jsonc` and replace `REPLACE_WITH_YOUR_DATABASE_ID` with it.
Leave `"binding": "DB"` as it is; the code reads the database by that name.

Then create the tables:

```bash
npm run db:migrate:remote
```

Answer `y` when it asks. It applies every file in `migrations/` in order.

## 4. Set the extension token

The browser extension signs its requests with a long random string. Make one and store it as a secret:

```bash
openssl rand -hex 32          # copy the output; keep it for the extension options
npx wrangler secret put EXTENSION_TOKEN
```

Paste the value when asked. (On Windows without openssl, any 32+ character random string from a password manager
works.)

If you don't plan to use the extension yet, you can skip this; the rest of the app works without it.

## 5. Deploy

```bash
npm run deploy
```

The first deploy asks you to pick a `workers.dev` subdomain if you don't have one. When it finishes it prints your
address, for example `https://jobpilot.yourname.workers.dev`.

Open `wrangler.jsonc` and set `APP_URL` to that address (it is used for links in the Telegram digest).

If you open the address now you'll see **"Sign in through Cloudflare Access to use this app."** That is expected:
the app refuses every request until Access is set up, so nobody else can read your data.

## 6. Protect it with Cloudflare Access

Follow [docs/access.md](access.md). The short version for the free `workers.dev` address:

1. Cloudflare dashboard, **Workers & Pages**, select `jobpilot`, **Settings**, **Domains & Routes**.
2. Next to `workers.dev`, click **Enable Cloudflare Access**. If Cloudflare asks you to set up Zero Trust first, pick
   a team name and the **Free** plan.
3. Click **Manage Cloudflare Access** and make sure the policy allows only your own email address.
4. Copy two values into `wrangler.jsonc`:
   - `ACCESS_AUD`: the application's **Application Audience (AUD) Tag** (Zero Trust, Access, Applications, your app).
   - `ACCESS_TEAM_DOMAIN`: your team domain, `yourteam.cloudflareaccess.com` (Zero Trust, Settings).
5. Deploy again: `npm run deploy`.

Open your address. Cloudflare asks for your email, sends a code, and then shows the JobPilot dashboard.

## 7. First run in the app

1. **Profile.** Fill in your jobs, bullets and skills, or click **Import / export JSON** and paste
   [examples/profile.example.json](../examples/profile.example.json) to see how it works, then replace it with your
   own facts. Preferences (rates, work type, countries, industries) drive the score. Save.
2. **Settings.** The **Setup** panel at the top shows what is set and what's missing. Set your time zone (hours from
   UTC) under Daily routine. Look through the job sources; add search words for your field (for example a
   Remotive search for "python", or a Himalayas source limited to one country).
3. **Jobs.** Click **Fetch new jobs now**. The first run takes a minute or two; on the free plan it reads the sources
   in groups and keeps going until it has been through all of them.
4. Open a job you like and click **Draft from my profile (no AI)**, or **Tailor my resume for this job** if you added
   a Claude key. Fix anything marked red, approve, and download the PDF.

From now on the cron fetches new jobs every 4 hours by itself.

## 8. Optional extras

- **Claude API key** (AI tailoring, reading pasted posts into fields, AI-written pitches):
  `npx wrangler secret put ANTHROPIC_API_KEY`. No redeploy needed. See
  [configuration.md](configuration.md#claude-api-optional) for models and costs.
- **Telegram morning digest:** [docs/telegram.md](telegram.md).
- **Chrome extension:** [docs/extension.md](extension.md).

## Updating later

Pull the new code, then:

```bash
npm install
npm run db:migrate:remote     # applies only the migrations you don't have yet
npm run deploy
```

## Running it on your computer instead

```bash
cp .dev.vars.example .dev.vars   # ALLOW_NO_ACCESS=true opens the app without Access, only on localhost
npm run db:migrate:local
npm run preview                  # http://localhost:8787
```

The local database lives in `.wrangler/` and is separate from the one on Cloudflare. Crons don't run locally; use
"Fetch new jobs now" and "Send a test digest now" instead.
