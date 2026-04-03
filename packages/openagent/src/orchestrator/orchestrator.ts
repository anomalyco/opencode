/**
 * Orchestrator Agent
 *
 * The meta-AI brain of OpenAgent. Uses an LLM to:
 * 1. Analyze incoming tasks
 * 2. Decompose them into subtasks with dependency graphs
 * 3. Route subtasks to OpenCode sessions via the session pool
 * 4. Execute subtasks (respecting dependencies, running parallel where possible)
 * 5. Synthesize final results from all subtask outputs
 *
 * This is analogous to what OpenClaw does for Claude Code / Codex —
 * but built natively on top of OpenCode as the coding engine.
 */

import { generateObject, generateText } from "ai"
import { createAnthropic } from "@ai-sdk/anthropic"
import { z } from "zod"
import { ulid } from "../../node_modules/ulid/dist/index.esm.js"

import type { Task, Subtask, TaskProgressUpdate } from "../task/task.ts"
import { Plan } from "../task/task.ts"
import type { SessionPool } from "../opencode/pool.ts"
import type { OpenCodeAdapter } from "../opencode/adapter.ts"

import SYSTEM_PROMPT from "./system.txt" with { type: "text" }

export interface OrchestratorOptions {
  /**
   * Model to use for the orchestrator's planning LLM.
   * Defaults to claude-sonnet-4-6 (fast, capable).
   */
  model?: string
  /** Anthropic API key. Falls back to ANTHROPIC_API_KEY env var. */
  apiKey?: string
  /** Provider type - currently supports "anthropic", expandable */
  provider?: "anthropic"
}

/**
 * The Orchestrator is the top-level controller that takes a user Task,
 * plans how to execute it using OpenCode agents, runs the subtasks, and
 * returns a synthesized result.
 */
export class Orchestrator {
  private model: ReturnType<ReturnType<typeof createAnthropic>>
  private modelId: string

  constructor(
    private pool: SessionPool,
    private adapter: OpenCodeAdapter,
    options: OrchestratorOptions = {},
  ) {
    const anthropic = createAnthropic({
      apiKey: options.apiKey ?? process.env.ANTHROPIC_API_KEY,
    })
    this.modelId = options.model ?? "claude-sonnet-4-6"
    this.model = anthropic(this.modelId)
  }

  /**
   * Execute a task end-to-end:
   *  1. Plan (decompose into subtasks)
   *  2. Execute (run subtasks respecting dependencies, parallel where possible)
   *  3. Synthesize (combine results into final answer)
   */
  async execute(task: Task): Promise<string> {
    try {
      await this.notify(task, { type: "planning", taskId: task.id })
      task.status = "planning"

      // Step 1: Plan
      const plan = await this.plan(task)

      // Build subtask objects
      task.subtasks = plan.subtasks.map(
        (s): Subtask => ({
          id: s.id,
          parentId: task.id,
          description: s.description,
          prompt: s.prompt,
          agentRole: s.agentRole,
          dependsOn: s.dependsOn,
          status: "pending",
        }),
      )

      task.status = "running"
      task.startedAt = new Date()

      // Step 2: Execute subtasks in dependency order
      await this.executeSubtasks(task)

      // Step 3: Synthesize
      const result = await this.synthesize(task, plan.summary)

      task.status = "completed"
      task.completedAt = new Date()
      task.result = result

      await this.notify(task, { type: "completed", taskId: task.id, result })
      return result
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      task.status = "failed"
      task.error = error
      task.completedAt = new Date()
      await this.notify(task, { type: "failed", taskId: task.id, error })
      throw err
    }
  }

  /**
   * Use the orchestrator LLM to analyze the task and produce a Plan.
   */
  private async plan(task: Task): Promise<Plan> {
    const { object } = await generateObject({
      model: this.model,
      system: SYSTEM_PROMPT,
      prompt: `Task: ${task.title}\n\nDescription:\n${task.description}`,
      schema: Plan,
      maxRetries: 2,
    })
    return object
  }

