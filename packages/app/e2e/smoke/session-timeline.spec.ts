import { expect, test, type Page } from "@playwright/test"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { fixture, pageMessages } from "./session-timeline.fixture"
import { trackPageErrors, expectNoSmokeErrors } from "../utils/errors"
import { mockOpenCodeServer } from "../utils/mock-server"
import { APP_READY_TIMEOUT, expectAppVisible, expectSessionTitle } from "../utils/waits"

const forbiddenText = ["Load details", "Show earlier steps"]

type SmokeState = {
  ids: string[]
  visibleIds: string[]
  messageIds: string[]
  visibleMessageIds: string[]
  topVisibleId?: string
  signature: string
  scrollTop: number
  scrollHeight: number
  clientHeight: number
  errorToasts: string[]
  forbiddenText: string[]
}

type SmokeWindow = Window & {
  __timelineSmokeState?: () => SmokeState
  __timelineSmokeErrorToasts?: string[]
  __timelineSmokeForbiddenText?: string[]
}

test.describe("smoke: session timeline", () => {
  test.setTimeout(240_000)

  test("renders seeded timeline in order while paging through history", async ({ page }) => {
    const errors = trackPageErrors(page)
    await mockOpenCodeServer(page, {
      sessions: fixture.sessions,
      provider: fixture.provider,
      directory: fixture.directory,
      project: fixture.project,
      pageMessages,
    })
    await configureSmokePage(page, fixture.directory)

    await selectHomeProject(page, fixture.project.name)
    await navigateToSession(page, fixture.directory, fixture.sourceID, fixture.expected.sourceTitle)
    await expectSessionReady(page)
    await navigateToSession(page, fixture.directory, fixture.targetID, fixture.expected.targetTitle)
    const expectedPartIDs = fixture.expected.targetPartIDs
    const expectedMessageIDs = fixture.expected.targetMessageIDs
    await expectSessionTimelineReady(page, expectedPartIDs, expectedMessageIDs, errors)
    await expectCanScrollToStart(page, expectedPartIDs, expectedMessageIDs, errors)
  })
})

