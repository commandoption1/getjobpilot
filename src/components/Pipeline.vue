<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { api, money } from './api'

const columns = ['saved', 'applied', 'interview', 'offer', 'won', 'lost']
const jobs = ref<any[]>([])
const dragging = ref<string | null>(null)
const today = new Date().toISOString().slice(0, 10)

async function load() { jobs.value = await api('/api/jobs?status=all') }
onMounted(load)

const byColumn = computed(() => Object.fromEntries(columns.map((c) => [c, jobs.value.filter((j) => j.status === c)])))
const due = computed(() => jobs.value.filter((j) => j.followUpAt && j.followUpAt <= today && ['applied', 'interview'].includes(j.status)))

async function moveTo(id: string, status: string) {
  const job = jobs.value.find((j) => j.id === id)
  if (!job || job.status === status) return
  job.status = status
  Object.assign(job, (await api(`/api/jobs/${id}`, { method: 'PATCH', body: { status } })).job)
}
</script>

<template>
  <div>
    <div v-if="due.length" class="panel">
      <strong class="due">Follow up today ({{ due.length }})</strong>
      <ul><li v-for="j in due" :key="j.id"><a :href="`/jobs/${j.id}`">{{ j.title }}</a> at {{ j.company }} <span class="muted small">applied {{ j.appliedAt?.slice(0, 10) }}</span></li></ul>
    </div>
    <div class="kanban">
      <div v-for="c in columns" :key="c" class="col" @dragover.prevent @drop="dragging && moveTo(dragging, c)">
        <strong style="text-transform: capitalize">{{ c }}</strong> <span class="muted small">{{ byColumn[c].length }}</span>
        <div v-for="j in byColumn[c]" :key="j.id" class="card" draggable="true" @dragstart="dragging = j.id" @dragend="dragging = null">
          <a :href="`/jobs/${j.id}`"><strong>{{ j.title }}</strong></a>
          <div class="muted">{{ j.company }}</div>
          <div v-if="money(j)">{{ money(j) }}</div>
          <div v-if="j.followUpAt" :class="{ due: j.followUpAt <= today }">Follow up {{ j.followUpAt }}</div>
          <select :value="j.status" style="margin-top: 6px; font-size: 12px; padding: 3px" @change="moveTo(j.id, ($event.target as HTMLSelectElement).value)">
            <option v-for="o in columns" :key="o">{{ o }}</option>
          </select>
        </div>
      </div>
    </div>
    <p class="small muted">Drag cards between columns, or use the menu on each card. Moving a job to Applied sets a follow-up reminder.</p>
  </div>
</template>
