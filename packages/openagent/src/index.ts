/**
 * OpenAgent
 *
 * A meta-orchestrator that sits above OpenCode, using it as a powerful coding
 * engine to autonomously handle complex, multi-step coding tasks.
 *
 * Architecture:
 *
 *   User/Channel  →  Orchestrator (LLM planner)  →  OpenCode Session Pool
 *        ↑                                                    ↓
 *   Result/Progress  ←────────────────────────────  Tool Execution
 *
 * OpenAgent is to OpenCode what OpenClaw is to Claude Code — a programmatic
 * control layer that adds:
 *   - Task decomposition (LLM plans subtasks from a high-level request)
 *   - Parallel execution (multiple OpenCode sessions concurrently)
 *   - Multiple channels (HTTP API, GitHub webhooks, Slack, CLI)
 *   - Session pool management (reuse sessions, recycle idle ones)
 *   - Real-time progress streaming (SSE, webhooks, callbacks)
 *
 * Usage:
 *   import { createOpenAgent } from "@opencode-ai/openagent"
 *
 *   const agent = await createOpenAgent({
 *     port: 3000,
 *     orchestrator: { model: "claude-sonnet-4-6" }
 *   })
 *
 *   // Submit a task programmatically
 *   const result = await agent.run("Add error handling to all API routes")
 *
 *   // Or start the HTTP server and accept tasks from external systems
 *   agent.listen()
 */

import { serve } from "bun"
import { ulid } from "../node_modules/ulid/dist/index.esm.js"

import { OpenCodeAdapter, type OpenCodeAdapterOptions } from "./opencode/adapter.ts"
import { SessionPool, type PoolConfig } from "./opencode/pool.ts"
import { TaskQueue } from "./task/queue.ts"
import type { Task, TaskPriority } from "./task/task.ts"
import { CreateTaskInput } from "./task/task.ts"
import { Orchestrator, type OrchestratorOptions } from "./orchestrator/orchestrator.ts"
import { createHttpApp } from "./channels/http.ts"
import { createGitHubChannel, type GitHubChannelOptions } from "./channels/github.ts"

// ─── Public API ───────────────────────────────────────────────────────────────

export type { Task, TaskPriority } from "./task/task.ts"
export type { SessionHandle, PromptResult } from "./opencode/adapter.ts"
export type { TaskProgressUpdate } from "./task/task.ts"

export interface OpenAgentOptions {
  /** Port for the OpenAgent HTTP API server. Default: 3000 */
  port?: number
  /** Hostname to bind the HTTP server */
  hostname?: string
  /** Orchestrator LLM configuration */
  orchestrator?: OrchestratorOptions
  /** OpenCode server options */
  opencode?: OpenCodeAdapterOptions
  /** Session pool configuration */
  pool?: PoolConfig
  /** GitHub webhook configuration */
  github?: GitHubChannelOptions
  /** Maximum concurrent tasks */
  concurrency?: number
  /** Signal to shut down OpenAgent */
  signal?: AbortSignal
}

export interface OpenAgentHandle {
  /** The URL of the OpenAgent HTTP server */
  url: string
  /** The URL of the underlying OpenCode server */
  opencodeUrl: string

  /**
   * Submit a task and wait for the result (synchronous, for scripting).
   */
  run(description: string, options?: { title?: string; priority?: TaskPriority }): Promise<string>

  /**
   * Submit a task and return immediately with a taskId.
   * Poll /tasks/:id to get progress.
   */
  submit(description: string, options?: { title?: string; priority?: TaskPriority }): Promise<{ taskId: string; result: Promise<string> }>

  /**
   * Get a task by ID.
   */
  getTask(id: string): Task | undefined

  /**
   * List all tasks (pending + completed).
   */
  listTasks(): Task[]

  /**
   * Cancel a pending task.
   */
  cancelTask(id: string): boolean

  /**
   * Session pool stats (how many sessions per role, idle/busy)
   */
  poolStats(): Record<string, unknown>

  /**
   * Task queue stats (queued/running by priority)
   */
  queueStats(): Record<string, unknown>

  /**
   * Shut down OpenAgent (and the underlying OpenCode server)
   */
  close(): void
}

