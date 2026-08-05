import { expect, test, type Page } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectAppVisible, expectSessionTitle } from "../utils/waits"
import {
  analyzeVisualObservations,
  defineVisualRegions,
  startVisualProbe,
  stopVisualProbe,
  visualPlan,
} from "../utils/visual-stability"

const directory = "C:/OpenCode/ContextResizeRegression"
const projectID = "proj_context_resize_regression"
const sessionID = "ses_context_resize_regression"
const title = "Context resize regression"
const model = { providerID: "opencode", modelID: "claude-opus-4-6", variant: "max" }
const contextIDs = ["prt_0100_read", "prt_0101_glob", "prt_0102_grep", "prt_0103_list"]
const followingTextID = "prt_0104_text"

type Message = {
  info: Record<string, unknown> & { id: string; role: "user" | "assistant" }
  parts: Record<string, unknown>[]
}

const messages = [...Array.from({ length: 8 }, (_, index) => turn(index, false)).flat(), ...turn(10, true)]

test.describe("regression: session timeline context group resize", () => {
  test("remeasures a recent explored context group before the next paint", async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 })
    await mockServer(page)
    await configurePage(page)

    await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
    await expectSessionTitle(page, title)
    await expectAppVisible(page.locator(`[data-timeline-part-ids="${contextIDs.join(",")}"]`).first())
    await expectAppVisible(page.locator(`[data-timeline-part-id="${followingTextID}"]`).first())
    await settle(page)

    const samples = await sampleExpansion(page)
    const visibleOverlap = samples.filter((sample) => sample.frame >= 1 && sample.overlap > 0.5)

    expect(samples[0]?.overlap).toBe(0)
    expect(visibleOverlap).toEqual([])
    expect(samples.at(-1)?.expanded).toBe("true")
  })

  test("paints a stable exploring to explored transition", async ({ page }) => {
    const events: { directory: string; payload: Record<string, unknown> }[] = []
    await page.setViewportSize({ width: 1400, height: 900 })
    await mockServer(page, events, [
      ...Array.from({ length: 8 }, (_, index) => turn(index, false)).flat(),
      ...turn(10, true, "running"),
    ])
    await configurePage(page)

    await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
    await expectSessionTitle(page, title)
    const devtools = await page.context().newCDPSession(page)
    await devtools.send("Emulation.setCPUThrottlingRate", { rate: 4 })
    const context = page.locator(`[data-timeline-part-ids="${contextIDs.join(",")}"]`).first()
    await expectAppVisible(context)
    await expect(context.locator('[data-component="tool-status-title"]')).toHaveAttribute("aria-label", "Exploring")

    const contextSelector = `[data-timeline-part-ids="${contextIDs.join(",")}"]`
    const regions = defineVisualRegions({
      status: {
        selector: `${contextSelector} [data-component="tool-status-title"]`,
        opacitySelectors: ['[data-slot="tool-status-active"]', '[data-slot="tool-status-done"]'],
      },
      context: { selector: contextSelector, closest: '[data-timeline-row="AssistantPart"]' },
      following: {
        selector: `[data-timeline-part-id="${followingTextID}"]`,
        closest: '[data-timeline-row="AssistantPart"]',
      },
    })
    await startVisualProbe(page, regions)
    for (const [index, delay] of [120, 350, 80, 500].entries()) {
      events.push({
        directory,
        payload: {
          type: "message.part.updated",
          properties: {
            part: contextTool(
              contextIDs[index]!,
              id("msg_assistant", 10),
              ["read", "glob", "grep", "list"][index]!,
              [
                { filePath: "src/recent-a.ts" },
                { path: directory, pattern: "**/*.ts" },
                { path: directory, pattern: "Explored" },
                { path: "src" },
              ][index]!,
            ),
          },
        },
      })
      await page.waitForTimeout(delay)
    }

    await expect(context.locator('[data-component="tool-status-title"]')).toHaveAttribute("aria-label", "Explored")
    await page.waitForTimeout(700)
    const trace = await stopVisualProbe<keyof typeof regions>(page)
    const labels = trace.samples
      .map((sample) => sample.regions.status?.label)
      .filter((value): value is string => !!value)
      .filter((value, index, all) => value !== all[index - 1])
    const issues = analyzeVisualObservations(
      trace.samples,
      visualPlan(regions, [
        { type: "required", regions: ["context", "following"] },
        { type: "opacity", regions: "all" },
        { type: "continuity", regions: "all" },
        { type: "motion", regions: "all" },
        { type: "label-stability", regions: "all" },
        { type: "flow", regions: ["context", "following"] },
      ]),
    )

    expect(labels).toEqual(["Exploring", "Explored"])
    expect(issues, JSON.stringify(trace.samples, null, 2)).toEqual([])
  })
})

