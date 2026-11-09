// Cloudflare Access sits in front of the dashboard. Access already blocks anyone not signed in at the edge; the
// Worker checks the signed token too, so a misconfigured policy or a request that reaches the Worker some other way
// still gets nothing. The extension uses its own bearer token on /api/ext/* (see src/middleware.ts).
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose'

const TEAM_DOMAIN = /^[a-z0-9-]+\.cloudflareaccess\.com$/
const keySets = new Map<string, JWTVerifyGetKey>()

export async function verifyAccess(token: string | null, teamDomain: string, aud: string): Promise<string | null> {
  if (!token || token.length > 8192 || !aud || !TEAM_DOMAIN.test(teamDomain)) return null
  const certs = `https://${teamDomain}/cdn-cgi/access/certs`
  let keys = keySets.get(certs)
  if (!keys) { keys = createRemoteJWKSet(new URL(certs)); keySets.set(certs, keys) }
  try {
    const { payload } = await jwtVerify(token, keys, { issuer: `https://${teamDomain}`, audience: aud, algorithms: ['RS256'] })
    return typeof payload.email === 'string' ? payload.email.toLowerCase() : 'service-token'
  } catch {
    return null
  }
}

/** Compares two secrets without leaking how many leading characters matched. */
export function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder()
  const x = enc.encode(a)
  const y = enc.encode(b)
  let diff = x.length ^ y.length
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0)
  return diff === 0
}
