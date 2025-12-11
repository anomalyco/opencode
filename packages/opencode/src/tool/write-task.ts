import z from "zod"
import path from "path"
import fs from "fs/promises"
import { Tool } from "./tool"
import { Log } from "../util/log"

const log = Log.create({ service: "write-task" })

// Task data structure
interface TaskData {
  feature: string
  featureName: string
  status?: "in_progress" | "completed" | "blocked"
  todo?: Array<{ task: string; done: boolean }>
  failures?: string[]
  changes?: string[]
  summary?: string
  nextSteps?: string[]
}

/**
 * Get the tasks directory for a feature
 */
async function getTasksDir(feature: string): Promise<string | null> {
  try {
    const { Instance } = await import("../project/instance")
    const worktree = Instance.worktree
    if (worktree) {
      return path.join(worktree, ".starfleet", "tasks", feature)
    }
  } catch {
    // Instance context not available
  }
  return null
}

/**
 * Format feature identifier to human-readable name
 * e.g., "1-user-auth" -> "User Auth"
 */
function formatFeatureName(feature: string): string {
  // Remove leading number and dash (e.g., "1-" from "1-user-auth")
  const withoutNumber = feature.replace(/^\d+-/, "")
  // Convert kebab-case to Title Case
  return withoutNumber
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
}

/**
 * Parse existing README.md content into structured data
 */
