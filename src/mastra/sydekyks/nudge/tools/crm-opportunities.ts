import type { NudgeOpportunityFact } from '../../../domain/schemas'
import { odooGadget, odooGadgetReady } from '../../../gadgets/odoo-gateway'

const desiredLeadFields = [
  'name',
  'type',
  'active',
  'stage_id',
  'user_id',
  'expected_revenue',
  'probability',
  'write_date',
  'date_last_stage_update'
]
const desiredActivityFields = [
  'res_model',
  'res_id',
  'date_deadline',
  'activity_type_id',
  'user_id',
  'summary',
  'note',
  'state'
]
const desiredMessageFields = [
  'model',
  'res_id',
  'date',
  'message_type',
  'subject',
  'author_id',
  'email_from',
  'body'
]

const availableFields = async (model: string, wanted: string[]): Promise<string[]> => {
  const schema = await odooGadget.getGateway().fieldsGet(model, wanted)
  return wanted.filter((field) => field in schema)
}

const relationName = (value: unknown): string | undefined =>
  Array.isArray(value) && typeof value[1] === 'string'
    ? value[1]
    : typeof value === 'string'
      ? value
      : undefined

const numberValue = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

const stringValue = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined

const recordId = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isInteger(value) ? value : undefined

const normalizeDate = (value: unknown): string | undefined => {
  const text = stringValue(value)
  if (!text) return undefined
  const parsed = new Date(
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text) ? `${text.replace(' ', 'T')}Z` : text
  )
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString()
}

const daysSince = (value: string | undefined, now: Date): number | undefined => {
  if (!value) return undefined
  const elapsed = now.getTime() - new Date(value).getTime()
  return elapsed < 0 ? 0 : Number((elapsed / 86_400_000).toFixed(1))
}

const bodyPreview = (value: unknown): string | undefined => {
  const text = stringValue(value)
  if (!text) return undefined
  const plain = text
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return plain ? plain.slice(0, 280) : undefined
}

const latest = (values: Array<string | undefined>): string | undefined =>
  values
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => right.localeCompare(left))[0]

export const readOpportunityFacts = async (
  limit: number,
  now = new Date()
): Promise<NudgeOpportunityFact[]> => {
  await odooGadgetReady
  const gateway = odooGadget.getGateway()
  const leadFields = await availableFields('crm.lead', desiredLeadFields)
  const leadDomain: Array<[string, string, unknown]> = []
  if (leadFields.includes('active')) leadDomain.push(['active', '=', true])
  if (leadFields.includes('type')) leadDomain.push(['type', '=', 'opportunity'])
  const leads = await gateway.searchRead('crm.lead', leadDomain, leadFields, limit)
  const openLeads = leads.filter((lead) => {
    const stage = relationName(lead.stage_id)?.toLocaleLowerCase() ?? ''
    const probability = numberValue(lead.probability)
    return !['won', 'lost'].some((label) => stage.includes(label)) && probability !== 100
  })
  if (openLeads.length === 0) return []

  const leadIds = openLeads.map((lead) => lead.id)
  const [activityFields, messageFields] = await Promise.all([
    availableFields('mail.activity', desiredActivityFields),
    availableFields('mail.message', desiredMessageFields)
  ])
  const [activities, messages] = await Promise.all([
    gateway.searchRead(
      'mail.activity',
      [
        ['res_model', '=', 'crm.lead'],
        ['res_id', 'in', leadIds]
      ],
      activityFields,
      100
    ),
    gateway.searchRead(
      'mail.message',
      [
        ['model', '=', 'crm.lead'],
        ['res_id', 'in', leadIds]
      ],
      messageFields,
      100
    )
  ])

  const today = now.toISOString().slice(0, 10)
  return openLeads.map((lead) => {
    const leadActivities = activities
      .filter((activity) => recordId(activity.res_id) === lead.id)
      .map((activity) => ({
        id: activity.id,
        deadline: stringValue(activity.date_deadline),
        state: stringValue(activity.state),
        type: relationName(activity.activity_type_id),
        summary: stringValue(activity.summary) ?? bodyPreview(activity.note),
        owner: relationName(activity.user_id)
      }))
    const leadMessages = messages
      .filter(
        (message) =>
          recordId(message.res_id) === lead.id &&
          ['email', 'comment'].includes(stringValue(message.message_type) ?? 'comment')
      )
      .map((message) => ({
        id: message.id,
        date: normalizeDate(message.date),
        subject: stringValue(message.subject),
        author: relationName(message.author_id),
        emailFrom: stringValue(message.email_from),
        bodyPreview: bodyPreview(message.body)
      }))
      .sort((left, right) => (right.date ?? '').localeCompare(left.date ?? ''))
      .slice(0, 8)
    const openActivities = leadActivities.filter(
      (activity) =>
        !['done', 'cancelled', 'canceled'].includes(activity.state?.toLocaleLowerCase() ?? '')
    )
    const futureDeadlines = openActivities
      .map((activity) => activity.deadline)
      .filter((deadline): deadline is string => typeof deadline === 'string' && deadline >= today)
      .sort()
    const lastUpdatedAt = normalizeDate(lead.write_date)
    const stageChangedAt = normalizeDate(lead.date_last_stage_update)
    const lastMeaningfulMessageAt = latest(leadMessages.map((message) => message.date))
    return {
      id: lead.id,
      name: stringValue(lead.name) ?? `Opportunity ${lead.id}`,
      stage: relationName(lead.stage_id) ?? 'Unknown stage',
      owner: relationName(lead.user_id),
      expectedRevenue: numberValue(lead.expected_revenue),
      probability: numberValue(lead.probability),
      lastUpdatedAt,
      stageChangedAt,
      daysSinceUpdate: daysSince(lastUpdatedAt, now),
      lastMeaningfulMessageAt,
      daysSinceLastMessage: daysSince(lastMeaningfulMessageAt, now),
      nextActivityAt: futureDeadlines[0],
      hasOpenActivity: openActivities.length > 0,
      overdueActivityCount: openActivities.filter(
        (activity) => Boolean(activity.deadline) && activity.deadline! < today
      ).length,
      activities: leadActivities,
      messages: leadMessages
    }
  })
}
