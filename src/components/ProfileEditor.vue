<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { api, csv, fromCsv } from './api'

type Bullet = { id: string; text: string; skills: string[]; tags: string[] }
const uid = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 8)}`

const profile = ref<any>(null)
const versions = ref<{ id: number; note: string; createdAt: string }[]>([])
const problems = ref<string[]>([])
const versionId = ref(0)
const note = ref('')
const saving = ref(false)
const message = ref('')
const showJson = ref(false)
const jsonText = ref('')
const dirty = ref(false)

async function load(version?: number) {
  const data = await api(`/api/profile${version ? `?version=${version}` : ''}`)
  profile.value = data.profile
  problems.value = data.problems
  versionId.value = data.id
  versions.value = await api('/api/profile/versions')
  dirty.value = false
}
onMounted(() => load())

function toast(text: string) {
  message.value = text
  setTimeout(() => (message.value = ''), 4000)
}

async function save() {
  saving.value = true
  try {
    const res = await api('/api/profile', { method: 'PUT', body: { profile: profile.value, note: note.value } })
    problems.value = res.problems
    note.value = ''
    await load()
    toast(res.problems.length ? 'Saved, but see the problems listed at the top.' : `Saved as version ${res.id}. ${res.rescored} jobs scored again.`)
  } catch (e) {
    toast((e as Error).message)
  } finally {
    saving.value = false
  }
}

async function restore(id: number) {
  if (!confirm(`Make version ${id} the current profile? Your current version stays in the history.`)) return
  await api('/api/profile/versions', { body: { id } })
  await load()
  toast(`Version ${id} restored.`)
}

function openJson() {
  jsonText.value = JSON.stringify(profile.value, null, 2)
  showJson.value = true
}
function applyJson() {
  try {
    profile.value = JSON.parse(jsonText.value)
    showJson.value = false
    dirty.value = true
    toast('Loaded. Check it, then press Save.')
  } catch (e) {
    toast(`That isn't valid JSON: ${(e as Error).message}`)
  }
}

const touch = () => (dirty.value = true)
const move = (list: any[], i: number, d: number) => {
  const j = i + d
  if (j < 0 || j >= list.length) return
  ;[list[i], list[j]] = [list[j], list[i]]
  touch()
}
const remove = (list: any[], i: number, what: string) => {
  if (confirm(`Remove this ${what}?`)) { list.splice(i, 1); touch() }
}
const addExperience = () => { profile.value.experience.unshift({ id: uid('exp'), company: '', title: '', location: '', engagement: 'contract', start: '', end: 'present', context: '', stack: [], bullets: [] }); touch() }
const addProject = () => { profile.value.projects.push({ id: uid('proj'), name: '', url: '', description: '', stack: [], bullets: [] }); touch() }
const addBullet = (list: Bullet[]) => { list.push({ id: uid('b'), text: '', skills: [], tags: [] }); touch() }
const addSkill = () => { profile.value.skills.push({ name: '', level: 'strong', aliases: [] }); touch() }
const addEducation = () => { profile.value.education.push({ id: uid('edu'), school: '', degree: '', field: '', start: '', end: '' }); touch() }
const addCert = () => { profile.value.certifications.push({ id: uid('cert'), name: '', issuer: '', year: '' }); touch() }
const addLanguage = () => { profile.value.languages.push({ name: '', level: '' }); touch() }

const prefs = computed(() => profile.value?.preferences)
const engagementOptions = ['contract', 'freelance', 'full-time', 'part-time']
const sizeOptions = ['solo', 'startup', 'scaleup', 'midsize', 'enterprise']
const toggle = (list: string[], value: string) => { const i = list.indexOf(value); i === -1 ? list.push(value) : list.splice(i, 1); touch() }
</script>

