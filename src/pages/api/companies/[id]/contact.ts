import { env } from 'cloudflare:workers'
import { z } from 'zod'

import { findContact } from '../../../../server/contacts'
import { getCompany, setCompanyContact } from '../../../../server/db'
import { body, handler, HttpError, json } from '../../../../server/http'

/** Looks for a contact address on the company's site, or saves one the user found. */
export const POST = handler(async ({ params, request }) => {
  const { email } = await body(request, z.object({ email: z.email().or(z.literal('')).optional() }))
  const company = await getCompany(env.DB, params.id!)
  if (!company) throw new HttpError(404, 'No such company')
  if (email !== undefined) { await setCompanyContact(env.DB, company.id, email); return json({ email, others: [] }) }
  if (!company.website) throw new HttpError(400, 'Add the company website first')
  const found = await findContact(fetch, company.website)
  await setCompanyContact(env.DB, company.id, found.email)
  return json(found)
})
