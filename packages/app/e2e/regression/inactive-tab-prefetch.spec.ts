import { expect, test } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectSessionTitle } from "../utils/waits"
import { fixture } from "../performance/timeline/session-timeline-stress.fixture"
import { installStressSessionTabs, stressSessionHref } from "../performance/timeline/timeline-test-helpers"

test("inactive tabs load attention, but read transcript and inbox only on selection", async ({ page }) => {
  const reads: string[] = []
  const mutations: string[] = []
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  page.on("response", (response) => {
    if (new URL(response.url()).pathname.startsWith("/api/") && !response.ok())
      errors.push(`HTTP ${response.status()}: ${response.url()}`)
  })
  const state = { text: "Original fixture answer" }
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname
    if (!path.startsWith("/api/")) return
    if (request.method() === "GET") reads.push(path)
    if (request.method() === "DELETE" || /\/(interrupt|prompt)$/.test(path)) mutations.push(path)
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
  })
  await installStressSessionTabs(page, { sessionIDs: [fixture.sourceID, fixture.targetID, fixture.childID] })
  const attention = Promise.all(
    [fixture.targetID, fixture.childID].flatMap((id) =>
      ["permission", "form"].map((kind) =>
        page.waitForResponse((response) => new URL(response.url()).pathname === `/api/session/${id}/${kind}`),
      ),
    ),
  )
  await page.goto(stressSessionHref(fixture.sourceID))
  await expectSessionTitle(page, fixture.expected.sourceTitle)
  await expect(page.locator(`[data-timeline-part-id="msg_${fixture.sourceID}_assistant:text:0"]`)).toContainText(
    state.text,
  )
  await attention
  const child = page
    .locator("[data-titlebar-tab-slot]")
    .filter({ has: page.locator(`a[href="${stressSessionHref(fixture.childID)}"]`) })
  await child.getByRole("button", { name: "Close tab", exact: true }).click()
  await expect(child).toHaveCount(0)
  state.text = "Latest fixture answer after tab restoration"
  await page.locator(`[data-slot="titlebar-tabs"] a[href="${stressSessionHref(fixture.targetID)}"]`).click()
  await expectSessionTitle(page, fixture.expected.targetTitle)
  await expect(page.locator(`[data-timeline-part-id="msg_${fixture.targetID}_assistant:text:0"]`)).toContainText(
    state.text,
  )
  for (const id of [fixture.sourceID, fixture.targetID]) {
    expect(reads.filter((path) => path === `/api/session/${id}/message`)).toHaveLength(1)
    expect(reads.filter((path) => path === `/api/session/${id}/inbox`)).toHaveLength(1)
  }
  expect(
    reads.filter(
      (path) => path === `/api/session/${fixture.childID}/message` || path === `/api/session/${fixture.childID}/inbox`,
    ),
  ).toEqual([])
  expect(mutations).toEqual([])
  expect(errors).toEqual([])
})
