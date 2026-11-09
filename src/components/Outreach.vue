<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { api, scoreClass } from './api'

const targets = ref<any[]>([])
const pitches = ref<any[]>([])
const templates = ref<any[]>([])
const message = ref('')
const busy = ref<string | null>(null)
const choice = ref<Record<string, { templateId: string; firstName: string }>>({})
const today = new Date().toISOString().slice(0, 10)
const blankTemplate = () => ({ id: '', name: '', kind: 'pitch', subject: '', body: '' })
const form = ref<any>(blankTemplate())

async function load() {
  const [p, t] = await Promise.all([api('/api/pitches'), api('/api/templates')])
  targets.value = p.targets
  pitches.value = p.pitches
  templates.value = t
  for (const c of targets.value) choice.value[c.id] ??= { templateId: pitchTemplates.value[0]?.id ?? '', firstName: '' }
}
onMounted(load)
function toast(text: string) { message.value = text; setTimeout(() => (message.value = ''), 6000) }

const pitchTemplates = computed(() => templates.value.filter((t) => t.kind === 'pitch'))
const drafts = computed(() => pitches.value.filter((p) => p.status === 'draft'))
const sent = computed(() => pitches.value.filter((p) => p.status === 'sent'))
const done = computed(() => pitches.value.filter((p) => p.status === 'replied' || p.status === 'no-reply'))
const errors = (p: any) => (p.checks ?? []).filter((c: any) => c.severity === 'error')
const mailto = (p: any) => `mailto:${encodeURIComponent(p.toEmail)}?subject=${encodeURIComponent(p.subject)}&body=${encodeURIComponent(p.body)}`

async function findEmail(c: any) {
  busy.value = c.id
  try {
    const res = await api(`/api/companies/${c.id}/contact`, { body: {} })
    c.contactEmail = res.email
    toast(res.email ? `Found ${res.email}${res.others.length ? ` (also ${res.others.join(', ')})` : ''}` : 'No address on their site. Try their LinkedIn or the founder on X, then type it in.')
  } catch (e) { toast((e as Error).message) }
  busy.value = null
}
async function setEmail(c: any, email: string) {
  try { await api(`/api/companies/${c.id}/contact`, { body: { email: email.trim() } }); c.contactEmail = email.trim() } catch (e) { toast((e as Error).message) }
}

async function draft(c: any, withClaude: boolean) {
  busy.value = c.id
  try {
    const pick = choice.value[c.id]!
    const res = await api('/api/pitches', { body: { companyId: c.id, firstName: pick.firstName, ...(withClaude ? {} : { templateId: pick.templateId }) } })
    toast(errors(res).length ? 'Drafted, but some checks fail. Fix them below.' : 'Drafted. Read it, then open it in your email.')
    await load()
  } catch (e) { toast((e as Error).message) }
  busy.value = null
}

async function update(p: any, patch: Record<string, unknown>) {
  try {
    const res = await api(`/api/pitches/${p.id}`, { method: 'PUT', body: { toEmail: p.toEmail, subject: p.subject, body: p.body, ...patch } })
    Object.assign(p, res.pitch)
    if (patch.status === 'sent') toast('Marked sent. It shows up for a follow-up in a few days.')
    else if (!patch.status) toast(errors(res.pitch).length ? 'Saved. Some checks still fail.' : 'Saved. Every check passes.')
    if (patch.status) await load()
  } catch (e) { toast((e as Error).message); await load() }
}
async function removePitch(p: any) { if (confirm(`Delete this pitch to ${p.company}?`)) { await api(`/api/pitches/${p.id}`, { method: 'DELETE' }); await load() } }

async function saveTemplate() {
  try {
    const { id, ...body } = form.value
    if (id) await api(`/api/templates/${id}`, { method: 'PUT', body })
    else await api('/api/templates', { body })
    form.value = blankTemplate()
    toast('Template saved. It passed the same checks as a cover letter.')
    await load()
  } catch (e) { toast((e as Error).message) }
}
async function removeTemplate(t: any) { if (confirm(`Delete "${t.name}"?`)) { await api(`/api/templates/${t.id}`, { method: 'DELETE' }); await load() } }
</script>

