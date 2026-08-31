import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs"
import { join } from "path"

type GoalState = {
  condition: string
  active: boolean
  turns: number
  startedAt: string
}

type LoopState = {
  id: string
  prompt: string
  interval: string
  createdAt: string
}

const HARNESS_DIR = ".opencode/harness"

function readJson<T>(file: string, fallback: T): T {
  const p = join(HARNESS_DIR, file)
  if (!existsSync(p)) return fallback
  return JSON.parse(readFileSync(p, "utf-8")) as T
}

function writeJson(file: string, data: unknown) {
  const dir = join(HARNESS_DIR)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(join(HARNESS_DIR, file), JSON.stringify(data, null, 2), "utf-8")
}

export const GoalLoopPlugin: Plugin = async ({ directory }) => ({
  tool: {
    goal: tool({
      description:
        "Set, check, or clear an autonomous goal. goal({action:'set',condition:'...'}) to set. goal({action:'status'}) to check. goal({action:'clear'}) to clear.",
      args: {
        action: tool.schema.enum(["set", "status", "clear"]),
        condition: tool.schema.string().optional(),
      },
      execute(args) {
        if (args.action === "clear") {
          writeJson("goal.json", { active: false })
          return "Goal cleared."
        }
        if (args.action === "status") {
          const g = readJson<GoalState | null>("goal.json", null)
          if (!g?.active) return "No active goal."
          return `Goal: "${g.condition}" | Turns: ${g.turns} | Since: ${g.startedAt}`
        }
        if (!args.condition) return "Provide a condition."
        const goal: GoalState = {
          condition: args.condition,
          active: true,
          turns: 0,
          startedAt: new Date().toISOString(),
        }
        writeJson("goal.json", goal)
        return `Goal set: "${goal.condition}". Work toward it. Call goal({action:'clear'}) when done.`
      },
    }),

    loop: tool({
      description:
        "Schedule a recurring prompt. loop({action:'add',prompt:'...',interval:'5m'}) to add. loop({action:'list'}) to list. loop({action:'remove',loopId:'...'}) to remove.",
      args: {
        action: tool.schema.enum(["add", "list", "remove"]),
        prompt: tool.schema.string().optional(),
        interval: tool.schema.string().optional(),
        loopId: tool.schema.string().optional(),
      },
      execute(args) {
        if (args.action === "list") {
          const loops = readJson<LoopState[]>("loops.json", [])
          if (!loops.length) return "No active loops."
          return loops.map((l) => `[${l.id}] ${l.interval}: "${l.prompt}"`).join("\n")
        }
        if (args.action === "remove") {
          const loops = readJson<LoopState[]>("loops.json", []).filter((l) => l.id !== args.loopId)
          writeJson("loops.json", loops)
          return `Removed loop ${args.loopId}.`
        }
        if (!args.prompt) return "Provide a prompt."
        const id = Math.random().toString(36).substring(2, 8)
        const interval = args.interval || "10m"
        const loops = readJson<LoopState[]>("loops.json", [])
        loops.push({ id, prompt: args.prompt, interval, createdAt: new Date().toISOString() })
        writeJson("loops.json", loops)
        return `Loop [${id}] scheduled every ${interval}: "${args.prompt}"`
      },
    }),
  },
})
