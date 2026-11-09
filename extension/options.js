import { call, getConfig } from './shared.js'

const $ = (id) => document.getElementById(id)
const status = (text) => ($('status').textContent = text)

getConfig().then((c) => { for (const k of ['appUrl', 'token', 'accessClientId', 'accessClientSecret']) $(k).value = c[k] })

$('save').addEventListener('click', async () => {
  let origin
  try { origin = new URL($('appUrl').value.trim()).origin } catch { return status('That address is not a valid URL.') }
  // Ask Chrome for access to this one site only.
  const granted = await chrome.permissions.request({ origins: [`${origin}/*`] })
  if (!granted) return status('Chrome access to that address was not allowed.')
  await chrome.storage.local.set({ appUrl: origin, token: $('token').value.trim(), accessClientId: $('accessClientId').value.trim(), accessClientSecret: $('accessClientSecret').value.trim() })
  try {
    const data = await call('/api/ext/profile')
    status(`Connected. Profile: ${data.fields.fullName || '(no name yet)'}.`)
  } catch (e) {
    status(`Saved, but the test call failed: ${e.message}`)
  }
})
