<script setup lang="ts">
import { onMounted, ref } from 'vue'

import { api, fromCsv } from './api'

const settings = ref<any>(null)
const runs = ref<any[]>([])
const recommended = ref<any[]>([])
const status = ref<Record<string, any> | null>(null)
const ATS = ['greenhouse', 'lever', 'ashby', 'recruitee', 'breezy']
const BOARDS: Record<string, string> = { himalayas: 'Himalayas', jobicy: 'Jobicy', arbeitnow: 'Arbeitnow', workingnomads: 'Working Nomads', mycareersfuture: 'MyCareersFuture (Singapore)' }
const COUNTRY_BOARDS = ['himalayas', 'jobicy']
const message = ref('')
const newSource = ref<any>({ kind: 'greenhouse', token: '', company: '', url: '', label: '', search: '', country: '', thread: 'freelancer', tags: '' })

async function load() { const data = await api('/api/settings'); settings.value = data.settings; runs.value = data.runs; recommended.value = data.recommendedSources ?? []; status.value = data.status ?? null }

const sameSource = (a: any, b: any) => JSON.stringify({ ...a, company: undefined }) === JSON.stringify({ ...b, company: undefined })
const missingRecommended = () => recommended.value.filter((r) => !settings.value.sources.some((s: any) => sameSource(s, r)))
function addRecommended() { const add = missingRecommended(); settings.value.sources.push(...add); toast(`${add.length} sources added. Press Save to keep them.`) }
onMounted(load)
function toast(text: string) { message.value = text; setTimeout(() => (message.value = ''), 5000) }

async function testDigest() {
  try {
    const res = await api('/api/routine/digest', { method: 'POST' })
    toast(res.sent ? 'Sent. Check Telegram.' : `Not sent: ${res.reason}`)
  } catch (e) { toast((e as Error).message) }
}

async function save() {
  try { const res = await api('/api/settings', { method: 'PUT', body: settings.value }); toast(`Saved. ${res.rescored} jobs scored again.`) }
  catch (e) { toast((e as Error).message) }
}

function describe(s: any) {
  if (ATS.includes(s.kind)) return `${s.kind}: ${s.company || s.token}`
  if (BOARDS[s.kind]) return `${BOARDS[s.kind]}${s.country ? ` [${s.country}]` : ''}${s.search ? `: "${s.search}"` : ''}`
  if (s.kind === 'rss') return `RSS: ${s.label || s.url}`
  if (s.kind === 'hn') return s.thread === 'hiring' ? 'Hacker News: Who is hiring' : 'Hacker News: Seeking freelancer'
  if (s.kind === 'remotive') return `Remotive${s.search ? `: "${s.search}"` : ''}`
  return `RemoteOK${s.tags?.length ? `: ${s.tags.join(', ')}` : ''}`
}

function addSource() {
  const s = newSource.value
  let item: any
  if (BOARDS[s.kind]) item = { kind: s.kind, search: s.search.trim(), ...(COUNTRY_BOARDS.includes(s.kind) && s.country?.trim() ? { country: s.country.trim() } : {}) }
  else if (ATS.includes(s.kind)) { if (!s.token) return toast('Enter the board token'); item = { kind: s.kind, token: s.token.trim(), company: s.company.trim() || undefined } }
  else if (s.kind === 'rss') { if (!s.url) return toast('Enter the feed URL'); item = { kind: 'rss', url: s.url.trim(), label: s.label.trim() || undefined } }
  else if (s.kind === 'hn') item = { kind: 'hn', thread: s.thread }
  else if (s.kind === 'remotive') item = { kind: 'remotive', search: s.search.trim() }
  else item = { kind: 'remoteok', tags: fromCsv(s.tags) }
  settings.value.sources.push(item)
  toast('Added. Press Save to keep it.')
}
const setupRows = () => status.value ? [
  { ok: status.value.access, label: 'Cloudflare Access', note: status.value.openWithoutAccess ? 'Off: ALLOW_NO_ACCESS is on, so anyone with the address can open this app. Fine on your own computer only.' : 'Set ACCESS_TEAM_DOMAIN and ACCESS_AUD (docs/setup.md, step 6).' },
  { ok: status.value.extension, label: 'Browser extension token', note: 'Set the EXTENSION_TOKEN secret to use the extension.' },
  { ok: status.value.telegram, label: 'Telegram digest (optional)', note: 'Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID (docs/telegram.md).' },
  { ok: status.value.appUrl, label: 'APP_URL (for digest links)', note: 'Set APP_URL in wrangler.jsonc so links in the digest open this app.' },
  { ok: status.value.claude, label: 'Claude API key (optional)', note: 'Without it everything works except AI tailoring, reading pasted posts into fields, and AI pitches. Use "Draft from my profile" and saved templates instead.' },
] : []
const weightLabels: Record<string, string> = { skills: 'Skills match', engagement: 'Work type', rate: 'Rate', location: 'Location and hours', company: 'Company fit' }
</script>

