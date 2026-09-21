import { expect, test } from "bun:test"
import type { RunEvent } from "@bearmanser/opencode-superpowers-execution/contract"
import { EXECUTION_RECONCILE_INTERVAL } from "./bridge-client"
import { runFixture, taskFixture } from "./fixtures"
import { lifecycleHarness, measureGraphBudgets } from "./lifecycle"
import { ACTIVITY_PAGE_SIZE, createExecutionModel } from "./model"

test("disposing repeated execution views releases subscriptions", async () => {
  const harness = lifecycleHarness()
  const baseline = harness.listenerCount()
  for (let i = 0; i < 50; i += 1) {
    const view = harness.open({ rootSessionID: `root-${i}`, runID: "run" })
    await view.reconcile()
    view.dispose()
  }
  expect(harness.listenerCount()).toBe(baseline)
  expect(harness.intervalCount()).toBe(0)
  expect(harness.cacheSize()).toBeLessThanOrEqual(20)
  expect(harness.maxConcurrentDetails()).toBeLessThanOrEqual(4)
})

test("fifty root switches keep listeners, intervals, and the run cache bounded", async () => {
  const harness = lifecycleHarness()
  const baseline = harness.listenerCount()
  for (let i = 0; i < 50; i += 1) {
    const view = harness.open({ rootSessionID: `switch-root-${i}`, runID: "run" })
    await view.reconcile()
    view.dispose()
  }
  expect(harness.listenerCount()).toBe(baseline)
  expect(harness.intervalCount()).toBe(0)
  expect(harness.cacheSize()).toBeLessThanOrEqual(20)
  expect(harness.maxConcurrentDetails()).toBeLessThanOrEqual(4)
})

test("a closed dashboard never runs the interval poll", async () => {
  const harness = lifecycleHarness()
  const polls = await harness.closedDashboardFullRunPolls()
  expect(polls).toBe(0)
  expect(harness.intervalCount()).toBe(0)
})

test("hiding the execution tab suspends the safety interval and resumes it", async () => {
  const harness = lifecycleHarness()
  const view = harness.open({ rootSessionID: "root-hidden", runID: "run", visible: true })
  await view.reconcile()
  expect(harness.intervalCount()).toBe(1)
  harness.setVisible(false)
  await harness.flush()
  expect(harness.intervalCount()).toBe(0)
  harness.setVisible(true)
  await harness.flush()
  expect(harness.intervalCount()).toBe(1)
  view.dispose()
  expect(harness.intervalCount()).toBe(0)
})

test("the run cache stays within the configured limit inside one scope", async () => {
  const harness = lifecycleHarness()
  const view = harness.open({ rootSessionID: "root-cache", runID: "run-0" })
  await view.reconcile()
  for (let i = 1; i < 25; i += 1) {
    view.attach(`run-${i}`)
    await harness.flush()
  }
  harness.setConnected(false)
  expect(harness.cacheSize()).toBe(20)
  view.dispose()
})

test("native hydration of fifty descendants never exceeds four concurrent detail requests", async () => {
  const harness = lifecycleHarness()
  const view = harness.open({ rootSessionID: "root-concurrency", runID: "run", descendants: 50 })
  await view.reconcile()
  expect(harness.maxConcurrentDetails()).toBeLessThanOrEqual(4)
  expect(harness.maxConcurrentDetails()).toBe(4)
  harness.setConnected(false)
  await harness.flush()
  view.dispose()
})

test("no unopened closed-dashboard cycle blocks the main thread for more than fifty milliseconds", async () => {
  const harness = lifecycleHarness()
  for (let i = 0; i < 50; i += 1) {
    const view = harness.open({ rootSessionID: `idle-root-${i}`, runID: "run" })
    await view.reconcile()
    view.dispose()
  }
  expect(harness.maxSyncSpanMs()).toBeLessThanOrEqual(50)
})

test("the 500-task graph layout stays within the rendering budget", () => {
  const metrics = measureGraphBudgets()
  console.log(`[task-19-perf] rendering=${JSON.stringify(metrics)}`)
  expect(metrics.graphLayout500Ms).toBeLessThanOrEqual(250)
  expect(metrics.retainedNodes).toBe(500)
})

test("status-only updates stay within the update budget and do not relayout the graph", () => {
  const metrics = measureGraphBudgets()
  console.log(`[task-19-lifecycle] rendering=${JSON.stringify(metrics)}`)
  expect(metrics.statusUpdateP95Ms).toBeLessThanOrEqual(100)
  expect(metrics.graphLayoutsForTokenOnlyUpdates).toBe(0)
  expect(metrics.graphLayoutsForLongTitles).toBe(0)
})

test("a thousand retained events stay bounded in the activity projection", () => {
  const events: RunEvent[] = Array.from({ length: 1000 }, (_, index) => ({
    revision: index + 1,
    type: "task.state",
    taskID: "task-1",
    summary: `Retained event ${index + 1}`,
    createdAt: index,
  }))
  const model = createExecutionModel({
    snapshot: () =>
      runFixture({ revision: 1000, tasks: [taskFixture()], events, historyTruncatedBeforeRevision: 1 }),
  })
  expect(model.activity().total).toBe(1000)
  expect(model.activity().events).toHaveLength(ACTIVITY_PAGE_SIZE)
  expect(model.activity().hasMore).toBe(true)
})

test("records the lifecycle bounds against the baseline", async () => {
  const harness = lifecycleHarness()
  const baseline = harness.listenerCount()
  for (let i = 0; i < 50; i += 1) {
    const view = harness.open({ rootSessionID: `record-root-${i}`, runID: "run" })
    await view.reconcile()
    view.dispose()
  }
  const listeners = harness.listenerCount()
  const intervals = harness.intervalCount()
  const cache = harness.cacheSize()
  const concurrent = harness.maxConcurrentDetails()
  const polls = await harness.closedDashboardFullRunPolls()
  console.log(
    `[task-19-lifecycle] baseline=${baseline} listeners=${listeners} intervals=${intervals} cache=${cache} concurrent=${concurrent} closedPolls=${polls} syncSpan=${harness.maxSyncSpanMs().toFixed(2)}`,
  )
  expect(listeners).toBe(baseline)
  expect(intervals).toBe(0)
  expect(cache).toBeLessThanOrEqual(20)
  expect(concurrent).toBeLessThanOrEqual(4)
  expect(polls).toBe(0)
  expect(harness.maxSyncSpanMs()).toBeLessThanOrEqual(50)
})

test("a hidden dashboard advances the safety interval without any full-run poll", async () => {
  const harness = lifecycleHarness()
  const view = harness.open({ rootSessionID: "root-advance", runID: "run", visible: false })
  await view.reconcile()
  harness.setConnected(false)
  const before = harness.runCallCount()
  for (let i = 0; i < 20; i += 1) harness.advance(EXECUTION_RECONCILE_INTERVAL)
  await harness.flush()
  expect(harness.runCallCount()).toBe(before)
  view.dispose()
})