async function configurePage(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      "settings.v3",
      JSON.stringify({
        general: {
          editToolPartsExpanded: true,
          shellToolPartsExpanded: true,
          showReasoningSummaries: true,
        },
      }),
    )
  })
}

async function sampleExpansion(page: Page) {
  return page.evaluate(
    ({ contextIDs, followingTextID }) =>
      new Promise<
        {
          frame: number
          label: string
          scrollTop: number
          scrollHeight: number
          contextBottom: number
          textTop: number
          overlap: number
          gap: number
          expanded: string | null
        }[]
      >((resolve) => {
        const context = document.querySelector<HTMLElement>(`[data-timeline-part-ids="${contextIDs.join(",")}"]`)
        const text = document.querySelector<HTMLElement>(`[data-timeline-part-id="${followingTextID}"]`)
        const scroller = context?.closest<HTMLElement>(".scroll-view__viewport")
        const trigger = context?.querySelector<HTMLElement>('[data-slot="collapsible-trigger"]')
        const contextRow = context?.closest<HTMLElement>('[data-timeline-row="AssistantPart"]')
        const textRow = text?.closest<HTMLElement>('[data-timeline-row="AssistantPart"]')
        if (!context || !text || !scroller || !trigger || !contextRow || !textRow)
          throw new Error("missing regression nodes")

        scroller.scrollTop = scroller.scrollHeight
        const samples: {
          frame: number
          label: string
          scrollTop: number
          scrollHeight: number
          contextBottom: number
          textTop: number
          overlap: number
          gap: number
          expanded: string | null
        }[] = []
        const capture = (frame: number, label: string) => {
          const contextRect = contextRow.getBoundingClientRect()
          const textRect = textRow.getBoundingClientRect()
          samples.push({
            frame,
            label,
            scrollTop: Math.round(scroller.scrollTop * 10) / 10,
            scrollHeight: Math.round(scroller.scrollHeight * 10) / 10,
            contextBottom: Math.round(contextRect.bottom * 10) / 10,
            textTop: Math.round(textRect.top * 10) / 10,
            overlap: Math.max(0, Math.round((contextRect.bottom - textRect.top) * 10) / 10),
            gap: Math.max(0, Math.round((textRect.top - contextRect.bottom) * 10) / 10),
            expanded: trigger.getAttribute("aria-expanded"),
          })
        }

        capture(-1, "before")
        trigger.click()
        capture(0, "sync-after-click")

        let frame = 1
        const tick = () => {
          setTimeout(() => {
            capture(frame, "painted")
            frame += 1
            if (frame > 8) {
              resolve(samples)
              return
            }
            requestAnimationFrame(tick)
          }, 0)
        }
        requestAnimationFrame(tick)
      }),
    { contextIDs, followingTextID },
  )
}