function parseExistingReadme(content: string): Partial<TaskData> {
  const data: Partial<TaskData> = {}

  // Parse status
  const statusMatch = content.match(/## Status\s*\n+(\w+)/i)
  if (statusMatch) {
    const status = statusMatch[1].toLowerCase()
    if (status === "in_progress" || status === "completed" || status === "blocked") {
      data.status = status
    }
  }

  // Parse todo items
  const todoSection = content.match(/## ToDo\s*\n([\s\S]*?)(?=\n## |$)/i)
  if (todoSection) {
    const todoItems: Array<{ task: string; done: boolean }> = []
    const lines = todoSection[1].split("\n")
    for (const line of lines) {
      const checkboxMatch = line.match(/^- \[([ x])\] (.+)$/i)
      if (checkboxMatch) {
        todoItems.push({
          task: checkboxMatch[2].trim(),
          done: checkboxMatch[1].toLowerCase() === "x",
        })
      }
    }
    if (todoItems.length > 0) {
      data.todo = todoItems
    }
  }

  // Parse failures
  const failuresSection = content.match(/## Failures\s*\n([\s\S]*?)(?=\n## |$)/i)
  if (failuresSection) {
    const failures: string[] = []
    const lines = failuresSection[1].split("\n")
    for (const line of lines) {
      const bulletMatch = line.match(/^- (.+)$/)
      if (bulletMatch) {
        failures.push(bulletMatch[1].trim())
      }
    }
    if (failures.length > 0) {
      data.failures = failures
    }
  }

  // Parse changes
  const changesSection = content.match(/## Changes Made\s*\n([\s\S]*?)(?=\n## |$)/i)
  if (changesSection) {
    const changes: string[] = []
    const lines = changesSection[1].split("\n")
    for (const line of lines) {
      const bulletMatch = line.match(/^- `(.+)`$/)
      if (bulletMatch) {
        changes.push(bulletMatch[1].trim())
      }
    }
    if (changes.length > 0) {
      data.changes = changes
    }
  }

  // Parse summary
  const summarySection = content.match(/## Summary\s*\n([\s\S]*?)(?=\n## |$)/i)
  if (summarySection) {
    const summary = summarySection[1].trim()
    if (summary) {
      data.summary = summary
    }
  }

  // Parse next steps
  const nextStepsSection = content.match(/## Next Steps\s*\n([\s\S]*?)(?=\n## |$)/i)
  if (nextStepsSection) {
    const nextSteps: string[] = []
    const lines = nextStepsSection[1].split("\n")
    for (const line of lines) {
      const bulletMatch = line.match(/^- (.+)$/)
      if (bulletMatch) {
        nextSteps.push(bulletMatch[1].trim())
      }
    }
    if (nextSteps.length > 0) {
      data.nextSteps = nextSteps
    }
  }

  return data
}

/**
 * Merge existing task data with new data
 */
function mergeTaskData(existing: Partial<TaskData>, incoming: Partial<TaskData>): Partial<TaskData> {
  const merged: Partial<TaskData> = { ...existing }

  // Status: new overwrites old
  if (incoming.status !== undefined) {
    merged.status = incoming.status
  }

  // Todo: merge arrays, update done status for matching tasks, add new tasks
  if (incoming.todo !== undefined) {
    const existingTodos = existing.todo || []
    const mergedTodos = [...existingTodos]

    for (const newTodo of incoming.todo) {
      const existingIndex = mergedTodos.findIndex(
        (t) => t.task.toLowerCase() === newTodo.task.toLowerCase()
      )
      if (existingIndex >= 0) {
        // Update done status for matching task
        mergedTodos[existingIndex] = { ...mergedTodos[existingIndex], done: newTodo.done }
      } else {
        // Add new task
        mergedTodos.push(newTodo)
      }
    }
    merged.todo = mergedTodos
  }

  // Failures: append new, avoid duplicates
  if (incoming.failures !== undefined) {
    const existingFailures = existing.failures || []
    const newFailures = incoming.failures.filter(
      (f) => !existingFailures.some((e) => e.toLowerCase() === f.toLowerCase())
    )
    merged.failures = [...existingFailures, ...newFailures]
  }

  // Changes: append new, avoid duplicates
  if (incoming.changes !== undefined) {
    const existingChanges = existing.changes || []
    const newChanges = incoming.changes.filter(
      (c) => !existingChanges.some((e) => e.toLowerCase() === c.toLowerCase())
    )
    merged.changes = [...existingChanges, ...newChanges]
  }

  // Summary: append with timestamp separator
  if (incoming.summary !== undefined) {
    if (existing.summary) {
      const timestamp = new Date().toISOString()
      merged.summary = `${existing.summary}\n\n---\n*Updated: ${timestamp}*\n\n${incoming.summary}`
    } else {
      merged.summary = incoming.summary
    }
  }

  // Next steps: replace with new list
  if (incoming.nextSteps !== undefined) {
    merged.nextSteps = incoming.nextSteps
  }

  return merged
}

/**
 * Generate README markdown content from task data
 */
function generateReadmeContent(data: TaskData): string {
  const lines: string[] = []

  // Header
  lines.push(`# ${data.featureName}`)
  lines.push("")

  // Status
  lines.push("## Status")
  lines.push(data.status || "in_progress")
  lines.push("")

  // ToDo
  lines.push("## ToDo")
  if (data.todo && data.todo.length > 0) {
    for (const item of data.todo) {
      const checkbox = item.done ? "[x]" : "[ ]"
      lines.push(`- ${checkbox} ${item.task}`)
    }
  } else {
    lines.push("*No tasks defined yet.*")
  }
  lines.push("")

  // Failures
  lines.push("## Failures")
  if (data.failures && data.failures.length > 0) {
    for (const failure of data.failures) {
      lines.push(`- ${failure}`)
    }
  } else {
    lines.push("*No failures recorded.*")
  }
  lines.push("")

  // Changes Made
  lines.push("## Changes Made")
  if (data.changes && data.changes.length > 0) {
    for (const change of data.changes) {
      lines.push(`- \`${change}\``)
    }
  } else {
    lines.push("*No changes recorded yet.*")
  }
  lines.push("")

  // Summary
  lines.push("## Summary")
  if (data.summary) {
    lines.push(data.summary)
  } else {
    lines.push("*No summary provided yet.*")
  }
  lines.push("")

  // Next Steps
  lines.push("## Next Steps")
  if (data.nextSteps && data.nextSteps.length > 0) {
    for (const step of data.nextSteps) {
      lines.push(`- ${step}`)
    }
  } else {
    lines.push("*No next steps defined.*")
  }
  lines.push("")

  return lines.join("\n")
}

export const WriteTaskTool = Tool.define("writetask", {
  description: `Write or update a task README file for tracking feature implementation progress.

Use this tool to:
- Create a new task file for a feature
- Update the status, todo list, failures, changes, summary, or next steps
- Track implementation progress over time

The task files are stored at: {worktree}/.starfleet/tasks/{feature}/README.md

When updating an existing task:
- status: New value overwrites old
- todo: Merges with existing, updates completion status for matching tasks
- failures: Appends new failures (avoids duplicates)
- changes: Appends new changes (avoids duplicates)
- summary: Appends with timestamp separator
- nextSteps: Replaces with new list`,
  parameters: z.object({
    feature: z
      .string()
      .describe("Feature identifier in format 'N-name' (e.g., '1-user-auth', '2-dashboard')"),
    status: z
      .enum(["in_progress", "completed", "blocked"])
      .optional()
      .describe("Current status of the feature"),
    todo: z
      .array(
        z.object({
          task: z.string(),
          done: z.boolean(),
        })
      )
      .optional()
      .describe("List of todo items with completion status"),
    failures: z.array(z.string()).optional().describe("List of failures or errors encountered"),
    changes: z.array(z.string()).optional().describe("List of files changed or created"),
    summary: z.string().optional().describe("Brief summary of what was accomplished"),
    nextSteps: z.array(z.string()).optional().describe("List of next steps to be done"),
  }),
  async execute(params, _opts) {
    const { feature, status, todo, failures, changes, summary, nextSteps } = params

    // Get tasks directory
    const tasksDir = await getTasksDir(feature)
    if (!tasksDir) {
      throw new Error("Could not determine tasks directory. Instance context may not be available.")
    }

    // Ensure directory exists
    await fs.mkdir(tasksDir, { recursive: true })

    const readmePath = path.join(tasksDir, "README.md")
    const featureName = formatFeatureName(feature)

    // Check if README exists
    let existingData: Partial<TaskData> = {}
    try {
      const existingContent = await fs.readFile(readmePath, "utf-8")
      existingData = parseExistingReadme(existingContent)
      log.debug("Parsed existing README", { feature, existingData })
    } catch (error) {
      // File doesn't exist, start fresh
      log.debug("No existing README found", { feature })
    }

    // Build incoming data
    const incomingData: Partial<TaskData> = {
      status,
      todo,
      failures,
      changes,
      summary,
      nextSteps,
    }

    // Merge data
    const mergedData = mergeTaskData(existingData, incomingData)

    // Create full task data
    const taskData: TaskData = {
      feature,
      featureName,
      status: mergedData.status || "in_progress",
      todo: mergedData.todo,
      failures: mergedData.failures,
      changes: mergedData.changes,
      summary: mergedData.summary,
      nextSteps: mergedData.nextSteps,
    }

    // Generate and write content
    const content = generateReadmeContent(taskData)
    await fs.writeFile(readmePath, content)

    log.info("Task README written", { feature, path: readmePath })

    return {
      title: `Updated task: ${featureName}`,
      output: `Successfully wrote task README to: ${readmePath}\n\nStatus: ${taskData.status}\nTodo items: ${taskData.todo?.length || 0}\nFailures: ${taskData.failures?.length || 0}\nChanges: ${taskData.changes?.length || 0}`,
      metadata: {
        path: readmePath,
        feature,
        featureName,
        status: taskData.status,
        todoCount: taskData.todo?.length || 0,
        failuresCount: taskData.failures?.length || 0,
        changesCount: taskData.changes?.length || 0,
      },
    }
  },
})
