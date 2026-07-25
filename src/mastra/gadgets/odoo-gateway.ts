import type { GenericOdooRequest, OdooCredentials, OdooPublicStatus } from '../domain/schemas'
import { isValidOdooModelName } from '../../shared/odoo-read-policy'
import { appStore } from '../lib/app-store'

type OdooRecord = Record<string, unknown> & { id: number }
type Domain = NonNullable<GenericOdooRequest['domain']>

const writableModels = new Set(['res.partner', 'account.tax', 'account.move'])
const genericWritableModels = new Set(['res.partner', 'account.move'])

export interface ConnectionTest {
  userId: number
  serverVersion?: string
}

export interface OdooGateway {
  readonly mode: 'demo' | 'live'
  fieldsGet(model: string, fields?: string[]): Promise<Record<string, unknown>>
  search(model: string, domain?: Domain, limit?: number, offset?: number): Promise<number[]>
  read(model: string, ids: number[], fields?: string[]): Promise<OdooRecord[]>
  searchRead(
    model: string,
    domain?: Domain,
    fields?: string[],
    limit?: number,
    offset?: number
  ): Promise<OdooRecord[]>
  create(model: string, values: Record<string, unknown>): Promise<number>
  write(model: string, ids: number[], values: Record<string, unknown>): Promise<boolean>
  test(): Promise<ConnectionTest>
}

const ensureModelAllowed = (model: string, write = false): void => {
  if (!isValidOdooModelName(model)) {
    throw new Error(`Model ${model} is not a valid Odoo model name`)
  }
  if (write && !writableModels.has(model)) {
    throw new Error(`Writes to ${model} are not allowed by this Gadget`)
  }
}