<template>
  <div v-if="settings">
    <section v-if="status" class="panel">
      <h2 style="margin-top: 0">Setup</h2>
      <table>
        <tbody>
          <tr v-for="row in setupRows()" :key="row.label">
            <td style="width: 30px">{{ row.ok ? '✓' : '·' }}</td>
            <td>{{ row.label }}</td>
            <td class="small muted">{{ row.ok ? 'Set' : row.note }}</td>
          </tr>
          <tr><td></td><td>Fetch budget per run</td><td class="small muted">{{ status.fetchBudget }} requests ({{ status.fetchBudget > 45 ? 'needs Workers Paid' : 'fits Workers Free' }})</td></tr>
        </tbody>
      </table>
    </section>

    <section class="panel">
      <h2 style="margin-top: 0">Score weights</h2>
      <p class="small muted">How much each part counts toward the 0 to 100 score. They don't need to add up to 100.</p>
      <div v-for="(label, key) in weightLabels" :key="key" class="row" style="margin: 6px 0">
        <span style="width: 170px">{{ label }}</span>
        <input v-model.number="settings.weights[key]" type="range" min="0" max="60" style="flex: 1" />
        <span style="width: 40px; text-align: right">{{ settings.weights[key] }}</span>
      </div>
      <label style="margin-top: 10px; max-width: 320px">Auto-skip new jobs scoring under <input v-model.number="settings.autoSkipBelow" type="number" min="0" max="100" /></label>
      <label style="margin-top: 10px; max-width: 320px">Follow-up reminder after (days) <input v-model.number="settings.followUpDays" type="number" min="1" max="60" /></label>
    </section>

    <section class="panel">
      <h2 style="margin-top: 0">Job sources</h2>
      <table>
        <thead><tr><th>Source</th><th>Last run</th><th></th></tr></thead>
        <tbody>
          <tr v-for="(s, i) in settings.sources" :key="i">
            <td>{{ describe(s) }}</td>
            <td class="small muted">{{ (() => { const r = runs.find((x) => x.source.toLowerCase().includes((s.company || s.token || s.label || s.kind || '').toLowerCase())); return r ? `${r.found} found, ${r.added} new${r.error ? `, error: ${r.error}` : ''}` : '' })() }}</td>
            <td><button class="danger" @click="settings.sources.splice(i, 1)">Remove</button></td>
          </tr>
        </tbody>
      </table>
      <p class="small muted">Companies on the Companies page with a Greenhouse, Lever, Ashby, Recruitee or Breezy careers link are pulled too, without being listed here. Each fetch run reads the next group of sources, so a large list is covered over a few runs.</p>
      <button v-if="missingRecommended().length" @click="addRecommended">Add {{ missingRecommended().length }} recommended sources</button>
      <div class="row" style="margin-top: 10px">
        <select v-model="newSource.kind" style="width: 170px">
          <option value="greenhouse">Greenhouse board</option><option value="lever">Lever board</option><option value="ashby">Ashby board</option>
          <option value="recruitee">Recruitee board</option><option value="breezy">Breezy board</option>
          <option value="himalayas">Himalayas</option><option value="jobicy">Jobicy</option><option value="workingnomads">Working Nomads</option><option value="arbeitnow">Arbeitnow</option><option value="mycareersfuture">MyCareersFuture (Singapore)</option>
          <option value="hn">Hacker News thread</option><option value="remotive">Remotive</option><option value="remoteok">RemoteOK</option><option value="rss">RSS feed</option>
        </select>
        <template v-if="BOARDS[newSource.kind]"><input v-model="newSource.search" placeholder="search word, e.g. vue (optional)" style="width: 200px" /><input v-if="COUNTRY_BOARDS.includes(newSource.kind)" v-model="newSource.country" :placeholder="newSource.kind === 'himalayas' ? 'country code, e.g. SG' : 'geo, e.g. apac or japan'" style="width: 170px" /></template>
        <template v-else-if="ATS.includes(newSource.kind)"><input v-model="newSource.token" placeholder="board token, e.g. acme" style="width: 200px" /><input v-model="newSource.company" placeholder="company name" style="width: 200px" /></template>
        <template v-else-if="newSource.kind === 'rss'"><input v-model="newSource.url" placeholder="https://.../feed.rss" style="width: 300px" /><input v-model="newSource.label" placeholder="short name" style="width: 140px" /></template>
        <select v-else-if="newSource.kind === 'hn'" v-model="newSource.thread" style="width: 220px"><option value="freelancer">Seeking freelancer</option><option value="hiring">Who is hiring</option><option value="jobs">YC startup job posts</option></select>
        <input v-else-if="newSource.kind === 'remotive'" v-model="newSource.search" placeholder="search words, e.g. vue" style="width: 220px" />
        <input v-else v-model="newSource.tags" placeholder="tags, e.g. vue, javascript" style="width: 220px" />
        <button @click="addSource">Add source</button>
      </div>
    </section>

    <section class="panel">
      <h2 style="margin-top: 0">Finding companies</h2>
      <label class="row" style="display: flex"><input v-model="settings.discovery.fromJobLinks" type="checkbox" style="width: auto" /> Watch every company whose job post links to its own Greenhouse, Lever, Ashby, Recruitee or Breezy board</label>
      <label class="row" style="display: flex; margin-top: 6px"><input v-model="settings.discovery.ycStartups" type="checkbox" style="width: auto" /> Add Y Combinator startups in this team size: every one from the last two years, and older ones that are hiring (remote ones, when your profile says remote only). Then look for their job board.</label>
      <label class="row" style="display: flex; margin-top: 6px"><input v-model="settings.discovery.launchHn" type="checkbox" style="width: auto" /> Add brand-new startups from "Launch HN" posts</label>
      <div class="grid" style="margin-top: 8px">
        <label>Smallest team <input v-model.number="settings.discovery.minTeam" type="number" min="1" /></label>
        <label>Largest team <input v-model.number="settings.discovery.maxTeam" type="number" min="1" /></label>
        <label>Startups checked per run <input v-model.number="settings.discovery.probesPerRun" type="number" min="0" max="200" /></label>
      </div>
      <label class="row" style="display: flex; margin-top: 8px"><input v-model="settings.keepLowScores" type="checkbox" style="width: auto" /> Keep jobs under the auto-skip score (stored as skipped). Off saves database space.</label>
    </section>

    <section class="panel">
      <h2 style="margin-top: 0">Daily routine</h2>
      <div class="grid">
        <label>Applications a day <input v-model.number="settings.routine.applicationsPerDay" type="number" min="0" max="100" /></label>
        <label>Direct pitches a day <input v-model.number="settings.routine.pitchesPerDay" type="number" min="0" max="100" /></label>
        <label>Apply queue: lowest score <input v-model.number="settings.routine.queueMinScore" type="number" min="0" max="100" /></label>
        <label>Pitch follow-up after (days) <input v-model.number="settings.routine.pitchFollowUpDays" type="number" min="1" max="60" /></label>
        <label>Your time zone, hours from UTC <input v-model.number="settings.routine.utcOffset" type="number" min="-12" max="14" step="0.5" /></label>
      </div>
      <h3>Morning digest on Telegram</h3>
      <p class="small muted">Every day at the hour below (in your time zone above): the best new jobs, follow-ups due, and yesterday against your goal. On Mondays it adds last week's reply numbers. Needs the TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID secrets (see docs/telegram.md).</p>
      <div class="grid">
        <label class="row small" style="display: flex"><input v-model="settings.digest.enabled" type="checkbox" /> Send the digest</label>
        <label>Send at (hour, 0 to 23) <input v-model.number="settings.digest.hour" type="number" min="0" max="23" /></label>
        <label>Jobs scoring at least <input v-model.number="settings.digest.minScore" type="number" min="0" max="100" /></label>
        <label>At most this many jobs <input v-model.number="settings.digest.maxJobs" type="number" min="1" max="30" /></label>
      </div>
      <button style="margin-top: 8px" @click="testDigest">Send a test digest now</button>
    </section>

    <section class="panel">
      <h2 style="margin-top: 0">Writing rules</h2>
      <p class="small muted">Phrases the writer must never use, on top of the built-in list (spearheaded, leveraged, passionate about, em dashes and about 80 more).</p>
      <textarea :value="settings.bannedPhrases.join('\n')" placeholder="one phrase per line" @change="settings.bannedPhrases = ($event.target as HTMLTextAreaElement).value.split('\n').map((s) => s.trim()).filter(Boolean)"></textarea>
    </section>

    <section class="panel">
      <h2 style="margin-top: 0">AI</h2>
      <div class="grid">
        <label>Model (empty = server default) <input v-model="settings.ai.model" placeholder="claude-opus-5-5" /></label>
        <label>Effort <select v-model="settings.ai.effort"><option>low</option><option>medium</option><option>high</option><option>xhigh</option><option>max</option></select></label>
        <label>Fix rounds when checks fail <input v-model.number="settings.ai.repairRounds" type="number" min="0" max="3" /></label>
      </div>
    </section>
    <button class="primary" @click="save">Save settings</button>
    <div v-if="message" class="toast">{{ message }}</div>
  </div>
  <p v-else class="muted">Loading...</p>
</template>
