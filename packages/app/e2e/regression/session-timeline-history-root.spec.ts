import { base64Encode } from "@opencode-ai/core/util/encode"
import { expect, test, type Page } from "@playwright/test"
import {
  assistantMessage,
  directory,
  messageUpdated,
  project,
  session,
  sessionID,
  status,
  textPart,
  title,
  userID,
  userMessage,
} from "../performance/timeline-stability/fixture"
import { mockOpenCodeServer } from "../utils/mock-server"
import { installSseTransport } from "../utils/sse-transport"
import { expectSessionTitle } from "../utils/waits"

const assistants = Array.from({ length: 14 }, (_, index) =>
  assistantMessage([textPart(`prt_history_root_${index}`, `Assistant response ${index}`)], {
    id: `msg_${String(index + 1001).padStart(4, "0")}_history_root_assistant`,
    parentID: userID,
    created: 1700000001000 + index * 1_000,
    completed: index < 13,
  }),
)
const messages = [userMessage(), ...assistants]
const lastAssistant = assistants.at(-1)!
const lastPartID = assistants.at(-1)!.parts[0]!.id
const userPartID = `prt_${userID}_text`
const completed = {
  ...lastAssistant.info,
  time: { ...lastAssistant.info.time, completed: lastAssistant.info.time.created + 15_000 },
}
const scenarios = [
  { name: "completion", info: completed, idleFirst: false, interrupted: false },
  {
    name: "interruption",
    info: { ...completed, error: { name: "MessageAbortedError", data: { message: "Stopped" } } },
    idleFirst: true,
    interrupted: true,
  },
] as const

test.use({ viewport: { width: 646, height: 1385 } })

