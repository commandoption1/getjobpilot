<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

import { wordDiff } from '../core/diff'
import { api, csv, fromCsv } from './api'

const props = defineProps<{ tailoredId: string }>()
const emit = defineEmits<{ (e: 'changed'): void }>()

const record = ref<any>(null)
const profile = ref<any>(null)
const resume = ref<any>(null)
const checks = ref<any[]>([])
const coverage = ref<any>(null)
const busy = ref(false)
const message = ref('')
const showDiff = ref(true)
const letters = ref<any[]>([])
const paper = ref(localStorage.getItem('jobpilot:paper') ?? 'a4')
watch(paper, (v) => localStorage.setItem('jobpilot:paper', v))
const letterId = ref('')
const letterName = ref('')

async function load() {
  record.value = await api(`/api/tailored/${props.tailoredId}`)
  profile.value = (await api(`/api/profile?version=${record.value.profileVersion}`)).profile
  resume.value = JSON.parse(JSON.stringify(record.value.resume))
  checks.value = record.value.checks
  coverage.value = record.value.coverage
  letters.value = (await api('/api/templates')).filter((t: any) => t.kind === 'letter')
}

/** Puts a saved letter, filled in for this job, in the cover letter box and runs the checks. No AI call. */
async function useLetter() {
  if (!letterId.value) return
  try {
    const res = await api(`/api/jobs/${record.value.jobId}/letter`, { body: { templateId: letterId.value, firstName: letterName.value.trim() } })
    resume.value.coverLetter = res.text
    if (res.missing.length) toast(`Fill in by hand: ${res.missing.map((m: string) => `{{${m}}}`).join(', ')}`)
    else await save(false)
  } catch (e) { toast((e as Error).message) }
}
onMounted(load)
watch(() => props.tailoredId, load)

const errors = computed(() => checks.value.filter((c) => c.severity === 'error'))
const warnings = computed(() => checks.value.filter((c) => c.severity === 'warning'))
const sourceText = (ids: string[]) => {
  const all = [...(profile.value?.experience ?? []), ...(profile.value?.projects ?? [])].flatMap((x: any) => x.bullets)
  return ids.map((id) => all.find((b: any) => b.id === id)?.text ?? '').filter(Boolean).join(' ')
}
const job = (id: string) => profile.value?.experience.find((e: any) => e.id === id)
const project = (id: string) => profile.value?.projects.find((p: any) => p.id === id)

/** Bullets the user could add back: every bullet of that job not used yet. */
const unused = (expId: string, used: any[], kind: 'experience' | 'project') => {
  const source = kind === 'experience' ? job(expId) : project(expId)
  const taken = new Set(used.flatMap((b: any) => b.sourceIds))
  return (source?.bullets ?? []).filter((b: any) => !taken.has(b.id))
}

function toast(text: string) {
  message.value = text
  setTimeout(() => (message.value = ''), 5000)
}

async function save(approve: boolean) {
  busy.value = true
  try {
    const res = await api(`/api/tailored/${props.tailoredId}`, { method: 'PUT', body: { resume: resume.value, approve } })
    checks.value = res.checks
    coverage.value = res.coverage
    record.value.status = res.status
    toast(approve ? 'Approved. The print view and the extension now use this version.' : res.checks.some((c: any) => c.severity === 'error') ? 'Saved. Some checks still fail.' : 'Saved. All checks pass.')
    emit('changed')
  } catch (e) {
    toast((e as Error).message)
    const fresh = await api(`/api/tailored/${props.tailoredId}`)
    checks.value = fresh.checks
  }
  busy.value = false
}

const move = (list: any[], i: number, d: number) => { const j = i + d; if (j >= 0 && j < list.length) [list[i], list[j]] = [list[j], list[i]] }
</script>

