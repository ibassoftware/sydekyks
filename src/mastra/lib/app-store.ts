import { createClient, type Client } from '@libsql/client'
import { createHash, randomUUID } from 'node:crypto'
import type {
  AiPublicStatus,
  AutomationSpecCreateInput,
  AutomationSpecRecord,
  AutomationSpecStatus,
  AutomationSpecUpdateInput,
  ImapPublicStatus,
  InboundEmailRecord,
  InboundEmailStatus,
  MissionRecord,
  MissionStatus,
  OdooPublicStatus,
  PermissionRecord,
  SidekickCapability,
  SidekickOperation,
  SidekickRecord,
  SidekickStatus
} from '../domain/schemas'
import { nextScheduleRun, scheduleLabel } from '../automations/schedule'
import { presetSidekicks } from '../sidekicks/preset-skills.generated'
import { sidekickScopeFingerprint } from '../sidekicks/fingerprint'
import { appDatabaseUrl } from './paths'
import { workerLogger } from './logger'

const now = (): string => new Date().toISOString()

const legacyAutomationPrompt = (owner: string, input: Record<string, unknown>): string => {
  const days = Number(input.staleAfterDays ?? input.lookbackDays ?? 0)
  if (owner === 'nudge') {
    return `Review open opportunities and identify work needing attention${days > 0 ? ` after ${days} days without meaningful progress` : ''}.`
  }
  if (owner === 'mirror') {
    return `Review vendor bills for possible duplicates${days > 0 ? ` within the last ${days} days` : ''}.`
  }
  return `Review accounts-payable records and prepare an evidence-led risk brief${days > 0 ? ` for the last ${days} days` : ''}.`
}

export class AppStore {
  private readonly client: Client
  private readonly ready: Promise<void>
  private closed = false

  constructor() {
    this.client = createClient({ url: appDatabaseUrl })
    this.ready = this.initialize()
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    await this.ready.catch(() => undefined)
    await workerLogger.flush()
    this.client.close()
  }