function turn(index: number, target: boolean, status: "running" | "completed" = "completed"): Message[] {
  const userID = id("msg_user", index)
  const assistantID = id("msg_assistant", index)
  return [
    {
      info: {
        id: userID,
        sessionID,
        role: "user",
        time: { created: 1700000000000 + index * 10_000 },
        summary: { diffs: [] },
        agent: "build",
        model,
      },
      parts: [{ id: id("prt_user", index), sessionID, messageID: userID, type: "text", text: `User message ${index}` }],
    },
    {
      info: {
        id: assistantID,
        sessionID,
        role: "assistant",
        time: { created: 1700000000000 + index * 10_000 + 1_000, completed: 1700000000000 + index * 10_000 + 2_000 },
        parentID: userID,
        modelID: model.modelID,
        providerID: model.providerID,
        mode: "build",
        agent: "build",
        path: { cwd: directory, root: directory },
        cost: 0.01,
        tokens: { input: 100, output: 200, reasoning: 0, cache: { read: 0, write: 0 } },
        variant: "max",
        finish: "stop",
      },
      parts: target
        ? [
            contextTool(
              contextIDs[0]!,
              assistantID,
              "read",
              { filePath: "src/recent-a.ts", offset: 0, limit: 120 },
              status,
            ),
            contextTool(contextIDs[1]!, assistantID, "glob", { path: directory, pattern: "**/*.ts" }, status),
            contextTool(
              contextIDs[2]!,
              assistantID,
              "grep",
              { path: directory, pattern: "Explored", include: "*.ts" },
              status,
            ),
            contextTool(contextIDs[3]!, assistantID, "list", { path: "src" }, status),
            {
              id: followingTextID,
              sessionID,
              messageID: assistantID,
              type: "text",
              text: "This assistant text is immediately after the explored context group.",
            },
          ]
        : [
            {
              id: id("prt_text", index),
              sessionID,
              messageID: assistantID,
              type: "text",
              text: `Assistant filler ${index}. ${"filler ".repeat(60)}`,
            },
          ],
    },
  ]
}

function contextTool(
  partID: string,
  messageID: string,
  tool: string,
  input: Record<string, unknown>,
  status: "running" | "completed" = "completed",
) {
  return {
    id: partID,
    sessionID,
    messageID,
    type: "tool",
    callID: `call_${partID}`,
    tool,
    state: {
      status,
      input,
      output: `Completed ${tool}.\n${"detail line\n".repeat(8)}`,
      title: input.filePath || input.path || input.pattern || "completed",
      metadata: {},
      time: { start: 1700000000000, end: 1700000000100 },
    },
  }
}

async function mockServer(
  page: Page,
  events: { directory: string; payload: Record<string, unknown> }[] = [],
  fixtureMessages = messages,
) {
  await mockOpenCodeServer(page, {
    directory,
    project: project(),
    provider: provider(),
    sessions: [session()],
    pageMessages: () => ({ items: fixtureMessages }),
    events: () => events.splice(0, 1),
    eventRetry: 50,
  })
}

async function settle(page: Page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
}

function id(prefix: string, index: number) {
  return `${prefix}_${String(index).padStart(4, "0")}`
}

function project() {
  return {
    id: projectID,
    worktree: directory,
    vcs: "git",
    name: "context-resize-regression",
    time: { created: 1700000000000, updated: 1700000000000 },
    sandboxes: [],
  }
}

function session() {
  return {
    id: sessionID,
    slug: "context-resize-regression",
    projectID,
    directory,
    title,
    version: "dev",
    time: { created: 1700000000000, updated: 1700000000000 },
  }
}

function provider() {
  return {
    all: [
      {
        id: "opencode",
        name: "OpenCode",
        models: { "claude-opus-4-6": { id: "claude-opus-4-6", name: "Claude Opus 4.6", limit: { context: 200_000 } } },
      },
    ],
    connected: ["opencode"],
    default: { providerID: "opencode", modelID: "claude-opus-4-6" },
  }
}

function base64Encode(value: string) {
  return Buffer.from(value, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")
}