<template>
  <div>
    <div class="panel">
      <h2 style="margin-top: 0">Startups to pitch ({{ targets.length }})</h2>
      <p class="small muted">Companies on your list with no public job board. Small startups often hire a contractor without posting a job. Find an address, draft from a template (free) or with Claude (about a cent), then send it from your own email. Nothing is sent from here.</p>
      <table>
        <thead><tr><th>Fit</th><th>Company</th><th>Contact</th><th>Draft</th></tr></thead>
        <tbody>
          <tr v-for="c in targets" :key="c.id">
            <td><span class="score" :class="scoreClass(c.fit)">{{ c.fit ?? '-' }}</span></td>
            <td><strong>{{ c.name }}</strong><div class="small muted">{{ [c.industry, c.teamSize ? `${c.teamSize} people` : c.size, c.stage].filter(Boolean).join(' · ') }}</div>
              <a class="small" :href="c.website" target="_blank" rel="noopener">{{ c.website.replace(/^https?:\/\//, '') }}</a>
              <div v-if="c.notes" class="small muted">{{ c.notes.slice(0, 160) }}</div></td>
            <td style="min-width: 200px">
              <input :value="c.contactEmail" placeholder="email" @change="setEmail(c, ($event.target as HTMLInputElement).value)" />
              <button class="small" :disabled="busy === c.id" style="margin-top: 4px" @click="findEmail(c)">Find on their site</button>
              <input v-model="choice[c.id]!.firstName" placeholder="first name (optional)" style="margin-top: 4px" />
            </td>
            <td style="min-width: 220px">
              <div v-if="pitchTemplates.length" class="row small">
                <select v-model="choice[c.id]!.templateId" style="max-width: 160px"><option v-for="t in pitchTemplates" :key="t.id" :value="t.id">{{ t.name }}</option></select>
                <button :disabled="busy === c.id || !choice[c.id]!.templateId" @click="draft(c, false)">From template</button>
              </div>
              <button class="small" style="margin-top: 4px" :disabled="busy === c.id" @click="draft(c, true)">{{ busy === c.id ? 'Working...' : 'Write with Claude' }}</button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="!targets.length" class="muted">No companies to pitch yet. Startups without a job board show up here after a fetch, or add some on <a href="/companies">Companies</a> with their website.</p>
    </div>

    <div v-if="drafts.length" class="panel">
      <h2 style="margin-top: 0">Drafts ({{ drafts.length }})</h2>
      <div v-for="p in drafts" :key="p.id" class="panel" style="background: var(--bg)">
        <div class="row" style="justify-content: space-between"><strong>{{ p.company }}</strong><span class="small muted">written from {{ p.writtenBy }}</span></div>
        <div class="grid" style="grid-template-columns: 1fr 2fr; margin-top: 6px">
          <label>To <input v-model="p.toEmail" /></label>
          <label>Subject <input v-model="p.subject" /></label>
        </div>
        <textarea v-model="p.body" style="min-height: 180px; margin-top: 6px"></textarea>
        <ul class="issues small"><li v-for="(c, i) in p.checks" :key="i" :class="c.severity"><strong>{{ c.where }}:</strong> {{ c.message }}</li></ul>
        <div class="row small">
          <button @click="update(p, {})">Save and check</button>
          <a class="button" :class="{ primary: !errors(p).length }" :href="mailto(p)">Open in my email</a>
          <button class="primary" :disabled="errors(p).length > 0 || !p.toEmail" :title="errors(p).length ? 'Fix the errors first' : ''" @click="update(p, { status: 'sent' })">I sent it</button>
          <button class="danger" @click="removePitch(p)">Delete</button>
        </div>
      </div>
    </div>

    <div v-if="sent.length" class="panel">
      <h2 style="margin-top: 0">Waiting for a reply ({{ sent.length }})</h2>
      <table>
        <thead><tr><th>Company</th><th>Sent</th><th>Follow up</th><th></th></tr></thead>
        <tbody>
          <tr v-for="p in sent" :key="p.id">
            <td><strong>{{ p.company }}</strong><div class="small muted">{{ p.toEmail }} · {{ p.subject }}</div></td>
            <td class="small">{{ p.sentAt?.slice(0, 10) }}</td>
            <td><input type="date" :value="p.followUpAt" :class="{ due: p.followUpAt && p.followUpAt <= today }" @change="update(p, { followUpAt: ($event.target as HTMLInputElement).value || null })" /></td>
            <td class="row small"><button class="primary" @click="update(p, { status: 'replied' })">They replied</button><button @click="update(p, { status: 'no-reply' })">No reply</button></td>
          </tr>
        </tbody>
      </table>
    </div>

    <details v-if="done.length" class="panel">
      <summary><strong>Finished ({{ done.length }})</strong></summary>
      <ul class="small"><li v-for="p in done" :key="p.id">{{ p.company }}: {{ p.status === 'replied' ? 'replied' : 'no reply' }} <span class="muted">(sent {{ p.sentAt?.slice(0, 10) }})</span></li></ul>
    </details>

    <div id="templates" class="panel">
      <h2 style="margin-top: 0">Saved letters and pitches</h2>
      <p class="small muted">Your own text, reused without an AI call. Placeholders: <code v-pre>{{company}}</code>, <code v-pre>{{role}}</code> (job title), <code v-pre>{{greeting}}</code> ("Hi Anna," or "Hi,"), <code v-pre>{{first_name}}</code>. A template is checked like a cover letter when you save it, and again each time it is filled in.</p>
      <ul class="small">
        <li v-for="t in templates" :key="t.id"><span class="chip">{{ t.kind }}</span> <strong>{{ t.name }}</strong>
          <button class="small" @click="form = { ...t }">Edit</button> <button class="small danger" @click="removeTemplate(t)">×</button></li>
      </ul>
      <div class="grid">
        <label>Name <input v-model="form.name" placeholder="Short startup pitch" /></label>
        <label>Kind <select v-model="form.kind"><option value="pitch">pitch (email to a company)</option><option value="letter">letter (cover letter or proposal)</option></select></label>
        <label v-if="form.kind === 'pitch'">Subject <input v-model="form.subject" placeholder="Vue and Node contractor for {{company}}" /></label>
      </div>
      <textarea v-model="form.body" style="min-height: 180px; margin-top: 8px" placeholder="{{greeting}}&#10;&#10;..."></textarea>
      <div class="row" style="margin-top: 8px"><button class="primary" :disabled="!form.name || !form.body" @click="saveTemplate">{{ form.id ? 'Save changes' : 'Save template' }}</button><button v-if="form.id" @click="form = blankTemplate()">Cancel</button></div>
    </div>
    <div v-if="message" class="toast">{{ message }}</div>
  </div>
</template>
