// Opening, scrolling, and selecting in the desktop model picker with a ~100-model, 19-provider catalog (matching a
// signed-in Console workspace with multiple connected providers), at 1440×900.
import { bench, web, type Case } from "@hona/strobe"
import { draftHref } from "../e2e/utils/app"
import { mockOpenCodeServer, type MockProviderCatalog } from "../e2e/utils/mock-server"
import { fixture } from "../e2e/utils/session-fixture"
import { installProjects } from "./fixtures/home"
import { cached } from "./fixtures/mock"
import { installTabs } from "./fixtures/tabs"

const draftID = "draft_perf_model_picker"

const composer = '[data-component="new-session"] [data-component="composer-editor"][contenteditable="true"]'

const trigger = '[data-component="new-session"] [data-action="composer-model"]'

const row = '[data-slot="search-list-row"]'

const scroller = '[data-slot="search-list-scroll"]'

const providerSpecs: ReadonlyArray<{ id: string; name: string; count: number; integrationID?: string }> = [
  { id: "opencode", name: "Anomaly / OpenCode", count: 47, integrationID: "opencode" },
  { id: "console-fireworks-ai", name: "Anomaly / Fireworks AI", count: 9, integrationID: "opencode" },
  { id: "console-openai-test", name: "Anomaly / RITB", count: 7, integrationID: "opencode" },
  { id: "console-google", name: "Anomaly / Google", count: 5, integrationID: "opencode" },
  { id: "claude-agent", name: "Claude Agent", count: 4 },
  { id: "console-meta", name: "Anomaly / Meta", count: 3, integrationID: "opencode" },
  { id: "console-moonshot-ai", name: "Anomaly / Moonshot AI", count: 3, integrationID: "opencode" },
  { id: "console-openai-2", name: "Anomaly / OpenAI", count: 3, integrationID: "opencode" },
  { id: "console-alibaba-qwen-preview", name: "Anomaly / Alibaba Qwen Preview", count: 2, integrationID: "opencode" },
  { id: "console-deepinfra", name: "Anomaly / DeepInfra", count: 2, integrationID: "opencode" },
  { id: "console-deepseek", name: "Anomaly / DeepSeek", count: 2, integrationID: "opencode" },
  { id: "console-humansand", name: "Anomaly / humans&", count: 2, integrationID: "opencode" },
  { id: "console-manhattan-project", name: "Anomaly / Manhattan DeepSeek", count: 1, integrationID: "opencode" },
  { id: "console-manhattan-glm-5-3", name: "Anomaly / Manhattan GLM", count: 1, integrationID: "opencode" },
  { id: "console-microsoft-ai", name: "Anomaly / Microsoft AI", count: 1, integrationID: "opencode" },
  { id: "console-nvidia", name: "Anomaly / NVIDIA", count: 1, integrationID: "opencode" },
  { id: "console-pearl-research", name: "Anomaly / Pareto", count: 1, integrationID: "opencode" },
  { id: "console-radixark", name: "Anomaly / Mirendil", count: 1, integrationID: "opencode" },
  { id: "console-z-ai", name: "Anomaly / Z.AI", count: 1, integrationID: "opencode" },
]

// 96 visible models across 19 providers with 3 variants each.
function realisticCatalog(): MockProviderCatalog {
  const all = providerSpecs.map((spec) => ({
    id: spec.id,
    name: spec.name,
    integrationID: spec.integrationID,
    models: Object.fromEntries(
      Array.from({ length: spec.count }, (_, index) => {
        const id = `${spec.id}-model-${index}`

        return [
          id,
          {
            id,
            name: `${spec.name.replace(/^Anomaly \/ /, "")} Model ${index + 1}`,
            cost: { input: 2, output: 10 },
            limit: { context: 200_000, output: 32_000 },
            variants: { low: {}, medium: {}, high: {} },
            // released: 0 decodes as release_date: "" so every model stays visible instead of collapsing by family.
            time: { released: 0 },
          },
        ]
      }),
    ),
  }))

  return {
    all,
    connected: providerSpecs.map((spec) => spec.id),
    default: { providerID: "opencode", modelID: "opencode-model-0" },
  }
}

const metrics = ["run.duration", "interaction.p95", "main.style", "main.layout", "main.script"]

type Setup = { opened: boolean }

const cases = {
  "open model picker": {
    primary: "main.work",
    metrics,
    async run({ page }) {
      await page.click(trigger, { until: [row, "frame"] })
      await page.idle()
    },
    async reset({ page }) {
      await page.press("Escape")
      await page.idle()
    },
  },
  "scroll model picker": {
    primary: "main.work",
    resetCheck: false,
    metrics: ["run.duration", "main.style", "main.layout", "main.script", "frames.dropped"],
    async run({ page }) {
      await page.scroll(scroller, { by: 1600, speed: 2400 })
      await page.idle()
    },
    async reset({ page }) {
      await page.scroll(scroller, { by: -1600, speed: 4000 })
      await page.idle()
    },
  },
  "select a model": {
    primary: "main.work",
    resetCheck: false,
    metrics,
    async run({ page }) {
      await page.click(`${row} index=3`, { until: "frame" })
      await page.idle()
    },
    async reset({ page }) {
      await page.click(trigger, { until: [row, "frame"] })
      await page.idle()
    },
  },
} satisfies Record<string, Case<{}>>

export default bench({
  setupKey: ({ case: name }): Setup => ({
    opened: name !== "open model picker",
  }),

  targets: {
    web: web<{}, Setup>({
      expect: { title: "OpenCode" },
      viewport: { width: 1440, height: 900 },
      async prepare(ctx) {
        const server = new URL(ctx.url).origin
        const page = cached(ctx)
        await mockOpenCodeServer(page, {
          server,
          sessions: fixture.sessions,
          provider: realisticCatalog(),
          directory: fixture.directory,
          project: fixture.project,
          pageMessages: () => ({ items: [] }),
        })
        await installProjects(page, [fixture.directory])
        await installTabs(page, {
          server,
          directory: fixture.directory,
          sessions: [],
          draft: draftID,
        })

        return { first: draftHref(draftID) }
      },
      url: ({ prepared }) => prepared.first,
    }),
  },

  async setup({ setupKey, page }) {
    await page.waitFor(composer, { timeout: 60_000 })
    await page.waitFor(trigger, { timeout: 60_000 })

    if (setupKey.opened) {
      await page.click(trigger, { until: [row, "frame"] })
      // Verify all 96 models actually rendered in the picker.
      await page.waitFor(`${row} index=95`, { timeout: 10_000 })
    }

    await page.idle()
  },

  cases,
})
