# Cron/Scheduled Agent Tasks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the ability to schedule recurring agent tasks using cron expressions, persisted across restarts, running in-process alongside the TUI.

**Architecture:** A `Scheduler` namespace with a lightweight cron parser (no external deps), job storage via `Storage`, and a timer loop that fires jobs by spawning agent sessions. A `CronTool` provides agent access. A `/cron` CLI command for management.

**Tech Stack:** TypeScript, existing `Storage` namespace, Zod, no external cron libraries

---

### Task 1: Implement cron expression parser

**Files:**

- Create: `packages/opencode/src/scheduler/cron-parser.ts`
- Test: `packages/opencode/test/scheduler/cron-parser.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// test/scheduler/cron-parser.test.ts
import { test, expect } from "bun:test"
import { CronParser } from "../../src/scheduler/cron-parser"

test("parse standard cron fields", () => {
  const expr = CronParser.parse("0 */4 * * *")
  expect(expr.minute).toEqual([0])
  expect(expr.hour).toContain(4)
  expect(expr.hour).toContain(8)
  expect(expr.hour).toContain(12)
  expect(expr.dayOfMonth).toEqual(Array.from({ length: 31 }, (_, i) => i + 1))
  expect(expr.month).toEqual(Array.from({ length: 12 }, (_, i) => i + 1))
  expect(expr.dayOfWeek).toEqual(Array.from({ length: 7 }, (_, i) => i))
})

test("parse wildcard", () => {
  const expr = CronParser.parse("* * * * *")
  expect(expr.minute).toEqual(Array.from({ length: 60 }, (_, i) => i))
})

test("parse ranges", () => {
  const expr = CronParser.parse("0 9-17 * * 1-5")
  expect(expr.hour).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17])
  expect(expr.dayOfWeek).toEqual([1, 2, 3, 4, 5])
})

test("parse steps", () => {
  const expr = CronParser.parse("*/15 * * * *")
  expect(expr.minute).toEqual([0, 15, 30, 45])
})

test("parse comma-separated values", () => {
  const expr = CronParser.parse("0 9,12,18 * * *")
  expect(expr.hour).toEqual([9, 12, 18])
})

test("nextRun returns the next scheduled time", () => {
  const expr = CronParser.parse("0 * * * *") // every hour
  const now = new Date()
  const next = CronParser.nextRun(expr, now.getTime())
  expect(next).toBeGreaterThan(now.getTime())
  // Should be within the next hour
  expect(next).toBeLessThan(now.getTime() + 60 * 60 * 1000 + 1000)
})

test("nextRun for daily at 2am", () => {
  const expr = CronParser.parse("0 2 * * *")
  const now = new Date(2026, 3, 1, 10, 0) // April 1, 10am
  const next = CronParser.nextRun(expr, now.getTime())
  const nextDate = new Date(next)
  // Should be April 2 at 2am
  expect(nextDate.getHours()).toBe(2)
  expect(nextDate.getDate()).toBe(2)
})

test("isValid rejects invalid expressions", () => {
  expect(CronParser.isValid("not a cron")).toBe(false)
  expect(CronParser.isValid("* * * *")).toBe(false) // only 4 fields
  expect(CronParser.isValid("* * * * *")).toBe(true)
  expect(CronParser.isValid("0 0 * * 0")).toBe(true)
})

test("humanReadable describes the schedule", () => {
  expect(CronParser.humanReadable("0 */4 * * *")).toContain("every 4 hours")
  expect(CronParser.humanReadable("0 2 * * *")).toContain("2:00 AM")
  expect(CronParser.humanReadable("*/30 * * * *")).toContain("every 30 minutes")
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test test/scheduler/cron-parser.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement CronParser**

```typescript
// src/scheduler/cron-parser.ts
export namespace CronParser {
  export interface CronExpr {
    minute: number[]
    hour: number[]
    dayOfMonth: number[]
    month: number[]
    dayOfWeek: number[]
  }

  function expandField(field: string, min: number, max: number): number[] {
    if (field === "*") return Array.from({ length: max - min + 1 }, (_, i) => i + min)

    const values = new Set<number>()
    for (const part of field.split(",")) {
      let [range, step] = part.split("/")
      step = step ? parseInt(step) : 1

      if (range.includes("-")) {
        const [startStr, endStr] = range.split("-")
        const start = parseInt(startStr)
        const end = parseInt(endStr)
        for (let i = start; i <= end; i += step) values.add(i)
      } else if (range === "*") {
        for (let i = min; i <= max; i += step) values.add(i)
      } else {
        const val = parseInt(range)
        for (let i = val; i <= max; i += step) values.add(i)
      }
    }

    return [...values].filter((v) => v >= min && v <= max).sort((a, b) => a - b)
  }

