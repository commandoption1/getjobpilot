# Cloudflare Access

JobPilot holds your work history, contact details and applications, so it is never open to the internet. Cloudflare
Access sits in front of the Worker and asks for your email before anything loads. The Worker also checks the signed
token Access adds to every request (`src/server/access.ts`), so even a misconfigured policy lets nobody in. Until
`ACCESS_AUD` and `ACCESS_TEAM_DOMAIN` are set, every request is refused.

Cloudflare Zero Trust is free for up to 50 users. When you first open Zero Trust, Cloudflare asks you to pick a team
name (this becomes `yourteam.cloudflareaccess.com`) and a plan: pick **Free**. Cloudflare may ask for a payment card
even for the Free plan; it is not charged.

There are two ways to set it up. Pick one.

## Option A: the free `workers.dev` address (no domain needed)

1. Cloudflare dashboard, **Workers & Pages**, select your Worker (`jobpilot`), **Settings**, **Domains & Routes**.
2. Next to `workers.dev`, click **Enable Cloudflare Access**.
3. Click **Manage Cloudflare Access**. In the policy, make sure the only rule is **Include, Emails**, with your own
   email address. Save.
4. On the application's page, copy the **Application Audience (AUD) Tag**.
5. In Zero Trust, **Settings** (or **Settings, Custom Pages**), copy your **team domain**, for example
   `yourteam.cloudflareaccess.com`.
6. Put both in `wrangler.jsonc`:

   ```jsonc
   "ACCESS_TEAM_DOMAIN": "yourteam.cloudflareaccess.com",
   "ACCESS_AUD": "the-long-aud-tag",
   ```

7. `npm run deploy`.

**The extension on this option.** The extension can't sign in through the Access login page. Give it an Access
service token instead:

1. Zero Trust, **Access**, **Service credentials** (or **Service Auth**), **Service Tokens**, **Create Service Token**.
   Name it `jobpilot-extension`. Copy the **Client ID** and **Client Secret** now; the secret is shown only once.
2. Open your JobPilot Access application, **Policies**, **Add a policy**: Action **Service Auth**, Include
   **Service Token**, `jobpilot-extension`. Save. Keep your email policy too.
3. In the extension options, open **Cloudflare Access service token** and paste the Client ID and Client Secret.

Access then lets the extension's requests through, and JobPilot still checks the extension token on `/api/ext/`.

## Option B: your own domain

Use this if you already have a domain on Cloudflare (it must use Cloudflare's nameservers).

1. **Workers & Pages**, your Worker, **Settings**, **Domains & Routes**, **Add**, **Custom domain**, for example
   `jobs.yourdomain.com`.
2. You can turn the `workers.dev` route off on the same page, so the app has only one address.
3. Zero Trust, **Access**, **Applications**, **Add an application**, **Self-hosted**.
   - Application domain: `jobs.yourdomain.com`
   - Policy: Action **Allow**, Include **Emails**, your own email address.
4. Add a second **Self-hosted** application for the extension:
   - Application domain: `jobs.yourdomain.com`, path `api/ext/`
   - Policy: Action **Bypass**, Include **Everyone**.

   Access stays out of the way for those routes, and the Worker checks the `EXTENSION_TOKEN` on each of them instead.
   (You can use a service token as in option A instead of the Bypass app, if you prefer.)
5. Copy the **first** application's AUD tag and your team domain into `wrangler.jsonc` as in option A, step 6.
6. Set `APP_URL` to `https://jobs.yourdomain.com` and `npm run deploy`.

## Check that it works

- Open the address in a private window: you should see the Cloudflare Access login, not JobPilot.
- Sign in: the dashboard loads. Settings, Setup shows **Cloudflare Access: Set**.
- `curl -i https://<your-address>/api/jobs` from a terminal: you should get a redirect to the Access login (or a
  403), never job data.

## Local development

For `npm run preview` on your own computer, `.dev.vars` sets `ALLOW_NO_ACCESS=true` and blanks `ACCESS_AUD`, which skips
the check locally (the check is skipped only while `ACCESS_AUD` is empty). Never set `ALLOW_NO_ACCESS` to `"true"` in `wrangler.jsonc` for a deployed Worker: it would
leave the app open to anyone who finds the address.