  private async initialize(): Promise<void> {
    const versionResult = await this.client.execute('PRAGMA user_version')
    const version = Number(versionResult.rows[0]?.user_version ?? 0)
    if (version > 4) {
      throw new Error(
        `This Sydekyks data was created by a newer app version (schema ${version}). Update Sydekyks before opening it.`
      )
    }
    await this.client.batch(
      [
        `CREATE TABLE IF NOT EXISTS app_settings (
          key TEXT PRIMARY KEY,
          value_json TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS missions (
          id TEXT PRIMARY KEY,
          kind TEXT NOT NULL,
          sydekyk TEXT NOT NULL,
          title TEXT NOT NULL,
          summary TEXT NOT NULL,
          status TEXT NOT NULL,
          run_id TEXT,
          payload_json TEXT,
          result_json TEXT,
          acknowledged_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS permissions (
          id TEXT PRIMARY KEY,
          capability TEXT NOT NULL,
          scope TEXT NOT NULL,
          granted INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(capability, scope)
        )`,
        `CREATE TABLE IF NOT EXISTS inbound_emails (
          id TEXT PRIMARY KEY,
          source_type TEXT NOT NULL DEFAULT 'email',
          chat_session_ids_json TEXT NOT NULL DEFAULT '[]',
          message_id TEXT,
          source_hash TEXT NOT NULL UNIQUE,
          source_path TEXT,
          mailbox TEXT NOT NULL,
          uid INTEGER,
          from_address TEXT NOT NULL,
          from_name TEXT,
          subject TEXT NOT NULL,
          status TEXT NOT NULL,
          review_mission_id TEXT,
          ledger_mission_id TEXT,
          attachments_json TEXT NOT NULL,
          extracted_json TEXT NOT NULL,
          intelligence_json TEXT,
          missing_fields_json TEXT NOT NULL,
          error TEXT,
          received_at TEXT NOT NULL,
          processed_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS sidekicks (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT NOT NULL,
          instructions TEXT NOT NULL,
          source TEXT NOT NULL,
          status TEXT NOT NULL,
          version INTEGER NOT NULL,
          content_hash TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS sidekick_versions (
          sidekick_id TEXT NOT NULL,
          version INTEGER NOT NULL,
          name TEXT NOT NULL,
          description TEXT NOT NULL,
          instructions TEXT NOT NULL,
          content_hash TEXT NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY(sidekick_id, version)
        )`,
        `CREATE TABLE IF NOT EXISTS sidekick_capabilities (
          id TEXT PRIMARY KEY,
          sidekick_id TEXT NOT NULL,
          model TEXT NOT NULL,
          label TEXT NOT NULL,
          operations_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(sidekick_id, model)
        )`,
        `CREATE TABLE IF NOT EXISTS automation_specs (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          sidekick_id TEXT NOT NULL,
          sidekick_version INTEGER NOT NULL,
          prompt TEXT NOT NULL,
          trigger_json TEXT NOT NULL,
          approval_mode TEXT NOT NULL,
          status TEXT NOT NULL,
          missed_run_policy TEXT NOT NULL,
          schema_fingerprint TEXT,
          next_run_at TEXT,
          last_run_at TEXT,
          last_mission_id TEXT,
          last_error TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )`,
        'CREATE INDEX IF NOT EXISTS missions_updated_idx ON missions(updated_at DESC)',
        'CREATE INDEX IF NOT EXISTS missions_run_idx ON missions(run_id)',
        'CREATE UNIQUE INDEX IF NOT EXISTS inbound_email_message_idx ON inbound_emails(message_id) WHERE message_id IS NOT NULL',
        'CREATE INDEX IF NOT EXISTS inbound_email_updated_idx ON inbound_emails(updated_at DESC)',
        'CREATE INDEX IF NOT EXISTS inbound_email_ledger_idx ON inbound_emails(ledger_mission_id)',
        'CREATE INDEX IF NOT EXISTS sidekicks_status_idx ON sidekicks(status, updated_at DESC)',
        'CREATE INDEX IF NOT EXISTS sidekick_capabilities_owner_idx ON sidekick_capabilities(sidekick_id)',
        'CREATE INDEX IF NOT EXISTS automation_specs_due_idx ON automation_specs(status, next_run_at)',
        'CREATE INDEX IF NOT EXISTS automation_specs_sidekick_idx ON automation_specs(sidekick_id, updated_at DESC)'
      ],
      'write'
    )
    const columns = await this.client.execute('PRAGMA table_info(inbound_emails)')
    if (!columns.rows.some((row) => String(row.name) === 'intelligence_json')) {
      await this.client.execute('ALTER TABLE inbound_emails ADD COLUMN intelligence_json TEXT')
    }
    if (!columns.rows.some((row) => String(row.name) === 'source_path')) {
      await this.client.execute('ALTER TABLE inbound_emails ADD COLUMN source_path TEXT')
    }
    if (!columns.rows.some((row) => String(row.name) === 'source_type')) {
      await this.client.execute(
        "ALTER TABLE inbound_emails ADD COLUMN source_type TEXT NOT NULL DEFAULT 'email'"
      )
    }
    if (!columns.rows.some((row) => String(row.name) === 'chat_session_ids_json')) {
      await this.client.execute(
        "ALTER TABLE inbound_emails ADD COLUMN chat_session_ids_json TEXT NOT NULL DEFAULT '[]'"
      )
    }
    const missionColumns = await this.client.execute('PRAGMA table_info(missions)')
    if (!missionColumns.rows.some((row) => String(row.name) === 'acknowledged_at')) {
      await this.client.execute('ALTER TABLE missions ADD COLUMN acknowledged_at TEXT')
    }
    const timestamp = now()
    for (const preset of presetSidekicks) {
      const contentHash = createHash('sha256')
        .update(`${preset.name}\n${preset.description}\n${preset.instructions}`)
        .digest('hex')
      const existing = await this.client.execute({
        sql: 'SELECT source, version, content_hash FROM sidekicks WHERE id = ?',
        args: [preset.id]
      })
      if (existing.rows.length === 0) {
        await this.client.batch(
          [
            {
              sql: `INSERT INTO sidekicks
                (id, name, description, instructions, source, status, version, content_hash, created_at, updated_at)
                VALUES (?, ?, ?, ?, 'preset', 'active', 1, ?, ?, ?)`,
              args: [
                preset.id,
                preset.name,
                preset.description,
                preset.instructions,
                contentHash,
                timestamp,
                timestamp
              ]
            },
            {
              sql: `INSERT INTO sidekick_versions
                (sidekick_id, version, name, description, instructions, content_hash, created_at)
                VALUES (?, 1, ?, ?, ?, ?, ?)`,
              args: [
                preset.id,
                preset.name,
                preset.description,
                preset.instructions,
                contentHash,
                timestamp
              ]
            }
          ],
          'write'
        )
      } else if (
        existing.rows[0].source === 'preset' &&
        String(existing.rows[0].content_hash) !== contentHash
      ) {
        const version = Number(existing.rows[0].version) + 1
        await this.client.batch(
          [
            {
              sql: `UPDATE sidekicks SET name = ?, description = ?, instructions = ?,
                    version = ?, content_hash = ?, updated_at = ? WHERE id = ?`,
              args: [
                preset.name,
                preset.description,
                preset.instructions,
                version,
                contentHash,
                timestamp,
                preset.id
              ]
            },
            {
              sql: `INSERT INTO sidekick_versions
                (sidekick_id, version, name, description, instructions, content_hash, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)`,
              args: [
                preset.id,
                version,
                preset.name,
                preset.description,
                preset.instructions,
                contentHash,
                timestamp
              ]
            }
          ],
          'write'
        )
      }
    }
    const legacyTable = await this.client.execute(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'automations'"
    )
    if (legacyTable.rows.length > 0) {
      const migrated = await this.client.execute({
        sql: "SELECT value_json FROM app_settings WHERE key = 'migration.legacy-automations.v4'"
      })
      if (migrated.rows.length === 0) {
        const legacyRows = await this.client.execute('SELECT * FROM automations')
        for (const row of legacyRows.rows) {
          const sidekickId = String(row.owner_sydekyk_id)
          if (!presetSidekicks.some((preset) => preset.id === sidekickId)) continue
          const schedule = JSON.parse(String(row.schedule_json))
          const input = JSON.parse(String(row.input_json)) as Record<string, unknown>
          const status = ['draft', 'active', 'paused'].includes(String(row.status))
            ? String(row.status)
            : 'paused'
          await this.client.execute({
            sql: `INSERT INTO automation_specs
              (id, name, sidekick_id, sidekick_version, prompt, trigger_json, approval_mode, status,
               missed_run_policy, next_run_at, last_run_at, last_mission_id, last_error,
               created_at, updated_at)
              VALUES (?, ?, ?, 1, ?, ?, 'read-only', ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO NOTHING`,
            args: [
              String(row.id),
              String(row.name),
              sidekickId,
              legacyAutomationPrompt(sidekickId, input),
              JSON.stringify({ kind: 'schedule', schedule }),
              status,
              String(row.missed_run_policy),
              row.next_run_at ? String(row.next_run_at) : null,
              row.last_run_at ? String(row.last_run_at) : null,
              row.last_mission_id ? String(row.last_mission_id) : null,
              row.last_error ? String(row.last_error) : null,
              String(row.created_at),
              String(row.updated_at)
            ]
          })
        }
        await this.client.execute({
          sql: `INSERT INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)`,
          args: ['migration.legacy-automations.v4', 'true', now()]
        })
      }
    }
    await this.client.execute('PRAGMA user_version = 4')
  }