<template>
  <div v-if="resume && profile">
    <div class="row" style="justify-content: space-between">
      <div>
        <span class="chip" :class="record.status === 'approved' ? 'good' : ''">{{ record.status }}</span>
        <span class="small muted">{{ record.model === 'none' ? 'drafted without AI' : `written by ${record.model}` }} from profile version {{ record.profileVersion }}</span>
      </div>
      <div class="row">
        <label class="row small" style="display: flex"><input v-model="showDiff" type="checkbox" /> Show changes</label>
        <select v-model="paper" style="width: 90px" title="Paper size"><option value="a4">A4</option><option value="letter">Letter</option></select>
        <a v-if="record.status === 'approved'" class="button primary" :href="`/resume/${record.id}.pdf?paper=${paper}`">Download PDF</a>
        <a v-if="record.status === 'approved' && resume.coverLetter.trim()" class="button" :href="`/resume/${record.id}.pdf?part=letter&paper=${paper}`">Download cover letter</a>
        <span v-if="record.status !== 'approved'" class="small muted">Approve to download the PDF</span>
        <a class="small" :href="`/resume/${record.id}`" target="_blank">Preview</a>
        <button :disabled="busy" @click="save(false)">Save and check</button>
        <button class="primary" :disabled="busy || errors.length > 0" :title="errors.length ? 'Fix the errors first' : ''" @click="save(true)">Approve</button>
      </div>
    </div>

    <div class="grid" style="margin-top: 12px; grid-template-columns: 1fr 1fr">
      <div class="panel" style="margin: 0">
        <strong>Checks</strong>
        <p v-if="!checks.length" class="small" style="color: var(--good)">Every check passes: no invented numbers or skills, no banned phrases.</p>
        <ul class="issues small">
          <li v-for="(c, i) in errors" :key="'e' + i" class="error"><strong>{{ c.where }}:</strong> {{ c.message }}</li>
          <li v-for="(c, i) in warnings" :key="'w' + i" class="warning"><strong>{{ c.where }}:</strong> {{ c.message }}</li>
        </ul>
      </div>
      <div v-if="coverage" class="panel" style="margin: 0">
        <strong>Keyword coverage: {{ Math.round(coverage.ratio * 100) }}%</strong>
        <div class="small" style="margin-top: 6px">
          <span v-for="k in coverage.matched" :key="k" class="chip good">{{ k }}</span>
          <span v-for="k in coverage.missing" :key="'m' + k" class="chip bad">{{ k }}</span>
        </div>
        <p class="small muted">Red ones are in the post but not on this resume. Add them only if you really have them, through your profile.</p>
      </div>
    </div>

    <div class="panel" style="margin-top: 12px">
      <label>Headline <input v-model="resume.headline" /></label>
      <label style="margin-top: 8px">Summary <textarea v-model="resume.summary"></textarea></label>
      <div v-if="showDiff && profile.summary" class="small diff muted" style="margin-top: 4px">
        <template v-for="(p, i) in wordDiff(profile.summary, resume.summary)" :key="i"><ins v-if="p.kind === 'added'">{{ p.text }}</ins><del v-else-if="p.kind === 'removed'">{{ p.text }}</del><span v-else>{{ p.text }}</span></template>
      </div>
    </div>

    <div v-for="(item, ei) in resume.experience" :key="item.experienceId" class="panel">
      <div class="row" style="justify-content: space-between">
        <div><strong>{{ job(item.experienceId)?.title }}</strong>, {{ job(item.experienceId)?.company }}</div>
        <div class="row"><button @click="move(resume.experience, ei, -1)">↑</button><button @click="move(resume.experience, ei, 1)">↓</button><button class="danger" @click="resume.experience.splice(ei, 1)">Leave out</button></div>
      </div>
      <div v-for="(b, bi) in item.bullets" :key="bi" style="margin-top: 8px">
        <textarea v-model="b.text"></textarea>
        <div v-if="showDiff" class="small diff muted">
          <template v-for="(p, i) in wordDiff(sourceText(b.sourceIds), b.text)" :key="i"><ins v-if="p.kind === 'added'">{{ p.text }}</ins><del v-else-if="p.kind === 'removed'">{{ p.text }}</del><span v-else>{{ p.text }}</span></template>
        </div>
        <div class="row small"><button @click="move(item.bullets, bi, -1)">↑</button><button @click="move(item.bullets, bi, 1)">↓</button><button class="danger" @click="item.bullets.splice(bi, 1)">Remove</button><button @click="b.text = sourceText(b.sourceIds)">Use my original</button></div>
      </div>
      <div v-if="unused(item.experienceId, item.bullets, 'experience').length" class="small" style="margin-top: 8px">
        Add back:
        <button v-for="u in unused(item.experienceId, item.bullets, 'experience')" :key="u.id" class="small" style="margin: 2px" :title="u.text" @click="item.bullets.push({ sourceIds: [u.id], text: u.text })">{{ u.text.slice(0, 50) }}...</button>
      </div>
    </div>
    <div class="panel small">
      Jobs not on this version:
      <button v-for="e in profile.experience.filter((x: any) => !resume.experience.some((r: any) => r.experienceId === x.id))" :key="e.id" style="margin: 2px" @click="resume.experience.push({ experienceId: e.id, bullets: e.bullets.slice(0, 2).map((b: any) => ({ sourceIds: [b.id], text: b.text })) })">{{ e.title }}, {{ e.company }}</button>
    </div>

    <div v-for="(item, pi) in resume.projects" :key="item.projectId" class="panel">
      <div class="row" style="justify-content: space-between"><strong>{{ project(item.projectId)?.name }}</strong><button class="danger" @click="resume.projects.splice(pi, 1)">Leave out</button></div>
      <div v-for="(b, bi) in item.bullets" :key="bi" style="margin-top: 8px">
        <textarea v-model="b.text"></textarea>
        <div class="row small"><button class="danger" @click="item.bullets.splice(bi, 1)">Remove</button><button @click="b.text = sourceText(b.sourceIds)">Use my original</button></div>
      </div>
    </div>

    <div class="panel">
      <label>Skills, most relevant first (comma separated) <input :value="csv(resume.skills)" @change="resume.skills = fromCsv(($event.target as HTMLInputElement).value)" /></label>
    </div>
    <div class="panel">
      <label>Cover letter or proposal <textarea v-model="resume.coverLetter" style="min-height: 220px"></textarea></label>
      <div class="row small" style="margin-top: 6px">
        <template v-if="letters.length">
          Use a saved letter:
          <select v-model="letterId" style="max-width: 220px"><option value="">choose...</option><option v-for="l in letters" :key="l.id" :value="l.id">{{ l.name }}</option></select>
          <input v-model="letterName" placeholder="contact first name (optional)" style="max-width: 200px" />
          <button :disabled="!letterId" @click="useLetter">Fill in</button>
        </template>
        <span v-else class="muted">Save letters you like on the <a href="/outreach#templates">Outreach</a> page to reuse them here without an AI call.</span>
      </div>
      <p class="small muted">{{ resume.coverLetter.split(/\s+/).filter(Boolean).length }} words</p>
    </div>
    <div v-if="message" class="toast">{{ message }}</div>
  </div>
  <p v-else class="muted">Loading...</p>
</template>
