// Style rules for anything written in the user's name. They catch the phrases and patterns that make text read as
// machine-written or generic. You can add phrases in Settings; these defaults always apply.

export const DEFAULT_BANNED_PHRASES = [
  'spearheaded', 'spearheading', 'leveraged', 'leveraging', 'utilized', 'utilizing', 'synergy', 'synergies', 'dynamic',
  'results-driven', 'results-oriented', 'detail-oriented', 'passionate about', 'proven track record', 'track record of',
  'go-getter', 'self-starter', 'team player', 'think outside the box', 'hit the ground running', 'cutting-edge',
  'cutting edge', 'state-of-the-art', 'best-in-class', 'world-class', 'game-changer', 'game changer', 'seamless',
  'seamlessly', 'robust', 'delve', 'delved', 'tapestry', 'testament to', 'in today\'s fast-paced', 'fast-paced environment',
  'ever-evolving', 'ever-changing', 'landscape', 'realm', 'navigate the complexities', 'unlock', 'unleash', 'elevate',
  'empower', 'empowering', 'harness', 'harnessing', 'meticulous', 'meticulously', 'pivotal', 'paramount', 'plethora',
  'myriad', 'furthermore', 'moreover', 'additionally,', 'in conclusion', 'i am excited to', 'i am thrilled',
  'i am writing to express', 'i believe i would be a great fit', 'perfect fit', 'ideal candidate', 'look no further',
  'wealth of experience', 'deep dive', 'stakeholders across', 'drive impact', 'impactful', 'innovative solutions',
  'end-to-end solutions', 'holistic', 'transformative', 'revolutionize', 'revolutionized', 'streamline operations',
]

export type StyleIssue = { rule: string; message: string; excerpt: string }

const sentences = (text: string) => text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean)

/** Every problem found in one piece of text. An empty list means it passes. */
export function lintText(text: string, extraBanned: string[] = []): StyleIssue[] {
  const issues: StyleIssue[] = []
  const lower = text.toLowerCase()
  for (const phrase of [...DEFAULT_BANNED_PHRASES, ...extraBanned.map((p) => p.toLowerCase().trim()).filter(Boolean)]) {
    const at = lower.search(new RegExp(`(^|[^a-z])${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^a-z])`))
    if (at !== -1) issues.push({ rule: 'banned-phrase', message: `Avoid "${phrase}"`, excerpt: text.slice(Math.max(0, at), Math.max(0, at) + phrase.length + 1).trim() })
  }
  if (/[—–]/.test(text)) issues.push({ rule: 'dash', message: 'Use a comma, period or hyphen instead of an em or en dash', excerpt: text.match(/.{0,20}[—–].{0,20}/)?.[0] ?? '' })
  if (/[“”‘’]/.test(text)) issues.push({ rule: 'smart-quotes', message: 'Use straight quotes so ATS parsers read them', excerpt: text.match(/.{0,15}[“”‘’].{0,15}/)?.[0] ?? '' })
  if (/[\u{1F300}-\u{1FAFF}☀-➿]/u.test(text)) issues.push({ rule: 'emoji', message: 'No emoji in a resume or proposal', excerpt: '' })
  if (/!/.test(text)) issues.push({ rule: 'exclamation', message: 'No exclamation marks', excerpt: text.match(/.{0,25}!/)?.[0] ?? '' })
  if (/\b(\w+) \1\b/i.test(text)) issues.push({ rule: 'repeated-word', message: 'Repeated word', excerpt: text.match(/\b(\w+) \1\b/i)?.[0] ?? '' })
  if (/ {2,}|\s[,.;:]/.test(text)) issues.push({ rule: 'spacing', message: 'Extra space or space before punctuation', excerpt: text.match(/.{0,10}( {2,}|\s[,.;:]).{0,10}/)?.[0] ?? '' })

  // "Not only X but also Y" and "It's not X, it's Y" are strong tells.
  if (/\bnot only\b[^.]*\bbut also\b/i.test(text)) issues.push({ rule: 'pattern', message: 'Avoid "not only ... but also"', excerpt: '' })
  if (/\b(it'?s|this is) not (just )?[^.,]+, (it'?s|but)\b/i.test(text)) issues.push({ rule: 'pattern', message: 'Avoid "it\'s not X, it\'s Y"', excerpt: '' })

  // Three bullets or sentences in a row that open with the same word read as templated.
  const starts = sentences(text).map((s) => s.replace(/^[-*•]\s*/, '').split(/\s+/)[0]?.toLowerCase() ?? '')
  for (let i = 2; i < starts.length; i++) {
    if (starts[i] && starts[i] === starts[i - 1] && starts[i] === starts[i - 2]) {
      issues.push({ rule: 'same-opening', message: `Three sentences in a row start with "${starts[i]}"`, excerpt: '' })
      break
    }
  }
  return issues
}

/** Lint each bullet on its own, plus the rule that a list of bullets shouldn't all open with the same verb. */
export function lintBullets(bullets: string[], extraBanned: string[] = []): StyleIssue[] {
  const issues = bullets.flatMap((b) => lintText(b, extraBanned).filter((i) => i.rule !== 'same-opening').map((i) => ({ ...i, excerpt: i.excerpt || b.slice(0, 60) })))
  const verbs = bullets.map((b) => b.trim().split(/\s+/)[0]?.toLowerCase())
  const counts = new Map<string, number>()
  for (const v of verbs) if (v) counts.set(v, (counts.get(v) ?? 0) + 1)
  for (const [verb, n] of counts) if (n >= 3) issues.push({ rule: 'same-opening', message: `${n} bullets start with "${verb}"`, excerpt: '' })
  return issues
}
