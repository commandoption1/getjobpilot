// The resume and cover letter as real PDF files, built in code so the download works in every browser (no print
// dialog). Plain one-column layout with selectable text, the same content and order as ResumeDocument.astro, so an
// ATS reads it the same way. No network or Cloudflare code here.
import { PDFDocument, type PDFFont, type PDFPage, rgb, StandardFonts } from 'pdf-lib'

import { formatMonth, type Profile } from './profile'
import type { TailoredResume } from './resume'

export type PaperSize = 'a4' | 'letter'
const SIZES: Record<PaperSize, [number, number]> = { a4: [595.28, 841.89], letter: [612, 792] }

// The standard PDF fonts only cover Western European letters. Turkish and other letters outside that set are written
// without their accent marks rather than dropped, and typographic punctuation becomes plain ASCII.
const REPLACE: Record<string, string> = {
  '‘': "'", '’': "'", '“': '"', '”': '"', '–': '-', '—': '-', '…': '...', ' ': ' ',
  '•': '-', 'ı': 'i', 'İ': 'I', 'Ł': 'L', 'ł': 'l', 'Ð': 'D', 'đ': 'd',
}
export function pdfSafe(text: string): string {
  let out = ''
  for (const ch of text) {
    const code = ch.codePointAt(0)!
    if (REPLACE[ch] !== undefined) out += REPLACE[ch]
    else if (code === 10 || (code >= 32 && code < 127) || (code >= 160 && code <= 255)) out += ch
    else {
      const bare = ch.normalize('NFKD').replace(/[̀-ͯ]/g, '')
      out += [...bare].every((c) => c.codePointAt(0)! < 256) ? bare : ''
    }
  }
  return out
}

type Fonts = { regular: PDFFont; bold: PDFFont; italic: PDFFont }

/** Keeps the cursor and starts a new page when the next line won't fit. */
class Writer {
  page!: PDFPage
  y = 0
  readonly left: number
  readonly right: number
  readonly top: number
  readonly bottom: number

  constructor(private doc: PDFDocument, readonly fonts: Fonts, private size: [number, number], margin = { x: 50, y: 44 }) {
    this.left = margin.x
    this.right = size[0] - margin.x
    this.top = size[1] - margin.y
    this.bottom = margin.y
    this.newPage()
  }

  get width() { return this.right - this.left }

  newPage() {
    this.page = this.doc.addPage(this.size)
    this.y = this.top
  }

  ensure(height: number) {
    if (this.y - height < this.bottom) this.newPage()
  }

  /** Splits text into lines that fit `width` at this size. */
  wrap(text: string, font: PDFFont, size: number, width = this.width): string[] {
    const lines: string[] = []
    for (const para of pdfSafe(text).split('\n')) {
      let line = ''
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const next = line ? `${line} ${word}` : word
        if (font.widthOfTextAtSize(next, size) <= width || !line) line = next
        else { lines.push(line); line = word }
      }
      lines.push(line)
    }
    return lines
  }

  text(text: string, opts: { font?: PDFFont; size?: number; gap?: number; indent?: number; color?: number } = {}) {
    const font = opts.font ?? this.fonts.regular
    const size = opts.size ?? 10
    const lead = size * 1.32
    const indent = opts.indent ?? 0
    for (const line of this.wrap(text, font, size, this.width - indent)) {
      this.ensure(lead)
      this.y -= lead
      this.page.drawText(line, { x: this.left + indent, y: this.y + lead - size, size, font, color: rgb(opts.color ?? 0.07, opts.color ?? 0.07, opts.color ?? 0.07) })
    }
    this.y -= opts.gap ?? 0
  }

  /** A bold line on the left with dates on the right, as on the printed resume. */
  headLine(left: { bold: string; rest: string }, right: string, size = 10) {
    const lead = size * 1.32
    this.ensure(lead * 2)
    const dateWidth = right ? this.fonts.regular.widthOfTextAtSize(pdfSafe(right), size) + 12 : 0
    const bold = pdfSafe(left.bold)
    const lines = this.wrap(`${bold}${left.rest}`, this.fonts.regular, size, this.width - dateWidth)
    lines.forEach((line, i) => {
      this.ensure(lead)
      this.y -= lead
      const baseline = this.y + lead - size
      if (i === 0 && line.startsWith(bold)) {
        this.page.drawText(bold, { x: this.left, y: baseline, size, font: this.fonts.bold })
        const boldWidth = this.fonts.bold.widthOfTextAtSize(bold, size)
        this.page.drawText(line.slice(bold.length), { x: this.left + boldWidth, y: baseline, size, font: this.fonts.regular })
      } else {
        this.page.drawText(line, { x: this.left, y: baseline, size, font: this.fonts.regular })
      }
      if (i === 0 && right) this.page.drawText(pdfSafe(right), { x: this.right - dateWidth + 12, y: baseline, size, font: this.fonts.regular })
    })
  }

  bullet(text: string, size = 10) {
    const lead = size * 1.32
    const indent = 12
    const lines = this.wrap(text, this.fonts.regular, size, this.width - indent)
    lines.forEach((line, i) => {
      this.ensure(lead)
      this.y -= lead
      const baseline = this.y + lead - size
      if (i === 0) this.page.drawText('-', { x: this.left + 3, y: baseline, size, font: this.fonts.regular })
      this.page.drawText(line, { x: this.left + indent, y: baseline, size, font: this.fonts.regular })
    })
    this.y -= 1
  }

  section(title: string) {
    this.ensure(40)
    this.y -= 10
    this.text(title.toUpperCase(), { font: this.fonts.bold, size: 10.5 })
    this.y -= 2
    this.page.drawLine({ start: { x: this.left, y: this.y }, end: { x: this.right, y: this.y }, thickness: 0.7, color: rgb(0.2, 0.2, 0.2) })
    this.y -= 4
  }
}

