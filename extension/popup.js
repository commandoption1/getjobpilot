import { call, getConfig } from './shared.js'

const $ = (id) => document.getElementById(id)
const status = (text) => ($('status').textContent = text)
let profileData = null

$('options').addEventListener('click', (e) => { e.preventDefault(); chrome.runtime.openOptionsPage() })

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  return tab
}

async function init() {
  const { appUrl, token } = await getConfig()
  if (!appUrl || !token) { $('job').textContent = 'Not set up yet. Open Options.'; return }
  const tab = await activeTab()
  try {
    profileData = await call(`/api/ext/profile?url=${encodeURIComponent(tab.url ?? '')}`)
    if (profileData.job) {
      $('job').innerHTML = ''
      const strong = document.createElement('strong')
      strong.textContent = profileData.job.title
      $('job').append(strong, document.createTextNode(` at ${profileData.job.company}`))
      $('job').append(document.createElement('br'), document.createTextNode(profileData.tailoredId ? 'Approved tailored resume ready.' : 'No approved tailored resume for this job yet.'))
      $('applied').hidden = false
    } else {
      $('job').textContent = 'This page is not a job in your dashboard. Save it first to score and tailor it.'
    }
    $('copyLetter').hidden = !profileData.fields.coverLetter
  } catch (e) {
    $('job').textContent = e.message
  }
}

// Runs inside the page. Matches each field by its label, name, id, placeholder or autocomplete, fills only empty
// fields, and outlines what it filled. It never submits.
function fillPage(fields) {
  const rules = [
    ['firstName', /first[\s_-]?name|given[\s_-]?name|fname/i],
    ['lastName', /last[\s_-]?name|family[\s_-]?name|surname|lname/i],
    ['fullName', /^(full[\s_-]?)?name$|your name|candidate name/i],
    ['email', /e-?mail/i],
    ['phone', /phone|mobile|tel/i],
    ['location', /location|city|where are you based|address/i],
    ['linkedin', /linkedin/i],
    ['github', /github/i],
    ['website', /website|portfolio|personal (site|url)|other (link|url)/i],
    ['currentCompany', /current (company|employer)|^company$|organization/i],
    ['currentTitle', /current (title|role|position)|job title/i],
    ['rate', /rate|salary|compensation|expectation/i],
    ['workRights', /authori[sz]ed|work permit|visa|right to work|sponsorship/i],
    ['coverLetter', /cover[\s_-]?letter|why (are you|do you)|motivation|additional information|anything else|proposal/i],
    ['resumeText', /resume text|paste (your )?(resume|cv)/i],
  ]
  const labelFor = (el) => {
    const parts = [el.getAttribute('aria-label'), el.name, el.id, el.placeholder, el.getAttribute('autocomplete')]
    if (el.id) { const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l) parts.push(l.textContent) }
    const wrap = el.closest('label, .field, .application-question, [class*="field"], [class*="question"]')
    if (wrap) parts.push((wrap.querySelector('label, legend, .label, [class*="label"]') ?? wrap).textContent?.slice(0, 200))
    return parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
  }
  const setValue = (el, value) => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value) // works with React-controlled inputs
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
    el.style.outline = '2px solid #2e9d5b'
  }
  const filled = []
  const missing = []
  const inputs = [...document.querySelectorAll('input:not([type=hidden]):not([type=file]):not([type=checkbox]):not([type=radio]):not([type=submit]), textarea')]
  for (const el of inputs) {
    if (el.disabled || el.readOnly || el.offsetParent === null) continue
    const label = labelFor(el)
    const rule = rules.find(([key, re]) => re.test(label) && fields[key])
    if (!rule) { if (el.required && !el.value) missing.push(label.slice(0, 60) || '(unlabelled field)'); continue }
    if (el.value) continue
    const [key] = rule
    if (key === 'coverLetter' && el instanceof HTMLInputElement) continue // long text only into text areas
    setValue(el, fields[key])
    filled.push(key)
  }
  const files = [...document.querySelectorAll('input[type=file]')].filter((f) => f.offsetParent !== null || f.closest('label'))
  files.forEach((f) => { const box = f.closest('div, label') ?? f; box.style.outline = '2px dashed #d08a00' })
  return { filled, missing, fileInputs: files.length }
}

$('fill').addEventListener('click', async () => {
  if (!profileData) return status('Not connected yet.')
  const tab = await activeTab()
  try {
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: fillPage, args: [profileData.fields] })
    const lines = [`Filled ${result.filled.length} fields (green outline).`]
    if (result.fileInputs) lines.push(`Attach your resume PDF yourself (orange outline). Get it from the job page in your dashboard: Print view, then Save as PDF.`)
    if (result.missing.length) lines.push(`Still empty and required: ${result.missing.slice(0, 6).join('; ')}`)
    if (!profileData.tailoredId) lines.push('Tip: approve a tailored resume for this job first so the cover letter and headline match it.')
    status(lines.join('\n'))
  } catch (e) {
    status(`Could not fill this page: ${e.message}`)
  }
})

$('save').addEventListener('click', async () => {
  const tab = await activeTab()
  status('Reading the page...')
  try {
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => ({ title: document.title, text: (document.querySelector('main, article, [role=main]') ?? document.body).innerText.slice(0, 150000) }) })
    const res = await call('/api/ext/jobs', { body: { url: tab.url, title: result.title, text: result.text } })
    const { appUrl } = await getConfig()
    status(res.added ? `Saved: ${res.title}. Open it in your dashboard to tailor.` : 'Already in your dashboard. Updated.')
    chrome.tabs.create({ url: `${appUrl}/jobs/${res.id}`, active: false })
    init()
  } catch (e) {
    status(e.message)
  }
})

$('applied').addEventListener('click', async () => {
  try { await call('/api/ext/applied', { body: { jobId: profileData.job.id } }); status('Marked as applied. A follow-up reminder is set.') } catch (e) { status(e.message) }
})

$('copyLetter').addEventListener('click', async () => {
  await navigator.clipboard.writeText(profileData.fields.coverLetter)
  status('Cover letter copied.')
})

init()
