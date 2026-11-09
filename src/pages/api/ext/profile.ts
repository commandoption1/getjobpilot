// What the extension needs to fill an application form: contact details, links, work rights, and (when the page
// matches a saved job) the approved tailored resume and cover letter for that job.
import { env } from 'cloudflare:workers'

import { formatMonth } from '../../../core/profile'
import { resumeText } from '../../../core/resume'
import { currentProfile, profileVersion, tailoredForJob } from '../../../server/db'
import { handler, json } from '../../../server/http'

async function jobForUrl(url: string) {
  if (!url) return null
  const clean = url.split(/[?#]/)[0]!.replace(/\/(apply|application)\/?$/, '')
  // D1 rejects LIKE patterns over 50 bytes, and job links are longer, so the "page starts with the job link" test
  // compares prefixes with substr instead.
  const row = await env.DB.prepare(`SELECT id, title, company, url, apply_url FROM jobs
      WHERE url = ? OR apply_url = ?
        OR (url != '' AND substr(?, 1, length(url)) = url)
        OR (apply_url != '' AND substr(?, 1, length(apply_url)) = apply_url)
      ORDER BY length(url) DESC, updated_at DESC LIMIT 1`)
    .bind(clean, clean, url, url).first<{ id: string; title: string; company: string; url: string; apply_url: string }>()
  return row
}

export const GET = handler(async ({ url }) => {
  const { profile } = await currentProfile(env.DB)
  const job = await jobForUrl(url.searchParams.get('url') ?? '')
  const approved = job ? (await tailoredForJob(env.DB, job.id)).find((t) => t.status === 'approved') ?? null : null
  const sourceProfile = approved ? (await profileVersion(env.DB, approved.profileVersion))?.profile ?? profile : profile
  const [first, ...rest] = profile.basics.name.trim().split(/\s+/)
  const latest = profile.experience[0]
  return json({
    fields: {
      firstName: first ?? '', lastName: rest.join(' '), fullName: profile.basics.name, email: profile.basics.email, phone: profile.basics.phone,
      location: profile.basics.location, website: profile.basics.website, github: profile.basics.github, linkedin: profile.basics.linkedin,
      currentCompany: latest?.end === 'present' ? latest.company : '', currentTitle: latest?.end === 'present' ? latest.title : '',
      headline: approved?.resume.headline || profile.basics.headline,
      workRights: profile.preferences.workRights.join(', '),
      rate: profile.preferences.targetRate ? `${profile.preferences.targetRate} ${profile.preferences.currency} per ${profile.preferences.rateUnit}` : '',
      coverLetter: approved?.resume.coverLetter ?? '',
      resumeText: approved ? resumeText(sourceProfile, approved.resume) : '',
    },
    job: job ? { id: job.id, title: job.title, company: job.company } : null,
    tailoredId: approved?.id ?? null,
    experience: profile.experience.map((e) => ({ company: e.company, title: e.title, start: formatMonth(e.start), end: formatMonth(e.end) })),
  })
})
