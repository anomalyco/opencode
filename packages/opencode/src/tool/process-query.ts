import z from "zod"
import { Tool } from "./tool"
import { TaskManager, type TaskInfo } from "../task"
import { Log } from "../util/log"

const log = Log.create({ service: "process-query-tool" })

export const ProcessQueryTool = Tool.define("process_query", {
    description: `Query and interact with background processes.

Use this tool to:
- Read output from background tasks
- Check the status of running processes
- Search for patterns in process logs
- Get information about specific tasks

Available actions:
- "status": Get the current status of a task
- "read_output": Read the full output of a task
- "read_last_n": Read the last N lines of output
- "search": Search for a pattern in the task output
- "list": List all background tasks

The identifier can be:
- A task ID (e.g., "task_abc123")
- "last" to refer to the most recently created task
- A partial match of the task description`,
    parameters: z.object({
      action: z
        .enum(["status", "read_output", "read_last_n", "search", "list"])
        .describe("The action to perform on the background process"),
      identifier: z
        .string()
        .describe(
          'Task identifier: task ID, "last" for most recent, or partial description match. Not required for "list" action.',
        )
        .optional(),
      lines: z
        .number()
        .describe("Number of lines to read (for read_last_n action). Defaults to 50.")
        .optional(),
      pattern: z.string().describe("Search pattern (for search action)").optional(),
    }),
    async execute(params, _ctx) {
      log.info("process query", { action: params.action, identifier: params.identifier })

      // Handle list action separately
      if (params.action === "list") {
        const tasks = await TaskManager.list()
        if (tasks.length === 0) {
          return {
            title: "List background tasks",
            metadata: { taskCount: 0 } as Record<string, any>,
            output: "No background tasks found.",
          }
        }

        const taskList = tasks
          .map((t) => {
            const duration = t.status === "running" ? `running for ${formatDuration(Date.now() - t.startTime)}` : t.status
            return `- ${t.id}: ${t.description || t.command.substring(0, 50)} [${duration}]${t.exitCode !== undefined ? ` (exit: ${t.exitCode})` : ""}`
          })
          .join("\n")

        return {
          title: "List background tasks",
          metadata: { taskCount: tasks.length } as Record<string, any>,
          output: `Found ${tasks.length} background task(s):\n\n${taskList}`,
        }
      }

      // For other actions, we need an identifier
      if (!params.identifier) {
        return {
          title: "Process query error",
          metadata: { error: "missing_identifier" } as Record<string, any>,
          output: 'Error: identifier is required for this action. Use "last" for the most recent task, or provide a task ID.',
        }
      }

      // Resolve the task
      const task = await resolveTask(params.identifier)
      if (!task) {
        return {
          title: "Process query error",
          metadata: { error: "task_not_found" },
          output: `Error: Could not find task matching "${params.identifier}". Use process_query with action "list" to see available tasks.`,
        }
      }

      switch (params.action) {
        case "status": {
          const duration = formatDuration(Date.now() - task.startTime)
          const statusInfo = [
            `Task ID: ${task.id}`,
            `Command: ${task.command}`,
            `Status: ${task.status}`,
            `PID: ${task.pid}`,
            `Started: ${new Date(task.startTime).toISOString()}`,
            `Duration: ${duration}`,
            task.description ? `Description: ${task.description}` : null,
            task.exitCode !== undefined ? `Exit Code: ${task.exitCode}` : null,
            `Log File: ${task.logFile}`,
          ]
            .filter(Boolean)
            .join("\n")

          return {
            title: `Status: ${task.description || task.id}`,
            metadata: {
              taskId: task.id,
              status: task.status,
              exitCode: task.exitCode,
            },
            output: statusInfo,
          }
        }

        case "read_output": {
          const output = await TaskManager.read(task.id)
          if (!output) {
            return {
              title: `Output: ${task.description || task.id}`,
              metadata: { taskId: task.id, outputLength: 0 },
              output: "(No output yet)",
            }
          }

          return {
            title: `Output: ${task.description || task.id}`,
            metadata: { taskId: task.id, outputLength: output.length },
            output: output,
          }
        }

        case "read_last_n": {
          const lines = params.lines ?? 50
          const output = await TaskManager.tail(task.id, lines)
          if (!output) {
            return {
              title: `Last ${lines} lines: ${task.description || task.id}`,
              metadata: { taskId: task.id, lines: 0 },
              output: "(No output yet)",
            }
          }

          return {
            title: `Last ${lines} lines: ${task.description || task.id}`,
            metadata: { taskId: task.id, lines },
            output: output,
          }
        }

        case "search": {
          if (!params.pattern) {
            return {
              title: "Process query error",
              metadata: { error: "missing_pattern" },
              output: 'Error: pattern is required for search action. Example: process_query(action="search", identifier="last", pattern="error")',
            }
          }

          const output = await TaskManager.read(task.id)
          if (!output) {
            return {
              title: `Search in: ${task.description || task.id}`,
              metadata: { taskId: task.id, matches: 0 },
              output: "(No output to search)",
            }
          }

          const lines = output.split("\n")
          const matches = lines
            .map((line, idx) => ({ line, idx: idx + 1 }))
            .filter(({ line }) => line.toLowerCase().includes(params.pattern!.toLowerCase()))

          if (matches.length === 0) {
            return {
              title: `Search in: ${task.description || task.id}`,
              metadata: { taskId: task.id, pattern: params.pattern, matches: 0 },
              output: `No matches found for "${params.pattern}"`,
            }
          }

          const matchOutput = matches.map(({ line, idx }) => `${idx}: ${line}`).join("\n")

          return {
            title: `Search in: ${task.description || task.id}`,
            metadata: { taskId: task.id, pattern: params.pattern, matches: matches.length },
            output: `Found ${matches.length} match(es) for "${params.pattern}":\n\n${matchOutput}`,
          }
        }

        default:
          return {
            title: "Process query error",
            metadata: { error: "unknown_action" },
            output: `Unknown action: ${params.action}`,
          }
      }
    },
})

/**
 * Resolve a task identifier to a TaskInfo object
 */
async function resolveTask(identifier: string): Promise<TaskInfo | undefined> {
  const tasks = await TaskManager.list()

  // Direct ID match
  const directMatch = tasks.find((t) => t.id === identifier)
  if (directMatch) return directMatch

  // "last" keyword - most recent task
  if (identifier.toLowerCase() === "last") {
    if (tasks.length === 0) return undefined
    return tasks.reduce((latest, t) => (t.startTime > latest.startTime ? t : latest), tasks[0])
  }

  // Partial ID match
  const partialIdMatch = tasks.find((t) => t.id.includes(identifier))
  if (partialIdMatch) return partialIdMatch

  // Description match (case-insensitive)
  const descMatch = tasks.find((t) => t.description?.toLowerCase().includes(identifier.toLowerCase()))
  if (descMatch) return descMatch

  // Command match (case-insensitive)
  const cmdMatch = tasks.find((t) => t.command.toLowerCase().includes(identifier.toLowerCase()))
  if (cmdMatch) return cmdMatch

  return undefined
}

/**
 * Format a duration in milliseconds to a human-readable string
 */
function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}
