/**
 * Background Agent Spawning
 *
 * Enables spawning background agents that run asynchronously while
 * the main session continues. Integrates with OpenCode's agent system
 * and event bus for status tracking.
 *
 * Agent Types:
 * - oracle: Deep research specialist
 * - librarian: Documentation and memory specialist
 * - explore: Codebase exploration specialist
 * - research: General research agent
 * - analyze: Analysis tasks
 * - implement: Implementation tasks
 *
 * Ported from: scripts/spawn_background_agent.py
 * Uses: OpenCode's Agent system, Storage API, Event Bus
 */

import { Storage } from "../storage/storage"
import { Bus } from "../bus"
import { Instance } from "../project/instance"
import { Log } from "../util/log"
import { OrchestrationEvents } from "./events"
import path from "path"
import fs from "fs/promises"

const log = Log.create({ service: "background-agent" })

export namespace BackgroundAgent {
  /**
   * Agent types with their default configurations
   */
  export type AgentType = "oracle" | "librarian" | "explore" | "research" | "analyze" | "implement"

  /**
   * Background task state
   */
  export interface Task {
    id: string
    agentType: AgentType
    description: string
    triggerFile: string
    status: "pending" | "running" | "completed" | "failed" | "reported"
    startedAt: string
    completedAt?: string
    output?: string
    error?: string
  }

  /**
   * Spawn options
   */
  export interface SpawnOptions {
    task: string
    agentType?: AgentType
    model?: string
    context?: Record<string, any>
    testMode?: boolean
  }

  /**
   * Model aliases for convenience - includes models from both Claude Code and OpenCode
   */
  export const MODEL_ALIASES: Record<string, string> = {
    // Anthropic models
    sonnet: "claude-sonnet-4-20250514",
    opus: "claude-opus-4-5-20251101",
    haiku: "claude-3-5-haiku-20241022",
    "claude-sonnet": "claude-sonnet-4-20250514",
    "claude-opus": "claude-opus-4-5-20251101",
    "claude-haiku": "claude-3-5-haiku-20241022",
    // OpenAI models
    "gpt-4": "gpt-4-turbo-preview",
    "gpt-4o": "gpt-4o",
    "gpt-4o-mini": "gpt-4o-mini",
    o1: "o1",
    "o1-mini": "o1-mini",
    "o1-preview": "o1-preview",
    "o3-mini": "o3-mini",
    // DeepSeek models
    deepseek: "deepseek-reasoner",
    "deepseek-chat": "deepseek-chat",
    "deepseek-coder": "deepseek-coder",
    // Google models
    gemini: "gemini-2.0-flash-thinking-exp-01-21",
    "gemini-pro": "gemini-1.5-pro",
    "gemini-flash": "gemini-1.5-flash",
    // Groq models
    llama: "llama-3.3-70b-versatile",
    mixtral: "mixtral-8x7b-32768",
    // Mistral models
    mistral: "mistral-large-latest",
    codestral: "codestral-latest",
  }

  /**
   * Storage key for background tasks
   */
  const STORAGE_KEY = ["orchestration", "background-tasks"]

  /**
   * Resolve model alias to full model name
   */
  export function resolveModel(model: string): string {
    return MODEL_ALIASES[model.toLowerCase()] ?? model
  }

  /**
   * Create agent prompt with context
   */
  function createAgentPrompt(task: string, agentType: AgentType, context: Record<string, any>): string {
    const prompts: Record<AgentType, string> = {
      oracle: `You are **Oracle** - a deep research agent spawned in the background.

**Your Task:** ${task}

**Context:**
- Spawned by: OpenCode session
- Parent session: ${context.sessionId ?? "unknown"}
- Timestamp: ${new Date().toISOString()}

**Instructions:**
1. Conduct thorough research on the topic
2. Search the codebase, documentation, and web as needed
3. Write your findings to a markdown file in the appropriate location
4. Be thorough - this is background work, take your time
5. Include citations and references

When complete, ensure your output is saved for the parent session to retrieve.`,

      librarian: `You are **Librarian** - a documentation and memory agent spawned in the background.

**Your Task:** ${task}

**Context:**
- Spawned by: OpenCode session
- Parent session: ${context.sessionId ?? "unknown"}
- Timestamp: ${new Date().toISOString()}

**Instructions:**
1. Focus on organizing and documenting information
2. Use memories to store important findings
3. Create clear, structured documentation
4. Index and cross-reference relevant materials
5. Make information discoverable for future sessions

When complete, ensure your documentation is properly saved and indexed.`,

      explore: `You are **Explorer** - a codebase exploration agent spawned in the background.

**Your Task:** ${task}

**Context:**
- Spawned by: OpenCode session
- Parent session: ${context.sessionId ?? "unknown"}
- Timestamp: ${new Date().toISOString()}

**Instructions:**
1. Use search tools to thoroughly explore the codebase
2. Map relevant files, classes, functions, and relationships
3. Create a comprehensive report of your findings
4. Note any patterns, issues, or opportunities discovered
5. Save your findings for the parent session

Be thorough in your exploration - cover multiple entry points and follow connections.`,

      research: `You are a **Research Agent** spawned in the background.

**Your Task:** ${task}

**Context:**
- Spawned by: OpenCode session
- Parent session: ${context.sessionId ?? "unknown"}
- Timestamp: ${new Date().toISOString()}

**Instructions:**
1. Conduct comprehensive research on the topic
2. Use web search, documentation, and codebase search as appropriate
3. Synthesize findings into a clear report
4. Include sources and confidence levels
5. Save your findings for retrieval

When complete, your output will be available to the parent session.`,

      analyze: `You are an **Analysis Agent** spawned in the background.

**Your Task:** ${task}

**Context:**
- Spawned by: OpenCode session
- Parent session: ${context.sessionId ?? "unknown"}
- Timestamp: ${new Date().toISOString()}

**Instructions:**
1. Perform deep analysis of the specified topic
2. Consider multiple perspectives and trade-offs
3. Document your reasoning process
4. Provide actionable recommendations
5. Save your analysis for the parent session

Be thorough and consider edge cases.`,

      implement: `You are an **Implementation Agent** spawned in the background.

**Your Task:** ${task}

**Context:**
- Spawned by: OpenCode session
- Parent session: ${context.sessionId ?? "unknown"}
- Timestamp: ${new Date().toISOString()}

**Instructions:**
1. Implement the requested feature or fix
2. Follow existing code patterns and conventions
3. Write tests if appropriate
4. Document your changes
5. Commit with clear messages (if appropriate)

When complete, report what was implemented and any issues encountered.`,
    }

    return prompts[agentType]
  }

