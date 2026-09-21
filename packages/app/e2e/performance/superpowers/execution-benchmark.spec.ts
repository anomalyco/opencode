import type { Page } from "@playwright/test"
import type { TaskDefinition } from "@bearmanser/opencode-superpowers-execution/contract"
import { benchmark, expect } from "../benchmark"
import {
  EXECUTION_ROOT_SESSION,
  createExecutionTestHarness,
  requireExplicitTestTarget,
  type ExecutionHarnessResult,
  type ExecutionRunRef,
  type ExecutionTestHarness,
} from "../../superpowers/execution-fixtures"

const target = requireExplicitTestTarget(process.env.EXECUTION_E2E_TARGET)
const PERF_OTHER_SESSION = "ses_perf_other"
const PERF_RUN_ID = "run-perf-1"
const PLAN = { path: "docs/plan.md", sha256: "0".repeat(64) }
const ENTRY_SAMPLES = 60
const OPEN_CLOSE_CYCLES = 50
const CLOSED_POLL_WINDOW_MS = 60_000
const GET_RUN_PATH = "/api/rpc/superpowers.execution.v1/getRun"

benchmark.use({
  viewport: { width: 1440, height: 900 },
  serviceWorkers: "block",
  trace: "off",
  video: "off",
  traceScope: "interaction",
})

benchmark.describe("superpowers execution performance budgets", () => {
  benchmark.skip(
    target === undefined,
    "UNRUN: EXECUTION_E2E_TARGET is not set. Set it to an explicitly disposable target (see docs/superpowers/verification/execution-ui/integration.md) to run this suite.",
  )

  let execution: ExecutionTestHarness

  benchmark.beforeAll(async () => {
    if (target === undefined) return
    execution = createExecutionTestHarness(target)
    await execution.start()
  })

  benchmark.afterAll(async () => {
    await execution?.stop()
  })

  benchmark.beforeEach(async () => {
    await execution.reset()
    await execution.resetSessions()
    await installPerformanceSessions(execution)
    await startPerformanceRun(execution)
  })

  benchmark("execution closed does not regress session entry or switch p95", async ({ page, report }) => {
    benchmark.setTimeout(300_000)
    if (target === undefined) return
    await execution.authenticate(page)
    await registerServer(page, execution, target.password)

    const loaded: number[] = []
    const baseline: number[] = []
    for (const state of ["loaded", "baseline", "baseline", "loaded"] as const) {
      if (state === "baseline") await execution.unloadPlugin()
      else await execution.reloadPlugin()
      const samples = await measureSessionEntry(page, execution, ENTRY_SAMPLES / 2)
      ;(state === "loaded" ? loaded : baseline).push(...samples)
    }
    await execution.reloadPlugin()
    expect(await page.locator('[data-testid="execution-map-node"]').count()).toBe(0)

    const loadedP95 = percentile(loaded, 95)
    const baselineP95 = percentile(baseline, 95)
    report({
      closedSessionSwitchP95Ms: round(loadedP95),
      baselineSessionSwitchP95Ms: round(baselineP95),
      closedSessionSwitchBudgetMs: round(baselineP95 * 1.1),
      regressionRatio: round(loadedP95 / baselineP95),
      samples: ENTRY_SAMPLES,
      phases: 2,
      loadedDistribution: loaded.map(round),
      baselineDistribution: baseline.map(round),
      mountedGraphNodes: 0,
    })
    expect(loadedP95).toBeLessThanOrEqual(baselineP95 * 1.1)
  })

  benchmark("an unopened execution dashboard performs no interval polling", async ({ page, report }) => {
    benchmark.setTimeout(180_000)
    if (target === undefined) return
    await execution.authenticate(page)
    await registerServer(page, execution, target.password)
    await page.clock.install()
    await page.goto(execution.sessionHref(EXECUTION_ROOT_SESSION))
    await expect(page.locator("[data-session-title]")).toBeVisible()

    const polls: string[] = []
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.endsWith(GET_RUN_PATH)) polls.push(request.url())
    })

    await execution.openPanel(page)
    const openPoll = page.waitForRequest((request) => new URL(request.url()).pathname.endsWith(GET_RUN_PATH))
    await page.clock.fastForward(15_000)
    await openPoll
    await drainFullRunPolls(polls)
    const visiblePolls = polls.length

    await execution.hideExecution(page)
    await drainFullRunPolls(polls)
    const before = polls.length
    await page.clock.fastForward(CLOSED_POLL_WINDOW_MS)
    await expect(page.locator('[data-testid="execution-map-node"]')).toHaveCount(0)
    const closedPolls = polls.length - before

    report({
      closedDashboardFullRunPolls: closedPolls,
      visibleDashboardFullRunPolls: visiblePolls,
      closedPollWindowMs: CLOSED_POLL_WINDOW_MS,
      mountedGraphNodes: 0,
    })
    expect(visiblePolls).toBeGreaterThan(0)
    expect(closedPolls).toBe(0)
  })

  benchmark("fifty execution open and close cycles leave no mounted graph", async ({ page, report }) => {
    benchmark.setTimeout(300_000)
    if (target === undefined) return
    await execution.authenticate(page)
    await registerServer(page, execution, target.password)
    await page.goto(execution.sessionHref(EXECUTION_ROOT_SESSION))
    await expect(page.locator("[data-session-title]")).toBeVisible()
    await execution.openPanel(page)

    let maxMountedNodes = 0
    for (let cycle = 0; cycle < OPEN_CLOSE_CYCLES; cycle += 1) {
      await execution.showExecution(page)
      maxMountedNodes = Math.max(maxMountedNodes, await page.locator('[data-testid="execution-map-node"]').count())
      await execution.hideExecution(page)
    }

    const mountedGraphNodes = await page.locator('[data-testid="execution-map-node"]').count()
    report({
      openCloseCycles: OPEN_CLOSE_CYCLES,
      mountedGraphNodes,
      maxMountedGraphNodes: maxMountedNodes,
    })
    expect(mountedGraphNodes).toBe(0)
  })
})

