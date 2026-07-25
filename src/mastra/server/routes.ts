import { registerApiRoute } from '@mastra/core/server'
import { toAISdkMessages } from '@mastra/ai-sdk/ui'
import { z } from 'zod'
import { sydAgent } from '../agents/syd-agent'
import {
  createAutomationSpec,
  deleteAutomationSpec,
  runAutomationSpecNow,
  setAutomationSpecStatus,
  updateAutomationSpec
} from '../automations/spec-service'
import {
  aiCredentialSchema,
  approvalDecisionSchema,
  automationSpecCreateSchema,
  automationSpecUpdateSchema,
  imapCredentialSchema,
  ledgerBillInputSchema,
  odooCredentialSchema
} from '../domain/schemas'
import { imapGadget, imapGadgetReady } from '../gadgets/imap-gateway'
import { odooGadget, odooGadgetReady } from '../gadgets/odoo-gateway'
import { appStore } from '../lib/app-store'
import { aiRuntime, aiRuntimeReady } from '../lib/ai-runtime'
import { friendlyErrorMessage } from '../lib/errors'
import { maximumDocumentBytes } from '../services/document-parser'
import {
  createSampleInboundEmail,
  handoffInboundEmailToLedger,
  reanalyzeInboundEmail
} from '../sydekyks/ledger/inbound-email'
import { ingestChatDocument } from '../sydekyks/ledger/chat-document'
import { testBillIntelligenceConnection } from '../sydekyks/ledger/intelligence-service'
import { resumeLedgerMission, startLedgerMission } from '../sydekyks/ledger/service'
import { getSydekykManifest, setInboundReviewPolicy } from '../sydekyks/registry'

const errorResponse = (error: unknown): { error: string; details?: unknown } => {
  if (error instanceof z.ZodError) {
    return { error: 'The request is invalid', details: z.treeifyError(error) }
  }
  return { error: friendlyErrorMessage(error, 'Sydekyks could not complete this request.') }
}

const missionIdSchema = z.object({ missionId: z.string().uuid() })
const acknowledgeMissionsSchema = z.object({
  missionIds: z.array(z.string().uuid()).min(1).max(50)
})
const emailIdSchema = z.object({ emailId: z.string().uuid() })
const sydekykIdSchema = z.object({ sydekykId: z.string().min(1) })
const automationIdSchema = z.object({ automationId: z.string().uuid() })
const chatSessionIdSchema = z.object({ sessionId: z.string().min(1).max(200) })
const sydChatResourceId = 'local-user-syd'

const getSydMemory = async (): Promise<
  NonNullable<Awaited<ReturnType<typeof sydAgent.getMemory>>>
> => {
  const memory = await sydAgent.getMemory()
  if (!memory) throw new Error('Syd chat memory is unavailable')
  return memory
}

const toChatSession = (thread: {
  id: string
  title?: string
  createdAt: Date
  updatedAt: Date
}): {
  id: string
  title: string
  titlePending: boolean
  createdAt: string
  updatedAt: string
} => ({
  id: thread.id,
  title: thread.title?.trim() || 'New session',
  titlePending: !thread.title?.trim(),
  createdAt: thread.createdAt.toISOString(),
  updatedAt: thread.updatedAt.toISOString()
})