class DemoOdooGateway implements OdooGateway {
  readonly mode = 'demo' as const
  private loaded = false
  private records: Record<string, OdooRecord[]> = {
    'ir.model': [
      { id: 1, name: 'Contact', model: 'res.partner', transient: false },
      { id: 2, name: 'Vendor Bill', model: 'account.move', transient: false },
      { id: 3, name: 'Vendor Bill Line', model: 'account.move.line', transient: false },
      { id: 4, name: 'CRM Lead', model: 'crm.lead', transient: false },
      { id: 5, name: 'Activity', model: 'mail.activity', transient: false },
      { id: 6, name: 'Message', model: 'mail.message', transient: false }
    ],
    'res.partner': [
      {
        id: 1,
        name: 'Acme Supplies',
        supplier_rank: 1,
        email: 'billing@acme.example',
        vat: 'EU-ACME-001',
        bank_ids: [501],
        create_date: '2025-01-10 09:00:00',
        write_date: '2026-06-15 14:00:00',
        active: true
      },
      {
        id: 2,
        name: 'Acme Supplies Europe',
        supplier_rank: 1,
        email: 'invoices-eu@acme.example',
        vat: 'EU-ACME-001',
        bank_ids: [502],
        create_date: '2026-07-18 10:00:00',
        write_date: '2026-07-20 08:30:00',
        active: true
      },
      {
        id: 3,
        name: 'Gotham Facility Services',
        supplier_rank: 1,
        email: 'accounts@gotham-facilities.example',
        vat: 'EU-GFS-901',
        bank_ids: [503],
        create_date: '2026-07-19 10:30:00',
        write_date: '2026-07-20 12:00:00',
        active: true
      }
    ],
    'res.partner.bank': [
      { id: 501, partner_id: [1, 'Acme Supplies'], acc_number: 'DEMO-ACME-PRIMARY' },
      { id: 502, partner_id: [2, 'Acme Supplies Europe'], acc_number: 'DEMO-ACME-PRIMARY' },
      { id: 503, partner_id: [3, 'Gotham Facility Services'], acc_number: 'DEMO-GFS-NEW' }
    ],
    'account.tax': [
      { id: 1, name: 'Purchase VAT 12%', amount: 12, type_tax_use: 'purchase', active: true },
      { id: 2, name: 'Purchase Tax 0%', amount: 0, type_tax_use: 'purchase', active: true }
    ],
    'account.account': [
      { id: 1, code: '610000', name: 'Office Supplies', account_type: 'expense' },
      { id: 2, code: '600000', name: 'Purchases', account_type: 'expense' },
      { id: 3, code: '140000', name: 'Inventory', account_type: 'asset_current' }
    ],
    'account.move': [
      {
        id: 1,
        name: 'BILL/2026/0001',
        ref: 'ACME-1000',
        move_type: 'in_invoice',
        partner_id: [1, 'Acme Supplies'],
        invoice_date: '2026-01-05',
        create_date: '2026-01-05 09:00:00',
        write_date: '2026-01-05 09:10:00',
        state: 'posted',
        payment_state: 'not_paid',
        amount_untaxed: 100,
        amount_total: 112,
        currency_id: [1, 'EUR']
      },
      {
        id: 2,
        name: 'BILL/2026/0002',
        ref: 'ACME-1000-RESUBMITTED',
        move_type: 'in_invoice',
        partner_id: [2, 'Acme Supplies Europe'],
        invoice_date: '2026-01-05',
        create_date: '2026-07-20 08:45:00',
        write_date: '2026-07-20 08:50:00',
        state: 'draft',
        payment_state: 'not_paid',
        amount_untaxed: 100,
        amount_total: 112,
        currency_id: [1, 'EUR']
      },
      {
        id: 3,
        name: 'BILL/2026/0003',
        ref: 'GFS-JUL-2026-19',
        move_type: 'in_invoice',
        partner_id: [3, 'Gotham Facility Services'],
        invoice_date: '2026-07-19',
        create_date: '2026-07-20 12:10:00',
        write_date: '2026-07-20 12:12:00',
        state: 'draft',
        payment_state: 'not_paid',
        amount_untaxed: 4_463.39,
        amount_total: 4_999,
        currency_id: [1, 'EUR']
      }
    ],
    'account.move.line': [
      {
        id: 1,
        move_id: [1, 'BILL/2026/0001'],
        partner_id: [1, 'Acme Supplies'],
        account_id: [1, '610000 Office Supplies'],
        name: 'A4 copy paper and toner cartridges',
        quantity: 1,
        price_unit: 100,
        price_subtotal: 100,
        parent_state: 'posted',
        display_type: 'product'
      },
      {
        id: 2,
        move_id: [2, 'BILL/2026/0002'],
        partner_id: [2, 'Acme Supplies Europe'],
        account_id: [1, '610000 Office Supplies'],
        name: 'A4 copy paper and toner cartridges',
        quantity: 1,
        price_unit: 100,
        price_subtotal: 100,
        parent_state: 'draft',
        display_type: 'product'
      },
      {
        id: 3,
        move_id: [3, 'BILL/2026/0003'],
        partner_id: [3, 'Gotham Facility Services'],
        account_id: [2, '600000 Purchases'],
        name: 'Emergency facilities support',
        quantity: 1,
        price_unit: 4_463.39,
        price_subtotal: 4_463.39,
        parent_state: 'draft',
        display_type: 'product'
      }
    ],
    'res.currency': [{ id: 1, name: 'EUR', symbol: '€', active: true }],
    'res.company': [{ id: 1, name: 'Sydekyks Demo Company' }],
    'account.journal': [{ id: 1, name: 'Vendor Bills', type: 'purchase', code: 'BILL' }],
    'crm.lead': [
      {
        id: 101,
        name: 'Gotham Transit renewal',
        type: 'opportunity',
        active: true,
        stage_id: [3, 'Proposal'],
        user_id: [7, 'Barbara Gordon'],
        expected_revenue: 45_000,
        probability: 75,
        write_date: '2026-07-16 08:30:00',
        date_last_stage_update: '2026-07-12 15:00:00'
      },
      {
        id: 102,
        name: 'Wayne Foundation onboarding',
        type: 'opportunity',
        active: true,
        stage_id: [2, 'Qualified'],
        user_id: [8, 'Dick Grayson'],
        expected_revenue: 18_000,
        probability: 45,
        write_date: '2026-07-19 11:45:00',
        date_last_stage_update: '2026-07-18 09:15:00'
      },
      {
        id: 103,
        name: 'Arkham facilities expansion',
        type: 'opportunity',
        active: true,
        stage_id: [4, 'Negotiation'],
        user_id: [9, 'Cassandra Cain'],
        expected_revenue: 82_000,
        probability: 85,
        write_date: '2026-07-14 13:20:00',
        date_last_stage_update: '2026-07-10 10:00:00'
      },
      {
        id: 104,
        name: 'Ace Chemicals discovery',
        type: 'opportunity',
        active: true,
        stage_id: [1, 'New'],
        user_id: [7, 'Barbara Gordon'],
        expected_revenue: 6_500,
        probability: 10,
        write_date: '2026-07-05 16:10:00',
        date_last_stage_update: '2026-07-05 16:10:00'
      }
    ],
    'mail.activity': [
      {
        id: 301,
        res_model: 'crm.lead',
        res_id: 102,
        date_deadline: '2026-07-22',
        activity_type_id: [1, 'Call'],
        user_id: [8, 'Dick Grayson'],
        summary: 'Confirm onboarding workshop',
        state: 'planned'
      },
      {
        id: 302,
        res_model: 'crm.lead',
        res_id: 103,
        date_deadline: '2026-07-17',
        activity_type_id: [2, 'Email'],
        user_id: [9, 'Cassandra Cain'],
        summary: 'Send revised commercial terms',
        state: 'overdue'
      }
    ],
    'mail.message': [
      {
        id: 401,
        model: 'crm.lead',
        res_id: 101,
        date: '2026-07-16 08:15:00',
        message_type: 'email',
        subject: 'Re: renewal proposal',
        author_id: [21, 'Gotham Transit Procurement'],
        email_from: 'procurement@gotham-transit.example',
        body: '<p>We reviewed the proposal. Can you confirm the implementation timeline?</p>'
      },
      {
        id: 402,
        model: 'crm.lead',
        res_id: 102,
        date: '2026-07-19 11:40:00',
        message_type: 'email',
        subject: 'Workshop confirmed',
        author_id: [8, 'Dick Grayson'],
        email_from: 'dick@sydekyks.local',
        body: '<p>Thanks — our onboarding workshop is booked for Wednesday.</p>'
      },
      {
        id: 403,
        model: 'crm.lead',
        res_id: 103,
        date: '2026-07-13 09:00:00',
        message_type: 'comment',
        subject: 'Pricing requested',
        author_id: [22, 'Arkham Facilities'],
        email_from: 'facilities@arkham.example',
        body: '<p>Please send the revised commercial terms before our budget review.</p>'
      },
      {
        id: 404,
        model: 'res.partner',
        res_id: 3,
        date: '2026-07-20 12:00:00',
        message_type: 'notification',
        subject: 'Vendor bank details changed',
        author_id: [7, 'Barbara Gordon'],
        tracking_value_ids: [601],
        body: '<p>Vendor payment details were updated.</p>'
      }
    ],
    'mail.tracking.value': [
      {
        id: 601,
        field_id: [77, 'Bank Accounts'],
        old_value_char: 'Previous bank account',
        new_value_char: 'Updated bank account'
      }
    ]
  }

