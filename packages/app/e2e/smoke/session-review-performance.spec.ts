import { expect, test, type Page } from "@playwright/test"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { mockOpenCodeServer } from "../utils/mock-server"

const directory = "C:/OpenCode/DiffPerformance"
const sessionID = "ses_diff_performance"
const lines = Number(process.env.DIFF_PERF_LINES ?? 1536)

type PerfWindow = Window & {
  __diffPerf?: {
    frames: number[]
    started: number
  }
}

test("keeps the renderer responsive while preparing a pathological review diff", async ({ page }) => {
  test.setTimeout(120_000)
  await mockOpenCodeServer(page, {
    directory,
    project: { id: "proj_diff_performance", name: "Diff Performance", worktree: directory, vcs: "git" },
    provider: { all: [], default: {} },
    sessions: [
      {
        id: sessionID,
        projectID: "proj_diff_performance",
        directory,
        title: "Diff performance",
        version: "1",
        time: { created: 1, updated: 1 },
      },
    ],
    pageMessages: () => ({ items: [] }),
    vcsDiff: [pathologicalDiff(lines)],
  })
  await configure(page)
  await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
  const review = page.getByRole("button", { name: "Toggle review" })
  await expect(review).toHaveAttribute("aria-expanded", "false")

  await page.evaluate(() => {
    const state = (window as PerfWindow).__diffPerf!
    state.frames.length = 0
    state.started = performance.now()
  })
  await review.click()
  const trigger = page.getByRole("heading", { name: /pathological\.ts/i }).locator(":scope > button")
  await expect(trigger).toBeVisible()
  await trigger.click()
  await expect(page.locator('[data-component="file"][data-mode="diff"]')).toBeVisible({ timeout: 90_000 })

  const metrics = await page.evaluate(() => {
    const state = (window as PerfWindow).__diffPerf!
    return {
      elapsed: performance.now() - state.started,
      frames: state.frames.length,
      maxFrameGap: Math.max(...state.frames),
      p95FrameGap: percentile(state.frames, 0.95),
    }

    function percentile(values: number[], ratio: number) {
      const sorted = [...values].sort((a, b) => a - b)
      return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))] ?? 0
    }
  })

  console.log("session review diff performance", { linesPerSide: lines, ...metrics })
  expect(metrics.frames).toBeGreaterThan(1)
  expect(metrics.maxFrameGap).toBeLessThan(200)
})

function pathologicalDiff(count: number) {
  const before = Array.from({ length: count }, (_, index) => `old:${index.toString(36).padStart(6, "0")}`)
  const after = Array.from({ length: count }, (_, index) => `new:${index.toString(36).padStart(6, "0")}`)
  return {
    file: "src/pathological.ts",
    patch: [
      "Index: src/pathological.ts",
      "===================================================================",
      "--- src/pathological.ts\t",
      "+++ src/pathological.ts\t",
      `@@ -1,${count} +1,${count} @@`,
      ...before.map((line) => `-${line}`),
      ...after.map((line) => `+${line}`),
      "",
    ].join("\n"),
    additions: 1,
    deletions: 1,
    status: "modified",
  }
}

async function configure(page: Page) {
  await page.addInitScript(() => {
    const state = { frames: [] as number[], started: performance.now() }
    ;(window as PerfWindow).__diffPerf = state
    let previous = state.started
    const frame = (now: number) => {
      state.frames.push(now - previous)
      previous = now
      requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  })
  await page.addInitScript((directory) => {
    localStorage.setItem("opencode.settings.dat:general", JSON.stringify({ layout: "stretch" }))
    localStorage.setItem("opencode.global.dat:layout", JSON.stringify({ review: { diffStyle: "split", panelOpened: false } }))
    localStorage.setItem(
      "opencode.global.dat:server",
      JSON.stringify({ projects: { local: [{ worktree: directory, expanded: true }] }, lastProject: { local: directory } }),
    )
  }, directory)
}
