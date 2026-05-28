import { afterAll, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import crypto from "node:crypto"

// ── Replicated types and logic from the plugin (same as goal.ts) ──

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

function storagePath(base: string): string {
  return path.join(base, "goals.json")
}

function readAllGoals(base: string): Record<string, Goal> {
  const p = storagePath(base)
  try { return JSON.parse(fs.readFileSync(p, "utf-8")) } catch { return {} }
}

function writeAllGoals(base: string, goals: Record<string, Goal>): void {
  const tmp = storagePath(base) + ".tmp"
  fs.writeFileSync(tmp, JSON.stringify(goals, null, 2))
  fs.renameSync(tmp, storagePath(base))
}

function readGoal(base: string, id: string): Goal | undefined {
  return readAllGoals(base)[id]
}

function writeGoal(base: string, goal: Goal): void {
  const goals = readAllGoals(base)
  goals[goal.threadID] = goal
  writeAllGoals(base, goals)
}

function deleteGoal(base: string, id: string): void {
  const goals = readAllGoals(base)
  delete goals[id]
  writeAllGoals(base, goals)
}

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

// ── Test setup ──

let tmpDir: string

function setup() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "goal-test-"))
}

function teardown() {
  if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true })
}

function resetStorage() {
  writeAllGoals(tmpDir, {})
}

function makeGoal(overrides: Partial<Goal> = {}): Goal {
  return {
    threadID: "s1",
    goalID: crypto.randomUUID(),
    objective: "fix the bug",
    status: "active",
    timeUsedSeconds: 0,
    iterationCount: 0,
    timeCreated: Date.now(),
    timeUpdated: Date.now(),
    ...overrides,
  }
}

setup()
resetStorage()

// ── Storage tests ──

test("writeGoal creates goals.json with single entry", () => {
  resetStorage()
  writeGoal(tmpDir, makeGoal())
  const all = readAllGoals(tmpDir)
  expect(all).toHaveProperty("s1")
  expect(all["s1"].objective).toBe("fix the bug")
})

test("writeGoal persists goalID and all fields", () => {
  resetStorage()
  writeGoal(tmpDir, makeGoal({ goalID: "u-123", iterationCount: 3, timeUsedSeconds: 60 }))
  const r = readGoal(tmpDir, "s1")!
  expect(r.goalID).toBe("u-123")
  expect(r.status).toBe("active")
  expect(r.iterationCount).toBe(3)
  expect(r.timeUsedSeconds).toBe(60)
})

test("writeGoal updates existing goal", () => {
  resetStorage()
  writeGoal(tmpDir, makeGoal({ objective: "first" }))
  writeGoal(tmpDir, makeGoal({ objective: "second", iterationCount: 5 }))
  const r = readGoal(tmpDir, "s1")!
  expect(r.objective).toBe("second")
  expect(r.iterationCount).toBe(5)
})

test("writeGoal handles multiple sessions", () => {
  resetStorage()
  writeGoal(tmpDir, makeGoal({ threadID: "a", objective: "task-a" }))
  writeGoal(tmpDir, makeGoal({ threadID: "b", objective: "task-b" }))
  const all = readAllGoals(tmpDir)
  expect(Object.keys(all)).toHaveLength(2)
})

test("deleteGoal removes entry", () => {
  resetStorage()
  writeGoal(tmpDir, makeGoal({ threadID: "a" }))
  writeGoal(tmpDir, makeGoal({ threadID: "b" }))
  deleteGoal(tmpDir, "a")
  const all = readAllGoals(tmpDir)
  expect(all).not.toHaveProperty("a")
  expect(all).toHaveProperty("b")
})

test("readGoal returns undefined for missing", () => {
  resetStorage()
  expect(readGoal(tmpDir, "nonexistent")).toBeUndefined()
})

test("atomic write via tmp file", () => {
  resetStorage()
  writeGoal(tmpDir, makeGoal())
  expect(fs.existsSync(storagePath(tmpDir))).toBe(true)
  expect(fs.existsSync(storagePath(tmpDir) + ".tmp")).toBe(false)
})

// ── isGoalContinueNeeded tests ──

test("isGoalContinueNeeded true for active", () => {
  expect(isGoalContinueNeeded(makeGoal({ status: "active" }))).toBe(true)
})

test("isGoalContinueNeeded false for complete", () => {
  expect(isGoalContinueNeeded(makeGoal({ status: "complete" }))).toBe(false)
})

test("isGoalContinueNeeded false for paused", () => {
  expect(isGoalContinueNeeded(makeGoal({ status: "paused" }))).toBe(false)
})

test("isGoalContinueNeeded false for blocked", () => {
  expect(isGoalContinueNeeded(makeGoal({ status: "blocked" }))).toBe(false)
})

test("isGoalContinueNeeded false for usage_limited", () => {
  expect(isGoalContinueNeeded(makeGoal({ status: "usage_limited" }))).toBe(false)
})

// ── continuationPrompt tests ──

test("continuationPrompt wraps in system-reminder tags", () => {
  const p = continuationPrompt(makeGoal())
  expect(p).toContain("<system-reminder>")
  expect(p).toContain("</system-reminder>")
  expect(p).toContain("Do not acknowledge this reminder")
})

test("continuationPrompt includes objective and status", () => {
  const p = continuationPrompt(makeGoal({ objective: "refactor module" }))
  expect(p).toContain("refactor module")
  expect(p).toContain("Status: active")
})

test("continuationPrompt includes time and iterations", () => {
  const p = continuationPrompt(makeGoal({ timeUsedSeconds: 125, iterationCount: 3 }))
  expect(p).toContain("2m 5s")
  expect(p).toContain("Iterations: 3")
})

// ── fmtDuration tests ──

test("fmtDuration seconds", () => {
  expect(fmtDuration(0)).toBe("0s")
  expect(fmtDuration(59)).toBe("59s")
})

test("fmtDuration minutes", () => {
  expect(fmtDuration(60)).toBe("1m 0s")
  expect(fmtDuration(3599)).toBe("59m 59s")
})

test("fmtDuration hours", () => {
  expect(fmtDuration(3600)).toBe("1h 0m")
  expect(fmtDuration(7200)).toBe("2h 0m")
})

// ── Cleanup ──

afterAll(teardown)
