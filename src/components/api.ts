// Small fetch wrapper for the Vue islands. Errors come back as { error } from src/server/http.ts.
export async function api<T = any>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(path, {
    method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
    headers: init.body === undefined ? undefined : { 'content-type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`)
  return data as T
}

export const scoreClass = (s: number | null) => (s === null ? '' : s >= 70 ? 'high' : s >= 45 ? 'mid' : 'low')

export const csv = (list: string[]) => list.join(', ')
export const fromCsv = (text: string) => text.split(',').map((s) => s.trim()).filter(Boolean)

export function money(job: { rateMin: number | null; rateMax: number | null; rateUnit: string | null; currency: string | null }) {
  if (job.rateMin === null) return ''
  const fmt = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(Math.round(n)))
  const range = job.rateMax && job.rateMax !== job.rateMin ? `${fmt(job.rateMin)}-${fmt(job.rateMax)}` : fmt(job.rateMin)
  return `${job.currency ?? ''} ${range}${job.rateUnit ? `/${job.rateUnit}` : ''}`.trim()
}