  async test(): Promise<ConnectionTest> {
    await this.ensureLoaded()
    return { userId: 1, serverVersion: 'Sydekyks demo 1.0' }
  }

  async fieldsGet(model: string, fields?: string[]): Promise<Record<string, unknown>> {
    await this.ensureLoaded()
    ensureModelAllowed(model)
    const sample = this.records[model]?.[0] ?? { id: 0 }
    return Object.fromEntries(
      Object.keys(sample)
        .filter((field) => !fields?.length || fields.includes(field))
        .map((field) => [
          field,
          { string: field.replaceAll('_', ' '), type: this.fieldType(sample[field]) }
        ])
    )
  }

  async search(model: string, domain: Domain = [], limit = 20, offset = 0): Promise<number[]> {
    await this.ensureLoaded()
    ensureModelAllowed(model)
    return (this.records[model] ?? [])
      .filter((record) => this.matches(record, domain))
      .slice(offset, offset + limit)
      .map((record) => record.id)
  }

  async read(model: string, ids: number[], fields?: string[]): Promise<OdooRecord[]> {
    await this.ensureLoaded()
    ensureModelAllowed(model)
    return (this.records[model] ?? [])
      .filter((record) => ids.includes(record.id))
      .map((record) => this.pick(record, fields))
  }

