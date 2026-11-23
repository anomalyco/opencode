// Opening, scrolling and selecting in the desktop model picker with 96 models from 19 providers, at 1440×900.
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

// One large provider and a long tail: 96 models in all.
const providers: ReadonlyArray<{ id: string; models: number }> = [
  { id: "lorem", models: 47 },
  { id: "ipsum", models: 9 },
  { id: "dolor", models: 7 },
  { id: "sit", models: 5 },
  { id: "amet", models: 4 },
  { id: "consectetur", models: 3 },
  { id: "adipiscing", models: 3 },
  { id: "elit", models: 3 },
  { id: "sed", models: 2 },
  { id: "eiusmod", models: 2 },
  { id: "tempor", models: 2 },
  { id: "incididunt", models: 2 },
  { id: "labore", models: 1 },
  { id: "dolore", models: 1 },
  { id: "magna", models: 1 },
  { id: "aliqua", models: 1 },
  { id: "enim", models: 1 },
  { id: "minim", models: 1 },
  { id: "veniam", models: 1 },
]

const title = (id: string) => id[0].toUpperCase() + id.slice(1)

// Every model has three variants, so each row's flyout lists them.
function catalog(): MockProviderCatalog {
  return {
    all: providers.map((provider) => ({
      id: provider.id,
      name: title(provider.id),
      models: Object.fromEntries(
        Array.from({ length: provider.models }, (_, index) => {
          const id = `${provider.id}-${index + 1}`

          return [
            id,
            {
              id,
              name: `${title(provider.id)} ${index + 1}`,
              cost: { input: 2, output: 10 },
              limit: { context: 200_000, output: 32_000 },
              variants: { low: {}, medium: {}, high: {} },
              // A release date of 0 reads as none, so the picker lists every model, not only each family's newest.
              time: { released: 0 },
            },
          ]
        }),
      ),
    })),
    connected: providers.map((provider) => provider.id),
    default: { providerID: "lorem", modelID: "lorem-1" },
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
          provider: catalog(),
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
