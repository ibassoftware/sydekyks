/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { WorkerHarness } from './lib/worker-harness.mjs'

const root = resolve(import.meta.dirname, '..')
const testRoot = await mkdtemp(join(tmpdir(), 'sydekyks-functional-'))
const dataDirectory = join(testRoot, 'runtime')
const logDirectory = join(testRoot, 'logs')
const includeGreenMail = process.argv.includes('--greenmail')
const includeLiveOdoo = process.argv.includes('--live-odoo')

const envFile = await readFile(join(root, '.env'), 'utf8').catch(() => '')
const envValue = (name) => {
  const line = envFile.split(/\r?\n/).find((candidate) => candidate.trim().startsWith(`${name}=`))
  if (!line) return process.env[name]
  const value = line.slice(line.indexOf('=') + 1).trim()
  return value.replace(/^(['"])(.*)\1$/, '$2')
}
const apiKey = envValue('OLLAMA_API_KEY')
if (!apiKey) {
  throw new Error('Set OLLAMA_API_KEY in .env to run the live intelligence functional matrix')
}

const expect = (condition, message) => {
  if (!condition) throw new Error(message)
}

const pdf = (lines) => {
  const escaped = lines.map((line) =>
    line.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)')
  )
  const content = [
    'BT',
    '/F1 11 Tf',
    '50 760 Td',
    ...escaped
      .flatMap((line, index) => [index === 0 ? '' : '0 -18 Td', `(${line}) Tj`])
      .filter(Boolean),
    'ET'
  ].join('\n')
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ]
  let value = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(value))
    value += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = Buffer.byteLength(value)
  value += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets.slice(1)) value += `${String(offset).padStart(10, '0')} 00000 n \n`
  value += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(value)
}

const onePixelPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
)

const aiCredentials = { provider: 'ollama-cloud', model: 'minimax-m2.7', apiKey }
const connectCoreGadgets = async (worker) => {
  const ai = await worker.json('/sydekyks/gadgets/ai/connect', {
    method: 'POST',
    body: aiCredentials,
    timeoutMs: 180_000
  })
  expect(ai.connected && ai.model === 'minimax-m2.7', 'Ollama Cloud did not pass both contracts')
  const odoo = await worker.json('/sydekyks/gadgets/odoo/connect', {
    method: 'POST',
    body: { mode: 'demo' }
  })
  expect(odoo.connected && odoo.mode === 'demo', 'Demo Odoo did not connect')
}

const bill = (overrides = {}) => ({
  vendorName: 'Acme Supplies',
  invoiceNumber: `E2E-${Date.now()}`,
  invoiceDate: '2026-07-20',
  currency: 'EUR',
  untaxedAmount: 100,
  taxAmount: 12,
  totalAmount: 112,
  description: 'Office supplies',
  confirmWrite: false,
  ...overrides
})

