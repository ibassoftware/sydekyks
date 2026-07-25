import { createHash, randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { basename, extname, resolve } from 'node:path'
import type { InboundAttachment, PartialLedgerBill } from '../domain/schemas'
import { dataDirectory } from '../lib/paths'

const documentDirectory = resolve(dataDirectory, 'documents')

export const maximumDocumentBytes = 15 * 1024 * 1024

export const requiredBillFields = [
  'vendorName',
  'invoiceNumber',
  'invoiceDate',
  'currency',
  'untaxedAmount',
  'taxAmount',
  'totalAmount',
  'description'
] as const satisfies ReadonlyArray<keyof PartialLedgerBill>

export interface DocumentMedia {
  content: Buffer
  contentType: 'application/pdf' | 'image/jpeg' | 'image/png'
  filename: string
}

export interface ParsedDocument {
  attachment: InboundAttachment
  extracted: PartialLedgerBill
  extractedText: string
  media?: DocumentMedia
}

export const documentHash = (value: Uint8Array): string =>
  createHash('sha256').update(value).digest('hex')

export const safeDocumentFilename = (filename: string): string => {
  const cleaned = basename(filename)
    .normalize('NFKC')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return cleaned || 'document.bin'
}

const extractPdfText = async (content: Buffer): Promise<string> => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(content),
    useSystemFonts: true
  })
  const document = await loadingTask.promise
  try {
    const pages: string[] = []
    for (let pageNumber = 1; pageNumber <= Math.min(document.numPages, 25); pageNumber += 1) {
      const page = await document.getPage(pageNumber)
      const text = await page.getTextContent()
      pages.push(
        text.items
          .map((item) => ('str' in item ? item.str : ''))
          .filter(Boolean)
          .join(' ')
      )
    }
    return pages.join('\n')
  } finally {
    await loadingTask.destroy()
  }
}

const capture = (text: string, patterns: RegExp[]): string | undefined => {
  for (const pattern of patterns) {
    const value = pattern.exec(text)?.[1]?.trim()
    if (value) return value
  }
  return undefined
}

const parseAmount = (value: string | undefined): number | undefined => {
  if (!value) return undefined
  const normalized = value
    .replace(/[^0-9,.-]/g, '')
    .replace(/,(?=\d{3}(?:\D|$))/g, '')
    .replace(',', '.')
  const number = Number(normalized)
  return Number.isFinite(number) ? Number(number.toFixed(2)) : undefined
}