  /**
   * Get triggers directory
   */
  async function getTriggersDir(): Promise<string> {
    const opencodePath = path.join(Instance.directory, ".opencode", "triggers")
    await fs.mkdir(opencodePath, { recursive: true })
    return opencodePath
  }

  /**
   * Spawn a background agent
   */
  export async function spawn(options: SpawnOptions): Promise<Task> {
    const agentType = options.agentType ?? "research"
    const model = resolveModel(options.model ?? "sonnet")
    const context = options.context ?? {}

    // Generate task ID
    const taskId = `spawn-${Date.now()}`

    // Get triggers directory
    const triggersDir = await getTriggersDir()
    const triggerFile = path.join(triggersDir, `${taskId}.trigger`)

    // Create prompt
    const prompt = createAgentPrompt(options.task, agentType, context)

    // Create trigger content (JSON for security)
    const triggerContent = {
      prompt,
      model,
      variant: "medium",
      metadata: {
        agentType,
        taskSummary: options.task.slice(0, 100),
        spawnedBy: "opencode",
        spawnedAt: new Date().toISOString(),
        parentSession: context.sessionId ?? "",
      },
    }

    // Write trigger file
    await fs.writeFile(triggerFile, JSON.stringify(triggerContent, null, 2))

    // Create task record
    const task: Task = {
      id: taskId,
      agentType,
      description: `[${agentType}] ${options.task.slice(0, 50)}...`,
      triggerFile,
      status: "pending",
      startedAt: new Date().toISOString(),
    }

    // Register in storage
    try {
      await Storage.update<Record<string, Task>>(STORAGE_KEY, (draft) => {
        Object.assign(draft, { [taskId]: task })
      })
    } catch {
      // Storage doesn't exist yet, write initial state
      await Storage.write(STORAGE_KEY, { [taskId]: task })
    }

    log.info("Background agent spawned", {
      taskId,
      agentType,
      model,
    })

    Bus.publish(OrchestrationEvents.BackgroundAgentSpawned, {
      taskId,
      agentType,
      model,
      description: task.description,
    })

    return task
  }

  /**
   * Get all background tasks
   */
  export async function getTasks(): Promise<Record<string, Task>> {
    try {
      return (await Storage.read<Record<string, Task>>(STORAGE_KEY)) ?? {}
    } catch {
      return {}
    }
  }

  /**
   * Get completed tasks that haven't been reported
   */
  export async function getCompletedTasks(): Promise<Task[]> {
    const tasks = await getTasks()
    const completed: Task[] = []

    for (const task of Object.values(tasks)) {
      const doneFile = task.triggerFile.replace(".trigger", ".trigger.done")
      const outputFile = task.triggerFile.replace(".trigger", ".trigger.output")

      try {
        const [doneExists, outputExists] = await Promise.all([
          fs.stat(doneFile).then(() => true).catch(() => false),
          fs.stat(outputFile).then(() => true).catch(() => false),
        ])

        if ((doneExists || outputExists) && task.status !== "reported") {
          if (outputExists) {
            try {
              const output = await fs.readFile(outputFile, "utf-8")
              task.output = output.slice(0, 2000)
            } catch {
              task.output = "(output file exists but unreadable)"
            }
          }
          task.status = "completed"
          completed.push(task)
        }
      } catch {
        // File doesn't exist, task still running
      }
    }

    return completed
  }

  /**
   * Mark a task as reported
   */
  export async function markReported(taskId: string): Promise<void> {
    try {
      await Storage.update<Record<string, Task>>(STORAGE_KEY, (draft) => {
        if (draft && draft[taskId]) {
          draft[taskId].status = "reported"
          draft[taskId].completedAt = new Date().toISOString()
        }
      })
    } catch (err) {
      log.warn("Failed to mark task as reported", { taskId, error: String(err) })
    }
  }

  /**
   * List available models with aliases
   */
  export function listModels(): Array<{ alias: string; fullName: string }> {
    return Object.entries(MODEL_ALIASES).map(([alias, fullName]) => ({
      alias,
      fullName,
    }))
  }
}
