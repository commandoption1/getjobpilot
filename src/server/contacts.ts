// Looks for a contact address on a company's own site: the home page, then /contact, /about and /team.
// Only addresses on the company's own domain count, so a page that links to a vendor's support email is ignored.
import { contactPages, findEmails, siteDomain } from '../core/outreach'

export async function findContact(fetcher: typeof fetch, website: string): Promise<{ email: string; others: string[]; checked: string[] }> {
  const domain = siteDomain(website)
  const checked: string[] = []
  const all: string[] = []
  for (const url of contactPages(website)) {
    checked.push(url)
    try {
      const res = await fetcher(url, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; JobPilot personal job search)', accept: 'text/html' }, redirect: 'follow', signal: AbortSignal.timeout(8000) })
      if (!res.ok || !(res.headers.get('content-type') ?? '').includes('html')) continue
      const html = (await res.text()).slice(0, 500_000)
      for (const e of findEmails(html, domain)) if (!all.includes(e)) all.push(e)
      if (all.length) break
    } catch { /* a slow or blocked page is skipped */ }
  }
  const sorted = findEmails(all.join(' '), domain)
  return { email: sorted[0] ?? '', others: sorted.slice(1, 6), checked }
}
