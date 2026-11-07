import { bench, web } from "@hona/strobe"
import { mockOpenCodeServer } from "../e2e/utils/mock-server"
import { project, seed } from "../e2e/utils/app"
import { modelCatalog } from "../e2e/utils/model-catalog"
import { cached } from "./fixtures/mock"

const first = '.settings-models [data-slot="settings-row-title"] text=="A Model 000"'
const search = ".settings-tab-header input"

export default bench({
  targets: {
    web: web({
      expect: { title: "OpenCode" },
      viewport: { width: 1280, height: 720 },
      async prepare(ctx) {
        const page = cached(ctx)
        const server = new URL(ctx.url).origin
        await mockOpenCodeServer(page, {
          server,
          directory: "C:/Projects/models",
          project: project({ id: "proj_models", directory: "C:/Projects/models" }),
          provider: modelCatalog(),
          sessions: [],
          pageMessages: () => ({ items: [] }),
        })
        await seed(page, { servers: [server], tabs: [] })
      },
    }),
  },
  async setup(ctx) {
    const { page } = ctx
    await page.goto("/")
    await page.click('button[aria-label="Settings"]', { until: '[data-testid="settings-screen"]' })
    if (ctx.case === "search gateway model settings") await page.click("role=tab text==Models", { until: first })
    await page.idle()
  },
  cases: {
    "open gateway model settings": {
      primary: "main.work",
      async run({ page }) {
        await page.click("role=tab text==Models", { until: first })
        await page.idle()
      },
      async reset({ page }) {
        await page.click("role=tab text==General")
        await page.idle()
      },
    },
    "search gateway model settings": {
      primary: "main.work",
      async run({ page }) {
        await page.type(search, "Model")
        await page.waitFor(first)
        await page.idle()
      },
      async reset({ page }) {
        await page.press("ControlOrMeta+A", { until: "frame" })
        await page.press("Backspace", { until: "frame" })
        await page.waitFor(first)
        await page.idle()
      },
    },
  },
})
