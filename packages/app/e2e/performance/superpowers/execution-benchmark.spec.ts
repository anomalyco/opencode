import type { Page } from "@playwright/test"
import type { TaskDefinition } from "@bearmanser/opencode-superpowers-execution/contract"
import { mockOpenCodeServer } from "../../utils/mock-server"
import { expectSessionTitle } from "../../utils/waits"
import { benchmark, expect } from "../benchmark"
import { expected, messages } from "../timeline/session-tab-switch.fixture"
import { measureSessionSwitch, waitForStableTimeline } from "../timeline/session-tab-switch-probe"
import { fixture } from "../timeline/session-timeline-stress.fixture"
import {
  createReviewDiffs,
  installStressSessionTabs,
  installTimelineSettings,
  mockStressTimeline,
  stressSessionHref,
} from "../timeline/timeline-test-helpers"
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
const T01_SAMPLES = 20
const STATUS_SAMPLES = 12
const OPEN_CLOSE_CYCLES = 50
const CLOSED_POLL_WINDOW_MS = 60_000
const GET_RUN_PATH = "/api/rpc/superpowers.execution.v1/getRun"
const LONGTASK_THRESHOLD_MS = 50

const T01_BASELINE = {
  "tab switch: cold, review closed": { firstCorrect: 530.9, stable: 583.0 },
  "tab switch: warm, review closed": { firstCorrect: 106.6, stable: 305.5 },
  "entry: cold session from Home": { firstCorrect: 1069.8, stable: 1227.0 },
} as const

const reviewDiffs = createReviewDiffs()

benchmark.use({
  viewport: { width: 1440, height: 900 },
  serviceWorkers: "block",
  trace: "off",
  video: "off",
  traceScope: "interaction",
})

benchmark.describe("T01 session-switch regression with execution closed", () => {
  benchmark("tab switch: cold, review closed does not regress past the T01 budget", async ({ page, report }) => {
    benchmark.setTimeout(600_000)
    await prepareT01TabSwitch(page)
    const baseline = T01_BASELINE["tab switch: cold, review closed"]
    const result = await measureT01TabSwitch(page, "cold")
    report(comparisonReport("tab switch: cold, review closed", result, baseline, "cold"))
    assertWithinT01Budget(result, baseline)
  })

  benchmark("tab switch: warm, review closed does not regress past the T01 budget", async ({ page, report }) => {
    benchmark.setTimeout(600_000)
    await prepareT01TabSwitch(page)
    const baseline = T01_BASELINE["tab switch: warm, review closed"]
    const result = await measureT01TabSwitch(page, "warm")
    report(comparisonReport("tab switch: warm, review closed", result, baseline, "warm"))
    assertWithinT01Budget(result, baseline)
  })

  benchmark("entry: cold session from Home does not regress past the T01 budget", async ({ page, report }) => {
    benchmark.setTimeout(600_000)
    await mockStressTimeline(page)
    await installStressSessionTabs(page, { sessionIDs: [] })
    const selector = `[data-component="home-session-row-container"][data-session-id="${fixture.targetID}"] [data-component="home-session-row"]`
    const lastID = fixture.expected.targetMessageIDs.at(-1)!
    const results: SessionSwitchResult[] = []
    for (let index = 0; index < T01_SAMPLES; index += 1) {
      await page.goto("/")
      await expect(page.locator(selector)).toBeVisible()
      results.push(
        await measureSessionSwitch(page, {
          destinationIDs: fixture.messages[fixture.targetID].map((message) => message.id),
          sourceIDs: [],
          lastID,
          requiredPartID: fixture.expected.targetPartIDs.at(-1)!,
          href: stressSessionHref(fixture.targetID),
          triggerSelector: selector,
          switch: async () => {
            await page.locator(selector).click()
            await waitForStableTimeline(page, lastID)
          },
        }),
      )
    }
    const baseline = T01_BASELINE["entry: cold session from Home"]
    report(comparisonReport("entry: cold session from Home", results, baseline, "cold"))
    assertWithinT01Budget(results, baseline)
  })
})