  async searchRead(
    model: string,
    domain: Domain = [],
    fields?: string[],
    limit = 20,
    offset = 0
  ): Promise<OdooRecord[]> {
    const ids = await this.search(model, domain, limit, offset)
    return this.read(model, ids, fields)
  }

  async create(model: string, values: Record<string, unknown>): Promise<number> {
    await this.ensureLoaded()
    ensureModelAllowed(model, true)
    const collection = (this.records[model] ??= [])
    const id = Math.max(0, ...collection.map((record) => record.id)) + 1
    collection.push({ id, ...structuredClone(values) })
    await this.persist()
    return id
  }

  async write(model: string, ids: number[], values: Record<string, unknown>): Promise<boolean> {
    await this.ensureLoaded()
    ensureModelAllowed(model, true)
    let changed = false
    this.records[model] = (this.records[model] ?? []).map((record) => {
      if (!ids.includes(record.id)) return record
      changed = true
      return { ...record, ...structuredClone(values) }
    })
    if (changed) await this.persist()
    return changed
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return
    const saved = await appStore.getSetting<Record<string, OdooRecord[]>>('odoo.demo.records')
    if (saved) this.records = { ...this.records, ...saved }
    else await this.persist()
    this.loaded = true
  }

  private async persist(): Promise<void> {
    await appStore.setSetting('odoo.demo.records', this.records)
  }

  private pick(record: OdooRecord, fields?: string[]): OdooRecord {
    if (!fields?.length) return structuredClone(record)
    return Object.fromEntries(
      ['id', ...fields]
        .filter((field, index, all) => all.indexOf(field) === index)
        .map((field) => [field, record[field]])
    ) as OdooRecord
  }

  private matches(record: OdooRecord, domain: Domain): boolean {
    return domain.every((condition) => {
      if (typeof condition === 'string') return true
      const [field, operator, expected] = condition
      const actual = record[field]
      const comparable = Array.isArray(actual) ? actual[0] : actual
      if (operator === '=') return comparable === expected
      if (operator === '!=') return comparable !== expected
      if (operator === 'in') return Array.isArray(expected) && expected.includes(comparable)
      if (operator === '>=' || operator === '<=' || operator === '>' || operator === '<') {
        const left = typeof comparable === 'number' ? comparable : String(comparable ?? '')
        const right = typeof expected === 'number' ? expected : String(expected ?? '')
        if (operator === '>=') return left >= right
        if (operator === '<=') return left <= right
        if (operator === '>') return left > right
        return left < right
      }
      if (operator === 'ilike') {
        return String(Array.isArray(actual) ? actual[1] : (actual ?? ''))
          .toLocaleLowerCase()
          .includes(String(expected).toLocaleLowerCase())
      }
      if (operator === '=ilike') {
        return (
          String(Array.isArray(actual) ? actual[1] : (actual ?? '')).toLocaleLowerCase() ===
          String(expected).toLocaleLowerCase()
        )
      }
      return false
    })
  }

  private fieldType(value: unknown): string {
    if (typeof value === 'boolean') return 'boolean'
    if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'float'
    if (Array.isArray(value)) return 'many2one'
    return 'char'
  }
}

class LiveOdooGateway implements OdooGateway {
  readonly mode = 'live' as const
  private userId?: number
  private requestId = 0

  constructor(private readonly credentials: Extract<OdooCredentials, { mode: 'live' }>) {}

  async test(): Promise<ConnectionTest> {
    const version = await this.rpc<Record<string, unknown>>('common', 'version', [])
    const userId = await this.rpc<number | false>('common', 'authenticate', [
      this.credentials.database,
      this.credentials.username,
      this.credentials.secret,
      {}
    ])
    if (!userId) throw new Error('Odoo rejected the database, username, or API key')
    this.userId = userId
    await this.execute('res.users', 'read', [[userId], ['name']])
    return {
      userId,
      serverVersion: typeof version.server_version === 'string' ? version.server_version : undefined
    }
  }

  async fieldsGet(model: string, fields?: string[]): Promise<Record<string, unknown>> {
    ensureModelAllowed(model)
    return this.execute(model, 'fields_get', [
      fields ?? [],
      ['string', 'type', 'required', 'readonly']
    ])
  }

