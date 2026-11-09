import { env } from 'cloudflare:workers'
import { defineMiddleware } from 'astro:middleware'

import { safeEqual, verifyAccess } from './server/access'

const EXT_PREFIX = '/api/ext/'

function cors(request: Request, response: Response) {
  const origin = request.headers.get('origin') ?? ''
  if (origin.startsWith('chrome-extension://') || origin.startsWith('moz-extension://')) {
    response.headers.set('access-control-allow-origin', origin)
    response.headers.set('access-control-allow-headers', 'authorization, content-type')
    response.headers.set('access-control-allow-methods', 'GET, POST, OPTIONS')
    response.headers.set('vary', 'origin')
  }
  return response
}

export const onRequest = defineMiddleware(async (context, next) => {
  const { request, url } = context
  const json = (status: number, error: string) => new Response(JSON.stringify({ error }), { status, headers: { 'content-type': 'application/json' } })

  // The browser extension: its own token, no Access cookie. Put /api/ext/* in an Access "Bypass" policy, or send an Access service token (docs/extension.md).
  if (url.pathname.startsWith(EXT_PREFIX)) {
    if (request.method === 'OPTIONS') return cors(request, new Response(null, { status: 204 }))
    const token = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
    if (!env.EXTENSION_TOKEN || env.EXTENSION_TOKEN.length < 24 || !safeEqual(token, env.EXTENSION_TOKEN)) return cors(request, json(401, 'Bad or missing extension token'))
    context.locals.user = 'extension'
    return cors(request, await next())
  }

  if (env.ALLOW_NO_ACCESS === 'true' && !env.ACCESS_AUD) {
    context.locals.user = 'local'
  } else {
    const user = await verifyAccess(request.headers.get('cf-access-jwt-assertion'), env.ACCESS_TEAM_DOMAIN, env.ACCESS_AUD)
    if (!user) return new Response('Sign in through Cloudflare Access to use this app.', { status: 403 })
    context.locals.user = user
  }

  // Writes from the dashboard must come from the dashboard itself.
  if (url.pathname.startsWith('/api/') && request.method !== 'GET') {
    const origin = request.headers.get('origin')
    if (origin && origin !== url.origin) return json(403, 'Cross-origin request refused')
  }
  const response = await next()
  response.headers.set('x-frame-options', 'DENY')
  response.headers.set('referrer-policy', 'no-referrer')
  response.headers.set('x-robots-tag', 'noindex, nofollow')
  return response
})