benchmark.describe("superpowers execution dashboard lifecycle budgets", () => {
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

  benchmark("a closed dashboard adds no browser long task above fifty milliseconds", async ({ page, report }) => {
    benchmark.setTimeout(300_000)
    if (target === undefined) return
    await execution.authenticate(page)
    await registerServer(page, execution, target.password)
    const longTasks: number[] = []
    await observeLongTasks(page, longTasks)
    await page.clock.install()

    const closed = await measureClosedDashboardLongTasks(page, execution, longTasks)
    await execution.unloadPlugin()
    const baseline = await measureClosedDashboardLongTasks(page, execution, longTasks)
    await execution.reloadPlugin()

    report({
      closedLongTasks: closed,
      baselineLongTasks: baseline,
      thresholdMs: LONGTASK_THRESHOLD_MS,
      mountedGraphNodes: 0,
    })
    expect(closed.supported).toBe(true)
    expect(closed.overThreshold).toBeLessThanOrEqual(baseline.overThreshold)
  })

  benchmark("a status-only update renders within the update budget", async ({ page, report }) => {
    benchmark.setTimeout(300_000)
    if (target === undefined) return
    await execution.authenticate(page)
    await registerServer(page, execution, target.password)
    await observeGetRunDelivery(page)
    await page.goto(execution.sessionHref(EXECUTION_ROOT_SESSION))
    await expect(page.locator("[data-session-title]")).toBeVisible()
    await execution.openPanel(page)
    await expect(page.locator('[data-testid="execution-map-node"][data-task-id="task-000"]')).toHaveAttribute(
      "data-state",
      "pending",
    )

    const run: ExecutionRunRef = { runID: PERF_RUN_ID, rootSessionID: EXECUTION_ROOT_SESSION }
    const samples: Array<number | null> = []
    for (let index = 0; index < STATUS_SAMPLES; index += 1) {
      const taskID = `task-${String(index).padStart(3, "0")}`
      await expect(page.locator(`[data-testid="execution-map-node"][data-task-id="${taskID}"]`)).toHaveAttribute(
        "data-state",
        "pending",
      )
      await page.evaluate((id) => {
        const host = window as StatusProbeWindow
        host.__statusProbe = undefined
        host.__lastGetRunAt = undefined
        const node = document.querySelector(`[data-testid="execution-map-node"][data-task-id="${id}"]`)
        if (!node) throw new Error("execution map node missing")
        const observer = new MutationObserver(() => {
          if (node.getAttribute("data-state") !== "running") return
          observer.disconnect()
          host.__statusProbe = {
            mutationAt: performance.now(),
            deliveredAt: host.__lastGetRunAt ?? null,
          }
        })
        observer.observe(node, { attributes: true, attributeFilter: ["data-state"] })
      }, taskID)
      await execution.reportTaskState(run, taskID, "running")
      await page.waitForFunction(() => (window as StatusProbeWindow).__statusProbe !== undefined, null, {
        timeout: 10_000,
      })
      const probe = await page.evaluate(() => (window as StatusProbeWindow).__statusProbe)
      samples.push(probe && probe.deliveredAt !== null ? probe.mutationAt - probe.deliveredAt : null)
    }

    const measured = samples.filter((value): value is number => value !== null)
    const p95 = percentile(measured, 95)
    report({
      statusUpdateP95Ms: measured.length > 0 ? round(p95) : null,
      statusUpdateSamples: samples.length,
      statusUpdateMeasuredSamples: measured.length,
      statusUpdateDistribution: samples.map((value) => (value === null ? null : round(value))),
      tasks: 100,
      descendants: 50,
    })
    expect(measured).toHaveLength(STATUS_SAMPLES)
    expect(p95).toBeLessThanOrEqual(100)
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

type StatusProbeWindow = Window & {
  __statusProbe?: { mutationAt: number; deliveredAt: number | null }
  __lastGetRunAt?: number
}

type SessionSwitchResult = {
  firstCorrectObservedMs: number | null
  stableObservedMs: number | null
}

type LongTaskReport = {
  supported: boolean
  samples: number
  overThreshold: number
  maxDurationMs: number
  durations: number[]
}

async function prepareT01TabSwitch(page: Page) {
  await mockOpenCodeServer(page, {
    sessions: fixture.sessions,
    provider: fixture.provider,
    directory: fixture.directory,
    project: fixture.project,
    pageMessages: (sessionID) => ({ items: messages[sessionID] ?? [] }),
    vcsDiff: reviewDiffs,
  })
  await installTimelineSettings(page)
  await installStressSessionTabs(page)
}

async function measureT01TabSwitch(page: Page, cache: "cold" | "warm") {
  const destination = fixture.targetID
  const source = fixture.sourceID
  const results: SessionSwitchResult[] = []
  if (cache === "warm") {
    await page.goto(stressSessionHref(source))
    await expectSessionTitle(page, fixture.expected.sourceTitle)
    await expectReadyT01Timeline(page, source)
  }
  for (let index = 0; index < T01_SAMPLES; index += 1) {
    if (cache === "cold") {
      await page.goto(stressSessionHref(source))
      await expectSessionTitle(page, fixture.expected.sourceTitle)
      await expectReadyT01Timeline(page, source)
    }
    if (cache === "warm" && index > 0) {
      await switchT01Session(page, source, fixture.expected.sourceTitle)
      await expectReadyT01Timeline(page, source)
    }
    if (cache === "warm") {
      await switchT01Session(page, destination, fixture.expected.targetTitle)
      await expectReadyT01Timeline(page, destination)
      await switchT01Session(page, source, fixture.expected.sourceTitle)
      await expectReadyT01Timeline(page, source)
    }
    results.push(
      await measureSessionSwitch(page, {
        destinationIDs: messages[destination].map((message) => message.id),
        sourceIDs: messages[source].map((message) => message.id),
        lastID: expected[destination].lastID,
        requiredPartID: expected[destination].answerID,
        href: stressSessionHref(destination),
        switch: () => switchT01Session(page, destination, fixture.expected.targetTitle),
      }),
    )
  }
  return results
}

async function expectReadyT01Timeline(page: Page, sessionID: string) {
  const answer = page.locator(`[data-timeline-part-id="${expected[sessionID].answerID}"]`)
  await expect(answer.locator('[data-component="markdown"]')).toHaveAttribute("data-markdown-ready", "")
  await expect(answer.getByRole("table")).toHaveCount(1)
  await expect(answer.locator("pre")).toHaveCount(4)
  await expect
    .poll(() => answer.evaluate((element) => element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })))
    .toBe(true)
  await waitForStableTimeline(page, expected[sessionID].lastID)
}

async function switchT01Session(page: Page, sessionID: string, title: string) {
  const tab = page.locator(`[data-slot="titlebar-tabs"] a[href="${stressSessionHref(sessionID)}"]`)
  await expect(tab).toHaveCount(1)
  await tab.click()
  await expectSessionTitle(page, title)
}

function comparisonReport(
  scenario: keyof typeof T01_BASELINE,
  results: SessionSwitchResult[],
  baseline: { firstCorrect: number; stable: number },
  cache: string,
) {
  const firstCorrect = results.map((result) => result.firstCorrectObservedMs)
  const stable = results.map((result) => result.stableObservedMs)
  return {
    scenario,
    t01BaselineFirstCorrectP95Ms: baseline.firstCorrect,
    t01BaselineStableP95Ms: baseline.stable,
    firstCorrectP95Ms: round(percentile(numbers(firstCorrect), 95)),
    stableP95Ms: round(percentile(numbers(stable), 95)),
    firstCorrectBudgetMs: round(baseline.firstCorrect * 1.1),
    stableBudgetMs: round(baseline.stable * 1.1),
    samples: results.length,
    cache,
    firstCorrectDistribution: firstCorrect.map((value) => (value === null ? null : round(value))),
    stableDistribution: stable.map((value) => (value === null ? null : round(value))),
  }
}

function assertWithinT01Budget(results: SessionSwitchResult[], baseline: { firstCorrect: number; stable: number }) {
  const firstCorrect = percentile(numbers(results.map((result) => result.firstCorrectObservedMs)), 95)
  const stable = percentile(numbers(results.map((result) => result.stableObservedMs)), 95)
  expect(firstCorrect).toBeLessThanOrEqual(baseline.firstCorrect * 1.1)
  expect(stable).toBeLessThanOrEqual(baseline.stable * 1.1)
}

function numbers(values: Array<number | null>) {
  return values.filter((value): value is number => value !== null)
}

async function observeGetRunDelivery(page: Page) {
  await page.addInitScript(() => {
    const host = window as Window & { __lastGetRunAt?: number }
    const original = window.fetch.bind(window)
    window.fetch = (async (...args: Parameters<typeof fetch>) => {
      const response = await original(...args)
      const input = args[0]
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.href : input instanceof Request ? input.url : ""
      if (url.includes("/getRun")) host.__lastGetRunAt = performance.now()
      return response
    }) as unknown as typeof fetch
  })
}

async function observeLongTasks(page: Page, durations: number[]) {
  await page.exposeFunction("__reportLongTask", (duration: number) => {
    durations.push(duration)
  })
  await page.addInitScript(() => {
    const host = window as Window & { __longTasksUnsupported?: boolean }
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          ;(window as Window & { __reportLongTask?: (duration: number) => void }).__reportLongTask?.(entry.duration)
        }
      }).observe({ type: "longtask", buffered: true })
    } catch {
      host.__longTasksUnsupported = true
    }
  })
}

