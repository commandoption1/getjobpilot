import { env } from 'cloudflare:workers'
import { z } from 'zod'

import { companyFit } from '../core/company'
import { detectAts } from '../core/sources'
import { currentProfile } from './db'

export const companyInput = z.object({
  name: z.string().min(1).max(200),
  website: z.string().max(500).default(''),
  careersUrl: z.string().max(500).default(''),
  industry: z.string().max(200).default(''),
  size: z.enum(['', 'solo', 'startup', 'scaleup', 'midsize', 'enterprise']).default(''),
  stage: z.string().max(100).default(''),
  location: z.string().max(200).default(''),
  stack: z.string().max(500).default(''),
  notes: z.string().max(4000).default(''),
  status: z.enum(['watching', 'pitched', 'talking', 'client', 'not-a-fit']).default('watching'),
  watchJobs: z.boolean().default(true),
})

export async function prepareCompany(id: string, input: z.infer<typeof companyInput>) {
  const { profile } = await currentProfile(env.DB)
  const ats = detectAts(input.careersUrl)
  return { id, ...input, ats: ats?.kind ?? null, atsToken: ats?.token ?? null, fit: companyFit(input, profile).fit }
}
