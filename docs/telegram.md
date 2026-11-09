# Morning digest on Telegram

Once a day, at the hour you choose, JobPilot sends you a short Telegram message: the best new jobs above your digest
score, follow-ups that are due, yesterday's applications and pitches against your daily goal, and on Mondays last
week's reply numbers. It uses no AI and costs nothing. It is optional.

## 1. Create a bot (2 minutes)

1. In Telegram, open a chat with **@BotFather** (the official one, with the blue check mark).
2. Send `/newbot`. Give it a name (for example "My JobPilot") and a username ending in `bot`
   (for example `myname_jobpilot_bot`).
3. BotFather replies with a **token** like `123456789:AAH...`. Treat it like a password.

## 2. Find your chat id

1. Open a chat with your new bot and send it any message, for example `hi`. (A bot can't message you first.)
2. In a browser, open `https://api.telegram.org/bot<TOKEN>/getUpdates`, with your token in place of `<TOKEN>`
   (keep the word `bot` in front of it).
3. Find `"chat":{"id":123456789,...`. That number is your chat id.

If the result is `{"ok":true,"result":[]}`, send the bot another message and reload. To send the digest to a group
instead, add the bot to the group, send a message there, and use the group's id (it starts with `-`).

## 3. Store both as secrets

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_CHAT_ID
```

Secrets take effect right away; no deploy needed. For local runs, put them in `.dev.vars` instead.

## 4. Pick the hour and test it

1. In JobPilot, **Settings**, **Daily routine**: set **Your time zone, hours from UTC** (for example `1` for Berlin
   in winter, `-5` for New York in winter, `5.5` for India, `7` for Bangkok).
2. Under **Morning digest on Telegram**, set **Send at (hour, 0 to 23)**, the lowest score to include, and how many
   jobs. Save.
3. Click **Send a test digest now**. The message should arrive within a few seconds.

Make sure `APP_URL` in `wrangler.jsonc` is your app's address, so the links in the message open your dashboard.

## How it runs

The second cron in `wrangler.jsonc` (`0 * * * *`) wakes the Worker at the top of every hour. It sends the digest
only when the local hour (from your time-zone setting) matches the hour you picked, so you get one message a day.
Cron triggers are free on the Workers Free plan (5 per account; JobPilot uses 2).

Time zones with daylight saving: the setting is a fixed offset, so change it when your clocks change, or accept the
message arriving an hour earlier or later for part of the year.

## Turning it off

Untick **Send the digest** in Settings, or delete the secrets with `npx wrangler secret delete TELEGRAM_BOT_TOKEN`.

If something doesn't arrive, see [troubleshooting](troubleshooting.md#telegram-digest).