async function configureSmokePage(page: Page, directory: string) {
  await page.addInitScript(() => {
    localStorage.setItem(
      "settings.v3",
      JSON.stringify({
        general: {
          editToolPartsExpanded: true,
          shellToolPartsExpanded: true,
          showReasoningSummaries: true,
          showSessionProgressBar: true,
        },
      }),
    )
  })

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

  await page.addInitScript(() => {
    const smoke = window as SmokeWindow
    smoke.__timelineSmokeErrorToasts = []
    smoke.__timelineSmokeForbiddenText = []
    const partSelector = "[data-timeline-part-id], [data-timeline-part-ids]"
    const idsOf = (el: HTMLElement) =>
      [el.dataset.timelinePartId, ...(el.dataset.timelinePartIds?.split(",") ?? [])].filter((id): id is string => !!id)

    smoke.__timelineSmokeState = () => {
      const scroller = [...document.querySelectorAll<HTMLElement>(".scroll-view__viewport")].find((el) =>
        el.querySelector("[data-timeline-row], [data-session-title]"),
      )
      if (!scroller) {
        return {
          ids: [],
          visibleIds: [],
          messageIds: [],
          visibleMessageIds: [],
          topVisibleId: undefined,
          signature: "",
          scrollTop: 0,
          scrollHeight: 0,
          clientHeight: 0,
          errorToasts: smoke.__timelineSmokeErrorToasts ?? [],
          forbiddenText: smoke.__timelineSmokeForbiddenText ?? [],
        }
      }

      const ids: string[] = []
      const visibleIds: string[] = []
      const scrollerRect = scroller.getBoundingClientRect()
      let topVisibleId: string | undefined
      for (const el of scroller.querySelectorAll<HTMLElement>(partSelector)) {
        const next = idsOf(el)
        ids.push(...next)

        const rect = el.getBoundingClientRect()
        if (rect.bottom >= scrollerRect.top && rect.top <= scrollerRect.bottom) {
          if (!topVisibleId) topVisibleId = next[0]
          visibleIds.push(...next)
        }
      }

      const messageIds: string[] = []
      const visibleMessageIds: string[] = []
      const rows = [...scroller.querySelectorAll<HTMLElement>("[data-message-id]")].map((el) => {
        const rect = el.getBoundingClientRect()
        const id = el.dataset.messageId
        if (id) {
          messageIds.push(id)
          if (rect.bottom >= scrollerRect.top && rect.top <= scrollerRect.bottom) visibleMessageIds.push(id)
        }
        return {
          id,
          top: Math.round(rect.top),
          bottom: Math.round(rect.bottom),
        }
      })
      const signature = JSON.stringify({
        top: Math.round(scroller.scrollTop),
        height: Math.round(scroller.scrollHeight),
        rows,
        ids,
      })

      return {
        ids,
        visibleIds,
        messageIds,
        visibleMessageIds,
        topVisibleId,
        signature,
        scrollTop: Math.round(scroller.scrollTop),
        scrollHeight: Math.round(scroller.scrollHeight),
        clientHeight: Math.round(scroller.clientHeight),
        errorToasts: smoke.__timelineSmokeErrorToasts ?? [],
        forbiddenText: smoke.__timelineSmokeForbiddenText ?? [],
      }
    }
    let recordFrame: number | undefined
    const record = () => {
      for (const toast of document.querySelectorAll<HTMLElement>('[data-component="toast"][data-variant="error"]')) {
        const text = toast.textContent?.trim()
        if (text && !smoke.__timelineSmokeErrorToasts!.includes(text)) smoke.__timelineSmokeErrorToasts!.push(text)
      }
      const text = document.body?.textContent ?? ""
      for (const value of ["Load details", "Show earlier steps"]) {
        if (text.includes(value) && !smoke.__timelineSmokeForbiddenText!.includes(value)) {
          smoke.__timelineSmokeForbiddenText!.push(value)
        }
      }
    }
    const start = () => {
      const root = document.documentElement ?? document.body
      if (!root) return
      new MutationObserver(() => {
        if (recordFrame) return
        recordFrame = requestAnimationFrame(() => {
          recordFrame = undefined
          record()
        })
      }).observe(root, { childList: true, subtree: true })
      record()
    }
    if (document.documentElement ?? document.body) start()
    else document.addEventListener("DOMContentLoaded", start, { once: true })
  })
}

async function expectCanScrollToStart(
  page: Page,
  expectedPartIDs: string[],
  expectedMessageIDs: string[],
  errors: string[],
) {
  await pointAtTimeline(page)
  const seenParts = new Set<string>()
  const seenMessages = new Set<string>()
  const samples: TraversalSample[] = []
  let current = await timelineState(page)
  let unchangedAtTop = 0

  for (let attempt = 0; attempt < 600; attempt++) {
    collectSeen(current, seenParts, seenMessages)
    samples.push(sampleTraversal(current, seenParts.size, seenMessages.size))
    expectNoSmokeErrors(errors, current.errorToasts, current.forbiddenText)
    expectOrderedIDs(expectedPartIDs, current.ids, "mounted part")
    expectOrderedIDs(expectedPartIDs, current.visibleIds, "visible part")
    expectOrderedIDs(expectedMessageIDs, unique(current.messageIds), "mounted message")
    expectOrderedIDs(expectedMessageIDs, unique(current.visibleMessageIds), "visible message")

    if (
      current.scrollTop <= 1 &&
      seenParts.size === expectedPartIDs.length &&
      seenMessages.size === expectedMessageIDs.length
    ) {
      expectCompleteScroll(current, expectedPartIDs, expectedMessageIDs, seenParts, seenMessages, samples)
      return
    }

    const before = current
    const changed = await scrollTimelineUp(page, current)
    current = await timelineState(page)
    if (!changed && current.signature === before.signature && current.scrollTop <= 1) unchangedAtTop++
    else unchangedAtTop = 0
    if (unchangedAtTop >= 2) break
  }

  collectSeen(current, seenParts, seenMessages)
  samples.push(sampleTraversal(current, seenParts.size, seenMessages.size))
  expectCompleteScroll(current, expectedPartIDs, expectedMessageIDs, seenParts, seenMessages, samples)
}

