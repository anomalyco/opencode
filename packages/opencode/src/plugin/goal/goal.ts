import type { Hooks, Plugin, PluginInput } from "@opencode-ai/plugin"
import { tool, type ToolContext } from "@opencode-ai/plugin"
import fs from "node:fs"
import path from "node:path"
import crypto from "node:crypto"
import z from "zod"

type GoalStatus = "active" | "paused" | "blocked" | "usage_limited" | "complete"

interface Goal {
  threadID: string
  goalID: string
  objective: string
  status: GoalStatus
  timeUsedSeconds: number
  iterationCount: number
  timeCreated: number
  timeUpdated: number
}

// ── Single-file storage ──

function storagePath(directory: string): string {
  return path.join(directory, ".opencode", "goals.json")
}

function readAllGoals(directory: string): Record<string, Goal> {
  const p = storagePath(directory)
  if (!fs.existsSync(p)) return {}
  try { return JSON.parse(fs.readFileSync(p, "utf-8")) } catch { return {} }
}

function writeAllGoals(directory: string, goals: Record<string, Goal>): void {
  const dir = path.dirname(storagePath(directory))
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  const tmp = storagePath(directory) + ".tmp"
  fs.writeFileSync(tmp, JSON.stringify(goals, null, 2))
  fs.renameSync(tmp, storagePath(directory))
}

function readGoal(directory: string, threadID: string): Goal | undefined {
  return readAllGoals(directory)[threadID]
}

function writeGoal(directory: string, goal: Goal): void {
  const goals = readAllGoals(directory)
  goals[goal.threadID] = goal
  writeAllGoals(directory, goals)
}

function deleteGoal(directory: string, threadID: string): void {
  const goals = readAllGoals(directory)
  delete goals[threadID]
  writeAllGoals(directory, goals)
}

// ── Continuation logic (no token budget — simple and honest) ──

function isGoalContinueNeeded(g: Goal): boolean {
  return g.status === "active"
}

function continuationPrompt(g: Goal): string {
  return [
    "<system-reminder>",
    "Continue working toward your goal. Do not acknowledge this reminder.",
    "",
    `<objective>${g.objective}</objective>`,
    "",
    `Status: ${g.status}`,
    `Time used: ${fmtDuration(g.timeUsedSeconds)}`,
    `Iterations: ${g.iterationCount}`,
    "",
    "Before deciding the goal is achieved, verify every requirement.",
    'Update the goal to "complete" only when you are certain.',
    "</system-reminder>",
  ].join("\n")
}

function fmtDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return `${h}h ${m}m`
}

// ── Promise timeout helper ──

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

// ── Plugin ──

