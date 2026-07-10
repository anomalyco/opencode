// Production-ready engine factory
// Wires together: Database (SQLite) + Real FS + LLM Provider

import { AgentEngine, type EngineConfig } from "./agent-engine"
import { EngineDatabase } from "./db/engine-database"
import { RealGitTransactionManager } from "./transactional-fs-real"
import { createEngineAdapter, type EngineAdapter } from "../engine-adapter"
import { LLMDAGGenerator } from "./llm/llm-dag-generator"
import { createAutoProviderAdapter } from "./llm/ai-sdk-adapter"
import type { ProviderAdapter } from "./llm/llm-dag-generator"
import { EventType, EventPriority } from "./event-bus"

export interface ProductionEngineOptions {
  config?: Partial<EngineConfig>
  dbPath?: string
  workDir?: string
  provider?: ProviderAdapter
  enableLLM?: boolean
}

export async function createProductionEngine(
  options: ProductionEngineOptions = {},
): Promise<{
  engine: AgentEngine
  adapter: EngineAdapter
  db: EngineDatabase
  txManager: RealGitTransactionManager
  dagGenerator: LLMDAGGenerator
}> {
  // 1. Initialize database
  const db = new EngineDatabase(options.dbPath ?? ":memory:")
  await db.initialize()

  // 2. Create event persistence callback
  const persistFn = db.isConnected()
    ? (event: Parameters<typeof db.persistBusEvent>[0]) => { db.persistBusEvent(event) }
    : undefined

  // 3. Create adapter + engine with persistence
  const adapter = createEngineAdapter(
    {
      maxSteps: 50,
      tokenBudget: 1_000_000,
      ...options.config,
    },
    persistFn,
  )
  const engine = adapter.getEngine()!

  // 3. Wire database to checkpoints, branches, archiver, session tracking, memory, and repair
  if (db.isConnected()) {
    engine.checkpoints.setDatabase(db)
    engine.branches.setDatabase(db)
    engine.archiver.setDatabase(db)
    engine.setEngineDatabase(db)
    engine.memory.setDatabase(db)
    engine.repair.setDatabase(db)
  }

  // 4. Create real filesystem transaction manager
  const txManager = new RealGitTransactionManager(options.workDir)

  // Wire EventBus callbacks for filesystem transactions
  txManager.setEventCallbacks({
    onCommit: async (tx) => {
      await engine.eventBus.publish({
        type: EventType.FILESYSTEM_COMMITTED,
        source: "RealGitTransactionManager",
        session_id: tx.sessionId,
        data: { transaction_id: tx.id, files: tx.affectedFiles },
        priority: EventPriority.CRITICAL,
        timestamp: Date.now(),
        require_persistence: true,
      })
    },
    onRollback: async (tx) => {
      await engine.eventBus.publish({
        type: EventType.FILESYSTEM_CONFLICT,
        source: "RealGitTransactionManager",
        session_id: tx.sessionId,
        data: { transaction_id: tx.id, files: tx.affectedFiles, reason: "rollback" },
        priority: EventPriority.HIGH,
        timestamp: Date.now(),
        require_persistence: true,
      })
    },
  })

  // @ts-expect-error — RealGitTransactionManager is API-compatible with GitTransactionManager
  // but TypeScript private-field declarations break structural compatibility
  engine.txFilesystem = txManager

  // 5. Wire LLM DAG generator
  const provider = options.provider ?? (options.enableLLM !== false ? createAutoProviderAdapter() : undefined)
  const dagGenerator = new LLMDAGGenerator()
  if (provider && options.enableLLM !== false) {
    dagGenerator.setProvider(provider)
  }
  engine.dagGenerator = dagGenerator

  return { engine, adapter, db, txManager, dagGenerator }
}

export function createProductionAdapter(): {
  adapter: EngineAdapter
  db: EngineDatabase
  txManager: RealGitTransactionManager
  dagGenerator: LLMDAGGenerator
} {
  const adapter = createEngineAdapter()
  const engine = adapter.getEngine()!

  const db = new EngineDatabase(":memory:")
  engine.checkpoints.setDatabase(db)

  const txManager = new RealGitTransactionManager()
  const dagGenerator = new LLMDAGGenerator()

  try {
    const provider = createAutoProviderAdapter()
    dagGenerator.setProvider(provider)
  } catch {
    // LLM not available, use fallback
  }

  return { adapter, db, txManager, dagGenerator }
}

export * as ProductionEngine from "./production-engine"
