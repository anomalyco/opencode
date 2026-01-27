/**
 * ULTRAWORK Memory - Persistent Memory System
 *
 * Implements a Letta/MemGPT-inspired 4-layer memory architecture
 * that allows the orchestrator to learn and improve over time.
 *
 * Memory Layers:
 * 1. Working Memory  - Current task context (in-session)
 * 2. Core Memory     - User preferences, project config (persistent)
 * 3. Recall Memory   - Task execution history (searchable)
 * 4. Archival Memory - Long-term knowledge base (indexed)
 *
 * Inspired by:
 * - Letta/MemGPT's persistent memory architecture
 * - ClawdBot's cross-session memory
 * - EvoAgentX's self-improvement via historical data
 */

import { Log } from "../util/log"
import { Global } from "../global"
import path from "path"
import fs from "fs/promises"

export namespace UltraworkMemory {
  const log = Log.create({ service: "ultrawork.memory" })

  // Memory file paths
  const MEMORY_DIR = path.join(Global.Path.data, "ultrawork")
  const CORE_MEMORY_FILE = path.join(MEMORY_DIR, "core-memory.json")
  const RECALL_MEMORY_FILE = path.join(MEMORY_DIR, "recall-memory.json")
  const ARCHIVAL_MEMORY_FILE = path.join(MEMORY_DIR, "archival-memory.json")

  // ============================================
  // Layer 1: Working Memory (in-process, volatile)
  // ============================================

  interface WorkingMemory {
    currentTask: string | null
    activeAIs: string[]
    pendingResults: Record<string, any>
    context: Record<string, any>
    startedAt: number | null
  }

  let workingMemory: WorkingMemory = {
    currentTask: null,
    activeAIs: [],
    pendingResults: {},
    context: {},
    startedAt: null,
  }

  export function setWorkingContext(key: string, value: any): void {
    workingMemory.context[key] = value
  }

  export function getWorkingContext(key: string): any {
    return workingMemory.context[key]
  }

  export function setCurrentTask(task: string): void {
    workingMemory.currentTask = task
    workingMemory.startedAt = Date.now()
  }

  export function clearWorking(): void {
    workingMemory = {
      currentTask: null,
      activeAIs: [],
      pendingResults: {},
      context: {},
      startedAt: null,
    }
  }

  // ============================================
  // Layer 2: Core Memory (persistent preferences)
  // ============================================

  interface CoreMemory {
    userPreferences: Record<string, any>
    projectContext: Record<string, any>
    aiPreferences: Record<string, string> // taskType -> preferred AI
    lastUpdated: number
  }

  let coreMemoryCache: CoreMemory | null = null

  async function ensureDir(): Promise<void> {
    await fs.mkdir(MEMORY_DIR, { recursive: true })
  }

  async function loadCoreMemory(): Promise<CoreMemory> {
    if (coreMemoryCache) return coreMemoryCache

    try {
      await ensureDir()
      const data = await fs.readFile(CORE_MEMORY_FILE, "utf-8")
      coreMemoryCache = JSON.parse(data)
      return coreMemoryCache!
    } catch {
      coreMemoryCache = {
        userPreferences: {},
        projectContext: {},
        aiPreferences: {},
        lastUpdated: Date.now(),
      }
      return coreMemoryCache
    }
  }

  async function saveCoreMemory(): Promise<void> {
    if (!coreMemoryCache) return
    try {
      await ensureDir()
      coreMemoryCache.lastUpdated = Date.now()
      await fs.writeFile(CORE_MEMORY_FILE, JSON.stringify(coreMemoryCache, null, 2))
    } catch (e: any) {
      log.error("failed to save core memory", { error: e.message })
    }
  }

  export async function setPreference(key: string, value: any): Promise<void> {
    const mem = await loadCoreMemory()
    mem.userPreferences[key] = value
    await saveCoreMemory()
  }

  export async function getPreference(key: string): Promise<any> {
    const mem = await loadCoreMemory()
    return mem.userPreferences[key]
  }

  export async function setAIPreference(taskType: string, aiId: string): Promise<void> {
    const mem = await loadCoreMemory()
    mem.aiPreferences[taskType] = aiId
    await saveCoreMemory()
  }

  export async function getAIPreference(taskType: string): Promise<string | undefined> {
    const mem = await loadCoreMemory()
    return mem.aiPreferences[taskType]
  }

  // ============================================
  // Layer 3: Recall Memory (execution history)
  // ============================================

  interface TaskExecution {
    taskType: string
    aiUsed: string
    success: boolean
    durationMs: number
    timestamp: number
  }

  interface RecallMemory {
    executions: TaskExecution[]
    ideas: { text: string; timestamp: number }[]
    maxEntries: number
  }

  let recallMemoryCache: RecallMemory | null = null

  async function loadRecallMemory(): Promise<RecallMemory> {
    if (recallMemoryCache) return recallMemoryCache

    try {
      await ensureDir()
      const data = await fs.readFile(RECALL_MEMORY_FILE, "utf-8")
      recallMemoryCache = JSON.parse(data)
      return recallMemoryCache!
    } catch {
      recallMemoryCache = {
        executions: [],
        ideas: [],
        maxEntries: 10_000,
      }
      return recallMemoryCache
    }
  }

