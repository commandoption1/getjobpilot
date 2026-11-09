import { profileSchema, type Profile } from '../src/core/profile'

export const sampleProfile = (): Profile => profileSchema.parse({
  basics: { name: 'Alex Example', headline: 'Full-stack engineer, Vue and Node', email: 'alex@example.com', location: 'Remote' },
  summary: 'I build web apps with Vue and Node and run them on Cloudflare. Most of my work in the last 6 years has been for startups.',
  experience: [
    {
      id: 'exp-1', company: 'Acme Pay', title: 'Senior Frontend Engineer', engagement: 'contract', start: '2023-02', end: 'present', stack: ['vue', 'typescript', 'cloudflare workers'],
      bullets: [
        { id: 'b1', text: 'Rebuilt the checkout in Vue 3, cutting page load from 4.1s to 1.3s', skills: ['vue', 'performance'] },
        { id: 'b2', text: 'Moved the API to Cloudflare Workers and D1, which lowered hosting costs by 60%', skills: ['cloudflare workers', 'd1'] },
        { id: 'b3', text: 'Mentored two junior developers', skills: [], tags: ['leadership'] },
      ],
    },
    {
      id: 'exp-2', company: 'Shoply', title: 'Full-stack Developer', engagement: 'employee', start: '2020-01', end: '2023-01', stack: ['node.js', 'postgresql', 'vue'],
      bullets: [{ id: 'b4', text: 'Built the order export service in Node.js and PostgreSQL used by 300 merchants', skills: ['node.js', 'postgresql'] }],
    },
  ],
  skills: [{ name: 'Vue', aliases: ['vue.js'] }, { name: 'TypeScript' }, { name: 'Node.js' }, { name: 'Cloudflare Workers' }, { name: 'PostgreSQL' }, { name: 'Astro', level: 'working' }],
  preferences: { targetRoles: ['frontend engineer', 'full-stack'], engagements: ['contract', 'freelance', 'full-time'], minRate: 70, targetRate: 100, rateUnit: 'hour', remote: 'remote-only', industries: ['fintech'], avoidIndustries: ['gambling'], excludeKeywords: ['unpaid'] },
})
