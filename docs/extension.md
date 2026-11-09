# Chrome extension

The extension in `extension/` does three things on the page you're looking at:

- **Save this job to my dashboard:** sends the page's address, title and text to JobPilot, which scores it.
  With a Claude key it reads the post into fields (title, company, rate); without one, plain code reads what it can.
- **Fill this application:** on an application form (Greenhouse, Lever, Ashby, Workable and most others) it fills
  empty fields from your profile and the approved resume for that job: name, email, phone, links, location, and the
  cover letter. It matches fields by their labels and never overwrites what you typed.
- **I submitted it, mark as applied:** moves the job to Applied and sets the follow-up date.

It **never presses Submit**. You check every field, attach the PDF, and submit yourself. Many job sites ban automated
submissions; this keeps you within their rules and keeps mistakes off your applications.

It has no build step and asks Chrome for access to one site only: your JobPilot address.

## Install

1. Chrome, `chrome://extensions`, turn on **Developer mode** (top right).
2. **Load unpacked** and pick the `extension` folder of this repository.
3. Pin it from the puzzle-piece menu so the icon is always visible.

Edge, Brave and other Chromium browsers work the same way. To share it with another computer, run
`npm run extension:zip` and load the unzipped folder there.

## Connect it to your JobPilot

1. Right-click the icon, **Options**.
2. **Your JobPilot address:** for example `https://jobpilot.yourname.workers.dev`.
3. **Extension token:** the value you stored with `npx wrangler secret put EXTENSION_TOKEN`.
4. Cloudflare Access must let the extension's requests through to `/api/ext/`. Either:
   - you added a **Bypass** application for `/api/ext/` ([access.md, option B](access.md#option-b-your-own-domain)),
     and leave the service token fields empty; or
   - you use a **service token** ([access.md, option A](access.md#option-a-the-free-workersdev-address-no-domain-needed)):
     open **Cloudflare Access service token** and paste its Client ID and Client Secret.
5. **Save and allow access**, and allow Chrome to reach that one site. It then says
   "Connected. Profile: <your name>."

## Use it

1. On a job post, click the icon, **Save this job to my dashboard**.
2. In JobPilot, open the job, draft and approve a resume, and download the PDF.
3. On the application form, click the icon, **Fill this application**. Check every field. Attach the PDF.
   **Copy cover letter** puts the letter on your clipboard for forms with a text box.
4. Submit the form yourself, then click **I submitted it, mark as applied**.

## Security

- The extension token only opens `/api/ext/*`: reading the profile fields it fills, saving a job, and marking a job
  applied. It can't read your other data or change settings.
- The token and the service token are kept in Chrome's local extension storage on that computer only.
- To revoke it, set a new token with `npx wrangler secret put EXTENSION_TOKEN` (and delete the service token in
  Zero Trust if you made one).