async function start(profile: Profile, title: string) {
  const doc = await PDFDocument.create()
  doc.setTitle(pdfSafe(title))
  doc.setAuthor(pdfSafe(profile.basics.name))
  doc.setCreator('JobPilot')
  doc.setProducer('JobPilot')
  const fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    italic: await doc.embedFont(StandardFonts.HelveticaOblique),
  }
  return { doc, fonts }
}

const contactLine = (profile: Profile) => {
  const b = profile.basics
  return [b.location, b.email, b.phone, b.website, b.github, b.linkedin].filter(Boolean).join(' | ')
}

function header(w: Writer, profile: Profile, headline: string) {
  w.text(profile.basics.name, { font: w.fonts.bold, size: 19 })
  if (headline) w.text(headline, { size: 11.5, gap: 1 })
  w.text(contactLine(profile), { size: 9.5, color: 0.2 })
}

const engagementNote = (e: string) => (e === 'contract' || e === 'freelance' ? ` (${e})` : '')

/** The resume as a PDF. Company, title and dates come from the profile by id, exactly as on the print view. */
export async function resumePdf(profile: Profile, resume: TailoredResume, paper: PaperSize = 'a4'): Promise<Uint8Array> {
  const { doc, fonts } = await start(profile, `${profile.basics.name} - Resume`)
  const w = new Writer(doc, fonts, SIZES[paper])
  header(w, profile, resume.headline)

  if (resume.summary) { w.section('Summary'); w.text(resume.summary) }

  const jobs = resume.experience.map((x) => ({ job: profile.experience.find((e) => e.id === x.experienceId), bullets: x.bullets })).filter((x) => x.job)
  if (jobs.length) {
    w.section('Experience')
    for (const { job, bullets } of jobs) {
      w.headLine({ bold: job!.title, rest: `, ${job!.company}${engagementNote(job!.engagement)}` }, `${formatMonth(job!.start)} - ${formatMonth(job!.end)}`)
      const sub = [job!.location, job!.context].filter(Boolean).join('. ')
      if (sub) w.text(sub, { font: fonts.italic, size: 9.5, color: 0.25 })
      for (const b of bullets) w.bullet(b.text)
      w.y -= 5
    }
  }

  const projects = resume.projects.map((x) => ({ p: profile.projects.find((e) => e.id === x.projectId), bullets: x.bullets })).filter((x) => x.p)
  if (projects.length) {
    w.section('Projects')
    for (const { p, bullets } of projects) {
      w.headLine({ bold: p!.name, rest: p!.url ? `, ${p!.url}` : '' }, '')
      if (p!.description) w.text(p!.description, { font: fonts.italic, size: 9.5, color: 0.25 })
      for (const b of bullets) w.bullet(b.text)
      w.y -= 5
    }
  }

  if (resume.skills.length) { w.section('Skills'); w.text(resume.skills.join(', ')) }

  if (profile.education.length) {
    w.section('Education')
    for (const e of profile.education) {
      const what = [e.degree, e.field].filter(Boolean).join(', ')
      w.headLine({ bold: what || e.school, rest: what ? `, ${e.school}` : '' }, [e.start, e.end].filter(Boolean).join(' - '))
    }
  }
  if (profile.certifications.length) {
    w.section('Certifications')
    for (const c of profile.certifications) w.text(`${c.name}${c.issuer ? `, ${c.issuer}` : ''}${c.year ? ` (${c.year})` : ''}`)
  }
  if (profile.languages.length) {
    w.section('Languages')
    w.text(profile.languages.map((l) => `${l.name}${l.level ? ` (${l.level})` : ''}`).join(', '))
  }
  return doc.save()
}

/** The cover letter or proposal on its own page, with the same header as the resume. */
export async function letterPdf(profile: Profile, letter: string, paper: PaperSize = 'a4'): Promise<Uint8Array> {
  const { doc, fonts } = await start(profile, `${profile.basics.name} - Cover letter`)
  const w = new Writer(doc, fonts, SIZES[paper], { x: 60, y: 56 })
  header(w, profile, '')
  w.y -= 18
  for (const para of letter.split(/\n{2,}/)) w.text(para.trim(), { size: 11, gap: 9 })
  return doc.save()
}

/** "Alex Example - Resume - Acme.pdf", safe for any file system. */
export function pdfFileName(name: string, kind: 'Resume' | 'Cover letter', company = ''): string {
  const clean = (s: string) => pdfSafe(s).replace(/[^A-Za-z0-9 .,&()-]/g, '').replace(/\s+/g, ' ').trim()
  return `${[clean(name) || 'Resume', kind, clean(company)].filter(Boolean).join(' - ')}.pdf`
}
