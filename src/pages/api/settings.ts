import { env } from 'cloudflare:workers'

import { defaultSettings, settingsSchema } from '../../core/settings'
import { currentProfile, getSettings, lastIngestRuns, rescoreAll, saveSettings } from '../../server/db'
import { body, handler, json } from '../../server/http'

/** What is set up, so the Settings page can show what's missing. Booleans only: no secret ever leaves the Worker. */
const setupStatus = () => ({
  access: Boolean(env.ACCESS_AUD && env.ACCESS_TEAM_DOMAIN),
  openWithoutAccess: env.ALLOW_NO_ACCESS === 'true' && !env.ACCESS_AUD,
  claude: Boolean(env.ANTHROPIC_API_KEY),
  extension: Boolean(env.EXTENSION_TOKEN),
  telegram: Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID),
  appUrl: Boolean(env.APP_URL),
  fetchBudget: Number(env.INGEST_FETCH_BUDGET) || 0,
})

export const GET = handler(async () => json({ settings: await getSettings(env.DB), runs: await lastIngestRuns(env.DB), recommendedSources: defaultSettings().sources, status: setupStatus() }))

export const PUT = handler(async ({ request }) => {
  const settings = await body(request, settingsSchema)
  await saveSettings(env.DB, settings)
  const rescored = await rescoreAll(env.DB, (await currentProfile(env.DB)).profile, settings)
  return json({ ok: true, rescored })
})