for (const scenario of scenarios) {
  test(`keeps the latest user turn visible through ${scenario.name}`, async ({ page }) => {
    const requests: { before?: string; phase: "start" | "end" }[] = []
    const pages: { before?: string; limit: number }[] = []
    const roots: { sessionID: string; messageID: string }[] = []
    const sequence: string[] = []
    const history = Promise.withResolvers<void>()
    const transport = await installSseTransport<{ directory: string; payload: Record<string, unknown> }>(page, {
      server: `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`,
      retry: 20,
    })
    await mockOpenCodeServer(page, {
      directory,
      project: project(),
      provider: {
        all: [
          {
            id: "opencode",
            name: "OpenCode",
            models: {
              "claude-opus-4-6": {
                id: "claude-opus-4-6",
                name: "Claude Opus 4.6",
                limit: { context: 200_000 },
              },
            },
          },
        ],
        connected: ["opencode"],
        default: { providerID: "opencode", modelID: "claude-opus-4-6" },
      },
      sessions: [session()],
      sessionStatus: { [sessionID]: { type: "busy" } },
      beforeMessagesResponse: (request) => (request.before ? history.promise : Promise.resolve()),
      onMessages: (request) => {
        requests.push(request)
        sequence.push(`messages:${request.phase}:${request.before ?? "latest"}`)
      },
      onMessage: (request) => {
        roots.push(request)
        sequence.push(`message:${request.messageID}`)
      },
      message: (requestedSessionID, messageID) => {
        if (requestedSessionID !== sessionID) return
        return messages.find((item) => item.info.id === messageID)
      },
      pageMessages: (_, limit, before) => {
        pages.push({ before, limit })
        const end = before ? messages.findIndex((message) => message.info.id === before) : messages.length
        const start = Math.max(0, end - limit)
        return {
          items: messages.slice(start, end),
          cursor: start > 0 ? messages[start]!.info.id : undefined,
        }
      },
    })
    await page.addInitScript(
      ({ userPartID, lastPartID }) => {
        const state = { armed: false, hidden: false, samples: 0, stop: false }
        ;(window as Window & { __historyRootProbe?: typeof state }).__historyRootProbe = state
        const sample = () => {
          if (state.armed) {
            const virtual = document.querySelector<HTMLElement>("[data-timeline-virtual-content]")
            const viewport = virtual?.closest<HTMLElement>(".scroll-view__viewport")
            const view = viewport?.getBoundingClientRect()
            const visible = (partID: string) => {
              const part = viewport?.querySelector<HTMLElement>(`[data-timeline-part-id="${partID}"]`)
              const rect = part?.getBoundingClientRect()
              return (
                !!rect &&
                !!view &&
                rect.width > 0 &&
                rect.height > 0 &&
                rect.bottom > view.top &&
                rect.top < view.bottom
              )
            }
            if (!virtual || !visible(userPartID) || !visible(lastPartID)) state.hidden = true
            state.samples++
          }
          if (!state.stop) requestAnimationFrame(() => setTimeout(sample, 0))
        }
        requestAnimationFrame(() => setTimeout(sample, 0))
      },
      { userPartID, lastPartID },
    )

    await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
    await transport.waitForConnection()
    await expectSessionTitle(page, title)
    await expect(page.locator(`[data-timeline-part-id="${lastPartID}"]`)).toBeVisible()
    await expect(page.locator(`[data-timeline-part-id="${userPartID}"]`)).toBeVisible()
    await expect.poll(() => requests.filter((request) => request.phase === "start").length).toBe(2)
    expect(requests.filter((request) => request.phase === "end")).toHaveLength(1)
    expect(sequence.slice(0, 4)).toEqual([
      "messages:start:latest",
      "messages:end:latest",
      `message:${userID}`,
      `messages:start:${messages.at(-2)!.info.id}`,
    ])
    await page.evaluate(() => {
      ;(
        window as Window & {
          __historyRootProbe?: { armed: boolean }
        }
      ).__historyRootProbe!.armed = true
    })
    await waitForProbeSamples(page, 0)
    expect(await historyRootHidden(page)).toBe(false)
    const beforeHistory = await probeSamples(page)
    history.resolve()
    await expect(page.locator('[data-timeline-part-id^="prt_history_root_"]')).toHaveCount(14)
    await expect(page.getByRole("button", { name: "Stop" })).toBeVisible()
    await waitForProbeSamples(page, beforeHistory)
    expect(pages[0]).toEqual({ before: undefined, limit: 2 })
    expect(roots).toEqual([{ sessionID, messageID: userID }])

    const message = messageUpdated(scenario.info)
    const idle = status("idle")
    for (const event of scenario.idleFirst ? [idle, message] : [message, idle]) {
      const beforeEvent = await probeSamples(page)
      await transport.send(event)
      if (event === idle) await expect(page.getByRole("button", { name: "Stop" })).toHaveCount(0)
      if (event === message && scenario.interrupted)
        await expect(page.getByText("Interrupted", { exact: true })).toBeVisible()
      await waitForProbeSamples(page, beforeEvent)
      const current = await timelineState(page)
      expect(current, JSON.stringify(current)).toMatchObject({ virtual: true })
      expect(current.rows, JSON.stringify(current)).toBeGreaterThan(0)
    }

    expect(requests[0]).toEqual({ before: undefined, phase: "start", sessionID })
    expect(requests[1]).toEqual({ before: undefined, phase: "end", sessionID })
    await expect(page.getByRole("button", { name: "Stop" })).toHaveCount(0)
    await expect(page.locator('[data-timeline-row="bottom-spacer"]')).toBeVisible()
    if (scenario.interrupted) await expect(page.getByText("Interrupted", { exact: true })).toBeVisible()
    expect(
      await page.evaluate(() => {
        const state = (window as Window & { __historyRootProbe?: { hidden: boolean; stop: boolean } })
          .__historyRootProbe!
        state.stop = true
        return state.hidden
      }),
    ).toBe(false)
  })
}

function timelineState(page: Page) {
  return page.evaluate(() => ({
    virtual: !!document.querySelector("[data-timeline-virtual-content]"),
    rows: document.querySelectorAll("[data-timeline-key]").length,
  }))
}

function probeSamples(page: Page) {
  return page.evaluate(
    () => (window as Window & { __historyRootProbe?: { samples: number } }).__historyRootProbe!.samples,
  )
}

async function waitForProbeSamples(page: Page, after: number) {
  await page.waitForFunction(
    (after) =>
      (window as Window & { __historyRootProbe?: { samples: number } }).__historyRootProbe!.samples >= after + 3,
    after,
  )
}

function historyRootHidden(page: Page) {
  return page.evaluate(
    () => (window as Window & { __historyRootProbe?: { hidden: boolean } }).__historyRootProbe!.hidden,
  )
}