async function timelineState(page: Page) {
  return page.evaluate(
    () =>
      (window as SmokeWindow).__timelineSmokeState?.() ?? {
        ids: [],
        visibleIds: [],
        messageIds: [],
        visibleMessageIds: [],
        topVisibleId: undefined,
        signature: "",
        scrollTop: 0,
        scrollHeight: 0,
        clientHeight: 0,
        errorToasts: [],
        forbiddenText: [],
      },
  )
}

function timelineScroller(page: Page) {
  return page.locator(".scroll-view__viewport", { has: page.locator("[data-timeline-row]") })
}

async function pointAtTimeline(page: Page) {
  const box = await timelineScroller(page).boundingBox()
  if (!box) throw new Error("Timeline scroller is not visible")
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
}

async function scrollTimelineUp(page: Page, before: SmokeState) {
  return page.evaluate(
    (prev) =>
      new Promise<boolean>((resolve) => {
        const scroller = [...document.querySelectorAll<HTMLElement>(".scroll-view__viewport")].find((el) =>
          el.querySelector("[data-timeline-row], [data-session-title]"),
        )
        if (!scroller) {
          resolve(false)
          return
        }

        scroller.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -1, deltaMode: 0 }))
        scroller.scrollTop = Math.max(0, scroller.scrollTop - Math.max(80, Math.round(scroller.clientHeight * 0.45)))

        const read = () => (window as SmokeWindow).__timelineSmokeState?.().signature ?? ""
        let frames = 0
        let stableFrames = 0
        let last = ""
        let changed = false
        const check = () => {
          const current = read()
          if (current !== prev) changed = true
          if (current === last) stableFrames++
          else {
            stableFrames = 0
            last = current
          }
          if (changed && stableFrames >= 2) {
            resolve(true)
            return
          }
          frames++
          if (frames >= 30) {
            resolve(changed)
            return
          }
          requestAnimationFrame(check)
        }
        requestAnimationFrame(check)
      }),
    before.signature,
  )
}

function expectOrderedIDs(expected: string[], actual: string[], label: string) {
  expect(actual.length, `${label} ids should not be empty`).toBeGreaterThan(0)
  const actualSet = new Set(actual)
  expect(actual, `${label} ids`).toEqual(expected.filter((id) => actualSet.has(id)))
}

function unique(values: string[]) {
  return values.filter((value, index) => values.indexOf(value) === index)
}

function collectSeen(state: SmokeState, seenParts: Set<string>, seenMessages: Set<string>) {
  for (const id of state.ids) seenParts.add(id)
  for (const id of state.visibleIds) seenParts.add(id)
  for (const id of state.messageIds) seenMessages.add(id)
  for (const id of state.visibleMessageIds) seenMessages.add(id)
}

type TraversalSample = ReturnType<typeof sampleTraversal>

function sampleTraversal(state: SmokeState, seenParts: number, seenMessages: number) {
  return {
    seenParts,
    seenMessages,
    mounted: state.ids.length,
    visible: state.visibleIds.length,
    mountedMessages: unique(state.messageIds).length,
    visibleMessages: unique(state.visibleMessageIds).length,
    top: state.scrollTop,
    height: state.scrollHeight,
    first: state.ids[0],
    last: state.ids.at(-1),
    topVisible: state.topVisibleId,
    visibleFirst: state.visibleIds[0],
    visibleLast: state.visibleIds.at(-1),
  }
}

