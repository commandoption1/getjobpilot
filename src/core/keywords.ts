// Finds the skills and tools a job post asks for, and how many of them a resume covers. ATS filters match on these
// words, so a tailored resume should use the post's own spelling for every skill the user really has.

/** Common tech terms with the spellings job posts use. The first entry is the canonical name. */
const TERMS: string[][] = [
  ['javascript', 'js', 'ecmascript'], ['typescript', 'ts'], ['node.js', 'node', 'nodejs'], ['vue', 'vue.js', 'vuejs', 'vue 3'],
  ['nuxt', 'nuxt.js'], ['react', 'react.js', 'reactjs'], ['next.js', 'nextjs'], ['astro'], ['svelte', 'sveltekit'], ['angular'],
  ['html'], ['css'], ['tailwind', 'tailwindcss', 'tailwind css'], ['sass', 'scss'], ['graphql'], ['rest', 'rest api', 'restful'],
  ['python'], ['django'], ['flask'], ['fastapi'], ['go', 'golang'], ['rust'], ['java'], ['kotlin'], ['php'], ['laravel'], ['ruby'], ['rails', 'ruby on rails'],
  ['c#', '.net', 'dotnet'], ['swift'], ['sql'], ['postgresql', 'postgres'], ['mysql'], ['sqlite'], ['mongodb', 'mongo'], ['redis'],
  ['elasticsearch'], ['aws', 'amazon web services'], ['gcp', 'google cloud'], ['azure'], ['cloudflare'], ['cloudflare workers', 'workers'],
  ['d1'], ['r2'], ['vercel'], ['netlify'], ['docker'], ['kubernetes', 'k8s'], ['terraform'], ['ci/cd', 'cicd', 'github actions'],
  ['linux'], ['serverless'], ['microservices'], ['websockets'], ['llm', 'llms', 'large language models'], ['openai'], ['anthropic', 'claude'],
  ['langchain'], ['rag', 'retrieval augmented generation'], ['machine learning', 'ml'], ['ai'], ['figma'], ['playwright'], ['cypress'],
  ['jest'], ['vitest'], ['seo'], ['stripe'], ['shopify'], ['wordpress'], ['webflow'], ['n8n'], ['zapier'], ['make.com'],
  ['automation'], ['scraping', 'web scraping'], ['chrome extension', 'browser extension'], ['pwa'], ['accessibility', 'a11y', 'wcag'],
  ['performance'], ['security'], ['oauth'], ['agile', 'scrum'], ['product management'], ['ui/ux', 'ux', 'ui design'],
]

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
const wordPattern = (term: string) => new RegExp(`(^|[^a-z0-9+#.])${escape(term)}(?=$|[^a-z0-9+#])`, 'i')

export type KeywordHit = { canonical: string; asWritten: string }

/** Terms found in the text, with the spelling the text used. Extra terms (e.g. the user's own skills) are checked too. */
export function findTerms(text: string, extra: string[] = []): KeywordHit[] {
  const hits = new Map<string, KeywordHit>()
  const groups = [...TERMS, ...extra.filter(Boolean).map((t) => [t.toLowerCase()])]
  for (const group of groups) {
    const canonical = group[0]!
    if (hits.has(canonical)) continue
    for (const variant of [...group].sort((a, b) => b.length - a.length)) {
      const m = wordPattern(variant).exec(text)
      if (m) {
        hits.set(canonical, { canonical, asWritten: text.slice(m.index + m[1]!.length, m.index + m[1]!.length + variant.length) })
        break
      }
    }
  }
  return [...hits.values()]
}

/** The canonical name for a skill, so "Vue.js" and "vue" compare equal. */
export function canonicalTerm(name: string): string {
  const lower = name.trim().toLowerCase()
  for (const group of TERMS) if (group.includes(lower)) return group[0]!
  return lower
}

export type Coverage = { matched: string[]; missing: string[]; ratio: number }

/** Which of the job's terms appear in the resume text. */
export function keywordCoverage(jobTerms: KeywordHit[], resumeText: string): Coverage {
  const resumeTerms = new Set(findTerms(resumeText, jobTerms.map((t) => t.canonical)).map((t) => t.canonical))
  const matched = jobTerms.filter((t) => resumeTerms.has(t.canonical)).map((t) => t.asWritten)
  const missing = jobTerms.filter((t) => !resumeTerms.has(t.canonical)).map((t) => t.asWritten)
  return { matched, missing, ratio: jobTerms.length ? matched.length / jobTerms.length : 1 }
}
