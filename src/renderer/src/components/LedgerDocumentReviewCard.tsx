import { useState } from 'react'
import { reanalyzeInboundEmail, reviewInboundEmail } from '../lib/api'
import type { InboundEmail } from '../lib/types'
import { Icon } from './Icon'

interface BillForm {
  vendorName: string
  invoiceNumber: string
  invoiceDate: string
  currency: string
  untaxedAmount: string
  taxAmount: string
  totalAmount: string
  description: string
  accountHint: string
  confirmWrite: boolean
}

const today = new Date().toISOString().slice(0, 10)

const billFromDocument = (document: InboundEmail): BillForm => ({
  vendorName: document.extracted.vendorName ?? '',
  invoiceNumber: document.extracted.invoiceNumber ?? '',
  invoiceDate: document.extracted.invoiceDate ?? today,
  currency: document.extracted.currency ?? 'EUR',
  untaxedAmount:
    document.extracted.untaxedAmount === undefined ? '' : String(document.extracted.untaxedAmount),
  taxAmount: document.extracted.taxAmount === undefined ? '' : String(document.extracted.taxAmount),
  totalAmount:
    document.extracted.totalAmount === undefined ? '' : String(document.extracted.totalAmount),
  description: document.extracted.description ?? document.subject,
  accountHint: document.extracted.accountHint ?? '',
  confirmWrite: false
})

const statusLabel: Record<InboundEmail['status'], string> = {
  needs_review: 'Needs review',
  processing: 'Processing',
  waiting_approval: 'Needs approval',
  completed: 'Completed',
  declined: 'Declined',
  failed: 'Needs attention',
  not_bill: 'Not a bill',
  ai_required: 'AI setup required'
}