<template>
  <div v-if="profile" @input="touch">
    <div class="panel row" style="justify-content: space-between">
      <div>
        <strong>Version {{ versionId || 'none yet' }}</strong>
        <span class="muted small"> · every save keeps the old version, so you can always go back</span>
      </div>
      <div class="row">
        <input v-model="note" placeholder="What changed? (optional)" style="width: 240px" />
        <button class="primary" :disabled="saving" @click="save">{{ saving ? 'Saving...' : dirty ? 'Save changes' : 'Save' }}</button>
        <button @click="openJson">Import / export JSON</button>
      </div>
    </div>

    <div v-if="problems.length" class="panel">
      <strong>Fix these before tailoring:</strong>
      <ul class="issues"><li v-for="p in problems" :key="p" class="error">{{ p }}</li></ul>
    </div>

    <div v-if="showJson" class="panel">
      <p class="small muted">Paste a whole profile here to replace the form, or copy it out as a backup.</p>
      <textarea v-model="jsonText" style="min-height: 320px; font-family: ui-monospace, monospace; font-size: 12px"></textarea>
      <div class="row" style="margin-top: 8px"><button class="primary" @click="applyJson">Load into form</button><button @click="showJson = false">Close</button></div>
    </div>

    <section class="panel">
      <h2 style="margin-top: 0">Basics</h2>
      <div class="grid">
        <label>Full name <input v-model="profile.basics.name" /></label>
        <label>Headline <input v-model="profile.basics.headline" placeholder="Full-stack engineer, Vue and Node" /></label>
        <label>Email <input v-model="profile.basics.email" type="email" /></label>
        <label>Phone <input v-model="profile.basics.phone" /></label>
        <label>Location <input v-model="profile.basics.location" placeholder="City, Country" /></label>
        <label>Website <input v-model="profile.basics.website" /></label>
        <label>GitHub <input v-model="profile.basics.github" /></label>
        <label>LinkedIn <input v-model="profile.basics.linkedin" placeholder="optional" /></label>
      </div>
      <label style="margin-top: 12px">Summary, in your own words (2 to 4 sentences)
        <textarea v-model="profile.summary"></textarea>
      </label>
    </section>

    <section class="panel">
      <div class="row" style="justify-content: space-between"><h2 style="margin: 0">Experience</h2><button @click="addExperience">Add job or contract</button></div>
      <p class="small muted">Newest first. Write every bullet as plainly and truthfully as you can, with real numbers where you have them. Tailoring can reword and choose bullets, but it can never add a number or skill that isn't here.</p>
      <div v-for="(job, i) in profile.experience" :key="job.id" class="panel" style="background: var(--bg)">
        <div class="grid">
          <label>Company or client <input v-model="job.company" /></label>
          <label>Your title <input v-model="job.title" /></label>
          <label>Type
            <select v-model="job.engagement"><option>employee</option><option>contract</option><option>freelance</option><option>founder</option></select>
          </label>
          <label>Location <input v-model="job.location" placeholder="Remote" /></label>
          <label>Start (YYYY-MM) <input v-model="job.start" placeholder="2023-04" /></label>
          <label>End (YYYY-MM or present) <input v-model="job.end" placeholder="present" /></label>
        </div>
        <label style="margin-top: 8px">One line about the company or client <input v-model="job.context" placeholder="Series A fintech, 40 people" /></label>
        <label style="margin-top: 8px">Stack (comma separated) <input :value="csv(job.stack)" @change="job.stack = fromCsv(($event.target as HTMLInputElement).value)" /></label>
        <h3>Bullets</h3>
        <div v-for="(b, bi) in job.bullets" :key="b.id" style="margin-bottom: 10px">
          <textarea v-model="b.text" placeholder="Rebuilt the checkout in Vue 3, cutting page load from 4.1s to 1.3s"></textarea>
          <div class="row small">
            <input :value="csv(b.skills)" placeholder="skills shown, e.g. vue, performance" style="flex: 1" @change="b.skills = fromCsv(($event.target as HTMLInputElement).value)" />
            <input :value="csv(b.tags)" placeholder="tags, e.g. fintech, leadership" style="flex: 1" @change="b.tags = fromCsv(($event.target as HTMLInputElement).value)" />
            <button @click="move(job.bullets, bi, -1)" title="Move up">↑</button><button @click="move(job.bullets, bi, 1)" title="Move down">↓</button>
            <button class="danger" @click="remove(job.bullets, bi, 'bullet')">Remove</button>
          </div>
        </div>
        <div class="row">
          <button @click="addBullet(job.bullets)">Add bullet</button>
          <span style="flex: 1"></span>
          <button @click="move(profile.experience, i, -1)">Move up</button><button @click="move(profile.experience, i, 1)">Move down</button>
          <button class="danger" @click="remove(profile.experience, i, 'job')">Remove job</button>
        </div>
      </div>
    </section>

    <section class="panel">
      <div class="row" style="justify-content: space-between"><h2 style="margin: 0">Projects and open source</h2><button @click="addProject">Add project</button></div>
      <div v-for="(p, i) in profile.projects" :key="p.id" class="panel" style="background: var(--bg); margin-top: 10px">
        <div class="grid">
          <label>Name <input v-model="p.name" /></label>
          <label>Link <input v-model="p.url" /></label>
          <label>Stack <input :value="csv(p.stack)" @change="p.stack = fromCsv(($event.target as HTMLInputElement).value)" /></label>
        </div>
        <label style="margin-top: 8px">What it is <input v-model="p.description" /></label>
        <div v-for="(b, bi) in p.bullets" :key="b.id" style="margin-top: 8px">
          <textarea v-model="b.text"></textarea>
          <div class="row small">
            <input :value="csv(b.skills)" placeholder="skills shown" style="flex: 1" @change="b.skills = fromCsv(($event.target as HTMLInputElement).value)" />
            <button class="danger" @click="remove(p.bullets, bi, 'bullet')">Remove</button>
          </div>
        </div>
        <div class="row" style="margin-top: 8px"><button @click="addBullet(p.bullets)">Add bullet</button><span style="flex: 1"></span><button class="danger" @click="remove(profile.projects, i, 'project')">Remove project</button></div>
      </div>
    </section>

    <section class="panel">
      <div class="row" style="justify-content: space-between"><h2 style="margin: 0">Skills</h2><button @click="addSkill">Add skill</button></div>
      <p class="small muted">Aliases are other names job posts use, e.g. "Workers" for "Cloudflare Workers". "Learning" skills are never put on a resume.</p>
      <table>
        <thead><tr><th>Skill</th><th>Level</th><th>Years</th><th>Aliases</th><th></th></tr></thead>
        <tbody>
          <tr v-for="(s, i) in profile.skills" :key="i">
            <td><input v-model="s.name" /></td>
            <td><select v-model="s.level"><option>strong</option><option>working</option><option>learning</option></select></td>
            <td><input v-model.number="s.years" type="number" min="0" style="width: 80px" /></td>
            <td><input :value="csv(s.aliases)" @change="s.aliases = fromCsv(($event.target as HTMLInputElement).value)" /></td>
            <td><button class="danger" @click="remove(profile.skills, i, 'skill')">×</button></td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="panel">
      <div class="row" style="justify-content: space-between"><h2 style="margin: 0">Education and certifications</h2><div class="row"><button @click="addEducation">Add education</button><button @click="addCert">Add certification</button></div></div>
      <div v-for="(e, i) in profile.education" :key="e.id" class="grid" style="margin-top: 10px">
        <label>School <input v-model="e.school" /></label><label>Degree <input v-model="e.degree" /></label><label>Field <input v-model="e.field" /></label>
        <label>Start <input v-model="e.start" /></label><label>End <input v-model="e.end" /></label>
        <label>&nbsp;<button class="danger" @click="remove(profile.education, i, 'entry')">Remove</button></label>
      </div>
      <div v-for="(c, i) in profile.certifications" :key="c.id" class="grid" style="margin-top: 10px">
        <label>Certification <input v-model="c.name" /></label><label>Issuer <input v-model="c.issuer" /></label><label>Year <input v-model="c.year" /></label>
        <label>&nbsp;<button class="danger" @click="remove(profile.certifications, i, 'certification')">Remove</button></label>
      </div>
    </section>

    <section class="panel">
      <div class="row" style="justify-content: space-between"><h2 style="margin: 0">Languages</h2><button @click="addLanguage">Add language</button></div>
      <div v-for="(l, i) in profile.languages" :key="i" class="row" style="margin-top: 8px">
        <input v-model="l.name" placeholder="English" style="width: 200px" /><input v-model="l.level" placeholder="Native, fluent, B2..." style="width: 200px" />
        <button class="danger" @click="remove(profile.languages, i, 'language')">×</button>
      </div>
    </section>

    <section class="panel">
      <h2 style="margin-top: 0">How you write</h2>
      <p class="small muted">Paste a few things you wrote yourself: an email to a client, a post, an old cover letter. The writer copies your rhythm and word choice from these, so drafts sound like you.</p>
      <div v-for="(s, i) in profile.writingSamples" :key="i" class="row" style="margin-bottom: 8px">
        <textarea v-model="profile.writingSamples[i]" style="flex: 1"></textarea>
        <button class="danger" @click="remove(profile.writingSamples, i, 'sample')">×</button>
      </div>
      <button @click="profile.writingSamples.push(''); touch()">Add sample</button>
    </section>

    <section v-if="prefs" class="panel">
      <h2 style="margin-top: 0">What you're looking for</h2>
      <div class="grid">
        <label>Target roles (comma separated) <input :value="csv(prefs.targetRoles)" @change="prefs.targetRoles = fromCsv(($event.target as HTMLInputElement).value)" /></label>
        <label>Currency <input v-model="prefs.currency" /></label>
        <label>Rate unit <select v-model="prefs.rateUnit"><option>hour</option><option>day</option></select></label>
        <label>Minimum rate <input v-model.number="prefs.minRate" type="number" min="0" /></label>
        <label>Target rate <input v-model.number="prefs.targetRate" type="number" min="0" /></label>
        <label>Minimum salary (full-time, yearly) <input v-model.number="prefs.minSalary" type="number" min="0" /></label>
        <label>Remote <select v-model="prefs.remote"><option value="remote-only">Remote only</option><option value="remote-or-hybrid">Remote or hybrid</option><option value="any">Any</option></select></label>
        <label>Your time zone <input v-model="prefs.timezone" placeholder="UTC+3" /></label>
        <label>Hours of overlap you can do <input v-model.number="prefs.overlapHours" type="number" min="0" max="24" /></label>
        <label>Where you can legally work <input :value="csv(prefs.workRights)" @change="prefs.workRights = fromCsv(($event.target as HTMLInputElement).value)" /></label>
        <label>Countries you want most <input :value="csv(prefs.targetCountries ?? [])" placeholder="Singapore, Japan, Australia" @change="prefs.targetCountries = fromCsv(($event.target as HTMLInputElement).value)" /></label>
        <label>Countries to leave out <input :value="csv(prefs.avoidCountries ?? [])" placeholder="India, China" @change="prefs.avoidCountries = fromCsv(($event.target as HTMLInputElement).value)" /></label>
        <label>Industries you like <input :value="csv(prefs.industries)" @change="prefs.industries = fromCsv(($event.target as HTMLInputElement).value)" /></label>
        <label>Industries to avoid <input :value="csv(prefs.avoidIndustries)" @change="prefs.avoidIndustries = fromCsv(($event.target as HTMLInputElement).value)" /></label>
        <label>Never show jobs containing <input :value="csv(prefs.excludeKeywords)" placeholder="unpaid, commission only" @change="prefs.excludeKeywords = fromCsv(($event.target as HTMLInputElement).value)" /></label>
      </div>
      <h3>Work types, in order of preference</h3>
      <div class="row"><label v-for="o in engagementOptions" :key="o" class="row" style="display: flex"><input type="checkbox" :checked="prefs.engagements.includes(o)" @change="toggle(prefs.engagements, o)" /> {{ o }}</label></div>
      <p class="small muted">Order: {{ prefs.engagements.join(' > ') || 'none' }}. Untick and tick again to move one to the end.</p>
      <h3>Company sizes</h3>
      <div class="row"><label v-for="o in sizeOptions" :key="o" class="row" style="display: flex"><input type="checkbox" :checked="prefs.companySizes.includes(o)" @change="toggle(prefs.companySizes, o)" /> {{ o }}</label></div>
    </section>

    <section class="panel">
      <h2 style="margin-top: 0">History</h2>
      <table>
        <thead><tr><th>Version</th><th>Saved</th><th>Note</th><th></th></tr></thead>
        <tbody>
          <tr v-for="v in versions" :key="v.id">
            <td>{{ v.id }}<span v-if="v.id === versionId" class="chip">current</span></td>
            <td class="small">{{ new Date(v.createdAt).toLocaleString() }}</td>
            <td class="small">{{ v.note }}</td>
            <td><button v-if="v.id !== versionId" @click="restore(v.id)">Restore</button></td>
          </tr>
        </tbody>
      </table>
    </section>

    <div class="row"><button class="primary" :disabled="saving" @click="save">Save changes</button><a class="button" href="/resume/base" target="_blank">See base resume</a><a class="button" href="/resume/base.pdf">Download base resume PDF</a></div>
    <div v-if="message" class="toast">{{ message }}</div>
  </div>
  <p v-else class="muted">Loading your profile...</p>
</template>