function sampleSummary(samples: TraversalSample[]) {
  return samples
    .filter((_, index) => index % Math.max(1, Math.floor(samples.length / 8)) === 0 || index === samples.length - 1)
    .map(
      (sample, index) =>
        `${index}: seenParts=${sample.seenParts} seenMessages=${sample.seenMessages} mounted=${sample.mounted}/${sample.mountedMessages} visible=${sample.visible}/${sample.visibleMessages} top=${sample.top}/${sample.height} first=${sample.first} last=${sample.last} topVisible=${sample.topVisible} visible=${sample.visibleFirst}..${sample.visibleLast}`,
    )
    .join("\n")
}

async function waitForTimelineStable(page: Page) {
  await page.waitForFunction(
    () =>
      new Promise<boolean>((resolve) => {
        requestAnimationFrame(() => {
          const a = (window as SmokeWindow).__timelineSmokeState?.().signature ?? ""
          requestAnimationFrame(() => {
            const b = (window as SmokeWindow).__timelineSmokeState?.().signature ?? ""
            requestAnimationFrame(() =>
              resolve(!!a && a === b && b === ((window as SmokeWindow).__timelineSmokeState?.().signature ?? "")),
            )
          })
        })
      }),
  )
}

async function expectSessionTimelineReady(
  page: Page,
  expectedPartIDs: string[],
  expectedMessageIDs: string[],
  errors: string[],
) {
  await waitForTimelineStable(page)
  for (const text of forbiddenText) await expect(page.getByText(text)).toHaveCount(0)
  const currentState = await timelineState(page)
  expectNoSmokeErrors(errors, currentState.errorToasts, currentState.forbiddenText)
  expectOrderedIDs(expectedPartIDs, currentState.ids, "mounted part")
  expectOrderedIDs(expectedPartIDs, currentState.visibleIds, "visible part")
  expectOrderedIDs(expectedMessageIDs, unique(currentState.messageIds), "mounted message")
  expectOrderedIDs(expectedMessageIDs, unique(currentState.visibleMessageIds), "visible message")
}

function expectCompleteScroll(
  state: SmokeState,
  expectedPartIDs: string[],
  expectedMessageIDs: string[],
  seenParts: Set<string>,
  seenMessages: Set<string>,
  samples: TraversalSample[],
) {
  expect(state.scrollTop, `timeline should reach the start\n${sampleSummary(samples)}`).toBeLessThanOrEqual(1)
  expect(
    expectedPartIDs.filter((id) => !seenParts.has(id)),
    `missing visible timeline parts\n${sampleSummary(samples)}`,
  ).toEqual([])
  expect(
    expectedMessageIDs.filter((id) => !seenMessages.has(id)),
    `missing visible messages\n${sampleSummary(samples)}`,
  ).toEqual([])
  expect(new Set(expectedPartIDs).size).toBe(expectedPartIDs.length)
  expect(new Set(expectedMessageIDs).size).toBe(expectedMessageIDs.length)
  expect(expectedPartIDs.length).toBe(331)
}

async function selectHomeProject(page: Page, projectName: string) {
  await page.goto("/")
  const row = page
    .locator('[data-component="home-project-row"]')
    .filter({ hasText: new RegExp(projectName, "i") })
    .first()
  await expectAppVisible(row)
  await row.click()
  await expect(row).toHaveAttribute("data-selected", "", { timeout: APP_READY_TIMEOUT })
  await expect(page).toHaveURL(/\/$/)
}

async function navigateToSession(page: Page, directory: string, sessionId: string, expectedTitle: string) {
  await page.goto(`/${base64Encode(directory)}/session/${sessionId}`)
  await expectSessionTitle(page, expectedTitle)
}

async function expectSessionReady(page: Page) {
  await expectAppVisible(page.getByRole("textbox", { name: /Ask anything/i }))
}
