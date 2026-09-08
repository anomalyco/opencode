import { expect, test, type Page } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectSessionTitle } from "../utils/waits"
import { fixture } from "../performance/timeline/session-timeline-stress.fixture"
import { installStressSessionTabs, stressSessionHref } from "../performance/timeline/timeline-test-helpers"

const source = fixture.sourceID
const target = fixture.targetID
const answer = (id: string) => `[data-timeline-part-id="msg_${id}_assistant:text:0"]`
const homeRow = `[data-component="home-session-row-container"][data-session-id="${target}"] [data-component="home-session-row"]`

test("closing the last tab releases the transcript and reopening reads the latest page", async ({ page }) => {
  const mock = await setup(page)
  await page.goto(stressSessionHref(source))
  await expectSessionTitle(page, fixture.expected.sourceTitle)
  await expect(page.locator(answer(source))).toContainText(mock.state.text)
  await selectTab(page, target, fixture.expected.targetTitle)
  await expect(page.locator(answer(target))).toContainText(mock.state.text)
  await selectTab(page, source, fixture.expected.sourceTitle)

  await closeTab(page, target)
  mock.state.text = "Latest fixture answer after reopening"
  await reopenFromHome(page)
  await expect(page.locator(answer(target))).toContainText(mock.state.text)
  expect(mock.reads.filter((id) => id === target)).toHaveLength(2)
  expect(mock.inboxReads.filter((id) => id === target)).toHaveLength(2)
  expect(mock.reads.filter((id) => id === source)).toHaveLength(1)
  expect(mock.mutations).toEqual([])
  expect(mock.errors).toEqual([])
})

test("a transcript read still in flight when its tab closes cannot repopulate the released session", async ({
  page,
}) => {
  const releases: PromiseWithResolvers<void>[] = []
  const mock = await setup(page, {
    gate: (sessionID) => {
      if (sessionID !== target) return Promise.resolve()
      const release = Promise.withResolvers<void>()
      releases.push(release)
      return release.promise
    },
  })
  await page.goto(stressSessionHref(source))
  await expectSessionTitle(page, fixture.expected.sourceTitle)
  await expect(page.locator(answer(source))).toContainText(mock.state.text)

  await page.locator(tabLink(target)).click()
  await expectSessionTitle(page, fixture.expected.targetTitle)
  await expect.poll(() => releases.length).toBe(1)
  // Close the tab while its first page is still loading. Closing the active tab returns to the other one.
  const response = page.waitForResponse(
    (response) => new URL(response.url()).pathname === `/api/session/${target}/message`,
  )
  await closeTab(page, target)
  await expectSessionTitle(page, fixture.expected.sourceTitle)
  releases[0].resolve()
  await response

  mock.state.text = "Latest fixture answer after the late read"
  await reopenFromHome(page)
  await expect.poll(() => releases.length).toBe(2)
  // The released session must not show the late page while its fresh read is still pending.
  await expect(page.locator(`[data-message-id="msg_${target}_assistant"]`)).toHaveCount(0)
  releases[1].resolve()
  await expect(page.locator(answer(target))).toContainText(mock.state.text)
  expect(mock.mutations).toEqual([])
  expect(mock.errors).toEqual([])
})

test("an unacknowledged prompt survives closing its tab and is still shown on reopen", async ({ page }) => {
  const mock = await setup(page)
  const release = Promise.withResolvers<void>()
  await page.route(`**/api/session/${target}/prompt`, async (route) => {
    await release.promise
    await route.fallback()
  })
  await page.goto(stressSessionHref(source))
  await expectSessionTitle(page, fixture.expected.sourceTitle)
  await selectTab(page, target, fixture.expected.targetTitle)
  await expect(page.locator(answer(target))).toContainText(mock.state.text)

  const input = page.locator('[data-component="composer"] [data-component="composer-editor"]')
  await expect(input).toBeEditable()
  const prompt = "Keep this prompt after the tab closes"
  await input.fill(prompt)
  await input.press("Enter")
  await expect(page.locator("[data-message-id]").filter({ hasText: prompt })).toHaveCount(1)
  await closeTab(page, target)
  await expectSessionTitle(page, fixture.expected.sourceTitle)
  release.resolve()
  await expect.poll(() => mock.prompts.length).toBe(1)

  await reopenFromHome(page)
  await expect(page.locator(answer(target))).toContainText(mock.state.text)
  await expect(page.locator("[data-message-id]").filter({ hasText: prompt })).toHaveCount(1)
  expect(mock.prompts).toHaveLength(1)
  expect(mock.errors).toEqual([])
})

async function setup(page: Page, options?: { gate?: (sessionID: string) => Promise<void> }) {
  const state = { text: "Original fixture answer" }
  const reads: string[] = []
  const inboxReads: string[] = []
  const mutations: string[] = []
  const prompts: string[] = []
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  page.on("response", (response) => {
    if (new URL(response.url()).pathname.startsWith("/api/") && !response.ok())
      errors.push(`HTTP ${response.status()}: ${response.url()}`)
  })
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname
    if (request.method() === "DELETE" || /\/(interrupt|prompt)$/.test(path)) mutations.push(path)
    const inbox = path.match(/^\/api\/session\/([^/]+)\/inbox$/)
    if (request.method() === "GET" && inbox) inboxReads.push(inbox[1])
  })
  await mockOpenCodeServer(page, {
    ...fixture,
    pageMessages: (id) => ({
      items: [
        { id: `msg_${id}_user`, type: "user", text: "Review the renderer change", time: { created: 1 } },
        {
          id: `msg_${id}_assistant`,
          type: "assistant",
          agent: "build",
          model: { id: "claude-opus-4-6", providerID: "opencode" },
          content: [{ type: "text", text: state.text }],
          time: { created: 2, completed: 3 },
        },
      ],
    }),
    beforeMessagesResponse: options?.gate ? ({ sessionID }) => options.gate!(sessionID) : undefined,
    onMessages: ({ sessionID, phase }) => {
      if (phase === "start") reads.push(sessionID)
    },
    onPrompt: ({ sessionID }) => prompts.push(sessionID),
  })
  await installStressSessionTabs(page, { sessionIDs: [source, target] })
  return { state, reads, inboxReads, mutations, prompts, errors }
}

function tabLink(id: string) {
  return `[data-slot="titlebar-tabs"] a[href="${stressSessionHref(id)}"]`
}

async function selectTab(page: Page, id: string, title: string) {
  await page.locator(tabLink(id)).click()
  await expectSessionTitle(page, title)
}

async function closeTab(page: Page, id: string) {
  const tab = page
    .locator("[data-titlebar-tab-slot]")
    .filter({ has: page.locator(`a[href="${stressSessionHref(id)}"]`) })
  await tab.getByRole("button", { name: "Close tab", exact: true }).click()
  await expect(tab).toHaveCount(0)
}

async function reopenFromHome(page: Page) {
  await page.getByRole("button", { name: "Home", exact: true }).click()
  await expect(page.locator(homeRow)).toBeVisible()
  await page.locator(homeRow).click()
  await expectSessionTitle(page, fixture.expected.targetTitle)
}
