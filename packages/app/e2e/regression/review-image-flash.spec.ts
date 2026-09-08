import { expect, test, type Page } from "@playwright/test"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectAppVisible, expectSessionTitle } from "../utils/waits"

const directory = "C:/OpenCode/ReviewImageFlashRegression"
const sessionID = "ses_review_image_flash_regression"
const title = "Review image flash regression"
const imageFile = "assets/preview.png"

test("clicking an image file in the v2 review pane does not blank the panel", async ({ page }) => {
  await openReview(page)
  await installReviewFlashProbe(page)

  await page.getByRole("button", { name: /preview\.png/ }).click()
  await waitForReviewFlashProbe(page, 400)
  const trace = await collectReviewFlashProbe(page)
  const bad = trace.samples.filter((sample) => sample.blank || sample.blackCenter)

  expect(trace.samples.length).toBeGreaterThan(0)
  expect(
    bad,
    JSON.stringify({ bad: bad.slice(0, 8), first: trace.samples.slice(0, 8), last: trace.samples.slice(-4) }, null, 2),
  ).toEqual([])
})

async function openReview(page: Page) {
  await page.setViewportSize({ width: 960, height: 900 })
  await page.addInitScript(() => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
  })
  await mockOpenCodeServer(page, {
    directory,
    project: {
      id: "proj_review_image_flash_regression",
      worktree: directory,
      vcs: "git",
      name: "review-image-flash-regression",
      time: { created: 1700000000000, updated: 1700000000000 },
      sandboxes: [],
    },
    provider: { all: [], connected: [], default: {} },
    sessions: [
      {
        id: sessionID,
        slug: "review-image-flash-regression",
        projectID: "proj_review_image_flash_regression",
        directory,
        title,
        version: "dev",
        time: { created: 1700000000000, updated: 1700000000000 },
      },
    ],
    vcsDiff: [
      {
        file: "src/example.ts",
        additions: 1,
        deletions: 1,
        status: "modified",
        patch:
          "diff --git a/src/example.ts b/src/example.ts\n--- a/src/example.ts\n+++ b/src/example.ts\n@@ -1 +1 @@\n-export const value = 'before'\n+export const value = 'after'\n",
      },
      {
        file: imageFile,
        patch: "",
        additions: 1,
        deletions: 0,
        status: "added",
      },
    ],
    fileContent: async (path) => {
      if (path !== imageFile) return undefined
      await new Promise((resolve) => setTimeout(resolve, 250))
      return {
        type: "binary",
        content: "iVBORw0KGgo=",
        encoding: "base64",
        mimeType: "image/png",
      }
    },
    fileList: (path) => {
      if (!path) {
        return [
          { name: "assets", path: "assets", absolute: `${directory}/assets`, type: "directory", ignored: false },
          { name: "src", path: "src", absolute: `${directory}/src`, type: "directory", ignored: false },
        ]
      }
      if (path === "assets") {
        return [
          {
            name: "preview.png",
            path: imageFile,
            absolute: `${directory}/${imageFile}`,
            type: "file",
            ignored: false,
          },
        ]
      }
      if (path === "src") {
        return [
          {
            name: "example.ts",
            path: "src/example.ts",
            absolute: `${directory}/src/example.ts`,
            type: "file",
            ignored: false,
          },
        ]
      }
      return []
    },
    pageMessages: () => ({
      items: [
        {
          info: {
            id: "msg_review_image_flash_regression",
            sessionID,
            role: "user",
            time: { created: 1700000000000 },
            summary: { diffs: [] },
            agent: "build",
            model: { providerID: "opencode", modelID: "test" },
          },
          parts: [
            {
              id: "prt_review_image_flash_regression",
              sessionID,
              messageID: "msg_review_image_flash_regression",
              type: "text",
              text: "Review this change.",
            },
          ],
        },
      ],
    }),
  })

  await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
  await expectSessionTitle(page, title)
  await page.getByRole("button", { name: "Toggle review" }).click()
  await expectAppVisible(page.locator('#review-panel [data-component="session-review-v2"]'))
  await expectAppVisible(page.getByRole("button", { name: /preview\.png/ }))
}

async function installReviewFlashProbe(page: Page) {
  await page.evaluate(() => {
    const samples: Array<{
      observedAtMs: number
      blank: boolean
      blackCenter: boolean
      text: string
      background: string
    }> = []
    const startedAt = performance.now()
    const sample = () => {
      const panel = document.querySelector<HTMLElement>('#review-panel [data-component="session-review-v2"]')
      const rect = panel?.getBoundingClientRect()
      const center = rect
        ? document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
        : undefined
      const background = center instanceof Element ? getComputedStyle(center).backgroundColor : ""
      samples.push({
        observedAtMs: performance.now() - startedAt,
        blank: !panel || panel.textContent?.trim().length === 0,
        blackCenter: background === "rgb(0, 0, 0)",
        text: panel?.textContent?.trim().slice(0, 80) ?? "",
        background,
      })
      if (performance.now() - startedAt < 500) requestAnimationFrame(sample)
    }
    document.addEventListener(
      "click",
      (event) => {
        const target = event.target instanceof Element ? event.target : undefined
        if (!target?.closest('[data-slot="file-tree-v2-row"]')) return
        requestAnimationFrame(sample)
      },
      { capture: true, once: true },
    )
    ;(window as Window & { __reviewImageFlash?: { samples: typeof samples; startedAt: number } }).__reviewImageFlash = {
      samples,
      startedAt,
    }
  })
}

async function waitForReviewFlashProbe(page: Page, durationMs: number) {
  await page.waitForFunction((durationMs) => {
    const state = (window as Window & { __reviewImageFlash?: { samples: unknown[]; startedAt: number } })
      .__reviewImageFlash
    return !!state && state.samples.length > 0 && performance.now() - state.startedAt >= durationMs
  }, durationMs)
}

async function collectReviewFlashProbe(page: Page) {
  return page.evaluate(() => {
    return (window as Window & { __reviewImageFlash?: { samples: unknown[]; startedAt: number } }).__reviewImageFlash!
  }) as Promise<{
    startedAt: number
    samples: Array<{ observedAtMs: number; blank: boolean; blackCenter: boolean; text: string; background: string }>
  }>
}