export const appRoutes = [
  registerApiRoute('/sydekyks/bootstrap', {
    method: 'GET',
    handler: async (c) => {
      await Promise.all([aiRuntimeReady, odooGadgetReady, imapGadgetReady])
      const [missions, permissions, emails, sidekicks, automations] = await Promise.all([
        appStore.listMissions(),
        appStore.listPermissions(),
        appStore.listInboundEmails(),
        appStore.listSidekicks(),
        appStore.listAutomationSpecs()
      ])
      return c.json({
        app: { name: 'Sydekyks', steward: 'Syd', localUser: true },
        ai: aiRuntime.getStatus(),
        gadget: odooGadget.getStatus(),
        imap: imapGadget.getStatus(),
        emails,
        sidekicks,
        automations,
        missions,
        permissions
      })
    }
  }),
  registerApiRoute('/sydekyks/chat/sessions', {
    method: 'GET',
    handler: async (c) => {
      try {
        const memory = await getSydMemory()
        const { threads } = await memory.listThreads({
          filter: { resourceId: sydChatResourceId },
          orderBy: { field: 'updatedAt', direction: 'DESC' },
          page: 0,
          perPage: 50
        })
        return c.json({ sessions: threads.map(toChatSession) })
      } catch (error) {
        return c.json(errorResponse(error), 500)
      }
    }
  }),
  registerApiRoute('/sydekyks/chat/sessions', {
    method: 'POST',
    handler: async (c) => {
      try {
        const memory = await getSydMemory()
        const thread = await memory.createThread({
          resourceId: sydChatResourceId,
          metadata: { agentId: 'syd', surface: 'chat' }
        })
        return c.json(toChatSession(thread), 201)
      } catch (error) {
        return c.json(errorResponse(error), 500)
      }
    }
  }),
  registerApiRoute('/sydekyks/chat/sessions', {
    method: 'DELETE',
    handler: async (c) => {
      try {
        const memory = await getSydMemory()
        const { threads } = await memory.listThreads({
          filter: { resourceId: sydChatResourceId },
          perPage: false
        })
        for (const thread of threads) await memory.deleteThread(thread.id)
        const replacement = await memory.createThread({
          resourceId: sydChatResourceId,
          metadata: { agentId: 'syd', surface: 'chat' }
        })
        return c.json({ deleted: threads.length, session: toChatSession(replacement) })
      } catch (error) {
        return c.json(errorResponse(error), 500)
      }
    }
  }),
  registerApiRoute('/sydekyks/chat/sessions/:sessionId', {
    method: 'GET',
    handler: async (c) => {
      try {
        const { sessionId } = chatSessionIdSchema.parse(c.req.param())
        const memory = await getSydMemory()
        const thread = await memory.getThreadById({ threadId: sessionId })
        if (!thread || thread.resourceId !== sydChatResourceId)
          return c.json({ error: 'The chat session was not found' }, 404)
        const { messages } = await memory.recall({ threadId: sessionId, perPage: false })
        return c.json({
          session: toChatSession(thread),
          messages: toAISdkMessages(messages, { version: 'v6' })
        })
      } catch (error) {
        return c.json(errorResponse(error), error instanceof z.ZodError ? 400 : 500)
      }
    }
  }),
  registerApiRoute('/sydekyks/chat/sessions/:sessionId', {
    method: 'DELETE',
    handler: async (c) => {
      try {
        const { sessionId } = chatSessionIdSchema.parse(c.req.param())
        const memory = await getSydMemory()
        const thread = await memory.getThreadById({ threadId: sessionId })
        if (!thread || thread.resourceId !== sydChatResourceId)
          return c.json({ error: 'The chat session was not found' }, 404)
        await memory.deleteThread(sessionId)
        return c.json({ deleted: true })
      } catch (error) {
        return c.json(errorResponse(error), error instanceof z.ZodError ? 400 : 500)
      }
    }
  }),
  registerApiRoute('/sydekyks/automations', {
    method: 'POST',
    handler: async (c) => {
      try {
        return c.json(
          await createAutomationSpec(automationSpecCreateSchema.parse(await c.req.json()))
        )
      } catch (error) {
        return c.json(errorResponse(error), 400)
      }
    }
  }),
  registerApiRoute('/sydekyks/automations/:automationId', {
    method: 'PATCH',
    handler: async (c) => {
      try {
        const { automationId } = automationIdSchema.parse(c.req.param())
        return c.json(
          await updateAutomationSpec(
            automationId,
            automationSpecUpdateSchema.parse(await c.req.json())
          )
        )
      } catch (error) {
        return c.json(errorResponse(error), 400)
      }
    }
  }),
  registerApiRoute('/sydekyks/automations/:automationId/status', {
    method: 'POST',
    handler: async (c) => {
      try {
        const { automationId } = automationIdSchema.parse(c.req.param())
        const { status } = z
          .object({ status: z.enum(['active', 'paused']) })
          .parse(await c.req.json())
        return c.json(await setAutomationSpecStatus(automationId, status))
      } catch (error) {
        return c.json(errorResponse(error), 400)
      }
    }
  }),
  registerApiRoute('/sydekyks/automations/:automationId/run', {
    method: 'POST',
    handler: async (c) => {
      try {
        const { automationId } = automationIdSchema.parse(c.req.param())
        return c.json(await runAutomationSpecNow(automationId))
      } catch (error) {
        return c.json(errorResponse(error), 400)
      }
    }
  }),
  registerApiRoute('/sydekyks/automations/:automationId', {
    method: 'DELETE',
    handler: async (c) => {
      try {
        const { automationId } = automationIdSchema.parse(c.req.param())
        await deleteAutomationSpec(automationId)
        return c.json({ deleted: true })
      } catch (error) {
        return c.json(errorResponse(error), 400)
      }
    }
  }),
  registerApiRoute('/sydekyks/:sydekykId/inbound-policy', {
    method: 'POST',
    handler: async (c) => {
      try {
        const { sydekykId } = sydekykIdSchema.parse(c.req.param())
        if (!getSydekykManifest(sydekykId)) throw new Error('The Sydekyk was not found')
        return c.json(await setInboundReviewPolicy(sydekykId, await c.req.json()))
      } catch (error) {
        return c.json(errorResponse(error), 400)
      }
    }
  }),
  registerApiRoute('/sydekyks/gadgets/ai/status', {
    method: 'GET',
    handler: async (c) => {
      await aiRuntimeReady
      return c.json(aiRuntime.getStatus())
    }
  }),
  registerApiRoute('/sydekyks/gadgets/ai/connect', {
    method: 'POST',
    handler: async (c) => {
      let missionId: string | undefined
      let staged = false
      try {
        const input = aiCredentialSchema.parse(await c.req.json())
        const mission = await appStore.createMission({
          kind: 'gadget.connection',
          sydekyk: 'Syd',
          title: `Connect AI · ${input.provider}`,
          summary: `Testing ${input.provider}/${input.model}.`,
          status: 'running',
          payload: { provider: input.provider, model: input.model, apiKey: '[redacted]' }
        })
        missionId = mission.id
        aiRuntime.stage(input)
        staged = true
        await testBillIntelligenceConnection()
        const status = await aiRuntime.confirm()
        await appStore.updateMission(mission.id, {
          status: 'completed',
          summary: `AI connected to ${input.provider}/${input.model}.`,
          result: status
        })
        return c.json(status)
      } catch (error) {
        if (staged) await aiRuntime.reject(error)
        if (missionId) {
          await appStore.updateMission(missionId, {
            status: 'failed',
            summary: friendlyErrorMessage(error, 'AI connection failed.')
          })
        }
        return c.json(errorResponse(error), 400)
      }
    }
  }),
  registerApiRoute('/sydekyks/gadgets/ai/restore', {
    method: 'POST',
    handler: async (c) => {
      try {
        const input = aiCredentialSchema.parse(await c.req.json())
        return c.json(await aiRuntime.restore(input))
      } catch (error) {
        return c.json(errorResponse(error), 400)
      }
    }
  }),
  registerApiRoute('/sydekyks/gadgets/ai/disconnect', {
    method: 'POST',
    handler: async (c) => c.json(await aiRuntime.disconnect())
  }),
  registerApiRoute('/sydekyks/gadgets/imap/status', {
    method: 'GET',
    handler: async (c) => {
      await imapGadgetReady
      return c.json(imapGadget.getStatus())
    }
  }),
  registerApiRoute('/sydekyks/gadgets/imap/connect', {
    method: 'POST',
    handler: async (c) => {
      let missionId: string | undefined
      try {
        const input = imapCredentialSchema.parse(await c.req.json())
        const mission = await appStore.createMission({
          kind: 'gadget.connection',
          sydekyk: 'Syd',
          title: `Connect inbound email · ${input.username}`,
          summary: 'Testing the IMAP Gadget connection.',
          status: 'running',
          payload: { ...input, password: '[redacted]' }
        })
        missionId = mission.id
        const status = await imapGadget.connect(input)
        await appStore.updateMission(mission.id, {
          status: 'completed',
          summary: `Inbound email connected to ${input.mailbox}.`,
          result: status
        })
        return c.json(status)
      } catch (error) {
        if (missionId) {
          await appStore.updateMission(missionId, {
            status: 'failed',
            summary: error instanceof Error ? error.message : 'IMAP connection failed.'
          })
        }
        return c.json(errorResponse(error), 400)
      }
    }
  }),
  registerApiRoute('/sydekyks/gadgets/imap/disconnect', {
    method: 'POST',
    handler: async (c) => c.json(await imapGadget.disconnect())
  }),
  registerApiRoute('/sydekyks/gadgets/imap/sync', {
    method: 'POST',
    handler: async (c) => {
      try {
        return c.json(await imapGadget.syncNow())
      } catch (error) {
        return c.json(errorResponse(error), 400)
      }
    }
  }),
  registerApiRoute('/sydekyks/inbound-email/sample', {
    method: 'POST',
    handler: async (c) => {
      try {
        const result = await createSampleInboundEmail()
        return c.json(result)
      } catch (error) {
        return c.json(errorResponse(error), 400)
      }
    }
  }),
  registerApiRoute('/sydekyks/chat/documents', {
    method: 'POST',
    handler: async (c) => {
      try {
        const body = await c.req.formData()
        const file = body.get('file')
        const note = body.get('note')
        const { sessionId } = chatSessionIdSchema.parse({ sessionId: body.get('sessionId') })
        if (!file || typeof file === 'string')
          throw new Error('Choose a document to send to Ledger')
        if (file.size > maximumDocumentBytes) {
          throw new Error('The document is larger than the 15 MB limit')
        }
        const memory = await getSydMemory()
        const thread = await memory.getThreadById({ threadId: sessionId })
        if (!thread || thread.resourceId !== sydChatResourceId)
          throw new Error('The chat session was not found')
        const result = await ingestChatDocument({
          content: Buffer.from(await file.arrayBuffer()),
          contentType: file.type || 'application/octet-stream',
          filename: file.name,
          note: typeof note === 'string' ? note : undefined,
          sessionId
        })
        return c.json({ document: result.email, duplicate: result.duplicate })
      } catch (error) {
        return c.json(errorResponse(error), 400)
      }
    }
  }),
  registerApiRoute('/sydekyks/inbound-email/:emailId/review', {
    method: 'POST',
    handler: async (c) => {
      try {
        const { emailId } = emailIdSchema.parse(c.req.param())
        const input = ledgerBillInputSchema.parse(await c.req.json())
        const result = await handoffInboundEmailToLedger(emailId, input)
        await imapGadget.reconcileMission(result.mission)
        return c.json(result)
      } catch (error) {
        return c.json(errorResponse(error), 400)
      }
    }
  }),
  registerApiRoute('/sydekyks/inbound-email/:emailId/analyze', {
    method: 'POST',
    handler: async (c) => {
      try {
        const { emailId } = emailIdSchema.parse(c.req.param())
        let email = await reanalyzeInboundEmail(emailId)
        if (email.ledgerMissionId) {
          const mission = await appStore.getMission(email.ledgerMissionId)
          if (mission) {
            await imapGadget.reconcileMission(mission)
            email = (await appStore.getInboundEmail(email.id)) ?? email
          }
        }
        return c.json(email)
      } catch (error) {
        return c.json(errorResponse(error), 400)
      }
    }
  }),
  registerApiRoute('/sydekyks/inbound-email', {
    method: 'GET',
    handler: async (c) => c.json({ emails: await appStore.listInboundEmails() })
  }),
  registerApiRoute('/sydekyks/gadgets/odoo/status', {
    method: 'GET',
    handler: async (c) => {
      await odooGadgetReady
      return c.json(odooGadget.getStatus())
    }
  }),
  registerApiRoute('/sydekyks/gadgets/odoo/connect', {
    method: 'POST',
    handler: async (c) => {
      try {
        const input = odooCredentialSchema.parse(await c.req.json())
        const mission = await appStore.createMission({
          kind: 'gadget.connection',
          sydekyk: 'Syd',
          title: input.mode === 'demo' ? 'Activate demo Odoo' : `Connect ${input.database}`,
          summary: 'Testing the Odoo Gadget connection.',
          status: 'running',
          payload: input.mode === 'demo' ? input : { ...input, secret: '[redacted]' }
        })
        try {
          const status = await odooGadget.connect(input)
          await appStore.updateMission(mission.id, {
            status: 'completed',
            summary: `Odoo Gadget connected to ${status.label}.`,
            result: status
          })
          return c.json(status)
        } catch (error) {
          await appStore.updateMission(mission.id, {
            status: 'failed',
            summary: error instanceof Error ? error.message : 'Odoo connection failed.'
          })
          throw error
        }
      } catch (error) {
        return c.json(errorResponse(error), 400)
      }
    }
  }),
  registerApiRoute('/sydekyks/gadgets/odoo/disconnect', {
    method: 'POST',
    handler: async (c) => c.json(await odooGadget.disconnect())
  }),
  registerApiRoute('/sydekyks/workflows/ledger/vendor-bill', {
    method: 'POST',
    handler: async (c) => {
      try {
        const input = ledgerBillInputSchema.parse(await c.req.json())
        return c.json(await startLedgerMission(input))
      } catch (error) {
        return c.json(errorResponse(error), 400)
      }
    }
  }),
  registerApiRoute('/sydekyks/workflows/ledger/vendor-bill/:missionId/resume', {
    method: 'POST',
    handler: async (c) => {
      try {
        const { missionId } = missionIdSchema.parse(c.req.param())
        const decision = approvalDecisionSchema.parse(await c.req.json())
        const mission = await resumeLedgerMission(missionId, decision)
        await imapGadget.reconcileMission(mission)
        return c.json(mission)
      } catch (error) {
        return c.json(errorResponse(error), 400)
      }
    }
  }),
  registerApiRoute('/sydekyks/missions', {
    method: 'GET',
    handler: async (c) => c.json({ missions: await appStore.listMissions() })
  }),
  registerApiRoute('/sydekyks/missions/acknowledge', {
    method: 'POST',
    handler: async (c) => {
      try {
        const { missionIds } = acknowledgeMissionsSchema.parse(await c.req.json())
        return c.json({ acknowledged: await appStore.acknowledgeMissions(missionIds) })
      } catch (error) {
        return c.json(errorResponse(error), 400)
      }
    }
  }),
  registerApiRoute('/sydekyks/permissions', {
    method: 'GET',
    handler: async (c) => c.json({ permissions: await appStore.listPermissions() })
  })
]
