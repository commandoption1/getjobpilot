import { env } from 'cloudflare:workers'
import { z } from 'zod'

import { companyFit } from '../../../core/company'
import { companyInput, prepareCompany } from '../../../server/companies'
import { currentProfile, linkJobsToCompany, listCompanies, newId, saveCompany } from '../../../server/db'
import { body, handler, json } from '../../../server/http'

export const GET = handler(async () => {
  const { profile } = await currentProfile(env.DB)
  return json((await listCompanies(env.DB)).map((c) => ({ ...c, reasons: companyFit(c, profile).reasons })))
})

/** One company, or many at once as { companies: [...] } (for pasting a list). */
export const POST = handler(async ({ request }) => {
  const input = await body(request, z.union([companyInput, z.object({ companies: z.array(companyInput).max(500) })]))
  const list = 'companies' in input ? input.companies : [input]
  const ids: string[] = []
  for (const c of list) {
    const company = await prepareCompany(newId(), c)
    await saveCompany(env.DB, company)
    await linkJobsToCompany(env.DB, company.id, company.name)
    ids.push(company.id)
  }
  return json({ ids })
})
