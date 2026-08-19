import { expect, test, type Page } from "@playwright/test"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { fixture, pageMessages } from "./session-timeline.fixture"
import { mockOpenCodeServer } from "../utils/mock-server"
import { APP_READY_TIMEOUT, expectSessionTitle } from "../utils/waits"

test.describe("smoke: session timeline message navigation", () => {
  test.setTimeout(120_000)
  // The bead strip only renders when the session panel container is at least
  // @xl (36rem) wide; a wide viewport guarantees the container query matches.
  test.use({ viewport: { width: 1600, height: 900 } })

  test("jumps to a user message from the timeline navigation strip", async ({ page }) => {
    await mockOpenCodeServer(page, {
      sessions: fixture.sessions,
      provider: fixture.provider,
      directory: fixture.directory,
      project: fixture.project,
      pageMessages,
    })
    await configureNavPage(page, fixture.directory, false)

    await navigateToSession(page, fixture.directory, fixture.targetID, fixture.expected.targetTitle)
    await waitForTimelineStable(page)

    // Preload is disabled, so the loaded history is exactly the initial page:
    // the latest 20 messages, returned oldest-first by pageMessages.
    const firstPage = pageMessages(fixture.targetID, 20).items
    const expectedBeadIDs = firstPage
      .filter((message) => message.info.role === "user")
      .map((message) => message.info.id)
    expect(expectedBeadIDs.length).toBeGreaterThanOrEqual(2)
    const firstBeadID = expectedBeadIDs[0]

    const nav = page.getByRole("navigation", { name: "Message navigation" })
    await expect(nav).toBeVisible({ timeout: APP_READY_TIMEOUT })
    const beads = nav.locator('[data-slot="timeline-message-bead"]')
    await expect(beads).toHaveCount(expectedBeadIDs.length)
    await expect
      .poll(() => beads.evaluateAll((elements) => elements.map((element) => element.getAttribute("data-bead-id"))))
      .toEqual(expectedBeadIDs)

    // The timeline opens anchored to the latest turn; exactly one loaded user
    // message sits at the nav's reading line and owns the active bead.
    await expect
      .poll(() =>
        beads.evaluateAll((elements, expected) => {
          const active = elements.filter((element) => element.getAttribute("data-active") === "true")
          if (active.length !== 1) return false
          const id = active[0].getAttribute("data-bead-id")
          return id !== null && expected.includes(id)
        }, expectedBeadIDs),
      )
      .toBe(true)

    const firstBead = nav.locator(`[data-bead-id="${firstBeadID}"]`)
    const firstMessage = firstPage.find((message) => message.info.id === firstBeadID)
    const textPart = firstMessage?.parts.find((part) => part.type === "text" && !part.synthetic && !part.ignored)
    const rawText = textPart?.text
    const preview = (typeof rawText === "string" ? rawText : "").replace(/\n/g, " ").slice(0, 200)
    expect(preview.length).toBeGreaterThan(0)
    await expect(firstBead).toHaveAttribute("aria-label", preview)
    await expect.poll(() => firstBead.getAttribute("title").then((title) => title ?? "")).toContain(preview)

    await firstBead.click()

    await expect(page).toHaveURL(new RegExp(`#message-${firstBeadID}$`))
    await expect(firstBead).toHaveAttribute("data-active", "true", { timeout: 30_000 })
    await expect
      .poll(() =>
        page.evaluate((id) => {
          const root = [...document.querySelectorAll<HTMLElement>(".scroll-view__viewport")].find((element) =>
            element.querySelector("[data-timeline-row]"),
          )
          const row = document.getElementById(`message-${id}`)
          if (!root || !row) return false
          const view = root.getBoundingClientRect()
          const rect = row.getBoundingClientRect()
          return rect.bottom > view.top && rect.top >= view.top - 1 && rect.top < view.bottom
        }, firstBeadID),
      )
      .toBe(true)
  })

  test("preloads older message history when enabled", async ({ page }) => {
    const requests: { sessionID: string; before?: string }[] = []
    await mockOpenCodeServer(page, {
      sessions: fixture.sessions,
      provider: fixture.provider,
      directory: fixture.directory,
      project: fixture.project,
      pageMessages,
      onMessages: (input) => requests.push({ sessionID: input.sessionID, before: input.before }),
    })
    await configureNavPage(page, fixture.directory, true)

    await navigateToSession(page, fixture.directory, fixture.targetID, fixture.expected.targetTitle)
    await waitForTimelineStable(page)

    // The preload loop keeps requesting older pages without any user scroll;
    // an older-page request carries the decoded cursor as `before`.
    await expect
      .poll(() => requests.some((request) => request.sessionID === fixture.targetID && request.before !== undefined), {
        timeout: 60_000,
      })
      .toBe(true)
  })
})

async function configureNavPage(page: Page, directory: string, preloadTimelineHistory: boolean) {
  await page.addInitScript((preloadTimelineHistory) => {
    localStorage.setItem(
      "settings.v3",
      JSON.stringify({
        general: {
          editToolPartsExpanded: true,
          shellToolPartsExpanded: true,
          showReasoningSummaries: true,
          preloadTimelineHistory,
        },
      }),
    )
  }, preloadTimelineHistory)

  await page.addInitScript((directory) => {
    localStorage.setItem(
      "opencode.global.dat:server",
      JSON.stringify({
        projects: {
          local: [{ worktree: directory, expanded: true }],
        },
        lastProject: {
          local: directory,
        },
      }),
    )
  }, directory)
}

async function navigateToSession(page: Page, directory: string, sessionId: string, expectedTitle: string) {
  await page.goto(`/${base64Encode(directory)}/session/${sessionId}`)
  await expectSessionTitle(page, expectedTitle)
}

async function waitForTimelineStable(page: Page) {
  await page.waitForFunction(() => {
    const signature = () => {
      const scroller = [...document.querySelectorAll<HTMLElement>(".scroll-view__viewport")].find((element) =>
        element.querySelector("[data-timeline-row]"),
      )
      if (!scroller) return ""
      const rows = [...scroller.querySelectorAll<HTMLElement>("[data-message-id]")].map(
        (element) => element.dataset.messageId,
      )
      return JSON.stringify({
        top: Math.round(scroller.scrollTop),
        height: Math.round(scroller.scrollHeight),
        rows,
      })
    }
    return new Promise<boolean>((resolve) => {
      requestAnimationFrame(() => {
        const a = signature()
        requestAnimationFrame(() => {
          const b = signature()
          requestAnimationFrame(() => resolve(!!a && a === b && b === signature()))
        })
      })
    })
  })
}
