import type { Page } from "@playwright/test"
import { benchmark, expect } from "../benchmark"
import { setupTimelineBenchmark } from "./session-timeline-benchmark.fixture"

const changedLinesPerFile = 100
const linesPerSide = changedLinesPerFile / 2
const fileCounts = [1, 10, 100, 1_000, 10_000]
const filesPerDirectory = 100
const readyFrames = 3
const completionTimeoutMs = Number(process.env.REVIEW_PANE_COMPLETION_TIMEOUT_MS ?? 900_000)

type ReviewPaneScalingSample = {
  observedAtMs: number
  logicalRows: number
  treeRows: number
  fileRows: number
  diffLines: number
  header: string
  ready: boolean
}

type ReviewPaneScalingProbe = {
  startedAt?: number
  firstTreeRowMs?: number
  logicalTreeReadyMs?: number
  firstDiffRenderMs?: number
  stableReadyMs?: number
  samples: ReviewPaneScalingSample[]
  frameTimesMs: number[]
  longTasks: { startTime: number; duration: number }[]
  stop: () => void
}

benchmark.describe("performance: review pane scaling", () => {
  for (const fileCount of fileCounts) {
    const changedLines = fileCount * changedLinesPerFile

    benchmark(
      `${changedLines} changed lines across ${fileCount} ${fileCount === 1 ? "file" : "files"}`,
      async ({ page, report }) => {
        benchmark.setTimeout(1_200_000)
        await page.emulateMedia({ reducedMotion: "reduce" })

        const patchByteLimit = Number(process.env.REVIEW_PANE_PATCH_BYTE_LIMIT ?? Number.POSITIVE_INFINITY)
        if (Number.isNaN(patchByteLimit) || patchByteLimit < 0)
          throw new Error(`Invalid REVIEW_PANE_PATCH_BYTE_LIMIT: ${process.env.REVIEW_PANE_PATCH_BYTE_LIMIT}`)
        const responseBody = JSON.stringify(createScalingDiffs(fileCount, patchByteLimit))
        await setupTimelineBenchmark(page, {
          historyTurns: 0,
          eventBatch: 1,
          newLayoutDesigns: true,
        })
        await page.route("**/vcs/diff**", (route) =>
          route.fulfill({
            status: 200,
            contentType: "application/json",
            headers: { "access-control-allow-origin": "*" },
            body: responseBody,
          }),
        )

        const expectedRows = fileCount + 2 + Math.ceil(fileCount / filesPerDirectory)
        const metrics = await measureReviewPaneLoad(page, {
          expectedFile: reviewFile(0),
          expectedRows,
        })
        const search = await measureBroadReviewSearch(page, fileCount)

        expect(metrics.logicalRows).toBe(expectedRows)
        expect(metrics.fileRows).toBeGreaterThan(0)
        expect(metrics.treeRows).toBeGreaterThan(0)
        expect(metrics.diffLines).toBeGreaterThan(0)
        expect(search.logicalRows).toBe(fileCount)
        expect(search.renderedRows).toBeGreaterThan(0)
        report(
          { ...metrics, search },
          {
            fileCount,
            changedLinesPerFile,
            changedLines,
            additions: changedLines / 2,
            deletions: changedLines / 2,
            patchLines: changedLines,
            patchByteLimit: Number.isFinite(patchByteLimit) ? patchByteLimit : null,
            payloadBytes: new TextEncoder().encode(responseBody).byteLength,
            expectedRows,
          },
        )
      },
    )
  }
})

async function measureBroadReviewSearch(page: Page, expectedRows: number) {
  const filter = page.getByRole("searchbox", { name: "Filter files" })
  await filter.evaluate((element) => {
    element.addEventListener(
      "input",
      () => {
        ;(window as Window & { __reviewSearchStartedAt?: number }).__reviewSearchStartedAt = performance.now()
      },
      { once: true, capture: true },
    )
  })
  await filter.fill("file-")

  return page.evaluate((expectedRows) => {
    const startedAt = (window as Window & { __reviewSearchStartedAt?: number }).__reviewSearchStartedAt!
    return new Promise<{ stableMs: number; logicalRows: number; renderedRows: number }>((resolve) => {
      let previous = -1
      let streak = 0
      const sample = () => {
        const tree = document.querySelector<HTMLElement>('#review-panel [data-component="file-tree-v2"]')
        const rows = [...document.querySelectorAll<HTMLElement>('#review-panel [data-slot="file-tree-v2-row"]')]
        const logicalRows = Number(tree?.dataset.totalRows ?? rows.length)
        const ready =
          logicalRows === expectedRows && rows.length > 0 && rows.every((row) => row.textContent?.includes("file-"))
        streak = ready && rows.length === previous ? streak + 1 : ready ? 1 : 0
        previous = rows.length
        if (streak >= 3) {
          resolve({ stableMs: performance.now() - startedAt, logicalRows, renderedRows: rows.length })
          return
        }
        requestAnimationFrame(sample)
      }
      requestAnimationFrame(sample)
    })
  }, expectedRows)
}