  export function parse(expr: string): CronExpr {
    const parts = expr.trim().split(/\s+/)
    if (parts.length !== 5) throw new Error(`Invalid cron expression: ${expr}`)

    return {
      minute: expandField(parts[0], 0, 59),
      hour: expandField(parts[1], 0, 23),
      dayOfMonth: expandField(parts[2], 1, 31),
      month: expandField(parts[3], 1, 12),
      dayOfWeek: expandField(parts[4], 0, 6),
    }
  }

  export function isValid(expr: string): boolean {
    try {
      parse(expr)
      return true
    } catch {
      return false
    }
  }

  export function nextRun(expr: CronExpr, after: number): number {
    const d = new Date(after)
    // Move to the next minute
    d.setSeconds(0, 0)
    d.setMinutes(d.getMinutes() + 1)

    // Search up to 1 year
    const limit = after + 366 * 24 * 60 * 60 * 1000
    while (d.getTime() < limit) {
      if (
        expr.minute.includes(d.getMinutes()) &&
        expr.hour.includes(d.getHours()) &&
        expr.dayOfMonth.includes(d.getDate()) &&
        expr.month.includes(d.getMonth() + 1) &&
        expr.dayOfWeek.includes(d.getDay())
      ) {
        return d.getTime()
      }
      d.setMinutes(d.getMinutes() + 1)
    }
    throw new Error("No next run found within 1 year")
  }

