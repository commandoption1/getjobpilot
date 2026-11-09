import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'

import { letterPdf, pdfFileName, pdfSafe, resumePdf } from '../src/core/pdf'
import { baseResume } from '../src/core/resume'
import { sampleProfile } from './fixtures'

describe('PDF download', () => {
  it('keeps text readable in the standard fonts', () => {
    expect(pdfSafe('Selçuk Şahin, Iğdır “quoted” — done…')).toBe('Selçuk Sahin, Igdir "quoted" - done...')
    expect(pdfSafe('東京 ok')).toBe(' ok')
  })

  it('names the file after the person and company', () => {
    expect(pdfFileName('Alex Example', 'Resume', 'Acme/Inc')).toBe('Alex Example - Resume - AcmeInc.pdf')
    expect(pdfFileName('', 'Cover letter')).toBe('Resume - Cover letter.pdf')
  })

  it('builds a real resume and letter PDF', async () => {
    const profile = sampleProfile()
    const resume = baseResume(profile)
    const bytes = await resumePdf(profile, resume, 'a4')
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-')
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1)
    expect(doc.getTitle()).toBe('Alex Example - Resume')
    expect(Math.round(doc.getPage(0).getWidth())).toBe(595)

    const long = { ...resume, experience: resume.experience.map((e) => ({ ...e, bullets: Array.from({ length: 30 }, () => e.bullets[0]!) })) }
    expect((await PDFDocument.load(await resumePdf(profile, long, 'letter'))).getPageCount()).toBeGreaterThan(1)

    const letter = await PDFDocument.load(await letterPdf(profile, 'Hi,\n\nI rebuilt a checkout in Vue 3.\n\nAlex'))
    expect(letter.getPageCount()).toBe(1)
  })
})
