// Settings live in chrome.storage.local: { appUrl, token, accessClientId, accessClientSecret }.
// The last two are optional: a Cloudflare Access service token, for when /api/ext/ sits behind Access instead of a
// Bypass policy (for example on a workers.dev address). See docs/extension.md.
export async function getConfig() {
  const { appUrl = '', token = '', accessClientId = '', accessClientSecret = '' } = await chrome.storage.local.get(['appUrl', 'token', 'accessClientId', 'accessClientSecret'])
  return { appUrl: appUrl.replace(/\/+$/, ''), token, accessClientId, accessClientSecret }
}

export async function call(path, init = {}) {
  const { appUrl, token, accessClientId, accessClientSecret } = await getConfig()
  if (!appUrl || !token) throw new Error('Open the extension options and set your app URL and token first.')
  const res = await fetch(`${appUrl}${path}`, {
    method: init.body ? 'POST' : 'GET',
    headers: {
      authorization: `Bearer ${token}`,
      ...(accessClientId && accessClientSecret ? { 'cf-access-client-id': accessClientId, 'cf-access-client-secret': accessClientSecret } : {}),
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
    redirect: 'manual',
  })
  // Access answers a request it won't let through with a redirect to its login page.
  if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) throw new Error('Cloudflare Access blocked the request. Add a Bypass policy for /api/ext/ or set the service token in the options (docs/extension.md).')
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`)
  return data
}