  async function saveRecallMemory(): Promise<void> {
    if (!recallMemoryCache) return
    try {
      await ensureDir()
      // Trim to max entries
      if (recallMemoryCache.executions.length > recallMemoryCache.maxEntries) {
        recallMemoryCache.executions = recallMemoryCache.executions.slice(-recallMemoryCache.maxEntries)
      }
      await fs.writeFile(RECALL_MEMORY_FILE, JSON.stringify(recallMemoryCache, null, 2))
    } catch (e: any) {
      log.error("failed to save recall memory", { error: e.message })
    }
  }

  export function recordTaskExecution(execution: Omit<TaskExecution, "timestamp">): void {
    const entry = { ...execution, timestamp: Date.now() }

    // Async save, don't block
    loadRecallMemory()
      .then((mem) => {
        mem.executions.push(entry)
        return saveRecallMemory()
      })
      .catch((e) => log.error("failed to record execution", { error: String(e) }))
  }

  export function recordIdea(idea: string): void {
    loadRecallMemory()
      .then((mem) => {
        mem.ideas.push({ text: idea, timestamp: Date.now() })
        return saveRecallMemory()
      })
      .catch((e) => log.error("failed to record idea", { error: String(e) }))
  }

  /**
   * Get the best AI for a task type based on historical performance
   */
  export function getBestAIForTask(
    taskType: string,
  ): { aiId: string; successRate: number; avgDuration: number } | undefined {
    if (!recallMemoryCache) return undefined

    const relevant = recallMemoryCache.executions.filter((e) => e.taskType === taskType)
    if (relevant.length < 3) return undefined // Need minimum data points

    // Group by AI and calculate success rate
    const byAI: Record<string, { successes: number; total: number; totalDuration: number }> = {}
    for (const exec of relevant) {
      if (!byAI[exec.aiUsed]) {
        byAI[exec.aiUsed] = { successes: 0, total: 0, totalDuration: 0 }
      }
      byAI[exec.aiUsed].total++
      byAI[exec.aiUsed].totalDuration += exec.durationMs
      if (exec.success) byAI[exec.aiUsed].successes++
    }

    // Find best performer
    let best: { aiId: string; successRate: number; avgDuration: number } | undefined
    for (const [aiId, stats] of Object.entries(byAI)) {
      const successRate = stats.successes / stats.total
      const avgDuration = stats.totalDuration / stats.total
      if (!best || successRate > best.successRate) {
        best = { aiId, successRate, avgDuration }
      }
    }

    return best
  }

  /**
   * Get recent ideas for context
   */
  export async function getRecentIdeas(limit: number = 10): Promise<string[]> {
    const mem = await loadRecallMemory()
    return mem.ideas
      .slice(-limit)
      .map((i) => i.text)
  }

  // ============================================
  // Layer 4: Archival Memory (long-term knowledge)
  // ============================================

  interface ArchivalEntry {
    key: string
    value: any
    tags: string[]
    timestamp: number
  }

  interface ArchivalMemory {
    entries: ArchivalEntry[]
  }

  let archivalCache: ArchivalMemory | null = null

  async function loadArchivalMemory(): Promise<ArchivalMemory> {
    if (archivalCache) return archivalCache

    try {
      await ensureDir()
      const data = await fs.readFile(ARCHIVAL_MEMORY_FILE, "utf-8")
      archivalCache = JSON.parse(data)
      return archivalCache!
    } catch {
      archivalCache = { entries: [] }
      return archivalCache
    }
  }

  async function saveArchivalMemory(): Promise<void> {
    if (!archivalCache) return
    try {
      await ensureDir()
      await fs.writeFile(ARCHIVAL_MEMORY_FILE, JSON.stringify(archivalCache, null, 2))
    } catch (e: any) {
      log.error("failed to save archival memory", { error: e.message })
    }
  }

  export async function archive(key: string, value: any, tags: string[] = []): Promise<void> {
    const mem = await loadArchivalMemory()
    const existing = mem.entries.findIndex((e) => e.key === key)
    const entry: ArchivalEntry = { key, value, tags, timestamp: Date.now() }

    if (existing >= 0) {
      mem.entries[existing] = entry
    } else {
      mem.entries.push(entry)
    }

    await saveArchivalMemory()
  }

  export async function recall(key: string): Promise<any> {
    const mem = await loadArchivalMemory()
    return mem.entries.find((e) => e.key === key)?.value
  }

  export async function searchArchive(query: string): Promise<ArchivalEntry[]> {
    const mem = await loadArchivalMemory()
    const lower = query.toLowerCase()
    return mem.entries.filter(
      (e) =>
        e.key.toLowerCase().includes(lower) ||
        e.tags.some((t) => t.toLowerCase().includes(lower)) ||
        JSON.stringify(e.value).toLowerCase().includes(lower),
    )
  }

  /**
   * Get memory statistics
   */
  export async function stats(): Promise<{
    working: { hasTask: boolean; contextKeys: number }
    core: { preferences: number; aiPreferences: number }
    recall: { executions: number; ideas: number }
    archival: { entries: number }
  }> {
    const core = await loadCoreMemory()
    const recallMem = await loadRecallMemory()
    const archival = await loadArchivalMemory()

    return {
      working: {
        hasTask: workingMemory.currentTask !== null,
        contextKeys: Object.keys(workingMemory.context).length,
      },
      core: {
        preferences: Object.keys(core.userPreferences).length,
        aiPreferences: Object.keys(core.aiPreferences).length,
      },
      recall: {
        executions: recallMem.executions.length,
        ideas: recallMem.ideas.length,
      },
      archival: {
        entries: archival.entries.length,
      },
    }
  }
}