// ─── createOpenAgent ──────────────────────────────────────────────────────────

/**
 * Create and start an OpenAgent instance.
 *
 * This starts:
 *   1. An OpenCode server (coding engine)
 *   2. A session pool manager
 *   3. The orchestrator agent (LLM planner)
 *   4. The OpenAgent HTTP API server
 *
 * @example
 * const agent = await createOpenAgent({ port: 3000 })
 * const result = await agent.run("Fix all TypeScript errors in the codebase")
 * console.log(result)
 */
export async function createOpenAgent(options: OpenAgentOptions = {}): Promise<OpenAgentHandle> {
  const {
    port = 3000,
    hostname = "127.0.0.1",
    concurrency = 4,
  } = options

  // Task store (in-memory; replace with SQLite for persistence)
  const tasks = new Map<string, Task>()

  // 1. Start OpenCode server and create adapter
  const adapter = await OpenCodeAdapter.create({
    port: options.opencode?.port ?? 0,
    signal: options.signal,
  })

  // 2. Session pool
  const pool = new SessionPool(adapter, options.pool)

  // 3. Orchestrator (LLM-based planner + executor)
  const orchestrator = new Orchestrator(pool, adapter, options.orchestrator)

  // 4. Task queue
  const queue = new TaskQueue({ concurrency })
  queue.setProcessor(async (task) => {
    task.status = "running"
    const result = await orchestrator.execute(task)
    return result
  })

  // ── Helper: submit a task ────────────────────────────────────────────────

  async function submitTask(input: {
    title: string
    description: string
    priority?: string
    source?: Task["source"]
    onProgress?: Task["onProgress"]
  }): Promise<{ taskId: string; result: Promise<string> }> {
    const task: Task = {
      id: ulid(),
      title: input.title,
      description: input.description,
      priority: (input.priority as TaskPriority) ?? "normal",
      status: "pending",
      source: input.source ?? { channel: "http", metadata: {} },
      subtasks: [],
      createdAt: new Date(),
      onProgress: input.onProgress,
    }

    tasks.set(task.id, task)
    const result = queue.enqueue(task)
    return { taskId: task.id, result }
  }

  // ── HTTP App ─────────────────────────────────────────────────────────────

  const httpApp = createHttpApp({
    submitTask: (input) =>
      submitTask({
        ...input,
        source: { channel: "http", metadata: {} },
      }),
    getTask: (id) => tasks.get(id),
    listTasks: () => Array.from(tasks.values()),
    cancelTask: (id) => queue.cancel(id),
    poolStats: () => pool.stats(),
    queueStats: () => queue.stats(),
  })

  // Mount GitHub webhook channel
  const githubChannel = createGitHubChannel(
    (input) =>
      submitTask({
        ...input,
        source: input.source,
      }),
    options.github,
  )
  httpApp.route("/github", githubChannel)

  // 5. Start HTTP server
  const server = serve({
    port,
    hostname,
    fetch: httpApp.fetch,
  })

  const agentUrl = `http://${hostname}:${server.port}`

  // ── Handle shutdown ───────────────────────────────────────────────────────

  const close = () => {
    pool.destroy()
    adapter.close()
    server.stop()
  }

  options.signal?.addEventListener("abort", close)

  // ── Public handle ─────────────────────────────────────────────────────────

  return {
    url: agentUrl,
    opencodeUrl: adapter.url,

    async run(description, opts = {}) {
      const { taskId, result } = await submitTask({
        title: opts.title ?? description.slice(0, 80),
        description,
        priority: opts.priority,
        source: { channel: "cli", metadata: {} },
      })
      return result
    },

    async submit(description, opts = {}) {
      return submitTask({
        title: opts.title ?? description.slice(0, 80),
        description,
        priority: opts.priority,
        source: { channel: "cli", metadata: {} },
      })
    },

    getTask: (id) => tasks.get(id),
    listTasks: () => Array.from(tasks.values()),
    cancelTask: (id) => queue.cancel(id),
    poolStats: () => pool.stats(),
    queueStats: () => queue.stats(),
    close,
  }
}