function createScalingDiffs(fileCount: number, patchByteLimit: number) {
  const changes = Array.from({ length: linesPerSide }, (_, index) => {
    const line = String(index).padStart(3, "0")
    return `-export const value_${line} = "before"\n+export const value_${line} = "after"`
  }).join("\n")
  let patchBytes = 0
  let capped = false

  return Array.from({ length: fileCount }, (_, index) => {
    const file = reviewFile(index)
    const fullPatch = [
      `diff --git a/${file} b/${file}`,
      `--- a/${file}`,
      `+++ b/${file}`,
      `@@ -1,${linesPerSide} +1,${linesPerSide} @@`,
      changes,
    ].join("\n")
    if (index === 0 && fullPatch.length > patchByteLimit)
      throw new Error(`REVIEW_PANE_PATCH_BYTE_LIMIT must include the active patch (${fullPatch.length} bytes)`)
    const patch = !capped && patchBytes + fullPatch.length <= patchByteLimit ? fullPatch : emptyReviewPatch(file)
    if (patch === fullPatch) patchBytes += fullPatch.length
    else capped = true
    return {
      file,
      patch,
      additions: linesPerSide,
      deletions: linesPerSide,
      status: "modified" as const,
    }
  })
}

function emptyReviewPatch(file: string) {
  return [`diff --git a/${file} b/${file}`, `--- a/${file}`, `+++ b/${file}`].join("\n")
}

function reviewFile(index: number) {
  return `src/review/d${String(Math.floor(index / filesPerDirectory)).padStart(5, "0")}/file-${String(index).padStart(5, "0")}.ts`
}

async function measureReviewPaneLoad(page: Page, input: { expectedFile: string; expectedRows: number }) {
  const toggle = page.getByRole("button", { name: "Toggle review" })
  await expect(toggle).toBeVisible()
  await toggle.evaluate((element) => element.setAttribute("data-review-pane-scaling-toggle", ""))
  await installReviewPaneScalingProbe(page, input)
  await toggle.click()
  await page.waitForFunction(
    () =>
      (window as Window & { __reviewPaneScalingProbe?: ReviewPaneScalingProbe }).__reviewPaneScalingProbe
        ?.stableReadyMs !== undefined,
    undefined,
    { timeout: completionTimeoutMs },
  )

  return page.evaluate(() => {
    const probe = (window as Window & { __reviewPaneScalingProbe?: ReviewPaneScalingProbe }).__reviewPaneScalingProbe!
    probe.stop()
    const startedAt = probe.startedAt!
    const final = probe.samples.at(-1)!
    const resources = performance
      .getEntriesByType("resource")
      .filter((entry) => entry.name.includes("/vcs/diff")) as PerformanceResourceTiming[]
    const resource = resources.at(-1)
    const longTasks = probe.longTasks.filter(
      (entry) => entry.startTime >= startedAt && entry.startTime <= startedAt + probe.stableReadyMs!,
    )
    const frameGaps = probe.frameTimesMs.map((time, index) => time - (probe.frameTimesMs[index - 1] ?? 0))

    return {
      firstTreeRowMs: probe.firstTreeRowMs ?? null,
      logicalTreeReadyMs: probe.logicalTreeReadyMs ?? null,
      firstDiffRenderMs: probe.firstDiffRenderMs ?? null,
      stableReadyMs: probe.stableReadyMs ?? null,
      responseStartMs: resource ? resource.responseStart - startedAt : null,
      responseEndMs: resource ? resource.responseEnd - startedAt : null,
      responseToStableMs: resource ? probe.stableReadyMs! - (resource.responseEnd - startedAt) : null,
      treeRows: final.treeRows,
      logicalRows: final.logicalRows,
      fileRows: final.fileRows,
      diffLines: final.diffLines,
      samples: probe.samples.length,
      maxFrameGapMs: Math.max(0, ...frameGaps),
      longTaskCount: longTasks.length,
      longTaskTotalMs: longTasks.reduce((sum, entry) => sum + entry.duration, 0),
      maxLongTaskMs: Math.max(0, ...longTasks.map((entry) => entry.duration)),
    }
  })
}

