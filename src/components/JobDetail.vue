<script setup lang="ts">
import { onMounted, ref } from 'vue'

import { api, money, scoreClass } from './api'
import TailorEditor from './TailorEditor.vue'

const props = defineProps<{ id: string }>()
const job = ref<any>(null)
const tailored = ref<any[]>([])
const events = ref<any[]>([])
const selected = ref<string | null>(null)
const tailoring = ref(false)
const withLetter = ref(true)
const note = ref('')
const message = ref('')
const showFull = ref(false)
/** Set when the Apply link is opened, so "I applied" shows next to it. */
const opened = ref(false)
const statuses = ['new', 'saved', 'skipped', 'applied', 'interview', 'offer', 'won', 'lost']

async function load() {
  const data = await api(`/api/jobs/${props.id}`)
  job.value = data.job
  tailored.value = data.tailored
  events.value = data.events
  note.value = data.job.myNote
  if (!selected.value && data.tailored.length) selected.value = data.tailored[0].id
}
onMounted(load)

function toast(text: string) {
  message.value = text
  setTimeout(() => (message.value = ''), 6000)
}

async function patch(body: Record<string, unknown>) {
  try { job.value = (await api(`/api/jobs/${props.id}`, { method: 'PATCH', body })).job; events.value = (await api(`/api/jobs/${props.id}`)).events }
  catch (e) { toast((e as Error).message) }
}

async function tailor(ai = true) {
  tailoring.value = true
  try {
    const res = await api(`/api/jobs/${props.id}/tailor`, { body: { coverLetter: withLetter.value, ai } })
    selected.value = res.id
    await load()
    const errs = res.checks.filter((c: any) => c.severity === 'error').length
    const how = res.model === 'none' ? `Drafted from your profile without AI${ai ? ' (no Claude API key is set)' : ''}: bullets that match the job are first. Trim and edit below.` : 'Drafted.'
    toast(errs ? `${how} ${errs} checks still fail. Fix them below before approving.` : `${how} Every check passes. Read it, edit if you like, then approve.`)
  } catch (e) { toast((e as Error).message) }
  tailoring.value = false
}

async function remove() {
  if (!confirm('Delete this job and its tailored resumes?')) return
  await api(`/api/jobs/${props.id}`, { method: 'DELETE' })
  location.href = '/jobs'
}
</script>

<template>
  <div v-if="job">
    <div class="row" style="align-items: flex-start">
      <div class="score" :class="scoreClass(job.score)" style="font-size: 22px; padding: 8px 10px">{{ job.score ?? '-' }}</div>
      <div style="flex: 1">
        <h1 style="margin: 0">{{ job.title }}</h1>
        <div class="muted">{{ job.company || 'Unknown company' }} · {{ job.location || 'location not stated' }}</div>
        <div class="small" style="margin-top: 4px">
          <span class="chip">{{ job.engagement }}</span>
          <span v-if="job.remote === true" class="chip">remote</span><span v-else-if="job.remote === false" class="chip">on-site</span>
          <span v-if="money(job)" class="chip">{{ money(job) }}</span>
          <span class="chip">{{ job.source }}</span>
          <a v-if="job.url" :href="job.url" target="_blank" rel="noopener">Open post</a>
        </div>
      </div>
      <div class="row">
        <a v-if="job.applyUrl || job.url" class="button primary" :href="job.applyUrl || job.url" target="_blank" rel="noopener" @click="opened = true">Apply</a>
        <button v-if="opened && !['applied', 'interview', 'offer', 'won'].includes(job.status)" @click="patch({ status: 'applied' })">I applied</button>
        <select :value="job.status" style="width: 140px" @change="patch({ status: ($event.target as HTMLSelectElement).value })"><option v-for="s in statuses" :key="s">{{ s }}</option></select>
        <button :class="{ primary: job.myRating === 1 }" @click="patch({ rating: job.myRating === 1 ? null : 1 })">👍</button>
        <button :class="{ primary: job.myRating === -1 }" @click="patch({ rating: job.myRating === -1 ? null : -1 })">👎</button>
      </div>
    </div>

    <div class="grid" style="margin-top: 16px; grid-template-columns: 2fr 1fr">
      <div class="panel" style="margin: 0">
        <strong>Why this score</strong>
        <table class="small" style="margin-top: 6px">
          <tr v-for="p in job.detail?.parts ?? []" :key="p.key"><td>{{ p.label }}</td><td style="width: 60px">{{ Math.round(p.value * 100) }}</td><td class="muted">{{ p.note }}</td></tr>
        </table>
        <div class="small" style="margin-top: 6px">
          <span v-for="s in job.detail?.matchedSkills ?? []" :key="s" class="chip good">{{ s }}</span>
          <span v-for="s in job.detail?.missingSkills ?? []" :key="'m' + s" class="chip bad">{{ s }}</span>
          <span v-for="f in job.detail?.flags ?? []" :key="f" class="chip warn">{{ f }}</span>
        </div>
      </div>
      <div class="panel" style="margin: 0">
        <label>Your notes <textarea v-model="note" @change="patch({ note })"></textarea></label>
        <label style="margin-top: 8px">Follow up on <input type="date" :value="job.followUpAt ?? ''" @change="patch({ followUpAt: ($event.target as HTMLInputElement).value || null })" /></label>
        <p v-if="job.appliedAt" class="small muted">Applied {{ new Date(job.appliedAt).toLocaleDateString() }}</p>
      </div>
    </div>

    <div class="panel" style="margin-top: 16px">
      <div class="row" style="justify-content: space-between">
        <strong>Job post</strong>
        <button @click="showFull = !showFull">{{ showFull ? 'Show less' : 'Show all' }}</button>
      </div>
      <div style="white-space: pre-wrap; margin-top: 8px" :style="showFull ? '' : 'max-height: 220px; overflow: hidden'">{{ job.description }}</div>
    </div>

    <div class="panel">
      <div class="row" style="justify-content: space-between">
        <h2 style="margin: 0">Tailored resume</h2>
        <div class="row">
          <label class="row small" style="display: flex"><input v-model="withLetter" type="checkbox" /> Claude writes the cover letter too</label>
          <button class="primary" :disabled="tailoring" @click="tailor(true)">{{ tailoring ? 'Writing and checking... (up to a minute)' : tailored.length ? 'Write a new version' : 'Tailor my resume for this job' }}</button>
          <button :disabled="tailoring" title="Free: picks and orders your own bullets for this job with plain code, no AI call" @click="tailor(false)">Draft from my profile (no AI)</button>
        </div>
      </div>
      <div v-if="tailored.length > 1" class="row small" style="margin-top: 8px">
        Versions:
        <button v-for="(t, i) in tailored" :key="t.id" :class="{ primary: selected === t.id }" @click="selected = t.id">{{ tailored.length - i }} · {{ t.status }}</button>
      </div>
    </div>
    <TailorEditor v-if="selected" :key="selected" :tailored-id="selected" @changed="load" />

    <div class="panel">
      <strong>History</strong>
      <ul class="small"><li v-for="(e, i) in events" :key="i"><span class="muted">{{ new Date(e.created_at).toLocaleString() }}</span> {{ e.kind === 'status' ? `Moved to ${e.detail}` : e.detail }}</li></ul>
      <button class="danger" @click="remove">Delete job</button>
    </div>
    <div v-if="message" class="toast">{{ message }}</div>
  </div>
  <p v-else class="muted">Loading...</p>
</template>
