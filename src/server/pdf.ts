import { pdfFileName, type PaperSize } from '../core/pdf'

export const paperFrom = (url: URL): PaperSize => (url.searchParams.get('paper') === 'letter' ? 'letter' : 'a4')

/** A PDF download. `attachment` makes every browser save it instead of opening a viewer. */
export function pdfResponse(bytes: Uint8Array, name: string, kind: 'Resume' | 'Cover letter', company = '') {
  const file = pdfFileName(name, kind, company)
  return new Response(new Uint8Array(bytes), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="${file}"; filename*=UTF-8''${encodeURIComponent(file)}`,
      'cache-control': 'no-store',
    },
  })
}
