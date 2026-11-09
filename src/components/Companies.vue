<script setup lang="ts">
import { onMounted, ref } from 'vue'

import { api, scoreClass } from './api'

const blank = () => ({ name: '', website: '', careersUrl: '', industry: '', size: '', stage: '', location: '', stack: '', notes: '', status: 'watching', watchJobs: true })
const companies = ref<any[]>([])
const form = ref<any>(blank())
const editing = ref<string | null>(null)
const bulk = ref('')
const message = ref('')

async function load() { companies.value = await api('/api/companies') }
onMounted(load)
function toast(text: string) { message.value = text; setTimeout(() => (message.value = ''), 5000) }

async function save() {
  try {
    if (editing.value) await api(`/api/companies/${editing.value}`, { method: 'PUT', body: form.value })
    else await api('/api/companies', { body: form.value })
    form.value = blank(); editing.value = null
    await load()
    toast('Saved. If the careers link is a Greenhouse, Lever, Ashby, Recruitee or Breezy board, its jobs are pulled on the next fetch.')
  } catch (e) { toast((e as Error).message) }
}
function edit(c: any) {
  editing.value = c.id
  form.value = { name: c.name, website: c.website, careersUrl: c.careersUrl, industry: c.industry, size: c.size, stage: c.stage, location: c.location, stack: c.stack, notes: c.notes, status: c.status, watchJobs: c.watchJobs }
  window.scrollTo({ top: 0, behavior: 'smooth' })
}
async function remove(c: any) { if (confirm(`Remove ${c.name}?`)) { await api(`/api/companies/${c.id}`, { method: 'DELETE' }); await load() } }

/** One company per line: name, careers link, industry, size, stack (stack items separated by ;). */
async function importBulk() {
  const list = bulk.value.split('\n').map((l) => l.trim()).filter(Boolean).map((line) => {
    const [name = '', careersUrl = '', industry = '', size = '', stack = ''] = line.split(',').map((s) => s.trim())
    return { ...blank(), name, careersUrl, industry, size: ['solo', 'startup', 'scaleup', 'midsize', 'enterprise'].includes(size) ? size : '', stack: stack.replace(/;/g, ',') }
  })
  try { const res = await api('/api/companies', { body: { companies: list } }); bulk.value = ''; await load(); toast(`${res.ids.length} companies added.`) }
  catch (e) { toast((e as Error).message) }
}
</script>

<template>
  <div>
    <div class="panel">
      <h2 style="margin-top: 0">{{ editing ? 'Edit company' : 'Add a company to watch or pitch' }}</h2>
      <div class="grid">
        <label>Name <input v-model="form.name" /></label>
        <label>Website <input v-model="form.website" /></label>
        <label>Careers page link <input v-model="form.careersUrl" placeholder="https://jobs.lever.co/acme" /></label>
        <label>Industry <input v-model="form.industry" placeholder="fintech" /></label>
        <label>Size <select v-model="form.size"><option value="">unknown</option><option>solo</option><option>startup</option><option>scaleup</option><option>midsize</option><option>enterprise</option></select></label>
        <label>Stage <input v-model="form.stage" placeholder="seed, series A" /></label>
        <label>Location <input v-model="form.location" /></label>
        <label>Their stack (comma separated) <input v-model="form.stack" placeholder="vue, node, cloudflare" /></label>
        <label>Status <select v-model="form.status"><option>watching</option><option>pitched</option><option>talking</option><option>client</option><option>not-a-fit</option></select></label>
      </div>
      <label style="margin-top: 8px">Notes, angle to pitch <textarea v-model="form.notes"></textarea></label>
      <label class="row small" style="display: flex; margin-top: 8px"><input v-model="form.watchJobs" type="checkbox" /> Pull their open jobs on every fetch</label>
      <div class="row" style="margin-top: 8px"><button class="primary" :disabled="!form.name" @click="save">Save</button><button v-if="editing" @click="editing = null; form = blank()">Cancel</button></div>
    </div>

    <details class="panel">
      <summary><strong>Add many at once</strong></summary>
      <p class="small muted">One per line: name, careers link, industry, size, stack (stack items separated by ;). Example: Acme, https://jobs.ashbyhq.com/acme, fintech, startup, vue;node</p>
      <textarea v-model="bulk" style="min-height: 140px"></textarea>
      <button style="margin-top: 8px" @click="importBulk">Import</button>
    </details>

    <div class="panel">
      <table>
        <thead><tr><th>Fit</th><th>Company</th><th>Why</th><th>Jobs</th><th>Status</th><th></th></tr></thead>
        <tbody>
          <tr v-for="c in companies" :key="c.id">
            <td><span class="score" :class="scoreClass(c.fit)">{{ c.fit ?? '-' }}</span></td>
            <td><strong>{{ c.name }}</strong> <span v-if="c.source && c.source !== 'manual'" class="chip small">{{ c.source === 'yc' ? 'YC startup' : 'from a job post' }}</span><div class="small muted">{{ [c.industry, c.teamSize ? `${c.teamSize} people` : c.size, c.stage].filter(Boolean).join(' · ') }}</div><div v-if="c.ats" class="small"><span class="chip good">{{ c.ats }}: {{ c.atsToken }}</span></div><div v-else-if="c.source === 'yc'" class="small muted">{{ c.probedAt ? 'no public job board found, good one to pitch directly' : 'job board not looked for yet' }}</div><div v-else-if="c.careersUrl" class="small muted">careers page not a known ATS, add jobs by hand</div><a v-if="c.website" class="small" :href="c.website" target="_blank" rel="noopener">{{ c.website.replace(/^https?:\/\//, '') }}</a></td>
            <td class="small">{{ c.reasons.join('; ') }}<div v-if="c.notes" class="muted">{{ c.notes }}</div></td>
            <td><a :href="`/jobs?q=${encodeURIComponent(c.name)}`">{{ c.openJobs ?? 0 }}</a></td>
            <td>{{ c.status }}</td>
            <td class="row"><button @click="edit(c)">Edit</button><button class="danger" @click="remove(c)">×</button></td>
          </tr>
        </tbody>
      </table>
      <p v-if="!companies.length" class="muted">No companies yet.</p>
    </div>
    <div v-if="message" class="toast">{{ message }}</div>
  </div>
</template>