let worker
let restartMissionId
try {
  worker = await new WorkerHarness({ dataDirectory, logDirectory }).start()
  const unauthorized = await fetch(`${worker.baseUrl}/sydekyks/bootstrap`)
  expect(unauthorized.status === 401, 'The worker accepted an unauthenticated request')

  console.log('1/11 Connecting live AI and disposable demo Odoo…')
  await connectCoreGadgets(worker)

  console.log('2/11 Exercising Syd chat streaming…')
  const chat = await worker.request('/chat/syd', {
    method: 'POST',
    body: {
      id: 'release-chat',
      messages: [
        {
          id: 'release-user-message',
          role: 'user',
          parts: [{ type: 'text', text: 'Reply in one short sentence: Sydekyks is ready.' }]
        }
      ],
      trigger: 'submit-message',
      messageId: 'release-user-message'
    },
    timeoutMs: 180_000
  })
  const chatBody = await chat.text()
  expect(chat.ok && chatBody.length > 20, `Syd chat did not stream a response (${chat.status})`)

  console.log('3/11 Uploading PDF and image documents, including duplicate detection…')
  const pdfBytes = pdf([
    'Vendor: Acme Supplies',
    'Invoice Number: PDF-E2E-20260720',
    'Invoice Date: 2026-07-20',
    'Currency: USD',
    'Description: Office supplies',
    'Untaxed Amount: 100.00',
    'Tax Amount: 12.00',
    'Total Amount: 112.00'
  ])
  const firstDocumentSession = await worker.json('/sydekyks/chat/sessions', { method: 'POST' })
  const upload = async (content, filename, type, sessionId, note) => {
    const form = new FormData()
    form.append('file', new Blob([content], { type }), filename)
    form.append('sessionId', sessionId)
    if (note) form.append('note', note)
    return worker.json('/sydekyks/chat/documents', {
      method: 'POST',
      body: form,
      timeoutMs: 180_000
    })
  }
  const pdfResult = await upload(
    pdfBytes,
    'vendor-bill-e2e.pdf',
    'application/pdf',
    firstDocumentSession.id
  )
  expect(
    pdfResult.document.sourceType === 'chat' &&
      pdfResult.document.chatSessionIds.includes(firstDocumentSession.id) &&
      !pdfResult.duplicate,
    'PDF intake failed'
  )
  const secondDocumentSession = await worker.json('/sydekyks/chat/sessions', { method: 'POST' })
  const duplicatePdf = await upload(
    pdfBytes,
    'vendor-bill-e2e.pdf',
    'application/pdf',
    secondDocumentSession.id
  )
  expect(duplicatePdf.duplicate, 'Repeated PDF content was not deduplicated')
  expect(
    duplicatePdf.document.chatSessionIds.includes(firstDocumentSession.id) &&
      duplicatePdf.document.chatSessionIds.includes(secondDocumentSession.id),
    'Repeated PDF content was not linked to both chat sessions'
  )
  const imageResult = await upload(
    onePixelPng,
    'vendor-bill-e2e.png',
    'image/png',
    firstDocumentSession.id,
    'Vendor: Acme Supplies; Invoice Number: IMG-E2E-20260720; Invoice Date: 2026-07-20; Currency: USD; Description: Office supplies; Untaxed Amount: 100; Tax Amount: 12; Total Amount: 112.'
  )
  expect(
    imageResult.document.sourceType === 'chat' &&
      ['needs_review', 'not_bill', 'ai_required'].includes(imageResult.document.status),
    'Image intake did not return a controlled classification state'
  )

  console.log('4/11 Creating and analyzing the built-in inbound email sample…')
  const sample = await worker.json('/sydekyks/inbound-email/sample', {
    method: 'POST',
    timeoutMs: 180_000
  })
  expect(sample.email?.sourceType === 'email' && !sample.duplicate, 'Sample email intake failed')

  console.log('5/11 Running Ledger dry-run and duplicate guards…')
  const dryRun = await worker.json('/sydekyks/workflows/ledger/vendor-bill', {
    method: 'POST',
    body: bill(),
    timeoutMs: 180_000
  })
  expect(
    dryRun.status === 'completed',
    `Ledger dry-run ended as ${dryRun.status}: ${JSON.stringify({ summary: dryRun.summary, result: dryRun.result })}`
  )
  expect(dryRun.result?.result?.outcome === 'dry-run', 'Ledger did not return a dry-run outcome')
  const duplicate = await worker.json('/sydekyks/workflows/ledger/vendor-bill', {
    method: 'POST',
    body: bill({ invoiceNumber: 'ACME-1000' }),
    timeoutMs: 180_000
  })
  expect(
    duplicate.result?.result?.outcome === 'duplicate',
    'Odoo duplicate guard did not stop the bill'
  )

  console.log('6/11 Exercising sequential partner/tax approvals with a worker restart…')
  const approvalMission = await worker.json('/sydekyks/workflows/ledger/vendor-bill', {
    method: 'POST',
    body: bill({
      vendorName: 'Restart Test Supplies',
      invoiceNumber: 'RESTART-E2E-20260720',
      taxAmount: 10,
      totalAmount: 110,
      confirmWrite: true
    }),
    timeoutMs: 180_000
  })
  expect(approvalMission.status === 'waiting_approval', 'Missing vendor did not request approval')
  const afterPartner = await worker.json(
    `/sydekyks/workflows/ledger/vendor-bill/${approvalMission.id}/resume`,
    { method: 'POST', body: { approved: true, remember: false }, timeoutMs: 180_000 }
  )
  expect(
    afterPartner.status === 'waiting_approval',
    'Missing tax did not request sequential approval'
  )
  restartMissionId = approvalMission.id
  await worker.stop()
  worker = undefined
  worker = await new WorkerHarness({ dataDirectory, logDirectory }).start()
  await connectCoreGadgets(worker)
  const afterRestart = await worker.json(
    `/sydekyks/workflows/ledger/vendor-bill/${restartMissionId}/resume`,
    { method: 'POST', body: { approved: true, remember: false }, timeoutMs: 180_000 }
  )
  expect(afterRestart.status === 'completed', `Restarted approval ended as ${afterRestart.status}`)
  expect(afterRestart.result?.result?.outcome === 'created', 'Approved demo bill was not created')

  console.log('7/11 Running Nudge with its structured CRM contract…')
  const nudge = await worker.json('/sydekyks/workflows/nudge/stale-opportunities', {
    method: 'POST',
    body: { staleAfterDays: 2, limit: 20, notifyOnlyWhenAttention: true },
    timeoutMs: 180_000
  })
  expect(nudge.status === 'completed', `Nudge ended as ${nudge.status}: ${nudge.summary}`)
  expect(nudge.result?.result?.assessment?.source === 'llm', 'Nudge returned no LLM assessment')

  console.log('8/11 Running Mirror candidate screening and line-item confirmation…')
  const mirror = await worker.json('/sydekyks/workflows/mirror/duplicate-bills', {
    method: 'POST',
    body: { lookbackDays: 365, limit: 20, notifyOnlyWhenAttention: true },
    timeoutMs: 240_000
  })
  expect(mirror.status === 'completed', `Mirror ended as ${mirror.status}: ${mirror.summary}`)
  expect(mirror.result?.result?.assessment?.source === 'llm', 'Mirror returned no LLM assessment')
  expect(
    mirror.result.result.assessment.pairs.some(
      (pair) => pair.billIds.includes(1) && pair.billIds.includes(2)
    ),
    'Mirror did not complete the seeded split-vendor comparison'
  )

  console.log('9/11 Running Shield through Watch, Assess, Rank, and Brief…')
  const shield = await worker.json('/sydekyks/workflows/shield/fraud-review', {
    method: 'POST',
    body: { lookbackDays: 365, limit: 20, notifyOnlyWhenAttention: true },
    timeoutMs: 240_000
  })
  expect(shield.status === 'completed', `Shield ended as ${shield.status}: ${shield.summary}`)
  expect(shield.result?.result?.assessment?.source === 'llm', 'Shield returned no LLM assessment')
  expect(shield.result?.result?.brief?.source === 'llm', 'Shield returned no LLM auditor brief')
  expect(
    shield.result.result.phases.map((phase) => phase.id).join(',') === 'watch,assess,rank,brief',
    'Shield did not expose its four required phases in order'
  )

  console.log('10/11 Exercising multi-Sydekyk automation create, run, pause, and delete…')
  const automation = await worker.json('/sydekyks/automations', {
    method: 'POST',
    body: {
      name: 'Release stale-opportunity check',
      ownerSydekykId: 'nudge',
      workflowId: 'nudge-stale-opportunities',
      schedule: {
        kind: 'interval',
        every: 3,
        unit: 'days',
        time: '09:00',
        timezone: 'UTC',
        anchorAt: new Date().toISOString()
      },
      inputData: { staleAfterDays: 2, limit: 20, notifyOnlyWhenAttention: true },
      missedRunPolicy: 'run-on-start',
      status: 'draft'
    }
  })
  const edited = await worker.json(`/sydekyks/automations/${automation.id}`, {
    method: 'PATCH',
    body: { name: 'Release check every three days', inputData: { staleAfterDays: 3 } }
  })
  expect(edited.inputData.staleAfterDays === 3, 'Automation edit was not persisted')
  const activated = await worker.json(`/sydekyks/automations/${automation.id}/status`, {
    method: 'POST',
    body: { status: 'active' }
  })
  expect(activated.status === 'active' && activated.nextRunAt, 'Automation did not activate')
  const automationRun = await worker.json(`/sydekyks/automations/${automation.id}/run`, {
    method: 'POST',
    timeoutMs: 180_000
  })
  expect(automationRun.status === 'completed', 'Automation run-now did not complete')
  const paused = await worker.json(`/sydekyks/automations/${automation.id}/status`, {
    method: 'POST',
    body: { status: 'paused' }
  })
  expect(paused.status === 'paused', 'Automation did not pause')
  const deleted = await worker.json(`/sydekyks/automations/${automation.id}`, {
    method: 'DELETE'
  })
  expect(deleted.deleted, 'Automation deletion was not acknowledged')

  for (const owner of ['mirror', 'shield']) {
    const workflowId = owner === 'mirror' ? 'mirror-duplicate-bills' : 'shield-fraud-review'
    const watchAutomation = await worker.json('/sydekyks/automations', {
      method: 'POST',
      body: {
        name: `Release ${owner} watch`,
        ownerSydekykId: owner,
        workflowId,
        schedule: {
          kind: 'calendar',
          daysOfWeek: [1, 2, 3, 4, 5],
          time: '09:00',
          timezone: 'UTC'
        },
        inputData: { lookbackDays: 365, limit: 20, notifyOnlyWhenAttention: true },
        missedRunPolicy: 'run-on-start',
        status: 'active'
      }
    })
    const watchRun = await worker.json(`/sydekyks/automations/${watchAutomation.id}/run`, {
      method: 'POST',
      timeoutMs: 240_000
    })
    expect(watchRun.status === 'completed', `${owner} automation did not complete`)
    const watchDeleted = await worker.json(`/sydekyks/automations/${watchAutomation.id}`, {
      method: 'DELETE'
    })
    expect(watchDeleted.deleted, `${owner} automation was not deleted`)
  }

  if (includeGreenMail) {
    console.log('11/11 Syncing the five-message GreenMail mailbox…')
    const imap = await worker.json('/sydekyks/gadgets/imap/connect', {
      method: 'POST',
      body: {
        host: '127.0.0.1',
        port: 3143,
        secure: false,
        username: 'ledger',
        password: 'sydekyks',
        mailbox: 'INBOX',
        pollIntervalMinutes: 5,
        processedMailbox: 'Sydekyks/Processed'
      }
    })
    expect(imap.connected, 'GreenMail IMAP did not connect')
    const sync = await worker.json('/sydekyks/gadgets/imap/sync', {
      method: 'POST',
      timeoutMs: 360_000
    })
    expect(sync.processed >= 4, `GreenMail processed only ${sync.processed} unique messages`)
    expect(sync.duplicates >= 1, 'GreenMail duplicate fixture was not detected')
    expect(sync.failed === 0, `GreenMail had ${sync.failed} ingestion failures`)
    const emails = await worker.json('/sydekyks/inbound-email')
    expect(
      emails.emails.some((email) => email.status === 'not_bill'),
      'GreenMail non-bill fixture was not classified as a non-bill'
    )
  } else {
    console.log('11/11 GreenMail skipped (use --greenmail for the Docker-backed mailbox pass).')
  }

  if (includeLiveOdoo) {
    const liveCredentials = {
      url: envValue('SYDEKYKS_TEST_ODOO_URL'),
      database: envValue('SYDEKYKS_TEST_ODOO_DATABASE'),
      username: envValue('SYDEKYKS_TEST_ODOO_USERNAME'),
      secret: envValue('SYDEKYKS_TEST_ODOO_SECRET')
    }
    expect(
      Object.values(liveCredentials).every(Boolean),
      'Live Odoo test environment is incomplete'
    )
    const live = await worker.json('/sydekyks/gadgets/odoo/connect', {
      method: 'POST',
      body: { mode: 'live', ...liveCredentials, liveWrites: false },
      timeoutMs: 180_000
    })
    expect(live.connected && live.mode === 'live' && !live.liveWrites, 'Live read-only Odoo failed')
  }

  await worker.stop()
  worker = undefined
  const logs = await readFile(join(logDirectory, 'worker.jsonl'), 'utf8')
  for (const line of logs.trim().split('\n')) JSON.parse(line)
  expect(!logs.includes(apiKey), 'The AI key appeared in structured logs')
  expect(
    logs.includes('http.request') && logs.includes('mission.updated'),
    'Audit events are missing'
  )

  console.log(
    `Functional matrix passed: live AI, chat, PDF/image, sample email, Ledger, restart recovery, Nudge, Mirror, Shield, multi-Sydekyk automations${includeGreenMail ? ', and GreenMail IMAP' : ''}.`
  )
} finally {
  await worker?.stop().catch(() => undefined)
  await rm(testRoot, { recursive: true, force: true })
}