async function installPerformanceSessions(execution: ExecutionTestHarness) {
  const owner = execution.owned.directories.owner
  await execution.setSessions([
    { id: EXECUTION_ROOT_SESSION, directory: owner, title: "Execution root", running: true },
    ...Array.from({ length: 50 }, (_, index) => ({
      id: `ses_perf_child_${index}`,
      parentID: EXECUTION_ROOT_SESSION,
      directory: owner,
      title: `Performance child ${String(index).padStart(2, "0")}`,
    })),
    { id: PERF_OTHER_SESSION, directory: owner, title: "Other session" },
  ])
}

async function startPerformanceRun(execution: ExecutionTestHarness): Promise<ExecutionRunRef> {
  const result: ExecutionHarnessResult<{ run: unknown }> = await execution.report({
    operationID: `start-${PERF_RUN_ID}`,
    runID: PERF_RUN_ID,
    expectedRevision: 0,
    operation: { type: "run.start", title: "Performance run", plan: PLAN, tasks: performanceTasks() },
  })
  if (!result.ok) throw new Error(`performance run.start failed: ${result.error.detail}`)
  return { runID: PERF_RUN_ID, rootSessionID: EXECUTION_ROOT_SESSION }
}

function performanceTasks(): TaskDefinition[] {
  const id = (index: number) => `task-${String(index).padStart(3, "0")}`
  const tasks: TaskDefinition[] = Array.from({ length: 99 }, (_, index) => ({
    id: id(index),
    title: `Task ${id(index)}`,
    phase: index % 2 === 0 ? "Build" : "Verify",
    order: index,
    dependsOn: index === 0 ? [] : [id(index - 1)],
    requiredGates: ["tests"],
    finalReview: false,
  }))
  tasks.push({
    id: "task-final",
    title: "Final review",
    phase: "Review",
    order: 99,
    dependsOn: [id(98)],
    requiredGates: ["spec_review"],
    finalReview: true,
  })
  return tasks
}

async function registerServer(page: Page, execution: ExecutionTestHarness, password: string | undefined) {
  await page.addInitScript(
    ({ url, secret }) => {
      localStorage.setItem(
        "opencode.global.dat:server",
        JSON.stringify({
          list: [{ type: "http", http: { url, password: secret } }],
          hidden: {},
          projects: {},
          lastProject: {},
          recentlyClosed: {},
        }),
      )
    },
    { url: execution.serverURL, secret: password },
  )
}

async function drainFullRunPolls(polls: string[]) {
  let previous = -1
  await expect
    .poll(
      () => {
        const current = polls.length
        const stable = current === previous
        previous = current
        return stable
      },
      { timeout: 5_000 },
    )
    .toBe(true)
}

async function measureSessionEntry(page: Page, harness: ExecutionTestHarness, samples: number) {
  await page.goto(harness.sessionHref(EXECUTION_ROOT_SESSION))
  await expect(page.locator("[data-session-title]")).toBeVisible()
  const durations: number[] = []
  for (let index = 0; index < samples; index += 1) {
    const sessionID = index % 2 === 0 ? EXECUTION_ROOT_SESSION : PERF_OTHER_SESSION
    const start = Date.now()
    await page.goto(harness.sessionHref(sessionID))
    await expect(page.locator("[data-session-title]")).toBeVisible()
    durations.push(Date.now() - start)
  }
  return durations
}

function percentile(values: number[], target: number) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((target / 100) * sorted.length) - 1))
  return sorted[index]!
}

function round(value: number) {
  return Math.round(value * 100) / 100
}