async function measureClosedDashboardLongTasks(
  page: Page,
  execution: ExecutionTestHarness,
  durations: number[],
): Promise<LongTaskReport> {
  await page.goto(execution.sessionHref(EXECUTION_ROOT_SESSION))
  await expect(page.locator("[data-session-title]")).toBeVisible()
  await expect(page.locator('[data-testid="execution-map-node"]')).toHaveCount(0)
  await drainLongTasks(durations)
  const start = durations.length
  await page.clock.fastForward(CLOSED_POLL_WINDOW_MS)
  await drainLongTasks(durations)
  const supported = await page.evaluate(
    () => !(window as Window & { __longTasksUnsupported?: boolean }).__longTasksUnsupported,
  )
  const slice = durations.slice(start)
  return {
    supported,
    samples: slice.length,
    overThreshold: slice.filter((duration) => duration > LONGTASK_THRESHOLD_MS).length,
    maxDurationMs: slice.reduce((max, duration) => Math.max(max, duration), 0),
    durations: slice,
  }
}

async function drainLongTasks(durations: number[]) {
  let previous = -1
  await expect
    .poll(
      () => {
        const current = durations.length
        const stable = current === previous
        previous = current
        return stable
      },
      { timeout: 5_000 },
    )
    .toBe(true)
}

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
    dependsOn: [],
    requiredGates: ["tests"],
    finalReview: false,
  }))
  tasks.push({
    id: "task-final",
    title: "Final review",
    phase: "Review",
    order: 99,
    dependsOn: [],
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

function percentile(values: number[], target: number) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((target / 100) * sorted.length) - 1))
  return sorted[index]!
}

function round(value: number) {
  return Math.round(value * 100) / 100
}