async function installReviewPaneScalingProbe(page: Page, input: { expectedFile: string; expectedRows: number }) {
  await page.evaluate(
    ({ expectedFile, expectedRows, stableFrames }) => {
      let running = true
      let readyStreak = 0
      const basename = expectedFile.split("/").at(-1)!
      const longTaskObserver = PerformanceObserver.supportedEntryTypes.includes("longtask")
        ? new PerformanceObserver((list) => {
            probe.longTasks.push(
              ...list.getEntries().map((entry) => ({ startTime: entry.startTime, duration: entry.duration })),
            )
          })
        : undefined
      const probe: ReviewPaneScalingProbe = {
        samples: [],
        frameTimesMs: [],
        longTasks: [],
        stop: () => {
          running = false
          longTaskObserver?.disconnect()
        },
      }

      const sample = (time: number) => {
        if (!running || probe.startedAt === undefined) return
        const panel = document.querySelector<HTMLElement>("#review-panel")
        const tree = panel?.querySelector<HTMLElement>('[data-component="file-tree-v2"]')
        const rows = panel?.querySelectorAll('[data-slot="file-tree-v2-row"]') ?? []
        const fileRows = panel?.querySelectorAll('button[data-slot="file-tree-v2-row"]') ?? []
        const header =
          panel?.querySelector<HTMLElement>('[data-slot="session-review-v2-file-header"]')?.textContent?.trim() ?? ""
        const viewers = panel
          ? [...panel.querySelectorAll<HTMLElement>('[data-component="file"][data-mode="diff"]')]
          : []
        const diffLines = viewers.reduce(
          (sum, viewer) =>
            sum + (viewer.querySelector("diffs-container")?.shadowRoot?.querySelectorAll("[data-line]").length ?? 0),
          0,
        )
        const observedAtMs = time - probe.startedAt
        const logicalRows = Number(tree?.dataset.totalRows ?? rows.length)
        const ready =
          logicalRows === expectedRows &&
          fileRows.length > 0 &&
          header.includes(basename) &&
          viewers.length === 1 &&
          diffLines > 0
        const previous = probe.samples.at(-1)
        const stable =
          ready &&
          previous?.ready === true &&
          previous.logicalRows === logicalRows &&
          previous.treeRows === rows.length &&
          previous.fileRows === fileRows.length &&
          previous.diffLines === diffLines &&
          previous.header === header

        probe.frameTimesMs.push(observedAtMs)
        probe.samples.push({
          observedAtMs,
          logicalRows,
          treeRows: rows.length,
          fileRows: fileRows.length,
          diffLines,
          header,
          ready,
        })
        if (probe.firstTreeRowMs === undefined && rows.length > 0) probe.firstTreeRowMs = observedAtMs
        if (probe.logicalTreeReadyMs === undefined && logicalRows === expectedRows)
          probe.logicalTreeReadyMs = observedAtMs
        if (probe.firstDiffRenderMs === undefined && diffLines > 0) probe.firstDiffRenderMs = observedAtMs
        readyStreak = !ready ? 0 : stable ? readyStreak + 1 : 1
        if (readyStreak === stableFrames) probe.stableReadyMs = observedAtMs
        if (probe.stableReadyMs === undefined) requestAnimationFrame(sample)
      }

      longTaskObserver?.observe({ type: "longtask", buffered: true })
      document.addEventListener(
        "click",
        (event) => {
          const toggle = event.target instanceof Element ? event.target.closest("button") : undefined
          if (!toggle?.hasAttribute("data-review-pane-scaling-toggle")) return
          probe.startedAt = performance.now()
          performance.mark("opencode.review-pane-scaling.click")
          requestAnimationFrame(sample)
        },
        { capture: true, once: true },
      )
      ;(window as Window & { __reviewPaneScalingProbe?: ReviewPaneScalingProbe }).__reviewPaneScalingProbe = probe
    },
    { ...input, stableFrames: readyFrames },
  )
}
