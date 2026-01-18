import z from "zod"
import path from "path"
import { Tool } from "./tool"
import { Instance } from "../project/instance"

const DESCRIPTION = `Read or write PM persistent state for project decisions, task history, and learnings.

Use this tool to:
- Record important project decisions with context
- Track completed task summaries from orchestrator sessions
- Store learnings that should persist across sessions
- Save user preferences learned over time

Actions:
- read: Get current state (optionally specify field)
- write: Replace a field's value
- append: Add item to an array field (decisions, taskHistory, learnings)

Fields: decisions, taskHistory, learnings, preferences

State is stored in .opencode/pm-state.json in the project directory.`

interface PMState {
  decisions: Array<{ date: string; decision: string; context: string }>
  taskHistory: Array<{ id: string; summary: string; status: string; date: string }>
  learnings: string[]
  preferences: Record<string, string>
}

const getStateFile = async () => {
  const project = await Instance.directory()
  return path.join(project, ".opencode", "pm-state.json")
}

const loadState = async (): Promise<PMState> => {
  const stateFile = await getStateFile()
  try {
    const file = Bun.file(stateFile)
    if (await file.exists()) {
      return await file.json()
    }
  } catch {
    // File doesn't exist or parse error
  }
  return { decisions: [], taskHistory: [], learnings: [], preferences: {} }
}

const saveState = async (state: PMState): Promise<void> => {
  const stateFile = await getStateFile()
  const dir = path.dirname(stateFile)
  await Bun.write(stateFile, JSON.stringify(state, null, 2))
}

export const PMStateTool = Tool.define("pm_state", {
  description: DESCRIPTION,
  parameters: z.object({
    action: z.enum(["read", "write", "append"]).describe("Action to perform"),
    field: z
      .enum(["decisions", "taskHistory", "learnings", "preferences"])
      .optional()
      .describe("Field to access (optional for read all)"),
    data: z.any().optional().describe("Data to write or append (required for write/append)"),
  }),
  async execute(params, _ctx) {
    const state = await loadState()

    if (params.action === "read") {
      if (params.field && params.field in state) {
        return {
          title: `PM State: ${params.field}`,
          output: JSON.stringify(state[params.field as keyof PMState], null, 2),
          metadata: {},
        }
      }
      return {
        title: "PM State: all",
        output: JSON.stringify(state, null, 2),
        metadata: {},
      }
    }

    if (!params.field || params.data === undefined) {
      return {
        title: "PM State Error",
        output: "Error: field and data required for write/append actions",
        metadata: { error: true },
      }
    }

    if (params.action === "write") {
      ;(state as any)[params.field] = params.data
    } else if (params.action === "append") {
      const field = state[params.field as keyof PMState]
      if (Array.isArray(field)) {
        field.push(params.data)
      } else {
        return {
          title: "PM State Error",
          output: `Error: Cannot append to non-array field "${params.field}"`,
          metadata: { error: true },
        }
      }
    }

    await saveState(state)
    return {
      title: "PM State Updated",
      output: `PM state updated: ${params.field}`,
      metadata: { field: params.field, action: params.action },
    }
  },
})