const parseDate = (value: string | undefined): string | undefined => {
  if (!value) return undefined
  const iso = /\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/.exec(value)
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`
  const local = /\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\b/.exec(value)
  if (!local) return undefined
  return `${local[3]}-${local[2].padStart(2, '0')}-${local[1].padStart(2, '0')}`
}

const inferCurrency = (text: string): string | undefined => {
  const explicit = /\b(?:currency)\s*[:#-]?\s*(EUR|USD|GBP|PHP|AUD|CAD|JPY|CHF)\b/i.exec(text)?.[1]
  if (explicit) return explicit.toUpperCase()
  if (text.includes('€')) return 'EUR'
  if (/\bPHP\b|₱/.test(text)) return 'PHP'
  if (/\bGBP\b|£/.test(text)) return 'GBP'
  if (/\bUSD\b|\$/.test(text)) return 'USD'
  return undefined
}

export const extractBillHints = (text: string, fallbackDescription: string): PartialLedgerBill => {
  const vendorName = capture(text, [
    /(?:^|\n)\s*(?:vendor|supplier|sold by)\s*[:#-]\s*([^\n\r]+)/im,
    /(?:^|\n)\s*(?:from)\s*[:#-]\s*([^\n\r]+)/im
  ])
  const invoiceNumber = capture(text, [
    /(?:invoice|bill)\s*(?:number|no\.?|#)\s*[:#-]?\s*([A-Z0-9][A-Z0-9_./-]*)/i,
    /(?:^|\n)\s*(?:reference)\s*[:#-]\s*([A-Z0-9][A-Z0-9_./-]*)/im
  ])
  const invoiceDate = parseDate(
    capture(text, [
      /(?:invoice|bill)\s*date\s*[:#-]?\s*([^\n\r]+)/i,
      /(?:^|\n)\s*date\s*[:#-]\s*([^\n\r]+)/im
    ])
  )
  const untaxedAmount = parseAmount(
    capture(text, [/(?:^|\n)\s*(?:untaxed|subtotal|net amount)\s*[:#-]?\s*([^\n\r]+)/im])
  )
  const explicitTaxAmount = capture(text, [
    /(?:^|\n)\s*(?:tax amount|vat amount)\s*[:#-]?\s*([^\n\r]+)/im
  ])
  const genericTaxValue = capture(text, [/(?:^|\n)\s*(?:tax|vat)\s*[:#-]?\s*([^\n\r]+)/im])
  const taxAmount = parseAmount(
    explicitTaxAmount ?? (genericTaxValue?.includes('%') ? undefined : genericTaxValue)
  )
  const totalAmount = parseAmount(
    capture(text, [
      /(?:^|\n)\s*(?:grand total|amount due|total amount|total)\s*[:#-]?\s*([^\n\r]+)/im
    ])
  )
  const description =
    capture(text, [/(?:^|\n)\s*(?:description|memo|item)\s*[:#-]\s*([^\n\r]+)/im]) ??
    fallbackDescription
  const accountHint = capture(text, [
    /(?:^|\n)\s*(?:account|expense account)\s*[:#-]\s*([^\n\r]+)/im
  ])

  return {
    vendorName,
    invoiceNumber,
    invoiceDate,
    currency: inferCurrency(text),
    untaxedAmount,
    taxAmount,
    totalAmount,
    description,
    accountHint
  }
}

const sniffContentType = (content: Buffer, declared: string, filename: string): string => {
  if (content.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf'
  if (content.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return 'image/png'
  }
  if (content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff) return 'image/jpeg'
  const extension = extname(filename).toLowerCase()
  if (declared.startsWith('text/') || ['.txt', '.csv', '.json'].includes(extension)) {
    return declared.startsWith('text/') ? declared : 'text/plain'
  }
  return declared || 'application/octet-stream'
}

export const parseDocument = async (input: {
  content: Buffer
  contentType: string
  filename: string
  strict?: boolean
}): Promise<ParsedDocument> => {
  if (input.content.length === 0) throw new Error('The selected document is empty')
  if (input.content.length > maximumDocumentBytes) {
    throw new Error('Documents must be 15 MB or smaller')
  }
  const filename = safeDocumentFilename(input.filename)
  const contentType = sniffContentType(input.content, input.contentType, filename)
  const supportedInChat =
    contentType === 'application/pdf' || contentType === 'image/png' || contentType === 'image/jpeg'
  if (input.strict && !supportedInChat) {
    throw new Error('Ledger accepts PDF, PNG, or JPEG documents in chat')
  }

  const sha256 = documentHash(input.content)
  const localPath = resolve(documentDirectory, `${sha256.slice(0, 16)}-${filename}`)
  await mkdir(documentDirectory, { recursive: true, mode: 0o700 })
  await writeFile(localPath, input.content, { mode: 0o600 })

  let extractedText = ''
  try {
    if (contentType === 'application/pdf') extractedText = await extractPdfText(input.content)
    else if (contentType.startsWith('text/')) extractedText = input.content.toString('utf8')
  } catch {
    extractedText = ''
  }

  const attachment: InboundAttachment = {
    id: randomUUID(),
    filename,
    contentType,
    size: input.content.length,
    sha256,
    localPath,
    textExtracted: Boolean(extractedText.trim())
  }
  const visualType = ['application/pdf', 'image/jpeg', 'image/png'].includes(contentType)
    ? (contentType as DocumentMedia['contentType'])
    : undefined
  return {
    attachment,
    extracted: extractBillHints(extractedText, filename),
    extractedText,
    media:
      visualType && (!extractedText.trim() || visualType.startsWith('image/'))
        ? { content: input.content, contentType: visualType, filename }
        : undefined
  }
}