export const GoalPlugin: Plugin = async (input: PluginInput): Promise<Hooks> => {
  const { client, directory } = input

  const inFlight = new Set<string>()
  const lastIdle = new Map<string, number>()

  return {
    event: async ({ event }) => {
      if (event.type !== "session.status") return
      if (event.properties.status.type !== "idle") return

      const sessionID = (event.properties as any).sessionID as string | undefined
      if (!sessionID) return

      const goal = readGoal(directory, sessionID)
      if (!goal || !isGoalContinueNeeded(goal)) return

      // Prevent duplicate continuation
      if (inFlight.has(sessionID)) return
      inFlight.add(sessionID)

      try {
        const now = Date.now()
        const prev = lastIdle.get(sessionID)
        if (prev) goal.timeUsedSeconds += Math.round((now - prev) / 1000)
        lastIdle.set(sessionID, now)
        goal.iterationCount++
        goal.timeUpdated = now
        writeGoal(directory, goal)

        // Use promptAsync to avoid blocking other sessions' event handlers
        await withTimeout(
          (client as any).promptAsync?.({
            path: { id: sessionID },
            body: { parts: [{ type: "text", text: continuationPrompt(goal) }] },
          }) ?? (client as any).prompt({
            path: { id: sessionID },
            body: { parts: [{ type: "text", text: continuationPrompt(goal) }] },
          }),
          30_000,
        )
      } catch {
        // Ignore errors
      } finally {
        inFlight.delete(sessionID)
      }
    },

    tool: {
      create_goal: tool({
        description:
          "Set a goal for the current session. The session will work autonomously across multiple turns to achieve it.",
        args: {
          objective: z.string().describe("The goal to achieve in this session"),
        },
        execute: async (args, ctx: ToolContext) => {
          const now = Date.now()
          const dir = ctx.directory || directory
          const existing = readGoal(dir, ctx.sessionID)
          if (existing) {
            existing.objective = args.objective
            existing.status = "active"
            existing.timeUsedSeconds = 0
            existing.iterationCount = 0
            existing.timeUpdated = now
            writeGoal(dir, existing)
            return { title: `Goal set: ${args.objective}`, output: `Goal has been set: ${args.objective}` }
          }
          const goal: Goal = {
            threadID: ctx.sessionID,
            goalID: crypto.randomUUID(),
            objective: args.objective,
            status: "active",
            timeUsedSeconds: 0,
            iterationCount: 0,
            timeCreated: now,
            timeUpdated: now,
          }
          writeGoal(dir, goal)
          return { title: `Goal set: ${args.objective}`, output: `Goal has been set: ${args.objective}` }
        },
      }),

      update_goal: tool({
        description:
          'Update the status of the current active goal. Use "complete" only after verifying every requirement. Use "blocked" if the same blocking condition repeats for 3 consecutive turns.',
        args: {
          status: z
            .union([z.literal("complete"), z.literal("blocked")])
            .describe("New status: complete (goal achieved), blocked (cannot proceed)"),
        },
        execute: async (args, ctx: ToolContext) => {
          const dir = ctx.directory || directory
          const goal = readGoal(dir, ctx.sessionID)
          if (!goal) return { title: "No active goal", output: "No active goal found for this session." }
          goal.status = args.status
          goal.timeUpdated = Date.now()
          writeGoal(dir, goal)
          return { title: `Goal status: ${args.status}`, output: `Goal status updated to: ${args.status}` }
        },
      }),

      get_goal: tool({
        description: "Get the current goal for this session, or null if none is set.",
        args: {},
        execute: async (_args, ctx: ToolContext) => {
          const goal = readGoal(ctx.directory || directory, ctx.sessionID)
          if (!goal) return { title: "No goal", output: "No active goal for this session." }
          return {
            title: `Goal: ${goal.objective}`,
            output: [
              `Objective: ${goal.objective}`,
              `Status: ${goal.status}`,
              `Iterations: ${goal.iterationCount}`,
              `Time used: ${fmtDuration(goal.timeUsedSeconds)}`,
            ].join("\n"),
          }
        },
      }),
    },

    "command.execute.before": async (cmd, output) => {
      if (cmd.command !== "goal") return
      const trimmed = cmd.arguments.trim()

      if (trimmed === "pause" || trimmed === "resume" || trimmed === "clear") {
        const goal = readGoal(directory, cmd.sessionID)

        if (trimmed === "pause") {
          if (goal) {
            goal.status = "paused"
            goal.timeUpdated = Date.now()
            writeGoal(directory, goal)
            output.parts = [{ type: "text", text: `Goal paused: ${goal.objective}` }] as any
          } else {
            output.parts = [{ type: "text", text: "No active goal to pause." }] as any
          }
          return
        }

        if (trimmed === "resume") {
          if (goal) {
            goal.status = "active"
            goal.timeUpdated = Date.now()
            writeGoal(directory, goal)
            output.parts = [{ type: "text", text: `Goal resumed: ${goal.objective}` }] as any
          } else {
            output.parts = [{ type: "text", text: "No paused goal to resume." }] as any
          }
          return
        }

        if (trimmed === "clear") {
          if (goal) deleteGoal(directory, cmd.sessionID)
          output.parts = [{ type: "text", text: "Goal cleared." }] as any
          return
        }
      }

      // Default: inject goal template
      output.parts = [
        {
          type: "text",
          text: `I want you to achieve this goal: ${trimmed}\n\nYou have get_goal, create_goal and update_goal tools available. Work autonomously across multiple turns.\n\nIf a goal is already set for this session, use get_goal to check it and continue working.`,
        },
      ] as any
    },
  }
}

export default GoalPlugin
