import { z } from 'zod'

export const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } })

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

export async function body<T extends z.ZodType>(request: Request, schema: T): Promise<z.infer<T>> {
  let raw: unknown
  try { raw = await request.json() } catch { throw new HttpError(400, 'Body must be JSON') }
  const parsed = schema.safeParse(raw)
  if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).slice(0, 8).join('; '))
  return parsed.data
}

/** Wraps a handler so thrown errors become JSON with a useful message instead of a bare 500. */
export function handler(fn: (ctx: import('astro').APIContext) => Promise<Response>) {
  return async (ctx: import('astro').APIContext) => {
    try {
      return await fn(ctx)
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.message }, error.status)
      console.warn(JSON.stringify({ event: 'api-error', path: ctx.url.pathname, error: error instanceof Error ? error.message : String(error) }))
      return json({ error: error instanceof Error ? error.message : 'Something went wrong' }, 500)
    }
  }
}
