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
const T01_BASELINE_SAMPLES = 6
const STATUS_SAMPLES = 12
const OPEN_CLOSE_CYCLES = 50
const CLOSED_POLL_WINDOW_MS = 60_000
const GET_RUN_PATH = "/api/rpc/superpowers.execution.v1/getRun"
const EXECUTION_RPC_PATTERN = "**/api/rpc/superpowers.execution.v1/**"
const LONGTASK_THRESHOLD_MS = 50
const FEATURE_ATTRIBUTION_GATE = "unrun"
const FEATURE_ATTRIBUTION_REASON =
  "Chromium long tasks report only self/window attribution; overlap with asynchronous execution RPC windows attributes unrelated boot/timeline render tasks, and no feature-absent build is available at runtime for a causal difference."

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
    const observation = await observeT01Scenario(page, "cold")
    report({
      ...comparisonReport("tab switch: cold, review closed", observation.current.result, T01_BASELINE["tab switch: cold, review closed"], "cold"),
      ...observationReport(observation),
    })
    assertWithinT01Budget("tab switch: cold, review closed", observation.current.result, T01_BASELINE["tab switch: cold, review closed"])
  })

  benchmark("tab switch: warm, review closed does not regress past the T01 budget", async ({ page, report }) => {
    benchmark.setTimeout(600_000)
    await prepareT01TabSwitch(page)
    const observation = await observeT01Scenario(page, "warm")
    report({
      ...comparisonReport("tab switch: warm, review closed", observation.current.result, T01_BASELINE["tab switch: warm, review closed"], "warm"),
      ...observationReport(observation),
    })
    assertWithinT01Budget("tab switch: warm, review closed", observation.current.result, T01_BASELINE["tab switch: warm, review closed"])
  })

  benchmark("entry: cold session from Home does not regress past the T01 budget", async ({ page, report }) => {
    benchmark.setTimeout(600_000)
    await mockStressTimeline(page)
    await installStressSessionTabs(page, { sessionIDs: [] })
    const observation = await observeEntryScenario(page)
    report({
      ...comparisonReport("entry: cold session from Home", observation.current.result, T01_BASELINE["entry: cold session from Home"], "cold"),
      ...observationReport(observation),
    })
    assertWithinT01Budget("entry: cold session from Home", observation.current.result, T01_BASELINE["entry: cold session from Home"])
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

type ExecutionWindow = {
  name: string
  url: string
  start: number
  end: number
  document: string
}

type LongTaskAttribution = {
  name: string
  duration: number
  startTime: number
  attribution: string[]
  document: string
  featureAttributable: boolean
  overlappingWindows: string[]
}

type LongTaskProfile = {
  samples: number
  overThreshold: number
  featureAttributableSamples: number
  featureAttributableOverThreshold: number
  maxDurationMs: number
  attributionSources: string[]
  executionWindows: number
  records: LongTaskAttribution[]
}

type ScenarioRun = {
  result: SessionSwitchResult[]
  longTasks: LongTaskProfile
  windows: ExecutionWindow[]
}

type ObservedScenario = {
  current: ScenarioRun
  baseline: ScenarioRun
}

async function observeT01Scenario(page: Page, cache: "cold" | "warm"): Promise<ObservedScenario> {
  return observeScenario(
    page,
    () => measureT01TabSwitch(page, cache, T01_SAMPLES),
    () => measureT01TabSwitch(page, cache, T01_BASELINE_SAMPLES),
    async () => {
      await page.goto(stressSessionHref(fixture.sourceID))
      await expectSessionTitle(page, fixture.expected.sourceTitle)
      await expectReadyT01Timeline(page, fixture.sourceID)
    },
  )
}

async function observeEntryScenario(page: Page): Promise<ObservedScenario> {
  const selector = `[data-component="home-session-row-container"][data-session-id="${fixture.targetID}"] [data-component="home-session-row"]`
  const lastID = fixture.expected.targetMessageIDs.at(-1)!
  const runScenario = (samples: number) => async () => {
    const results: SessionSwitchResult[] = []
    for (let index = 0; index < samples; index += 1) {
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
    return results
  }
  return observeScenario(page, runScenario(T01_SAMPLES), runScenario(T01_BASELINE_SAMPLES), async () => {
    await page.goto("/")
    await expect(page.locator(selector)).toBeVisible()
  })
}

async function observeScenario(
  page: Page,
  current: () => Promise<SessionSwitchResult[]>,
  baseline: () => Promise<SessionSwitchResult[]>,
  warmup: () => Promise<void>,
): Promise<ObservedScenario> {
  const records: LongTaskAttribution[] = []
  const windows: ExecutionWindow[] = []
  await observeLongTasks(page, records, windows)
  await warmup()
  await drainLongTasks(records)
  const currentStart = records.length
  const windowsStart = windows.length
  const currentResult = await current()
  const currentWindows = windows.slice(windowsStart)
  const currentLongTasks = summarizeLongTasks(records.slice(currentStart), currentWindows)

  await page.route(EXECUTION_RPC_PATTERN, (route) => route.abort())
  const baselineStart = records.length
  const baselineWindowsStart = windows.length
  const baselineResult = await baseline()
  const baselineWindows = windows.slice(baselineWindowsStart)
  const baselineLongTasks = summarizeLongTasks(records.slice(baselineStart), baselineWindows)
  await page.unroute(EXECUTION_RPC_PATTERN)

  return {
    current: { result: currentResult, longTasks: currentLongTasks, windows: currentWindows },
    baseline: { result: baselineResult, longTasks: baselineLongTasks, windows: baselineWindows },
  }
}

async function observeLongTasks(page: Page, records: LongTaskAttribution[], windows: ExecutionWindow[]) {
  await page.exposeFunction("__reportLongTask", (record: LongTaskAttribution) => {
    records.push(record)
  })
  await page.exposeFunction("__reportExecutionWindow", (window: ExecutionWindow) => {
    windows.push(window)
  })
  await page.addInitScript(() => {
    const host = window as Window & {
      __longTasksUnsupported?: boolean
      __reportLongTask?: (record: LongTaskAttribution) => void
      __reportExecutionWindow?: (window: ExecutionWindow) => void
    }
    const documentID = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const windows: ExecutionWindow[] = []
    let sequence = 0
    const original = window.fetch.bind(window)
    window.fetch = (async (...args: Parameters<typeof fetch>) => {
      const input = args[0]
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.href : input instanceof Request ? input.url : ""
      if (!url.includes("/api/rpc/superpowers.execution.v1/")) return original(...args)
      sequence += 1
      const name = `execution-window-${sequence}`
      const start = performance.now()
      performance.mark(`${name}-start`, { startTime: start })
      try {
        return await original(...args)
      } finally {
        const end = performance.now()
        performance.mark(`${name}-end`, { startTime: end })
        try {
          performance.measure(name, `${name}-start`, `${name}-end`)
        } catch {
          host.__longTasksUnsupported = true
        }
        const window = { name, url, start, end, document: documentID }
        windows.push(window)
        host.__reportExecutionWindow?.(window)
      }
    }) as unknown as typeof fetch
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const attribution = (
            entry as PerformanceEntry & {
              attribution?: Array<{ containerType?: string; containerName?: string; containerId?: string }>
            }
          ).attribution
          const overlapping = windows.filter(
            (window) => entry.startTime < window.end && window.start < entry.startTime + entry.duration,
          )
          host.__reportLongTask?.({
            name: entry.name,
            duration: entry.duration,
            startTime: entry.startTime,
            attribution: (attribution ?? []).map(
              (item) => `${item.containerType ?? ""}:${item.containerName ?? ""}:${item.containerId ?? ""}`,
            ),
            document: documentID,
            featureAttributable: overlapping.length > 0,
            overlappingWindows: overlapping.map((window) => window.name),
          })
        }
      }).observe({ type: "longtask", buffered: true })
    } catch {
      host.__longTasksUnsupported = true
    }
  })
}