export function LedgerDocumentReviewCard({
  document,
  onChanged,
  compact = false,
  collapseContext = false
}: {
  document: InboundEmail
  onChanged: () => Promise<void>
  compact?: boolean
  collapseContext?: boolean
}): React.JSX.Element {
  const [bill, setBill] = useState<BillForm>(() => billFromDocument(document))
  const [open, setOpen] = useState(
    ['needs_review', 'not_bill', 'failed', 'declined'].includes(document.status)
  )
  const [submitting, setSubmitting] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError] = useState<string>()

  const update = <K extends keyof BillForm>(key: K, value: BillForm[K]): void => {
    setBill((current) => ({ ...current, [key]: value }))
  }

  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    setSubmitting(true)
    setError(undefined)
    try {
      await reviewInboundEmail(document.id, {
        ...bill,
        untaxedAmount: Number(bill.untaxedAmount),
        taxAmount: Number(bill.taxAmount),
        totalAmount: Number(bill.totalAmount),
        accountHint: bill.accountHint || undefined
      })
      setOpen(false)
      await onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Ledger could not accept this document')
    } finally {
      setSubmitting(false)
    }
  }

  const analyze = async (): Promise<void> => {
    setAnalyzing(true)
    setError(undefined)
    try {
      await reanalyzeInboundEmail(document.id)
      await onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'AI could not analyze this document')
    } finally {
      setAnalyzing(false)
    }
  }

  const canReview = ['needs_review', 'not_bill', 'failed', 'declined'].includes(document.status)
  const sourceLabel = document.sourceType === 'chat' ? 'Chat upload' : document.mailbox
  const documentContext = (
    <>
      {document.intelligence && (
        <section className="document-intelligence" aria-label="AI document analysis">
          <div className="document-intelligence-heading">
            <span className="ai-mark">
              <Icon name="sparkles" size={17} />
            </span>
            <div>
              <strong>
                {document.intelligence.isBill ? 'Bill detected' : 'May not be a bill'}
              </strong>
              <span>{document.intelligence.documentType.replaceAll('_', ' ')}</span>
            </div>
            <div className="ai-badges">
              <span>{Math.round(document.intelligence.confidence * 100)}% confidence</span>
              <span>AI analyzed</span>
            </div>
          </div>
          <p>{document.intelligence.rationale}</p>
          {(document.intelligence.evidence.length > 0 ||
            document.intelligence.warnings.length > 0) && (
            <details>
              <summary>Evidence and warnings</summary>
              <ul>
                {document.intelligence.evidence.map((item) => (
                  <li key={`evidence-${item}`}>
                    <Icon name="check" size={14} />
                    {item}
                  </li>
                ))}
                {document.intelligence.warnings.map((item) => (
                  <li className="warning" key={`warning-${item}`}>
                    <Icon name="alert" size={14} />
                    {item}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}
      {document.attachments.length > 0 && (
        <ul className="attachment-list">
          {document.attachments.map((attachment) => (
            <li key={attachment.id}>
              <Icon name="paperclip" size={15} />
              <span>{attachment.filename}</span>
              <small>
                {attachment.textExtracted ? 'Text extracted locally' : 'Visual analysis requested'}
              </small>
            </li>
          ))}
        </ul>
      )}
    </>
  )

  return (
    <article
      className={`email-review-card ledger-document-card email-${document.status}${compact ? ' compact' : ''}`}
    >
      <div className="email-review-header">
        <div className="email-icon">
          <Icon name={document.sourceType === 'chat' ? 'document' : 'mail'} />
        </div>
        <div>
          <span>
            {document.sourceType === 'chat'
              ? 'You → Ledger'
              : document.fromName || document.fromAddress}
          </span>
          <h3>{document.subject}</h3>
          <p>{sourceLabel}</p>
        </div>
        <span className={`status-badge email-status-${document.status}`}>
          <Icon
            name={
              document.status === 'completed'
                ? 'check'
                : document.status === 'waiting_approval'
                  ? 'clock'
                  : document.status === 'failed' ||
                      document.status === 'not_bill' ||
                      document.status === 'ai_required'
                    ? 'alert'
                    : 'document'
            }
            size={14}
          />
          {statusLabel[document.status]}
        </span>
      </div>
      <div className="email-metadata">
        <span>{sourceLabel}</span>
        <span>{new Date(document.receivedAt).toLocaleString()}</span>
        <span>
          {document.attachments.length} file{document.attachments.length === 1 ? '' : 's'}
        </span>
      </div>
      {collapseContext && (document.intelligence || document.attachments.length > 0) ? (
        <details className="email-context-details">
          <summary>
            <span>
              <Icon name="sparkles" size={17} />
              Document analysis
            </span>
            <span className="email-context-meta">
              {document.intelligence &&
                `${Math.round(document.intelligence.confidence * 100)}% confidence`}
              {document.intelligence && document.attachments.length > 0 && ' · '}
              {document.attachments.length > 0 &&
                `${document.attachments.length} file${document.attachments.length === 1 ? '' : 's'}`}
              <Icon name="chevron-down" size={17} />
            </span>
          </summary>
          <div className="email-context-content">{documentContext}</div>
        </details>
      ) : (
        documentContext
      )}
      {(document.error || error) && (
        <div className="inline-alert error" role="alert">
          <Icon name="alert" size={18} />
          {error ?? document.error}
        </div>
      )}
      {document.status === 'ai_required' && (
        <button
          className="primary-button email-review-toggle"
          disabled={analyzing}
          onClick={() => void analyze()}
          type="button"
        >
          <Icon name={analyzing ? 'refresh' : 'sparkles'} size={18} />
          {analyzing ? 'Analyzing with AI…' : 'Analyze with configured AI'}
        </button>
      )}
      {canReview && (
        <button
          aria-expanded={open}
          className="secondary-button email-review-toggle"
          onClick={() => setOpen(!open)}
          type="button"
        >
          <Icon name="document" size={18} />
          {open
            ? 'Hide extracted fields'
            : document.status === 'not_bill'
              ? 'Override and process as a bill'
              : document.status === 'failed' || document.status === 'declined'
                ? 'Review and retry Ledger'
                : 'Review extracted fields'}
        </button>
      )}
      {open && canReview && (
        <form className="form-grid email-review-form" onSubmit={(event) => void submit(event)}>
          <label>
            <span>Vendor name</span>
            <input
              required
              value={bill.vendorName}
              onChange={(e) => update('vendorName', e.target.value)}
            />
          </label>
          <label>
            <span>Invoice number</span>
            <input
              required
              value={bill.invoiceNumber}
              onChange={(e) => update('invoiceNumber', e.target.value)}
            />
          </label>
          <label>
            <span>Invoice date</span>
            <input
              required
              type="date"
              value={bill.invoiceDate}
              onChange={(e) => update('invoiceDate', e.target.value)}
            />
          </label>
          <label>
            <span>Currency</span>
            <input
              maxLength={3}
              required
              value={bill.currency}
              onChange={(e) => update('currency', e.target.value.toUpperCase())}
            />
          </label>
          <label>
            <span>Untaxed amount</span>
            <input
              min="0"
              required
              step="0.01"
              type="number"
              value={bill.untaxedAmount}
              onChange={(e) => update('untaxedAmount', e.target.value)}
            />
          </label>
          <label>
            <span>Tax amount</span>
            <input
              min="0"
              required
              step="0.01"
              type="number"
              value={bill.taxAmount}
              onChange={(e) => update('taxAmount', e.target.value)}
            />
          </label>
          <label>
            <span>Total amount</span>
            <input
              min="0.01"
              required
              step="0.01"
              type="number"
              value={bill.totalAmount}
              onChange={(e) => update('totalAmount', e.target.value)}
            />
          </label>
          <label>
            <span>
              Account hint <small>optional</small>
            </span>
            <input
              value={bill.accountHint}
              onChange={(e) => update('accountHint', e.target.value)}
            />
          </label>
          <label className="span-two">
            <span>Description</span>
            <input
              required
              value={bill.description}
              onChange={(e) => update('description', e.target.value)}
            />
          </label>
          <label className="toggle-field span-two">
            <input
              checked={bill.confirmWrite}
              onChange={(e) => update('confirmWrite', e.target.checked)}
              type="checkbox"
            />
            <span className="toggle-track" aria-hidden="true">
              <span />
            </span>
            <span>
              <strong>Create the Odoo draft after checks</strong>
              <small>Leave off to run Ledger as a dry-run.</small>
            </span>
          </label>
          <div className="form-footer span-two">
            <p>
              <Icon name="shield" size={16} />
              This starts the same approval-aware Ledger workflow for chat and email.
            </p>
            <button className="primary-button" disabled={submitting} type="submit">
              <Icon name={submitting ? 'refresh' : 'bolt'} size={18} />
              {submitting ? 'Starting Ledger…' : 'Send verified bill to Ledger'}
            </button>
          </div>
        </form>
      )}
    </article>
  )
}
