// The composer with a lot in it: a 44,000-character saved draft, and a long prompt history with screenshots. At
// 1440×900.
import { bench, web } from "@hona/strobe-bench"
import { fixture, mockStressTimeline } from "../e2e/utils/session-fixture"
import { countDraftEncodes, draftEnd, mockLargeDraft, recalled, seedHistory } from "./fixtures/composer"
import { installProjects } from "./fixtures/home"
import { cached } from "./fixtures/mock"

const composer = '[data-component="composer-editor"]'

const newSession = '[data-component="new-session"] [data-component="composer-editor"][contenteditable="true"]'

const typed = " Keep the existing error handling and add coverage."

export default bench({
  targets: {
    web: web({
      viewport: { width: 1440, height: 900 },
      async prepare({ case: name, playwright, mock, url }) {
        const server = new URL(url).origin
        const page = cached(playwright.page, mock)

        if (!name.includes("history")) {
          await countDraftEncodes(page)

          return mockLargeDraft(page, server)
        }

        await seedHistory(page, server)
        await mockStressTimeline(page, { server })
        await installProjects(page, [fixture.directory])

        return { path: "/" }
      },
      url: ({ prepared }) => prepared.path,
    }),
  },

  async setup({ case: name, page }) {
    if (name.includes("history")) {
      await page.waitFor('[data-action="home-new-session"]', { timeout: 60_000 })
      await page.idle()

      return
    }

    // The caret at the end of the large draft.
    await page.waitFor(composer, { text: draftEnd, timeout: 60_000 })
    await page.click(composer)
    await page.press("ControlOrMeta+End")
    await page.idle()
  },

  cases: {
    // Each keystroke changes the draft and saves it; `count.draft.encode` is how many times the draft was encoded.
    "type in a large draft": {
      primary: "main.work",
      metrics: ["interaction.p95", "count.draft.encode"],
      async run({ page }) {
        await page.type(composer, typed, { delay: 50 })
        await page.idle()
      },
      async reset({ page }) {
        for (let step = 0; step < typed.length; step++) await page.press("Backspace")
        await page.idle()
      },
    },

    // Twenty caret moves: each saves the caret position, not the text.
    "move the cursor in a large draft": {
      primary: "main.work",
      metrics: ["interaction.p95", "count.draft.encode"],
      async run({ page }) {
        for (let step = 0; step < 20; step++) await page.press("ArrowLeft", { until: "frame" })
        await page.idle()
      },
      async reset({ page }) {
        await page.press("ControlOrMeta+End")
        await page.idle()
      },
    },

    // A new session's composer loads the history (counted: the run waits until the page settles), then ArrowUp
    // recalls the newest prompt and its screenshot.
    "recall a prompt from history": {
      primary: "main.work",
      metrics: ["run.duration"],
      async run({ page }) {
        await page.click('[data-action="home-new-session"]', { until: newSession })
        await page.idle()
        await page.press("ArrowUp")
        await page.waitFor(newSession, { text: recalled })
        await page.idle()
      },
      async reset({ page }) {
        await page.goto("/", { until: '[data-action="home-new-session"]', timeout: 60_000 })
        await page.idle()
      },
    },
  },
})