function summarizeLongTasks(records: LongTaskAttribution[], windows: ExecutionWindow[]): LongTaskProfile {
  const attributable = records.filter((record) => record.featureAttributable)
  return {
    samples: records.length,
    overThreshold: records.filter((record) => record.duration > LONGTASK_THRESHOLD_MS).length,
    featureAttributableSamples: attributable.length,
    featureAttributableOverThreshold: attributable.filter((record) => record.duration > LONGTASK_THRESHOLD_MS).length,
    maxDurationMs: records.reduce((max, record) => Math.max(max, record.duration), 0),
    attributionSources: [...new Set(records.flatMap((record) => [`${record.name}|${record.attribution.join(",")}`]))].sort(),
    executionWindows: windows.length,
    records,
  }
}

function observationReport(observation: ObservedScenario) {
  return {
    currentLongTasks: observation.current.longTasks,
    baselineLongTasks: observation.baseline.longTasks,
    executionWindows: observation.current.windows,
    baselineExecutionWindows: observation.baseline.windows,
    featureAttributionGate: FEATURE_ATTRIBUTION_GATE,
    featureAttributionReason: FEATURE_ATTRIBUTION_REASON,
  }
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

async function measureT01TabSwitch(page: Page, cache: "cold" | "warm", samples: number) {
  const destination = fixture.targetID
  const source = fixture.sourceID
  const results: SessionSwitchResult[] = []
  if (cache === "warm") {
    await page.goto(stressSessionHref(source))
    await expectSessionTitle(page, fixture.expected.sourceTitle)
    await expectReadyT01Timeline(page, source)
  }
  for (let index = 0; index < samples; index += 1) {
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
  const samples = completeSamples(scenario, results)
  return {
    scenario,
    t01BaselineFirstCorrectP95Ms: baseline.firstCorrect,
    t01BaselineStableP95Ms: baseline.stable,
    firstCorrectP95Ms: round(percentile(samples.firstCorrect, 95)),
    stableP95Ms: round(percentile(samples.stable, 95)),
    firstCorrectBudgetMs: round(baseline.firstCorrect * 1.1),
    stableBudgetMs: round(baseline.stable * 1.1),
    samples: samples.firstCorrect.length,
    cache,
    firstCorrectDistribution: samples.firstCorrect.map(round),
    stableDistribution: samples.stable.map(round),
  }
}

function assertWithinT01Budget(
  scenario: keyof typeof T01_BASELINE,
  results: SessionSwitchResult[],
  baseline: { firstCorrect: number; stable: number },
) {
  const samples = completeSamples(scenario, results)
  expect(percentile(samples.firstCorrect, 95)).toBeLessThanOrEqual(baseline.firstCorrect * 1.1)
  expect(percentile(samples.stable, 95)).toBeLessThanOrEqual(baseline.stable * 1.1)
}

function completeSamples(scenario: string, results: SessionSwitchResult[]) {
  expect(results).toHaveLength(T01_SAMPLES)
  const missing = results.flatMap((result, index) => {
    const absent = []
    if (result.firstCorrectObservedMs === null) absent.push("firstCorrect")
    if (result.stableObservedMs === null) absent.push("stable")
    return absent.length > 0 ? [`${scenario}#${index}:${absent.join("+")}`] : []
  })
  expect(missing).toEqual([])
  return {
    firstCorrect: results.map((result) => result.firstCorrectObservedMs!),
    stable: results.map((result) => result.stableObservedMs!),
  }
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
  await drainUntilStable(() => polls.length)
}

async function drainLongTasks(records: LongTaskAttribution[]) {
  await drainUntilStable(() => records.length)
}

async function drainUntilStable(read: () => number) {
  let previous = -1
  await expect
    .poll(
      () => {
        const current = read()
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
