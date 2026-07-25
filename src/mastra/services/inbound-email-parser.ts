import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { simpleParser } from 'mailparser'
import type { InboundAttachment, PartialLedgerBill } from '../domain/schemas'
import { dataDirectory } from '../lib/paths'
import {
  documentHash,
  extractBillHints,
  parseDocument,
  requiredBillFields,
  type DocumentMedia
} from './document-parser'

const emailDirectory = resolve(dataDirectory, 'inbound-email')

export interface ParsedInboundEmail {
  messageId?: string
  sourceHash: string
  sourcePath: string
  fromAddress: string
  fromName?: string
  subject: string
  receivedAt: string
  attachments: InboundAttachment[]
  extracted: PartialLedgerBill
  missingFields: string[]
  analysisText: string
  media: DocumentMedia[]
}

const htmlToPlainText = (html: string): string =>
  html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

export const parseInboundEmail = async (source: Buffer): Promise<ParsedInboundEmail> => {
  const sourceHash = documentHash(source)
  await mkdir(emailDirectory, { recursive: true, mode: 0o700 })
  const sourcePath = resolve(emailDirectory, `${sourceHash}.eml`)
  await writeFile(sourcePath, source, { mode: 0o600 })

  const mail = await simpleParser(source, { skipHtmlToText: true })
  const body = mail.text?.trim() || (mail.html ? htmlToPlainText(mail.html) : '')
  const attachments: InboundAttachment[] = []
  const media: DocumentMedia[] = []
  const attachmentText: string[] = []

  for (const attachment of mail.attachments) {
    if (attachment.related) continue
    try {
      const parsed = await parseDocument({
        content: attachment.content,
        contentType: attachment.contentType || 'application/octet-stream',
        filename: attachment.filename || 'attachment.bin'
      })
      attachments.push(parsed.attachment)
      if (parsed.media && media.length < 3) media.push(parsed.media)
      if (parsed.extractedText.trim()) {
        attachmentText.push(`${parsed.attachment.filename}\n${parsed.extractedText}`)
      }
    } catch {
      // Oversized or empty MIME parts are excluded from model context and local persistence.
    }
  }

  const subject = mail.subject?.trim() || 'Untitled inbound email'
  const analysisText = [subject, body, attachmentText.join('\n\n')].filter(Boolean).join('\n\n')
  const extracted = extractBillHints(analysisText, subject)
  const missingFields = requiredBillFields.filter((field) => extracted[field] === undefined)
  const from = mail.from?.value[0]

  return {
    messageId: mail.messageId?.trim() || undefined,
    sourceHash,
    sourcePath,
    fromAddress: from?.address?.trim() || 'unknown',
    fromName: from?.name?.trim() || undefined,
    subject,
    receivedAt: (mail.date ?? new Date()).toISOString(),
    attachments,
    extracted,
    missingFields,
    analysisText,
    media
  }
}