  async search(model: string, domain: Domain = [], limit = 20, offset = 0): Promise<number[]> {
    ensureModelAllowed(model)
    return this.execute(model, 'search', [domain], { limit, offset })
  }

  async read(model: string, ids: number[], fields?: string[]): Promise<OdooRecord[]> {
    ensureModelAllowed(model)
    return this.execute(model, 'read', [ids], fields?.length ? { fields } : {})
  }

  async searchRead(
    model: string,
    domain: Domain = [],
    fields?: string[],
    limit = 20,
    offset = 0
  ): Promise<OdooRecord[]> {
    ensureModelAllowed(model)
    return this.execute(model, 'search_read', [domain], {
      ...(fields?.length ? { fields } : {}),
      limit,
      offset
    })
  }

  async create(model: string, values: Record<string, unknown>): Promise<number> {
    ensureModelAllowed(model, true)
    return this.execute(model, 'create', [values])
  }

  async write(model: string, ids: number[], values: Record<string, unknown>): Promise<boolean> {
    ensureModelAllowed(model, true)
    return this.execute(model, 'write', [ids, values])
  }

  private async execute<T>(
    model: string,
    method: string,
    args: unknown[],
    kwargs: Record<string, unknown> = {}
  ): Promise<T> {
    const userId = this.userId ?? (await this.test()).userId
    const context = this.credentials.companyId
      ? {
          allowed_company_ids: [this.credentials.companyId],
          company_id: this.credentials.companyId
        }
      : {}
    return this.rpc<T>('object', 'execute_kw', [
      this.credentials.database,
      userId,
      this.credentials.secret,
      model,
      method,
      args,
      { ...kwargs, context }
    ])
  }

  private async rpc<T>(service: string, method: string, args: unknown[]): Promise<T> {
    const endpoint = new URL('/jsonrpc', this.credentials.url)
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'call',
        params: { service, method, args },
        id: ++this.requestId
      }),
      signal: AbortSignal.timeout(15_000)
    })
    if (!response.ok) throw new Error(`Odoo responded with HTTP ${response.status}`)
    const payload = (await response.json()) as {
      result?: T
      error?: { data?: { message?: string }; message?: string }
    }
    if (payload.error) {
      throw new Error(payload.error.data?.message ?? payload.error.message ?? 'Odoo request failed')
    }
    return payload.result as T
  }
}

class OdooGadget {
  private gateway: OdooGateway = new DemoOdooGateway()
  private status: OdooPublicStatus = {
    mode: 'demo',
    connected: true,
    label: 'Demo Company',
    liveWrites: false,
    connectedAt: new Date().toISOString(),
    serverVersion: 'Sydekyks demo 1.0'
  }

  async initialize(): Promise<void> {
    const saved = await appStore.getOdooStatus()
    if (saved?.mode === 'live') {
      this.status = {
        ...saved,
        connected: false,
        label: `${saved.database ?? 'Odoo'} (credentials locked)`
      }
      return
    }
    await appStore.saveOdooStatus(this.status)
  }

  getGateway(): OdooGateway {
    return this.gateway
  }

  getStatus(): OdooPublicStatus {
    return { ...this.status }
  }

  async connect(credentials: OdooCredentials): Promise<OdooPublicStatus> {
    if (credentials.mode === 'demo') {
      this.gateway = new DemoOdooGateway()
      const test = await this.gateway.test()
      this.status = {
        mode: 'demo',
        connected: true,
        label: 'Demo Company',
        liveWrites: false,
        connectedAt: new Date().toISOString(),
        serverVersion: test.serverVersion
      }
      await appStore.saveOdooStatus(this.status)
      return this.getStatus()
    }

    const gateway = new LiveOdooGateway(credentials)
    const test = await gateway.test()
    this.gateway = gateway
    this.status = {
      mode: 'live',
      connected: true,
      label: credentials.database,
      url: credentials.url,
      database: credentials.database,
      username: credentials.username,
      companyId: credentials.companyId,
      liveWrites: credentials.liveWrites,
      connectedAt: new Date().toISOString(),
      serverVersion: test.serverVersion
    }
    await appStore.saveOdooStatus(this.status)
    return this.getStatus()
  }

