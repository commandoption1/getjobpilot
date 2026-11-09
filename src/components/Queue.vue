<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { api, money, scoreClass } from './api'

const data = ref<any>(null)
const hidden = ref<Set<string>>(new Set())
const message = ref('')

async function load() { data.value = await api('/api/routine/queue') }
onMounted(load)
function toast(text: string) { message.value = text; setTimeout(() => (message.value = ''), 5000) }

const jobs = computed(() => (data.value?.jobs ?? []).filter((j: any) => !hidden.value.has(j.id)))
const pct = (done: number, goal: number) => (goal ? Math.min(100, Math.round((done / goal) * 100)) : 100)

async function setStatus(job: any, status: string) {
  try {
    await api(`/api/jobs/${job.id}`, { method: 'PATCH', body: { status } })
    hidden.value.add(job.id)
    if (status === 'applied') { data.value.today.applied++; toast(data.value.today.applied >= data.value.goal.applications ? 'Daily goal reached. Anything more is a bonus.' : 'Marked applied. Follow-up reminder set.') }
  } catch (e) { toast((e as Error).message) }
}
</script>

<template>
  <div v-if="data">
    <div class="grid">
      <div class="panel">
        <div class="muted small">Applications today</div>
        <div class="stat">{{ data.today.applied }} / {{ data.goal.applications }}</div>
        <div class="bar"><span :style="{ width: pct(data.today.applied, data.goal.applications) + '%' }"></span></div>
      </div>
      <a class="panel" href="/outreach" style="text-decoration: none; color: inherit">
        <div class="muted small">Pitches sent today</div>
        <div class="stat">{{ data.today.pitched }} / {{ data.goal.pitches }}</div>
        <div class="bar"><span :style="{ width: pct(data.today.pitched, data.goal.pitches) + '%' }"></span></div>
      </a>
    </div>

    <div class="panel list">
      <div class="row" style="justify-content: space-between"><h2 style="margin: 0">Next up</h2><span class="small muted">Thumbs-up first, then saved, then by score. Change the goal in <a href="/settings">Settings</a>.</span></div>
      <p v-if="!jobs.length" class="muted">Nothing left in the queue. Fetch new jobs, lower the queue score in Settings, or <a href="/outreach">pitch a startup</a>.</p>
      <div v-for="(j, i) in jobs" :key="j.id" class="item">
        <div class="score" :class="scoreClass(j.score)">{{ j.score ?? '-' }}</div>
        <div class="body">
          <div><span class="muted small">{{ i + 1 }}.</span> <a class="title" :href="`/jobs/${j.id}`">{{ j.title }}</a> <span class="muted">· {{ j.company }}</span></div>
          <div class="small">
            <span class="chip">{{ j.engagement }}</span><span v-if="money(j)" class="chip">{{ money(j) }}</span><span class="chip">{{ j.source }}</span>
            <span v-if="j.myRating === 1" class="chip good">thumbs up</span><span v-if="j.status === 'saved'" class="chip">saved</span>
            <span v-if="j.hasApproved" class="chip good">resume approved</span><span v-else class="chip warn">no approved resume yet</span>
          </div>
          <div class="row small" style="margin-top: 6px">
            <a class="button" :href="`/jobs/${j.id}`">{{ j.hasApproved ? 'Review resume' : '1. Tailor resume' }}</a>
            <a class="button" :href="j.applyUrl || j.url" target="_blank" rel="noopener">2. Apply</a>
            <button class="primary" @click="setStatus(j, 'applied')">3. Mark applied</button>
            <button @click="hidden.add(j.id)">Not today</button>
            <button class="danger" @click="setStatus(j, 'skipped')">Skip</button>
          </div>
        </div>
      </div>
    </div>
    <p class="small muted">On the application page, use the JobPilot extension to fill the form from your approved resume. It never presses Submit.</p>
    <div v-if="message" class="toast">{{ message }}</div>
  </div>
  <p v-else class="muted">Loading...</p>
</template>

<style scoped>
.bar { height: 6px; background: var(--chip); border-radius: 3px; margin-top: 6px; overflow: hidden; }
.bar span { display: block; height: 100%; background: var(--good); }
</style>
