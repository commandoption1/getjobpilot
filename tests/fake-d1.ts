// A small D1 stand-in over Node's built-in SQLite, so server code can be tested against the real migrations.
import { readdirSync, readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

export function fakeD1() {
  const sqlite = new DatabaseSync(':memory:')
  for (const file of readdirSync('migrations').sort()) sqlite.exec(readFileSync(`migrations/${file}`, 'utf8'))
  let calls = 0
  const statement = (sql: string, params: unknown[] = []): any => ({
    sql, params,
    bind: (...values: unknown[]) => statement(sql, values),
    run: async () => { calls++; return exec(sql, params) },
    all: async () => { calls++; return exec(sql, params) },
    first: async (col?: string) => { calls++; const row = (exec(sql, params).results[0] ?? null) as any; return row && col ? row[col] : row },
  })
  const exec = (sql: string, params: unknown[]) => {
    const prepared = sqlite.prepare(sql)
    const values = params.map((v) => (v === undefined ? null : typeof v === 'boolean' ? Number(v) : v)) as any[]
    if (/^\s*(select|with)/i.test(sql)) return { results: prepared.all(...values), success: true, meta: {} }
    prepared.run(...values)
    return { results: [], success: true, meta: {} }
  }
  const db = {
    prepare: (sql: string) => statement(sql),
    batch: async (list: any[]) => { calls++; return list.map((s) => exec(s.sql, s.params)) },
    exec: async (sql: string) => { calls++; sqlite.exec(sql) },
  }
  return { db: db as unknown as D1Database, sqlite, calls: () => calls }
}
