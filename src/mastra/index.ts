import { chatRoute } from '@mastra/ai-sdk'
import { Mastra } from '@mastra/core/mastra'
import { LibSQLStore } from '@mastra/libsql'
import { timingSafeEqual } from 'node:crypto'
import { automationDispatcherWorkflow } from './automations/dispatcher-workflow'
import { sydAgent } from './agents/syd-agent'
import { appStore } from './lib/app-store'
import { mastraDatabaseUrl } from './lib/paths'
import { workerLogger } from './lib/logger'
import { appRoutes } from './server/routes'
import { ledgerAgent } from './sydekyks/ledger/agent'
import { billIntelligenceAgent } from './sydekyks/ledger/intelligence-agent'
import { ledgerVendorBillWorkflow } from './sydekyks/ledger/workflows/vendor-bill'

class ProcessScopedLibSQLStore extends LibSQLStore {
  /**
   * The standalone desktop worker exits immediately after Mastra shutdown.
   * LibSQLStore currently opens per-domain SQLite clients, then its parent close
   * attempts to switch WAL back to DELETE while the workflow-domain client is
   * still open. SQLite correctly reports SQLITE_BUSY even though process exit
   * releases every handle and WAL recovery is durable. Avoid that unsafe journal
   * mode switch here; Electron snapshots the DB/WAL/SHM set before every launch.
   */
  async close(): Promise<void> {
    workerLogger.info('storage.process-scoped-close')
  }
}

const sessionToken = process.env.SYDEKYKS_SESSION_TOKEN?.trim()

const tokenMatches = (candidate: string | undefined): boolean => {
  if (!sessionToken || !candidate?.startsWith('Bearer ')) return false
  const supplied = Buffer.from(candidate.slice('Bearer '.length))
  const expected = Buffer.from(sessionToken)
  return supplied.length === expected.length && timingSafeEqual(supplied, expected)
}

export const mastra = new Mastra({
  storage: new ProcessScopedLibSQLStore({ id: 'sydekyks-local-storage', url: mastraDatabaseUrl }),
  agents: {
    syd: sydAgent,
    ledger: ledgerAgent,
    billIntelligence: billIntelligenceAgent
  },
  workflows: {
    ledgerVendorBillWorkflow,
    automationDispatcherWorkflow
  },
  server: {
    host: '127.0.0.1',
    port: Number(process.env.PORT ?? 4111),
    cors: {
      origin: (origin) => {
        if (!origin || origin === 'null') return origin || 'null'
        try {
          const hostname = new URL(origin).hostname
          return hostname === 'localhost' || hostname === '127.0.0.1' ? origin : undefined
        } catch {
          return undefined
        }
      },
      allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: ['content-type', 'authorization']
    },
    middleware: [
      {
        path: '/*',
        handler: async (context, next) => {
          const startedAt = performance.now()
          // The CORS middleware must be allowed to answer a browser preflight;
          // every request that can read or mutate data still requires the token.
          if (context.req.method === 'OPTIONS') return next()
          if (!tokenMatches(context.req.header('authorization'))) {
            workerLogger.warn('http.unauthorized', {
              method: context.req.method,
              path: context.req.path
            })
            return context.json({ error: 'Unauthorized local service request' }, 401)
          }
          await next()
          workerLogger.info('http.request', {
            method: context.req.method,
            path: context.req.path,
            status: context.res.status,
            durationMs: Math.round(performance.now() - startedAt)
          })
        }
      }
    ],
    apiRoutes: [
      chatRoute({
        path: '/chat/:agentId',
        version: 'v6'
      }),
      ...appRoutes
    ]
  }
})

const shutdownMastra = mastra.shutdown.bind(mastra)
mastra.shutdown = async (): Promise<void> => {
  await appStore.close()
  await workerLogger.flush()
  await shutdownMastra()
}
