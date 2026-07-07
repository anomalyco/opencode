import type { Page } from "@playwright/test"
import { expectSessionTitle } from "../../utils/waits"
import { mockOpenCodeServer } from "../../utils/mock-server"
import { benchmark, expect, withBenchmarkPage } from "../benchmark"
import { fixture } from "./session-timeline-stress.fixture"
import { installStressSessionTabs, stressSessionHref } from "./timeline-test-helpers"
import { measureSessionSwitch, waitForStableTimeline } from "./session-tab-switch-probe"

type ParentHydrationBenchmarkMode = "natural" | "candidate"

const mode = process.env.SESSION_PARENT_HYDRATION_BENCHMARK_MODE ?? "natural"
if (mode !== "natural" && mode !== "candidate") throw new Error(`Unknown parent hydration benchmark mode: ${mode}`)
const userID = "msg_parent_hydration_user"
const user = {
  ...fixture.messages[fixture.targetID][0]!,
  info: { ...fixture.messages[fixture.targetID][0]!.info, id: userID, time: { created: 1700001000000 } },
  parts: fixture.messages[fixture.targetID][0]!.parts.map((part, index) => ({
    ...part,
    id: `prt_parent_hydration_user_${index}`,
    messageID: userID,
  })),
}
const assistantSeed = fixture.messages[fixture.targetID][3]!
const assistants = Array.from({ length: 14 }, (_, index) => {
  const messageID = `msg_parent_hydration_${String(index).padStart(2, "0")}`
  return {
    ...assistantSeed,
    info: {
      ...assistantSeed.info,
      id: messageID,
      parentID: userID,
      time: { created: 1700001001000 + index * 1_000, completed: 1700001001500 + index * 1_000 },
    },
    parts: assistantSeed.parts.map((part, partIndex) => ({
      ...part,
      id: `prt_parent_hydration_${String(index).padStart(2, "0")}_${partIndex}`,
      messageID,
    })),
  }
})
const messages = [user, ...assistants]
const target = fixture.sessions.find((session) => session.id === fixture.targetID)!
const lastID = userID
const lastPartID = assistants.at(-1)!.parts.at(-1)!.id

benchmark("hydrates an orphaned latest turn after a cold session click", async ({ browser, report }, testInfo) => {
  benchmark.setTimeout(180_000)
  const results = [] as Awaited<ReturnType<typeof trial>>[]
  for (let run = 0; run < 5; run++) {
    results.push(
      await withBenchmarkPage(
        browser,
        `session-parent-hydration-${mode}-${run}`,
        (page) => trial(page, mode),
        testInfo,
      ),
    )
  }
  const timing = results.map((result) => result.metrics.firstCorrectObservedMs!).sort((a, b) => a - b)
  report(
    {
      results: results.map((result) => ({ ...result.metrics, historyGateCount: result.historyGateCount })),
      summary: {
        firstCorrectObservedMs: { min: timing[0], median: timing[2], max: timing.at(-1) },
        blankSamples: results.map((result) => result.metrics.blankSamples),
        requestCounts: {
          list: results.map((result) => result.requestCounts.list),
          parent: results.map((result) => result.requestCounts.parent),
        },
        historyGateCount: results.map((result) => result.historyGateCount),
      },
    },
    { mode },
  )
})

async function trial(page: Page, mode: ParentHydrationBenchmarkMode) {
  const requests: { type: "list" | "parent"; before?: string }[] = []
  const history = mode === "candidate" ? Promise.withResolvers<void>() : undefined
  let historyGates = 0
  await mockOpenCodeServer(page, {
    sessions: fixture.sessions.filter((session) => session.id === fixture.sourceID),
    provider: fixture.provider,
    directory: fixture.directory,
    project: fixture.project,
    messageDelay: 50,
    onMessages: (request) => {
      if (request.sessionID === fixture.targetID && request.phase === "start")
        requests.push({ type: "list", before: request.before })
    },
    beforeMessagesResponse: (request) => {
      if (mode !== "candidate" || request.sessionID !== fixture.targetID || !request.before) return Promise.resolve()
      historyGates++
      return history!.promise
    },
    onMessage: (request) => {
      if (request.sessionID === fixture.targetID && request.messageID === userID) requests.push({ type: "parent" })
    },
    message: (sessionID, messageID) => {
      if (sessionID !== fixture.targetID || messageID !== userID) return
      return user
    },
    pageMessages: (sessionID, limit, before) => {
      const items = sessionID === fixture.targetID ? messages : fixture.messages[fixture.sourceID]
      const end = before ? items.findIndex((message) => message.info.id === before) : items.length
      const start = Math.max(0, end - limit)
      return { items: items.slice(start, end), cursor: start > 0 ? items[start]!.info.id : undefined }
    },
  })
  await page.route(`**/session/${fixture.targetID}`, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(target) }),
  )
  await installStressSessionTabs(page, { sessionIDs: [fixture.sourceID] })
  await page.goto(stressSessionHref(fixture.sourceID))
  await expectSessionTitle(page, fixture.expected.sourceTitle)
  await waitForStableTimeline(page, fixture.expected.sourceMessageIDs.at(-1)!)

  const href = stressSessionHref(fixture.targetID)
  await page.evaluate(
    ({ href, title }) => {
      const link = document.createElement("a")
      link.id = "parent-hydration-target"
      link.href = href
      link.textContent = title
      document.body.append(link)
    },
    { href, title: target.title },
  )
  const metrics = await measureSessionSwitch(page, {
    destinationIDs: messages.map((message) => message.info.id),
    sourceIDs: fixture.messages[fixture.sourceID].map((message) => message.info.id),
    lastID,
    requiredPartID: lastPartID,
    requireBottomAnchor: false,
    href,
    switch: async () => {
      await page.locator("#parent-hydration-target").click()
      await expectSessionTitle(page, target.title)
    },
  }).finally(() => history?.resolve())
  expect(metrics.firstCorrectObservedMs).not.toBeNull()
  const requestCounts = {
    list: requests.filter((request) => request.type === "list").length,
    parent: requests.filter((request) => request.type === "parent").length,
  }
  if (mode === "candidate") {
    expect(requestCounts.parent).toBe(1)
    expect(historyGates).toBe(1)
  }
  return { metrics, requestCounts, historyGateCount: historyGates }
}
