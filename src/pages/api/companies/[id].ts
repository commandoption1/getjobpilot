import { env } from 'cloudflare:workers'

import { deleteCompany, linkJobsToCompany, saveCompany } from '../../../server/db'
import { body, handler, json } from '../../../server/http'
import { companyInput, prepareCompany } from '../../../server/companies'

export const PUT = handler(async ({ params, request }) => {
  const company = await prepareCompany(params.id!, await body(request, companyInput))
  await saveCompany(env.DB, company)
  await linkJobsToCompany(env.DB, company.id, company.name)
  return json({ ok: true, fit: company.fit, ats: company.ats })
})

export const DELETE = handler(async ({ params }) => {
  await deleteCompany(env.DB, params.id!)
  return json({ ok: true })
})