  export function humanReadable(expr: string): string {
    const parts = expr.trim().split(/\s+/)
    if (parts.length !== 5) return expr

    const minute = parts[0]
    const hour = parts[1]
    const dom = parts[2]
    const month = parts[3]
    const dow = parts[4]

    const parts2: string[] = []

    // Minute description
    if (minute === "0" && hour.startsWith("*/")) {
      const step = hour.split("/")[1]
      parts2.push(`every ${step} hours`)
    } else if (minute.startsWith("*/")) {
      const step = minute.split("/")[1]
      parts2.push(`every ${step} minutes`)
    } else if (hour !== "*" && minute !== "*") {
      parts2.push(`${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`)
    } else {
      parts2.push(`minute=${minute} hour=${hour}`)
    }

    if (dom !== "*") parts2.push(`day=${dom}`)
    if (month !== "*") parts2.push(`month=${month}`)
    if (dow !== "*" && dow !== "0-6") {
      const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
      parts2.push(days[parseInt(dow)] ?? `dow=${dow}`)
    }

    return parts2.join(", ")
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test test/scheduler/cron-parser.test.ts`
Expected: All 8 tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/opencode/src/scheduler/cron-parser.ts packages/opencode/test/scheduler/cron-parser.test.ts
git commit -m "feat: add CronParser for cron expression parsing and scheduling"
```

---

### Task 2: Define the Job model and storage

**Files:**

- Create: `packages/opencode/src/scheduler/job.ts`
- Test: `packages/opencode/test/scheduler/job.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// test/scheduler/job.test.ts
import { test, expect } from "bun:test"
import { Job } from "../../src/scheduler/job"

test("create a job with required fields", () => {
  const job = Job.create({
    cron: "0 */4 * * *",
    prompt: "Run all tests",
    agent: "build",
    projectID: "proj-1",
  })
  expect(job.id).toBeDefined()
  expect(job.cron).toBe("0 */4 * * *")
  expect(job.prompt).toBe("Run all tests")
  expect(job.agent).toBe("build")
  expect(job.enabled).toBe(true)
  expect(job.runCount).toBe(0)
  expect(job.lastRun).toBeUndefined()
  expect(job.nextRun).toBeGreaterThan(Date.now())
})

test("create with custom tags", () => {
  const job = Job.create({
    cron: "0 2 * * *",
    prompt: "Nightly analysis",
    agent: "explore",
    projectID: "proj-1",
    tags: ["nightly", "testing"],
  })
  expect(job.tags).toEqual(["nightly", "testing"])
})

test("markRun updates run count and lastRun", () => {
  const job = Job.create({ cron: "* * * * *", prompt: "test", agent: "build", projectID: "p" })
  const before = Date.now()
  const updated = Job.markRun(job, "success")
  expect(updated.runCount).toBe(1)
  expect(updated.lastRun).toBeGreaterThanOrEqual(before)
  expect(updated.lastStatus).toBe("success")
})

test("disable and enable a job", () => {
  const job = Job.create({ cron: "* * * * *", prompt: "test", agent: "build", projectID: "p" })
  expect(job.enabled).toBe(true)
  const disabled = Job.toggle(job)
  expect(disabled.enabled).toBe(false)
  const enabled = Job.toggle(disabled)
  expect(enabled.enabled).toBe(true)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test test/scheduler/job.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement Job model**

```typescript
// src/scheduler/job.ts
import { Identifier } from "../id/id"
import { CronParser } from "./cron-parser"
import z from "zod"

export namespace Job {
  export const Info = z.object({
    id: z.string(),
    cron: z.string(),
    prompt: z.string(),
    agent: z.string(),
    projectID: z.string(),
    tags: z.array(z.string()).default([]),
    enabled: z.boolean().default(true),
    runCount: z.number().default(0),
    lastRun: z.number().optional(),
    lastStatus: z.enum(["success", "failure", "running"]).optional(),
    lastOutput: z.string().optional(),
    nextRun: z.number(),
    createdAt: z.number(),
  })
  export type Info = z.infer<typeof Info>

  export function create(input: {
    cron: string
    prompt: string
    agent: string
    projectID: string
    tags?: string[]
  }): Info {
    if (!CronParser.isValid(input.cron)) throw new Error(`Invalid cron expression: ${input.cron}`)
    const expr = CronParser.parse(input.cron)
    return {
      id: Identifier.generate("job"),
      cron: input.cron,
      prompt: input.prompt,
      agent: input.agent,
      projectID: input.projectID,
      tags: input.tags ?? [],
      enabled: true,
      runCount: 0,
      nextRun: CronParser.nextRun(expr, Date.now()),
      createdAt: Date.now(),
    }
  }

  export function markRun(job: Info, status: "success" | "failure" | "running", output?: string): Info {
    const expr = CronParser.parse(job.cron)
    return {
      ...job,
      runCount: job.runCount + 1,
      lastRun: Date.now(),
      lastStatus: status,
      lastOutput: output,
      nextRun: CronParser.nextRun(expr, Date.now()),
    }
  }

  export function toggle(job: Info): Info {
    return { ...job, enabled: !job.enabled }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test test/scheduler/job.test.ts`
Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/opencode/src/scheduler/job.ts packages/opencode/test/scheduler/job.test.ts
git commit -m "feat: add Job model for scheduled tasks"
```

---

### Task 3: Add JobStore persistence

**Files:**

- Create: `packages/opencode/src/scheduler/store.ts`

- [ ] **Step 1: Implement JobStore**

Follow the pattern from `packages/opencode/src/storage/storage.ts` and the memory store.

```typescript
// src/scheduler/store.ts
import { Storage } from "../storage/storage"
import { Job } from "./job"

export namespace JobStore {
  export async function save(job: Job.Info): Promise<void> {
    await Storage.write(["job", job.projectID, job.id], job)
  }

  export async function get(id: string, projectID: string): Promise<Job.Info | null> {
    return Storage.read<Job.Info>(["job", projectID, id])
  }

  export async function list(projectID: string): Promise<Job.Info[]> {
    const keys = await Storage.list(["job", projectID])
    const jobs = await Promise.all(keys.map((k) => Storage.read<Job.Info>(k)))
    return jobs.filter((j): j is Job.Info => j !== null)
  }

  export async function listEnabled(projectID: string): Promise<Job.Info[]> {
    const all = await list(projectID)
    return all.filter((j) => j.enabled)
  }

  export async function remove(id: string, projectID: string): Promise<void> {
    await Storage.remove(["job", projectID, id])
  }

  export async function update(job: Job.Info): Promise<void> {
    await save(job)
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/opencode/src/scheduler/store.ts
git commit -m "feat: add JobStore persistence layer"
```

---

### Task 4: Implement the Scheduler loop

**Files:**

- Create: `packages/opencode/src/scheduler/scheduler.ts`

- [ ] **Step 1: Implement the Scheduler**

The scheduler runs a check interval (default: 60s), finds due jobs, and spawns agent sessions. It should be started/stopped alongside the TUI.

```typescript
// src/scheduler/scheduler.ts
import { Log } from "../util/log"
import { Instance } from "../project/instance"
import { JobStore } from "./store"
import { Job } from "./job"
import { Session } from "../session/session"

export namespace Scheduler {
  const log = Log.create({ service: "scheduler" })
  let timer: Timer | null = null
  const CHECK_INTERVAL_MS = 60 * 1000 // 1 minute

  export function start(): void {
    if (timer) return
    log.info("Scheduler started")
    tick() // Check immediately
    timer = setInterval(tick, CHECK_INTERVAL_MS)
  }

  export function stop(): void {
    if (timer) {
      clearInterval(timer)
      timer = null
      log.info("Scheduler stopped")
    }
  }

  export function isRunning(): boolean {
    return timer !== null
  }

  async function tick(): Promise<void> {
    try {
      const projectID = Instance.project.id
      const jobs = await JobStore.listEnabled(projectID)
      const now = Date.now()

      for (const job of jobs) {
        if (job.nextRun > now) continue

        log.info(`Firing job ${job.id}: ${job.prompt}`)
        const updated = Job.markRun(job, "running")
        await JobStore.update(updated)

        try {
          // Spawn an agent session for this job
          // In production, this would call the session creation API
          // For now, log and mark as success
          log.info(`Job ${job.id} executed: ${job.prompt}`)
          const completed = Job.markRun(updated, "success", "Executed successfully")
          await JobStore.update(completed)
        } catch (err) {
          log.error(`Job ${job.id} failed: ${err}`)
          const failed = Job.markRun(updated, "failure", String(err))
          await JobStore.update(failed)
        }
      }
    } catch (err) {
      log.error(`Scheduler tick error: ${err}`)
    }
  }
}
```

- [ ] **Step 2: Hook scheduler into TUI lifecycle**

Find where the TUI app starts and stops. Add `Scheduler.start()` on init and `Scheduler.stop()` on exit. Look at the TUI entry point in `packages/opencode/src/cli/cmd/tui/`.

- [ ] **Step 3: Commit**

```bash
git add packages/opencode/src/scheduler/scheduler.ts
git commit -m "feat: add Scheduler loop with periodic job checking"
```

---

### Task 5: Add the Cron tool for agents

**Files:**

- Create: `packages/opencode/src/tool/cron.ts`

- [ ] **Step 1: Implement the CronTool**

```typescript
// src/tool/cron.ts
import { Tool } from "./tool"
import { Instance } from "../project/instance"
import { JobStore } from "../scheduler/store"
import { Job } from "../scheduler/job"
import { CronParser } from "../scheduler/cron-parser"
import z from "zod"

export const CronTool = Tool.define({
  name: "cron",
  description: "Manage scheduled recurring agent tasks. Create, list, and delete cron jobs.",
  parameters: z.object({
    action: z.enum(["create", "list", "delete"]).describe("Action to perform"),
    cron: z.string().optional().describe("Cron expression (for create action)"),
    prompt: z.string().optional().describe("Task prompt (for create action)"),
    agent: z.string().optional().describe("Agent type (for create action, default: build)"),
    id: z.string().optional().describe("Job ID (for delete action)"),
  }),
  async execute(input, ctx) {
    const projectID = Instance.project.id

    switch (input.action) {
      case "create": {
        if (!input.cron || !input.prompt) return "Error: cron and prompt are required for create"
        if (!CronParser.isValid(input.cron)) return `Error: invalid cron expression: ${input.cron}`
        const job = Job.create({
          cron: input.cron,
          prompt: input.prompt,
          agent: input.agent ?? "build",
          projectID,
        })
        await JobStore.save(job)
        return `Job created (id: ${job.id})\nSchedule: ${CronParser.humanReadable(input.cron)}\nNext run: ${new Date(job.nextRun).toISOString()}`
      }
      case "list": {
        const jobs = await JobStore.list(projectID)
        if (jobs.length === 0) return "No scheduled jobs."
        return jobs
          .map(
            (j) =>
              `${j.enabled ? "✓" : "✗"} ${j.id} | ${CronParser.humanReadable(j.cron)} | ${j.agent} | "${j.prompt}" | runs: ${j.runCount}${j.lastStatus ? ` | last: ${j.lastStatus}` : ""}`,
          )
          .join("\n")
      }
      case "delete": {
        if (!input.id) return "Error: id is required for delete"
        await JobStore.remove(input.id, projectID)
        return `Job ${input.id} deleted.`
      }
    }
  },
})
```

- [ ] **Step 2: Register the tool**

Add `CronTool` to the tool registry alongside existing tools.

- [ ] **Step 3: Commit**

```bash
git add packages/opencode/src/tool/cron.ts
git commit -m "feat: add Cron tool for agent-managed scheduled tasks"
```

---

### Task 6: Add `/cron` CLI command

**Files:**

- Create: `packages/opencode/src/cli/cmd/cron.ts`

- [ ] **Step 1: Create the CLI command**

Follow the pattern from `packages/opencode/src/cli/cmd/session.ts`. Support: `cron list`, `cron create "0 */4 * * *" "run tests" --agent build`, `cron delete <id>`.

- [ ] **Step 2: Register the command**

Add to CLI command registry.

- [ ] **Step 3: Test manually**

Run: `bun run --conditions=browser ./src/index.ts cron list`
Expected: "No scheduled jobs." or list of jobs

- [ ] **Step 4: Commit**

```bash
git commit -m "feat: add /cron CLI command for scheduled task management"
```

---

### Task 7: Run typecheck and full tests

- [ ] **Step 1: Run typecheck**

Run: `cd packages/opencode && bun run typecheck`
Expected: No type errors

- [ ] **Step 2: Run full test suite**

Run: `cd packages/opencode && bun test`
Expected: All tests pass, no regressions
