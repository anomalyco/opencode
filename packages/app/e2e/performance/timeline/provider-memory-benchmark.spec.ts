import { benchmark, expect } from "../benchmark"
import { mockOpenCodeServer } from "../../utils/mock-server"
import { expectSessionTitle } from "../../utils/waits"
import { fixture, pageMessages } from "./session-timeline-stress.fixture"
import { installStressSessionTabs, installTimelineSettings, stressSessionHref } from "./timeline-test-helpers"
import { waitForStableTimeline } from "./session-tab-switch-probe"
import type { CatalogUpdated } from "@opencode-ai/client/promise"

benchmark("measures retained renderer memory with a large model catalog", async ({ page, report }) => {
  benchmark.setTimeout(120_000)
  const count = Number(process.env.PROVIDER_MEMORY_MODELS ?? 1200)
  const switches = Number(process.env.PROVIDER_MEMORY_SWITCHES ?? 10)
  const provider = fixture.provider.all[0]
  const selected = { ...provider.models["claude-opus-4-6"] }
  await mockOpenCodeServer(page, {
    directory: fixture.directory,
    project: fixture.project,
    sessions: fixture.sessions,
    pageMessages,
    provider: {
      ...fixture.provider,
      all: [
        {
          ...provider,
          models: {
            [selected.id]: selected,
            ...Object.fromEntries(
              Array.from({ length: count - 1 }, (_, index) => {
                const id = `catalog-model-${index}`
                return [
                  id,
                  {
                    id,
                    name: `Catalog model ${index}`,
                    cost: { input: 1, output: 2 },
                    limit: { context: 200_000, output: 8192 },
                    variants: { high: { reasoningEffort: "high" } },
                  },
                ]
              }),
            ),
          },
        },
      ],
    },
  })
  await installTimelineSettings(page)
  await installStressSessionTabs(page)
  await page.goto(stressSessionHref(fixture.sourceID))
  await expectSessionTitle(page, fixture.expected.sourceTitle)
  await waitForStableTimeline(page, fixture.expected.sourceMessageIDs.at(-1)!)
  await expect(page.locator('[data-action="composer-model"]')).toContainText("Claude Opus 4.6")
  const cdp = await page.context().newCDPSession(page)
  const samples = []
  for (let index = 0; index <= switches; index++) {
    if (index > 0) {
      const target = index % 2 === 1
      const id = target ? fixture.targetID : fixture.sourceID
      await page.locator(`[data-slot="titlebar-tabs"] a[href="${stressSessionHref(id)}"]`).click()
      await expectSessionTitle(page, target ? fixture.expected.targetTitle : fixture.expected.sourceTitle)
      await waitForStableTimeline(
        page,
        (target ? fixture.expected.targetMessageIDs : fixture.expected.sourceMessageIDs).at(-1)!,
      )
      await expect(page.locator('[data-action="composer-model"]')).toContainText("Claude Opus 4.6")
    }
    // GC is an explicit retained-heap measurement, not an application optimization or readiness wait.
    await cdp.send("HeapProfiler.collectGarbage")
    samples.push({
      switches: index,
      heap: await cdp.send("Runtime.getHeapUsage"),
      dom: await cdp.send("Memory.getDOMCounters"),
    })
  }
  expect(samples).toHaveLength(switches + 1)
  expect(samples.every((sample) => sample.heap.usedSize > 0)).toBe(true)
  selected.name = "Updated catalog model"
  await page.evaluate(
    (event) => {
      const host = window as Window & { __mockServerStream?: { push: (events: CatalogUpdated[]) => void } }
      if (!host.__mockServerStream) throw new Error("Missing fixture event stream")
      host.__mockServerStream.push([event])
    },
    {
      id: "evt_catalog_refresh",
      created: Date.now(),
      type: "catalog.updated",
      location: { directory: fixture.directory },
      data: {},
    } satisfies CatalogUpdated,
  )
  await expect(page.locator('[data-action="composer-model"]')).toContainText(selected.name)
  report(
    { samples },
    { models: count, switches, gc: "explicit", scope: "renderer main isolate; not total desktop RAM" },
  )
  await cdp.detach()
})