  async setSetting(key: string, value: unknown): Promise<void> {
    await this.ready
    await this.client.execute({
      sql: `INSERT INTO app_settings (key, value_json, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
      args: [key, JSON.stringify(value), now()]
    })
  }

  async getSetting<T>(key: string): Promise<T | undefined> {
    await this.ready
    const result = await this.client.execute({
      sql: 'SELECT value_json FROM app_settings WHERE key = ?',
      args: [key]
    })
    const row = result.rows[0]
    return row ? (JSON.parse(String(row.value_json)) as T) : undefined
  }

  async saveOdooStatus(status: OdooPublicStatus): Promise<void> {
    await this.setSetting('odoo.status', status)
  }

  async getOdooStatus(): Promise<OdooPublicStatus | undefined> {
    return this.getSetting<OdooPublicStatus>('odoo.status')
  }

  async saveAiStatus(status: AiPublicStatus): Promise<void> {
    await this.setSetting('ai.status', status)
  }

  async getAiStatus(): Promise<AiPublicStatus | undefined> {
    return this.getSetting<AiPublicStatus>('ai.status')
  }

  async saveImapStatus(status: ImapPublicStatus): Promise<void> {
    await this.setSetting('imap.status', status)
  }

  async getImapStatus(): Promise<ImapPublicStatus | undefined> {
    return this.getSetting<ImapPublicStatus>('imap.status')
  }

  async createSidekick(input: {
    id: string
    name: string
    description: string
    instructions: string
    source?: 'preset' | 'user'
    status?: SidekickStatus
  }): Promise<SidekickRecord> {
    await this.ready
    const timestamp = now()
    const contentHash = this.sidekickContentHash(input)
    await this.client.batch(
      [
        {
          sql: `INSERT INTO sidekicks
            (id, name, description, instructions, source, status, version, content_hash, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
          args: [
            input.id,
            input.name,
            input.description,
            input.instructions,
            input.source ?? 'user',
            input.status ?? 'active',
            contentHash,
            timestamp,
            timestamp
          ]
        },
        {
          sql: `INSERT INTO sidekick_versions
            (sidekick_id, version, name, description, instructions, content_hash, created_at)
            VALUES (?, 1, ?, ?, ?, ?, ?)`,
          args: [
            input.id,
            input.name,
            input.description,
            input.instructions,
            contentHash,
            timestamp
          ]
        }
      ],
      'write'
    )
    return (await this.getSidekick(input.id)) as SidekickRecord
  }

  async getSidekick(id: string): Promise<SidekickRecord | undefined> {
    await this.ready
    const result = await this.client.execute({
      sql: 'SELECT * FROM sidekicks WHERE id = ?',
      args: [id]
    })
    if (!result.rows[0]) return undefined
    return this.rowToSidekick(result.rows[0], await this.listSidekickCapabilities(id))
  }

