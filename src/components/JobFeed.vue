<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'

import { api, money, scoreClass } from './api'

const props = defineProps<{ initialStatus?: string }>()
const status = ref(props.initialStatus ?? 'new')
const q = ref('')
const engagement = ref('')
const minScore = ref(0)
const jobs = ref<any[]>([])
const loading = ref(false)
const fetching = ref(false)
const progress = ref('')
const message = ref('')
const adding = ref(false)
const pasteText = ref('')
const pasteUrl = ref('')

function toast(text: string) {
  message.value = text
  setTimeout(() => (message.value = ''), 5000)
}

async function load() {
  loading.value = true
  const p = new URLSearchParams({ status: status.value, q: q.value, engagement: engagement.value, minScore: String(minScore.value || '') })
  try { jobs.value = await api(`/api/jobs?${p}`) } catch (e) { toast((e as Error).message) }
  loading.value = false
}
onMounted(load)
watch([status, engagement, minScore], load)

/** Each call fetches the next window of sources; keep going until every source has been fetched once. */
async function fetchNow() {
  fetching.value = true
  let added = 0
  let companies = 0
  const failed: string[] = []
  let done = 0
  try {
    for (let round = 0; round < 25; round++) {
      const res = await api('/api/ingest', { body: {} })
      added += res.summary.reduce((n: number, s: any) => n + s.added, 0)
      companies += res.companiesAdded
      failed.push(...res.summary.filter((s: any) => s.error).map((s: any) => s.source))
      done += res.fetched
      progress.value = `Fetched ${Math.min(done, res.total)} of ${res.total} sources...`
      await load()
      if (done >= res.total || !res.fetched) break
    }
    toast(`${added} new jobs${companies ? `, ${companies} new companies to watch` : ''}.${failed.length ? ` Failed: ${failed.join(', ')}.` : ''}`)
  } catch (e) { toast((e as Error).message) }
  progress.value = ''
  fetching.value = false
}

async function patch(job: any, body: Record<string, unknown>) {
  try {
    const res = await api(`/api/jobs/${job.id}`, { method: 'PATCH', body })
    Object.assign(job, res.job)
    if (body.status && body.status !== status.value && status.value !== 'all') jobs.value = jobs.value.filter((j) => j.id !== job.id)
  } catch (e) { toast((e as Error).message) }
}

async function addJob() {
  adding.value = true
  try {
    const res = await api('/api/jobs', { body: { text: pasteText.value, url: pasteUrl.value } })
    location.href = `/jobs/${res.id}`
  } catch (e) { toast((e as Error).message); adding.value = false }
}
const tabs = [['new', 'New'], ['saved', 'Saved'], ['active', 'In progress'], ['skipped', 'Skipped'], ['all', 'All']]
</script>

<template>
  <div>
    <div class="panel">
      <div class="row">
        <button v-for="[value, label] in tabs" :key="value" :class="{ primary: status === value }" @click="status = value">{{ label }}</button>
        <span style="flex: 1"></span>
        <button :disabled="fetching" @click="fetchNow">{{ fetching ? progress || 'Fetching...' : 'Fetch new jobs now' }}</button>
      </div>
      <div class="row" style="margin-top: 10px">
        <input v-model="q" placeholder="Search title, company or text" style="flex: 1; min-width: 200px" @keyup.enter="load" />
        <select v-model="engagement" style="width: 160px"><option value="">Any work type</option><option>contract</option><option>freelance</option><option>full-time</option><option>part-time</option><option>unknown</option></select>
        <label class="row small" style="display: flex">Min score <input v-model.number="minScore" type="number" min="0" max="100" style="width: 70px" /></label>
        <button @click="load">Search</button>
      </div>
    </div>

    <details class="panel">
      <summary><strong>Add a job by pasting it</strong> <span class="muted small">from Upwork, LinkedIn, an email, anywhere</span></summary>
      <label style="margin-top: 10px">Link to the post (optional) <input v-model="pasteUrl" placeholder="https://..." /></label>
      <label style="margin-top: 8px">The whole post <textarea v-model="pasteText" style="min-height: 160px"></textarea></label>
      <button class="primary" style="margin-top: 8px" :disabled="adding || pasteText.length < 40" @click="addJob">{{ adding ? 'Reading it...' : 'Add and score' }}</button>
    </details>

    <div class="panel list">
      <p v-if="loading" class="muted">Loading...</p>
      <p v-else-if="!jobs.length" class="muted">Nothing here. Try "Fetch new jobs now", or check your sources in Settings.</p>
      <div v-for="job in jobs" :key="job.id" class="item">
        <div class="score" :class="scoreClass(job.score)" :title="job.detail?.parts?.map((p: any) => `${p.label}: ${p.note}`).join('\n')">{{ job.score ?? '-' }}</div>
        <div class="body">
          <a class="title" :href="`/jobs/${job.id}`">{{ job.title }}</a>
          <span class="muted"> · {{ job.company || 'Unknown company' }}</span>
          <div class="small">
            <span class="chip">{{ job.engagement }}</span>
            <span v-if="job.remote === true" class="chip">remote</span><span v-else-if="job.remote === false" class="chip">on-site</span>
            <span v-if="money(job)" class="chip">{{ money(job) }}</span>
            <span class="chip">{{ job.source }}</span>
            <span v-if="job.location" class="muted">{{ job.location.slice(0, 60) }}</span>
          </div>
          <div v-if="job.detail" class="small" style="margin-top: 4px">
            <span v-for="s in job.detail.matchedSkills.slice(0, 8)" :key="s" class="chip good">{{ s }}</span>
            <span v-for="s in job.detail.missingSkills.slice(0, 5)" :key="'m' + s" class="chip bad">{{ s }}</span>
            <span v-for="f in job.detail.flags" :key="f" class="chip warn">{{ f }}</span>
          </div>
        </div>
        <div class="row" style="flex-wrap: nowrap">
          <button :class="{ primary: job.myRating === 1 }" title="Good fit" @click="patch(job, { rating: job.myRating === 1 ? null : 1 })">👍</button>
          <button :class="{ primary: job.myRating === -1 }" title="Not for me" @click="patch(job, { rating: job.myRating === -1 ? null : -1 })">👎</button>
          <button v-if="job.status !== 'saved'" @click="patch(job, { status: 'saved' })">Save</button>
          <button v-if="job.status !== 'skipped'" @click="patch(job, { status: 'skipped' })">Skip</button>
        </div>
      </div>
    </div>
    <div v-if="message" class="toast">{{ message }}</div>
  </div>
</template>
