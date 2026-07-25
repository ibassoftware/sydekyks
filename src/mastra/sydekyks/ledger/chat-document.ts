import { extractBillHints, parseDocument, requiredBillFields } from '../../services/document-parser'
import { ingestParsedLedgerDocument, type IngestResult } from './inbound-email'

export interface ChatDocumentInput {
  content: Buffer
  contentType: string
  filename: string
  note?: string
  sessionId: string
}

export const ingestChatDocument = async (input: ChatDocumentInput): Promise<IngestResult> => {
  const parsed = await parseDocument({
    content: input.content,
    contentType: input.contentType,
    filename: input.filename,
    strict: true
  })
  const note = input.note?.trim().slice(0, 2_000)
  const analysisText = [note, parsed.attachment.filename, parsed.extractedText]
    .filter(Boolean)
    .join('\n\n')
  const extracted = extractBillHints(analysisText, parsed.attachment.filename)

  return ingestParsedLedgerDocument(
    {
      sourceHash: parsed.attachment.sha256,
      sourcePath: parsed.attachment.localPath,
      fromAddress: 'local-user@sydekyks.local',
      fromName: 'You',
      subject: parsed.attachment.filename,
      receivedAt: new Date().toISOString(),
      attachments: [parsed.attachment],
      extracted,
      missingFields: requiredBillFields.filter((field) => extracted[field] === undefined),
      analysisText,
      media: parsed.media ? [parsed.media] : []
    },
    { mailbox: 'Chat', sourceType: 'chat', chatSessionId: input.sessionId }
  )
}