  /**
   * Execute all subtasks, respecting dependency order.
   * Subtasks without unmet dependencies run in parallel.
   */
  private async executeSubtasks(task: Task) {
    const completed = new Set<string>()
    const running = new Set<string>()

    const runSubtask = async (subtask: Subtask) => {
      running.add(subtask.id)
      subtask.status = "running"
      subtask.startedAt = new Date()

      await this.notify(task, {
        type: "subtask_started",
        taskId: task.id,
        subtask,
      })

      try {
        const result = await this.pool.use(
          subtask.agentRole,
          async (sessionId) => {
            subtask.sessionId = sessionId

            // Build full prompt with context from completed subtasks
            const contextualPrompt = this.buildContextualPrompt(subtask, task)
            return await this.adapter.prompt(sessionId, contextualPrompt).then((r) => {
              // Forward tool calls as progress updates
              for (const tc of r.toolCalls) {
                this.notify(task, {
                  type: "subtask_tool",
                  taskId: task.id,
                  subtaskId: subtask.id,
                  tool: tc.tool,
                  title: tc.title,
                })
              }
              return r.text
            })
          },
          subtask.description,
        )

        subtask.result = result
        subtask.status = "completed"
        subtask.completedAt = new Date()
        completed.add(subtask.id)

        await this.notify(task, {
          type: "subtask_completed",
          taskId: task.id,
          subtask,
        })
      } catch (err) {
        subtask.status = "failed"
        subtask.error = err instanceof Error ? err.message : String(err)
        subtask.completedAt = new Date()
        completed.add(subtask.id) // Mark as completed (failed) so dependents can proceed / fail too
        throw err
      } finally {
        running.delete(subtask.id)
      }
    }

    // Topological execution loop
    while (completed.size < task.subtasks.length) {
      const ready = task.subtasks.filter(
        (s) =>
          s.status === "pending" &&
          !running.has(s.id) &&
          s.dependsOn.every((dep) => completed.has(dep)),
      )

      if (ready.length === 0 && running.size === 0) {
        // Deadlock — some subtasks cannot run (circular deps or all failed)
        break
      }

      // Start all ready subtasks in parallel
      const promises = ready.map((s) => runSubtask(s))
      if (promises.length > 0) {
        // Wait for at least one to finish before checking for more ready tasks
        await Promise.race(promises).catch(() => {})
      } else {
        // Wait for any running task to finish
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    }
  }

  /**
   * Build a prompt for a subtask that includes relevant context
   * from already-completed dependency subtasks.
   */
  private buildContextualPrompt(subtask: Subtask, task: Task): string {
    const deps = task.subtasks.filter((s) => subtask.dependsOn.includes(s.id) && s.result)

    if (deps.length === 0) return subtask.prompt

    const context = deps
      .map((d) => `## Result from: ${d.description}\n\n${d.result}`)
      .join("\n\n---\n\n")

    return `${subtask.prompt}\n\n---\n\n## Context from previous steps\n\n${context}`
  }

  /**
   * After all subtasks complete, use the LLM to synthesize a coherent answer.
   */
  private async synthesize(task: Task, planSummary: string): Promise<string> {
    const completedSubtasks = task.subtasks.filter((s) => s.result)

    if (completedSubtasks.length === 0) {
      return "No results were produced."
    }

    // If there's only one subtask, return its result directly
    if (completedSubtasks.length === 1) {
      return completedSubtasks[0].result!
    }

    const subtaskResults = completedSubtasks
      .map((s) => `### ${s.description}\n\n${s.result}`)
      .join("\n\n---\n\n")

    const { text } = await generateText({
      model: this.model,
      system: `You are OpenAgent. Synthesize the results from multiple completed subtasks into a clear, concise final response for the user.`,
      prompt: `Original task: ${task.title}\nPlan summary: ${planSummary}\n\nSubtask results:\n\n${subtaskResults}\n\nProvide a clear synthesis of what was accomplished.`,
    })

    return text
  }

  private async notify(task: Task, update: TaskProgressUpdate) {
    if (task.onProgress) {
      await task.onProgress(update).catch(() => {})
    }
  }
}
