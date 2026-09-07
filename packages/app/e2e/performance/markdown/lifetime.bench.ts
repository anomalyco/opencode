import type { SessionMessageInfo } from "@opencode-ai/client/promise"
import { benchmark, expect } from "../benchmark"
import { mockOpenCodeServer } from "../../utils/mock-server"
import { fixture } from "../timeline/session-timeline-stress.fixture"
import { installStressSessionTabs, installTimelineSettings, stressSessionHref } from "../timeline/timeline-test-helpers"
import { completedAnswer } from "../../../../session-ui/performance/markdown-lifetime/answer"
import { installMarkdownGate } from "./probe"

for (const size of ["typical", "large"]) {
  benchmark(`timeline preload disposal: ${size}`, async ({ page, report }) => {
    const answer = completedAnswer(size === "typical" ? 2 : 36)
    const errors: string[] = []
    page.on("pageerror", (error) => errors.push(error.message))
    const messages: Record<string, SessionMessageInfo[]> = Object.fromEntries(
      [fixture.sourceID, fixture.targetID].map((id) => [
        id,
        [
          {
            id: `msg_1_${id}_user`,
            type: "user",
            time: { created: 1700000000000 },
            text: "Review the recovery boundary.",
          },
          {
            id: `msg_2_${id}_assistant`,
            type: "assistant",
            time: { created: 1700000001000, completed: 1700000008000 },
            model: { id: "claude-opus-4-6", providerID: "opencode" },
            agent: "build",
            cost: 0.01,
            tokens: { input: 100, output: 200, reasoning: 0, cache: { read: 0, write: 0 } },
            finish: "stop",
            content: [
              {
                type: "text",
                text:
                  id === fixture.targetID
                    ? answer
                    : "## Current destination\n\nThe selected session is ready.\n\n```typescript\nconst current = { ready: true }\n```",
              },
            ],
          },
        ] satisfies SessionMessageInfo[],
      ]),
    )
    await mockOpenCodeServer(page, {
      sessions: fixture.sessions.filter((session) => session.id !== fixture.childID),
      provider: fixture.provider,
      directory: fixture.directory,
      project: fixture.project,
      pageMessages: (id) => ({ items: messages[id] ?? [] }),
    })
    await installTimelineSettings(page)
    await installStressSessionTabs(page)
    const targetPart = `msg_2_${fixture.targetID}_assistant:text:0`
    const sourcePart = `msg_2_${fixture.sourceID}_assistant:text:0`
    await installMarkdownGate(page, { answer, targetPart, sourcePart, href: stressSessionHref(fixture.sourceID) })
    const prefetched = page.waitForResponse((response) =>
      new URL(response.url()).pathname.endsWith(`/session/${fixture.targetID}/message`),
    )
    await page.goto(stressSessionHref(fixture.sourceID))
    await prefetched
    const source = page.locator(`[data-timeline-part-id="${sourcePart}"] [data-component="markdown"]`)
    await expect(source).toHaveAttribute("data-markdown-ready", "")
    await page.locator(`[data-slot="titlebar-tabs"] a[href="${stressSessionHref(fixture.targetID)}"]`).click()
    await page.waitForFunction(() => Reflect.get(window, "markdownGate").held)
    await expect(page.locator(`[data-timeline-part-id="${targetPart}"]`)).toBeAttached()
    const cdp = await page.context().newCDPSession(page)
    await cdp.send("Performance.enable")
    const before = await cdp.send("Performance.getMetrics")
    await page.evaluate(() => Reflect.get(window, "markdownGate").arm())
    await page.locator(`[data-slot="titlebar-tabs"] a[href="${stressSessionHref(fixture.sourceID)}"]`).click()
    await expect(source).toHaveAttribute("data-markdown-ready", "")
    await expect(source.getByRole("heading", { name: "Current destination" })).toBeVisible()
    await expect(page.locator(`[data-timeline-part-id="${targetPart}"]`)).toHaveCount(0)
    await page.waitForFunction(() => Reflect.get(window, "markdownGate").settled > 0)
    const after = await cdp.send("Performance.getMetrics")
    const stats = await page.evaluate(() => {
      const value = Reflect.get(window, "markdownGate")
      return {
        admitted: value.admitted,
        responses: value.responses,
        started: value.started,
        ready: value.ready,
        released: value.released,
        settled: value.settled,
        sanitizeCalls: value.sanitizeCalls,
        sanitizeChars: value.sanitizeChars,
      }
    })
    expect(stats.admitted).toBe(1)
    expect(stats.responses).toBe(1)
    expect(stats.ready).toBeGreaterThan(stats.started)
    expect(stats.settled).toBeGreaterThan(stats.released)
    expect(errors).toEqual([])
    if (process.env.MARKDOWN_ASSERT_DISPOSAL === "1") expect(stats.sanitizeCalls).toBe(0)
    const value = (data: typeof after, name: string) => data.metrics.find((item) => item.name === name)!.value
    const retained = process.env.MARKDOWN_RETAINED === "1"
    if (retained) await cdp.send("HeapProfiler.collectGarbage")
    report(
      {
        ...stats,
        destinationReadyMs: stats.ready - stats.started,
        releasedSettledMs: stats.settled - stats.released,
        taskMs: (value(after, "TaskDuration") - value(before, "TaskDuration")) * 1000,
        scriptMs: (value(after, "ScriptDuration") - value(before, "ScriptDuration")) * 1000,
        usedHeapBytes: (await cdp.send("Runtime.getHeapUsage")).usedSize,
      },
      {
        size,
        retained,
        answerBytes: Buffer.byteLength(answer),
        messagesPerSession: 2,
        partsPerAnswer: 1,
        fences: size === "typical" ? 2 : 36,
        browser: page.context().browser()!.version(),
        transport: "playwright-route",
        build: process.env.MARKDOWN_APP_BUILD_DIR,
      },
    )
    if (process.env.MARKDOWN_SCREENSHOT)
      await page.screenshot({ path: `${process.env.MARKDOWN_SCREENSHOT}/timeline-${size}.png` })
    await cdp.detach()
  })
}
