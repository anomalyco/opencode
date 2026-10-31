// One long session (120 turns of markdown, code fences, tool calls and diffs) at normal speed.
import { bench, web } from "@strobe/bench"
import { editTools } from "./fixtures/diffs"
import { composer, mockTimelineSession, oldestPrompt, timeline } from "./fixtures/timeline"

const find = '[data-component="timeline-search-bar"] input'

const count = '[data-slot="timeline-search-count"]'

// The first of four edits of Core's tool sources (edit.ts), listed one per file and collapsed.
const edit = '[data-scope="apply-patch"] [data-slot="accordion-trigger"]'

const diff = '[data-component="apply-patch-file-diff"] diffs-container >>> [data-line]'

export default bench({
  targets: {
    web: web({
      viewport: { width: 1366, height: 768 },
      prepare: async ({ case: name, playwright, url }) =>
        mockTimelineSession(playwright.page, {
          server: new URL(url).origin,
          // The edits alone, so the case measures the diff, not the history around it.
          historyTurns: name === "expand an edit" ? 0 : 120,
          collapsedEdits: name === "expand an edit",
          tools: name === "expand an edit" ? await editTools() : undefined,
        }),
      url: ({ prepared }) => prepared.path,
    }),
  },

  async setup({ page }) {
    await page.waitFor(timeline, { timeout: 60_000 })
    await page.waitFor(composer)
    await page.idle()
  },

  cases: {
    "scroll history": {
      primary: "main.busy",
      async run({ page, phase }) {
        await phase("up", () => page.scroll(timeline, { by: -4000, speed: 3000 }))
        await phase("down", () => page.scroll(timeline, { by: 4000, speed: 3000 }))
      },
      reset: ({ page }) => page.idle(),
    },

    "type in composer": {
      primary: "interaction.p95",
      run: ({ page }) => page.type(composer, "Refactor the timeline so rows mount lazily", { delay: 80 }),
      async reset({ page }) {
        await page.press("ControlOrMeta+a")
        await page.press("Backspace")
        await page.idle()
      },
    },

    // 120 prompts match; the first is the oldest, far above the viewport and not mounted until Find reveals it.
    "find in session": {
      primary: "main.work",
      metrics: ["run.duration", "interaction.p95"],
      async run({ page }) {
        await page.press("ControlOrMeta+f", { until: find })
        await page.type(find, "Historical prompt", { delay: 50 })
        await page.waitFor(count, { text: "1/120" })
        await page.waitFor(oldestPrompt)
      },
      // A fresh document: once revealed, the top rows stay measured and a second search would be cheaper.
      async reset({ page, prepared }) {
        await page.goto(prepared.path, { until: timeline, timeout: 60_000 })
        await page.idle()
      },
    },

    // A full-file diff of edit.ts (395 lines) mounts and highlights in the timeline, which does not virtualize it.
    "expand an edit": {
      primary: "main.work",
      metrics: ["run.duration"],
      async run({ page }) {
        await page.click(edit, { until: diff })
        await page.idle()
      },
      async reset({ page }) {
        await page.click(edit)
        await page.idle()
      },
    },
  },
})