  async disconnect(): Promise<OdooPublicStatus> {
    return this.connect({ mode: 'demo' })
  }
}

export const odooGadget = new OdooGadget()
export const odooGadgetReady = odooGadget.initialize()

export interface OdooModelDescriptor {
  name: string
  model: string
}

const modelDiscoveryTerms = (query: string): string[] => {
  const normalized = query.trim().toLocaleLowerCase()
  const terms = new Set([normalized])
  const ignored = new Set([
    'all',
    'any',
    'check',
    'do',
    'find',
    'for',
    'have',
    'list',
    'me',
    'my',
    'odoo',
    'records',
    'show',
    'the'
  ])
  for (const word of normalized.match(/[a-z0-9_]+/g) ?? []) {
    if (word.length < 3 || ignored.has(word)) continue
    terms.add(word)
    if (word.length > 4 && word.endsWith('ies')) {
      terms.add(`${word.slice(0, -3)}y`)
    } else if (word.length > 4 && word.endsWith('s')) {
      terms.add(word.slice(0, -1))
    }
  }
  return [...terms].filter(Boolean).slice(0, 6)
}

export const discoverReadableOdooModels = async (
  query: string,
  limit = 12
): Promise<OdooModelDescriptor[]> => {
  await odooGadgetReady
  const gateway = odooGadget.getGateway()
  const fields = ['name', 'model', 'transient']
  const perSearchLimit = Math.max(1, Math.min(limit, 20))
  const termMatches = await Promise.all(
    modelDiscoveryTerms(query).flatMap((term) => [
      gateway.searchRead(
        'ir.model',
        [
          ['transient', '=', false],
          ['model', 'ilike', term]
        ],
        fields,
        perSearchLimit
      ),
      gateway.searchRead(
        'ir.model',
        [
          ['transient', '=', false],
          ['name', 'ilike', term]
        ],
        fields,
        perSearchLimit
      )
    ])
  )
  const matches = new Map<string, OdooModelDescriptor>()
  for (const record of termMatches.flat()) {
    if (
      typeof record.model !== 'string' ||
      !isValidOdooModelName(record.model) ||
      typeof record.name !== 'string'
    ) {
      continue
    }
    matches.set(record.model, { name: record.name, model: record.model })
  }
  return [...matches.values()].slice(0, limit)
}

export const runGenericOdooOperation = async (
  request: GenericOdooRequest
): Promise<{ dryRun: boolean; result: unknown }> => {
  await odooGadgetReady
  const gateway = odooGadget.getGateway()
  const status = odooGadget.getStatus()
  const write = request.operation === 'create' || request.operation === 'write'
  if (write && !genericWritableModels.has(request.model)) {
    throw new Error(
      `Generic writes to ${request.model} are not allowed; use a specialized workflow`
    )
  }
  const canWrite = request.confirmWrite && (gateway.mode === 'demo' || status.liveWrites)

  if (write && !canWrite) {
    return {
      dryRun: true,
      result: {
        operation: request.operation,
        model: request.model,
        ids: request.ids,
        values: request.values,
        reason:
          gateway.mode === 'live' && !status.liveWrites
            ? 'Live writes are disabled in this Gadget'
            : 'confirmWrite is required'
      }
    }
  }

  switch (request.operation) {
    case 'fieldsGet':
      return { dryRun: false, result: await gateway.fieldsGet(request.model, request.fields) }
    case 'search':
      return {
        dryRun: false,
        result: await gateway.search(request.model, request.domain, request.limit, request.offset)
      }
    case 'read':
      return {
        dryRun: false,
        result: await gateway.read(request.model, request.ids ?? [], request.fields)
      }
    case 'searchRead':
      return {
        dryRun: false,
        result: await gateway.searchRead(
          request.model,
          request.domain,
          request.fields,
          request.limit,
          request.offset
        )
      }
    case 'create':
      return {
        dryRun: false,
        result: { id: await gateway.create(request.model, request.values ?? {}) }
      }
    case 'write':
      return {
        dryRun: false,
        result: {
          updated: await gateway.write(request.model, request.ids ?? [], request.values ?? {})
        }
      }
  }
}
