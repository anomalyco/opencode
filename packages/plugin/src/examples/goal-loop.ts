import { tool } from "@opencode-ai/plugin"
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs"
import { join } from "path"

const HARNESS_DIR = ".opencode/harness"

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

function readJson<T>(file: string, fallback: T): T {
  try {
    const p = join(HARNESS_DIR, file)
    if (existsSync(p)) return JSON.parse(readFileSync(p, "utf-8"))
  } catch {}
  return fallback
}

function writeJson(file: string, data: unknown) {
  ensureDir(HARNESS_DIR)
  writeFileSync(join(HARNESS_DIR, file), JSON.stringify(data, null, 2), "utf-8")
}

export default {
  id: "goal-loop",
  server: async ({ directory }: { directory: string }) => {
    return {
      tool: {
        goal: tool({
          description:
            "Set, check, or clear an autonomous goal. goal({action:'set',condition:'...'}) to set. goal({action:'status'}) to check. goal({action:'clear'}) to clear.",
          args: {
            action: tool.schema.enum(["set", "status", "clear"]),
            condition: tool.schema.string().optional(),
            maxTurns: tool.schema.number().optional(),
            oneTaskPerTurn: tool.schema.boolean().optional(),
          },
          async execute(args: {
            action: "set" | "status" | "clear"
            condition?: string
            maxTurns?: number
            oneTaskPerTurn?: boolean
          }) {
            if (args.action === "clear") {
              writeJson("goal.json", { active: false })
              return "Goal cleared."
            }
            if (args.action === "status") {
              const g = readJson<{
                condition: string
                active: boolean
                turns: number
                maxTurns?: number
                oneTaskPerTurn?: boolean
                startedAt: string
              } | null>("goal.json", null)
              if (!g || !g.active) return "No active goal."
              const limit = g.maxTurns ? ` | Max: ${g.maxTurns}` : ""
              const taskMode = g.oneTaskPerTurn ? " | One task/turn" : ""
              return `Goal: "${g.condition}" | Turns: ${g.turns || 0}${limit}${taskMode} | Since: ${g.startedAt}`
            }
            if (!args.condition) return "Provide a condition."
            const goal = {
              condition: args.condition,
              active: true,
              turns: 0,
              maxTurns: args.maxTurns || null,
              oneTaskPerTurn: args.oneTaskPerTurn || false,
              startedAt: new Date().toISOString(),
            }
            writeJson("goal.json", goal)
            const extras: string[] = []
            if (goal.maxTurns) extras.push(`max ${goal.maxTurns} turns`)
            if (goal.oneTaskPerTurn) extras.push("one task per turn")
            const hint = extras.length ? ` (${extras.join(", ")})` : ""
            return `Goal set: "${goal.condition}"${hint}. Work toward it. Call goal({action:'clear'}) when done.`
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
          async execute(args: {
            action: "add" | "list" | "remove"
            prompt?: string
            interval?: string
            loopId?: string
          }) {
            if (args.action === "list") {
              const loops = readJson<Array<{ id: string; interval: string; prompt: string }>>("loops.json", [])
              if (!loops.length) return "No active loops."
              return loops.map((l) => `[${l.id}] ${l.interval}: "${l.prompt}"`).join("\n")
            }
            if (args.action === "remove") {
              let loops = readJson<Array<{ id: string }>>("loops.json", [])
              loops = loops.filter((l) => l.id !== args.loopId)
              writeJson("loops.json", loops)
              return `Removed loop ${args.loopId}.`
            }
            if (!args.prompt) return "Provide a prompt."
            const id = Math.random().toString(36).substring(2, 8)
            const interval = args.interval || "10m"
            const loops = readJson<Array<{ id: string; prompt: string; interval: string; createdAt: string }>>(
              "loops.json",
              [],
            )
            loops.push({ id, prompt: args.prompt, interval, createdAt: new Date().toISOString() })
            writeJson("loops.json", loops)
            return `Loop [${id}] scheduled every ${interval}: "${args.prompt}"`
          },
        }),
      },
    }
  },
}