  async listSidekicks(options: { activeOnly?: boolean } = {}): Promise<SidekickRecord[]> {
    await this.ready
    const result = await this.client.execute(
      options.activeOnly
        ? "SELECT * FROM sidekicks WHERE status = 'active' ORDER BY name"
        : 'SELECT * FROM sidekicks ORDER BY name'
    )
    return Promise.all(
      result.rows.map(async (row) =>
        this.rowToSidekick(row, await this.listSidekickCapabilities(String(row.id)))
      )
    )
  }

  async updateSidekick(
    id: string,
    update: Partial<Pick<SidekickRecord, 'name' | 'description' | 'instructions' | 'status'>>
  ): Promise<SidekickRecord> {
    await this.ready
    const current = await this.getSidekick(id)
    if (!current) throw new Error('The Sidekick was not found')
    const next = { ...current, ...update }
    const contentChanged =
      next.name !== current.name ||
      next.description !== current.description ||
      next.instructions !== current.instructions
    const version = contentChanged ? current.version + 1 : current.version
    const contentHash = contentChanged ? this.sidekickContentHash(next) : current.contentHash
    const timestamp = now()
    const statements: Array<{ sql: string; args: Array<string | number> }> = [
      {
        sql: `UPDATE sidekicks SET name = ?, description = ?, instructions = ?, status = ?,
              version = ?, content_hash = ?, updated_at = ? WHERE id = ?`,
        args: [
          next.name,
          next.description,
          next.instructions,
          next.status,
          version,
          contentHash,
          timestamp,
          id
        ]
      }
    ]
    if (contentChanged) {
      statements.push({
        sql: `INSERT INTO sidekick_versions
          (sidekick_id, version, name, description, instructions, content_hash, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [id, version, next.name, next.description, next.instructions, contentHash, timestamp]
      })
    }
    await this.client.batch(statements, 'write')
    return (await this.getSidekick(id)) as SidekickRecord
  }

  async setSidekickCapability(
    sidekickId: string,
    capability: SidekickCapability
  ): Promise<SidekickCapability> {
    await this.ready
    if (!(await this.getSidekick(sidekickId))) throw new Error('The Sidekick was not found')
    const timestamp = now()
    await this.client.execute({
      sql: `INSERT INTO sidekick_capabilities
            (id, sidekick_id, model, label, operations_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(sidekick_id, model) DO UPDATE SET label = excluded.label,
              operations_json = excluded.operations_json, updated_at = excluded.updated_at`,
      args: [
        randomUUID(),
        sidekickId,
        capability.model,
        capability.label,
        JSON.stringify([...new Set(capability.operations)]),
        timestamp,
        timestamp
      ]
    })
    return capability
  }

  async listSidekickCapabilities(sidekickId: string): Promise<SidekickCapability[]> {
    await this.ready
    const result = await this.client.execute({
      sql: 'SELECT model, label, operations_json FROM sidekick_capabilities WHERE sidekick_id = ? ORDER BY label',
      args: [sidekickId]
    })
    return result.rows.map((row) => ({
      model: String(row.model),
      label: String(row.label),
      operations: JSON.parse(String(row.operations_json)) as SidekickOperation[]
    }))
  }

  async hasSidekickCapability(
    sidekickId: string,
    model: string,
    operation: SidekickOperation
  ): Promise<boolean> {
    const capabilities = await this.listSidekickCapabilities(sidekickId)
    return capabilities.some(
      (capability) =>
        (capability.model === model || capability.model === '*') &&
        capability.operations.includes(operation)
    )
  }

  async createAutomationSpec(input: AutomationSpecCreateInput): Promise<AutomationSpecRecord> {
    await this.ready
    const sidekick = await this.getSidekick(input.sidekickId)
    if (!sidekick) throw new Error('The Sidekick was not found')
    const id = randomUUID()
    const timestamp = now()
    const schemaFingerprint = sidekickScopeFingerprint(sidekick.capabilities)
    const nextRunAt =
      input.status === 'active' && input.trigger.kind === 'schedule'
        ? nextScheduleRun(input.trigger.schedule).toISOString()
        : null
    await this.client.execute({
      sql: `INSERT INTO automation_specs
        (id, name, sidekick_id, sidekick_version, prompt, trigger_json, approval_mode, status,
         missed_run_policy, schema_fingerprint, next_run_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        id,
        input.name,
        input.sidekickId,
        sidekick.version,
        input.prompt,
        JSON.stringify(input.trigger),
        input.approvalMode,
        input.status,
        input.missedRunPolicy,
        schemaFingerprint,
        nextRunAt,
        timestamp,
        timestamp
      ]
    })
    return (await this.getAutomationSpec(id)) as AutomationSpecRecord
  }

  async getAutomationSpec(id: string): Promise<AutomationSpecRecord | undefined> {
    await this.ready
    const result = await this.client.execute({
      sql: `SELECT automation_specs.*, sidekicks.name AS sidekick_name
            FROM automation_specs JOIN sidekicks ON sidekicks.id = automation_specs.sidekick_id
            WHERE automation_specs.id = ?`,
      args: [id]
    })
    return result.rows[0] ? this.rowToAutomationSpec(result.rows[0]) : undefined
  }

  async listAutomationSpecs(limit = 100): Promise<AutomationSpecRecord[]> {
    await this.ready
    const result = await this.client.execute({
      sql: `SELECT automation_specs.*, sidekicks.name AS sidekick_name
            FROM automation_specs JOIN sidekicks ON sidekicks.id = automation_specs.sidekick_id
            ORDER BY automation_specs.updated_at DESC LIMIT ?`,
      args: [limit]
    })
    return result.rows.map((row) => this.rowToAutomationSpec(row))
  }

  async updateAutomationSpec(
    id: string,
    update: AutomationSpecUpdateInput
  ): Promise<AutomationSpecRecord> {
    await this.ready
    const current = await this.getAutomationSpec(id)
    if (!current) throw new Error('The automation was not found')
    const sidekick = update.repinSidekick ? await this.getSidekick(current.sidekickId) : undefined
    if (update.repinSidekick && !sidekick) throw new Error('The Sidekick was not found')
    const trigger = update.trigger ?? current.trigger
    const currentSidekick = sidekick ?? (await this.getSidekick(current.sidekickId))
    if (!currentSidekick) throw new Error('The Sidekick was not found')
    const schemaFingerprint = sidekickScopeFingerprint(currentSidekick.capabilities)
    const status = update.status ?? current.status
    const nextRunAt =
      status === 'active' && trigger.kind === 'schedule'
        ? nextScheduleRun(trigger.schedule).toISOString()
        : null
    await this.client.execute({
      sql: `UPDATE automation_specs SET name = ?, sidekick_version = ?, prompt = ?,
            trigger_json = ?, approval_mode = ?, status = ?, missed_run_policy = ?,
            schema_fingerprint = ?, next_run_at = ?, last_error = NULL, updated_at = ?
            WHERE id = ?`,
      args: [
        update.name ?? current.name,
        sidekick?.version ?? current.sidekickVersion,
        update.prompt ?? current.prompt,
        JSON.stringify(trigger),
        update.approvalMode ?? current.approvalMode,
        status,
        update.missedRunPolicy ?? current.missedRunPolicy,
        schemaFingerprint,
        nextRunAt,
        now(),
        id
      ]
    })
    return (await this.getAutomationSpec(id)) as AutomationSpecRecord
  }

  async deleteAutomationSpec(id: string): Promise<void> {
    await this.ready
    await this.client.execute({ sql: 'DELETE FROM automation_specs WHERE id = ?', args: [id] })
  }

  async listDueAutomationSpecs(at = new Date()): Promise<AutomationSpecRecord[]> {
    await this.ready
    const result = await this.client.execute({
      sql: `SELECT automation_specs.*, sidekicks.name AS sidekick_name
            FROM automation_specs JOIN sidekicks ON sidekicks.id = automation_specs.sidekick_id
            WHERE automation_specs.status = 'active' AND automation_specs.next_run_at IS NOT NULL
              AND automation_specs.next_run_at <= ?
            ORDER BY automation_specs.next_run_at LIMIT 25`,
      args: [at.toISOString()]
    })
    return result.rows.map((row) => this.rowToAutomationSpec(row))
  }

  async claimAutomationSpec(
    id: string,
    expectedRunAt: string,
    nextRunAt: string
  ): Promise<boolean> {
    await this.ready
    const result = await this.client.execute({
      sql: `UPDATE automation_specs SET next_run_at = ?, updated_at = ?
            WHERE id = ? AND status = 'active' AND next_run_at = ?`,
      args: [nextRunAt, now(), id, expectedRunAt]
    })
    return result.rowsAffected === 1
  }

  async recordAutomationSpecRun(
    id: string,
    input: { missionId?: string; error?: string; failed?: boolean; ranAt?: string }
  ): Promise<void> {
    await this.ready
    await this.client.execute({
      sql: `UPDATE automation_specs SET last_run_at = ?, last_mission_id = ?, last_error = ?,
            status = CASE WHEN ? THEN 'error' ELSE status END, updated_at = ? WHERE id = ?`,
      args: [
        input.ranAt ?? now(),
        input.missionId ?? null,
        input.error ?? null,
        input.failed ? 1 : 0,
        now(),
        id
      ]
    })
  }

  async createMission(
    input: Omit<MissionRecord, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }
  ): Promise<MissionRecord> {
    await this.ready
    const timestamp = now()
    const mission: MissionRecord = {
      ...input,
      id: input.id ?? randomUUID(),
      createdAt: timestamp,
      updatedAt: timestamp
    }
    await this.client.execute({
      sql: `INSERT INTO missions
        (id, kind, sydekyk, title, summary, status, run_id, payload_json, result_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        mission.id,
        mission.kind,
        mission.sydekyk,
        mission.title,
        mission.summary,
        mission.status,
        mission.runId ?? null,
        mission.payload === undefined ? null : JSON.stringify(mission.payload),
        mission.result === undefined ? null : JSON.stringify(mission.result),
        timestamp,
        timestamp
      ]
    })
    workerLogger.info('mission.created', {
      missionId: mission.id,
      kind: mission.kind,
      sydekyk: mission.sydekyk,
      status: mission.status
    })
    return mission
  }

  async updateMission(
    id: string,
    update: Partial<Pick<MissionRecord, 'summary' | 'status' | 'runId' | 'result'>>
  ): Promise<void> {
    await this.ready
    const current = await this.getMission(id)
    if (!current) throw new Error(`Mission ${id} was not found`)
    const next = { ...current, ...update, updatedAt: now() }
    const reopenedForAttention =
      update.status !== undefined &&
      ['needs_attention', 'waiting_approval'].includes(next.status) &&
      current.status !== next.status
    const acknowledgedAt = reopenedForAttention ? undefined : current.acknowledgedAt
    await this.client.execute({
      sql: `UPDATE missions
            SET summary = ?, status = ?, run_id = ?, result_json = ?, acknowledged_at = ?, updated_at = ?
            WHERE id = ?`,
      args: [
        next.summary,
        next.status,
        next.runId ?? null,
        next.result === undefined ? null : JSON.stringify(next.result),
        acknowledgedAt ?? null,
        next.updatedAt,
        id
      ]
    })
    workerLogger.info('mission.updated', {
      missionId: id,
      kind: next.kind,
      sydekyk: next.sydekyk,
      fromStatus: current.status,
      toStatus: next.status
    })
  }

  async getMission(id: string): Promise<MissionRecord | undefined> {
    await this.ready
    const result = await this.client.execute({
      sql: 'SELECT * FROM missions WHERE id = ?',
      args: [id]
    })
    return result.rows[0] ? this.rowToMission(result.rows[0]) : undefined
  }

  async listMissions(limit = 50): Promise<MissionRecord[]> {
    await this.ready
    const result = await this.client.execute({
      sql: 'SELECT * FROM missions ORDER BY updated_at DESC LIMIT ?',
      args: [limit]
    })
    return result.rows.map((row) => this.rowToMission(row))
  }

  async acknowledgeMissions(ids: string[]): Promise<number> {
    await this.ready
    const missionIds = [...new Set(ids)]
    if (missionIds.length === 0) return 0
    const result = await this.client.execute({
      sql: `UPDATE missions
            SET acknowledged_at = ?
            WHERE id IN (${missionIds.map(() => '?').join(', ')})
              AND status IN ('needs_attention', 'waiting_approval')
              AND acknowledged_at IS NULL`,
      args: [now(), ...missionIds]
    })
    const acknowledged = Number(result.rowsAffected)
    workerLogger.info('mission.notifications-acknowledged', {
      requestedCount: missionIds.length,
      acknowledged
    })
    return acknowledged
  }

  async findInboundEmail(
    messageId: string | undefined,
    sourceHash: string
  ): Promise<InboundEmailRecord | undefined> {
    await this.ready
    const result = await this.client.execute({
      sql: `SELECT * FROM inbound_emails
            WHERE source_hash = ? OR (? IS NOT NULL AND message_id = ?)
            LIMIT 1`,
      args: [sourceHash, messageId ?? null, messageId ?? null]
    })
    return result.rows[0] ? this.rowToInboundEmail(result.rows[0]) : undefined
  }

  async findInboundEmailByAttachmentHashes(
    hashes: string[]
  ): Promise<InboundEmailRecord | undefined> {
    if (hashes.length === 0) return undefined
    const emails = await this.listInboundEmails(250)
    const wanted = new Set(hashes)
    return emails.find((email) =>
      email.attachments.some((attachment) => wanted.has(attachment.sha256))
    )
  }

  async createInboundEmail(
    input: Omit<InboundEmailRecord, 'id' | 'chatSessionIds' | 'createdAt' | 'updatedAt'> & {
      id?: string
      chatSessionIds?: string[]
    }
  ): Promise<InboundEmailRecord> {
    await this.ready
    const timestamp = now()
    const email: InboundEmailRecord = {
      ...input,
      id: input.id ?? randomUUID(),
      chatSessionIds: input.chatSessionIds ?? [],
      createdAt: timestamp,
      updatedAt: timestamp
    }
    await this.client.execute({
      sql: `INSERT INTO inbound_emails
        (id, source_type, chat_session_ids_json, message_id, source_hash, source_path, mailbox, uid, from_address, from_name, subject, status,
         review_mission_id, ledger_mission_id, attachments_json, extracted_json,
         intelligence_json, missing_fields_json, error, received_at, processed_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        email.id,
        email.sourceType,
        JSON.stringify(email.chatSessionIds),
        email.messageId ?? null,
        email.sourceHash,
        email.sourcePath ?? null,
        email.mailbox,
        email.uid ?? null,
        email.fromAddress,
        email.fromName ?? null,
        email.subject,
        email.status,
        email.reviewMissionId ?? null,
        email.ledgerMissionId ?? null,
        JSON.stringify(email.attachments),
        JSON.stringify(email.extracted),
        email.intelligence === undefined ? null : JSON.stringify(email.intelligence),
        JSON.stringify(email.missingFields),
        email.error ?? null,
        email.receivedAt,
        email.processedAt ?? null,
        timestamp,
        timestamp
      ]
    })
    return email
  }

  async linkInboundEmailToChatSession(
    id: string,
    chatSessionId: string
  ): Promise<InboundEmailRecord> {
    await this.ready
    const current = await this.getInboundEmail(id)
    if (!current) throw new Error(`Inbound email ${id} was not found`)
    if (!current.chatSessionIds.includes(chatSessionId)) {
      await this.client.execute({
        sql: `UPDATE inbound_emails SET chat_session_ids_json = ?, updated_at = ? WHERE id = ?`,
        args: [JSON.stringify([...current.chatSessionIds, chatSessionId]), now(), id]
      })
    }
    return (await this.getInboundEmail(id)) as InboundEmailRecord
  }

  async updateInboundEmail(
    id: string,
    update: Partial<
      Pick<
        InboundEmailRecord,
        | 'status'
        | 'reviewMissionId'
        | 'ledgerMissionId'
        | 'attachments'
        | 'extracted'
        | 'intelligence'
        | 'missingFields'
        | 'error'
        | 'processedAt'
      >
    >
  ): Promise<void> {
    await this.ready
    const current = await this.getInboundEmail(id)
    if (!current) throw new Error(`Inbound email ${id} was not found`)
    const next = { ...current, ...update, updatedAt: now() }
    await this.client.execute({
      sql: `UPDATE inbound_emails SET status = ?, review_mission_id = ?, ledger_mission_id = ?,
            attachments_json = ?, extracted_json = ?, intelligence_json = ?, missing_fields_json = ?,
            error = ?, processed_at = ?, updated_at = ? WHERE id = ?`,
      args: [
        next.status,
        next.reviewMissionId ?? null,
        next.ledgerMissionId ?? null,
        JSON.stringify(next.attachments),
        JSON.stringify(next.extracted),
        next.intelligence === undefined ? null : JSON.stringify(next.intelligence),
        JSON.stringify(next.missingFields),
        next.error ?? null,
        next.processedAt ?? null,
        next.updatedAt,
        id
      ]
    })
  }

  async getInboundEmail(id: string): Promise<InboundEmailRecord | undefined> {
    await this.ready
    const result = await this.client.execute({
      sql: 'SELECT * FROM inbound_emails WHERE id = ?',
      args: [id]
    })
    return result.rows[0] ? this.rowToInboundEmail(result.rows[0]) : undefined
  }

  async getInboundEmailByLedgerMission(
    ledgerMissionId: string
  ): Promise<InboundEmailRecord | undefined> {
    await this.ready
    const result = await this.client.execute({
      sql: 'SELECT * FROM inbound_emails WHERE ledger_mission_id = ? LIMIT 1',
      args: [ledgerMissionId]
    })
    return result.rows[0] ? this.rowToInboundEmail(result.rows[0]) : undefined
  }

  async listInboundEmails(limit = 50): Promise<InboundEmailRecord[]> {
    await this.ready
    const result = await this.client.execute({
      sql: 'SELECT * FROM inbound_emails ORDER BY updated_at DESC LIMIT ?',
      args: [limit]
    })
    return result.rows.map((row) => this.rowToInboundEmail(row))
  }

  async hasPermission(capability: string, scope: string): Promise<boolean> {
    await this.ready
    const result = await this.client.execute({
      sql: 'SELECT granted FROM permissions WHERE capability = ? AND scope IN (?, ?)',
      args: [capability, scope, '*']
    })
    return result.rows.some((row) => Number(row.granted) === 1)
  }

  async grantPermission(capability: string, scope: string): Promise<PermissionRecord> {
    await this.ready
    const timestamp = now()
    const id = randomUUID()
    await this.client.execute({
      sql: `INSERT INTO permissions (id, capability, scope, granted, created_at, updated_at)
            VALUES (?, ?, ?, 1, ?, ?)
            ON CONFLICT(capability, scope) DO UPDATE SET granted = 1, updated_at = excluded.updated_at`,
      args: [id, capability, scope, timestamp, timestamp]
    })
    const result = await this.client.execute({
      sql: 'SELECT * FROM permissions WHERE capability = ? AND scope = ?',
      args: [capability, scope]
    })
    return this.rowToPermission(result.rows[0])
  }

  async listPermissions(): Promise<PermissionRecord[]> {
    await this.ready
    const result = await this.client.execute(
      'SELECT * FROM permissions WHERE granted = 1 ORDER BY updated_at DESC'
    )
    return result.rows.map((row) => this.rowToPermission(row))
  }

  private rowToMission(row: Record<string, unknown>): MissionRecord {
    return {
      id: String(row.id),
      kind: String(row.kind) as MissionRecord['kind'],
      sydekyk: String(row.sydekyk) as MissionRecord['sydekyk'],
      title: String(row.title),
      summary: String(row.summary),
      status: String(row.status) as MissionStatus,
      runId: row.run_id ? String(row.run_id) : undefined,
      payload: row.payload_json ? JSON.parse(String(row.payload_json)) : undefined,
      result: row.result_json ? JSON.parse(String(row.result_json)) : undefined,
      acknowledgedAt: row.acknowledged_at ? String(row.acknowledged_at) : undefined,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    }
  }

  private rowToPermission(row: Record<string, unknown>): PermissionRecord {
    return {
      id: String(row.id),
      capability: String(row.capability),
      scope: String(row.scope),
      granted: Number(row.granted) === 1,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    }
  }

  private sidekickContentHash(input: {
    name: string
    description: string
    instructions: string
  }): string {
    return createHash('sha256')
      .update(`${input.name}\n${input.description}\n${input.instructions}`)
      .digest('hex')
  }

  private rowToSidekick(
    row: Record<string, unknown>,
    capabilities: SidekickCapability[]
  ): SidekickRecord {
    return {
      id: String(row.id),
      name: String(row.name),
      description: String(row.description),
      instructions: String(row.instructions),
      source: row.source === 'preset' ? 'preset' : 'user',
      status: String(row.status) as SidekickStatus,
      version: Number(row.version),
      contentHash: String(row.content_hash),
      capabilities,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    }
  }

  private rowToAutomationSpec(row: Record<string, unknown>): AutomationSpecRecord {
    const trigger = JSON.parse(String(row.trigger_json)) as AutomationSpecRecord['trigger']
    const triggerLabel =
      trigger.kind === 'schedule'
        ? scheduleLabel(trigger.schedule)
        : trigger.kind === 'email'
          ? `Email · ${trigger.mailbox}`
          : 'Manual'
    return {
      id: String(row.id),
      name: String(row.name),
      sidekickId: String(row.sidekick_id),
      sidekickName: String(row.sidekick_name),
      sidekickVersion: Number(row.sidekick_version),
      prompt: String(row.prompt),
      trigger,
      approvalMode: String(row.approval_mode) as AutomationSpecRecord['approvalMode'],
      status: String(row.status) as AutomationSpecStatus,
      missedRunPolicy: String(row.missed_run_policy) as AutomationSpecRecord['missedRunPolicy'],
      triggerLabel,
      schemaFingerprint: row.schema_fingerprint ? String(row.schema_fingerprint) : undefined,
      nextRunAt: row.next_run_at ? String(row.next_run_at) : undefined,
      lastRunAt: row.last_run_at ? String(row.last_run_at) : undefined,
      lastMissionId: row.last_mission_id ? String(row.last_mission_id) : undefined,
      lastError: row.last_error ? String(row.last_error) : undefined,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    }
  }

  private rowToInboundEmail(row: Record<string, unknown>): InboundEmailRecord {
    const chatSessionIds = row.chat_session_ids_json
      ? JSON.parse(String(row.chat_session_ids_json))
      : []
    return {
      id: String(row.id),
      sourceType: row.source_type === 'chat' ? 'chat' : 'email',
      chatSessionIds: Array.isArray(chatSessionIds)
        ? chatSessionIds.filter((id): id is string => typeof id === 'string')
        : [],
      messageId: row.message_id ? String(row.message_id) : undefined,
      sourceHash: String(row.source_hash),
      sourcePath: row.source_path ? String(row.source_path) : undefined,
      mailbox: String(row.mailbox),
      uid: row.uid === null || row.uid === undefined ? undefined : Number(row.uid),
      fromAddress: String(row.from_address),
      fromName: row.from_name ? String(row.from_name) : undefined,
      subject: String(row.subject),
      status: String(row.status) as InboundEmailStatus,
      reviewMissionId: row.review_mission_id ? String(row.review_mission_id) : undefined,
      ledgerMissionId: row.ledger_mission_id ? String(row.ledger_mission_id) : undefined,
      attachments: JSON.parse(String(row.attachments_json)),
      extracted: JSON.parse(String(row.extracted_json)),
      intelligence: row.intelligence_json ? JSON.parse(String(row.intelligence_json)) : undefined,
      missingFields: JSON.parse(String(row.missing_fields_json)),
      error: row.error ? String(row.error) : undefined,
      receivedAt: String(row.received_at),
      processedAt: row.processed_at ? String(row.processed_at) : undefined,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    }
  }
}

export const appStore = new AppStore()
