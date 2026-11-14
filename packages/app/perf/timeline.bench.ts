// One long session (120 turns of markdown, code fences, tool calls and diffs) at normal speed.
import { bench, web } from "@hona/strobe"
import { editTools, reviewDiffs } from "./fixtures/diffs"
import { dragDivider, measureDivider, type Divider } from "./fixtures/drag"
import { cached } from "./fixtures/mock"
import { openReview } from "./fixtures/review"
import { composer, mockTimelineSession, oldestPrompt, timeline } from "./fixtures/timeline"

const find = '[data-component="timeline-search-bar"] input'

const count = '[data-slot="timeline-search-count"]'

// The first of four edits of Core's tool sources (edit.ts), listed one per file and collapsed.
const edit = '[data-scope="apply-patch"] [data-slot="accordion-trigger"]'

const diff = '[data-component="apply-patch-file-diff"] diffs-container >>> [data-line]'

const drag = "drag the review's edge"

// The divider between the session and the side panel, read once the review is open. The session panel keeps at least
// 400px, the side panel 320px and the 8px gap.
const handle = '[data-slot="session-chat-panel"] > div > [data-component="resize-handle"]'

let divider: Divider | undefined

export default bench({
  // The session a case's launch loads: the edits alone, the history beside the review, or the history. Cases with the
  // same one share a launch.
  setupKey: (ctx) => (ctx.case === "expand an edit" ? "edits" : ctx.case === drag ? "review" : "history"),

  targets: {
    web: web({
      expect: { title: "OpenCode" },
      viewport: { width: 1366, height: 768 },
      prepare: async (ctx) =>
        mockTimelineSession(cached(ctx), {
          server: new URL(ctx.url).origin,
          // The edits alone, so the case measures the diff, not the history around it.
          historyTurns: ctx.setupKey === "edits" ? 0 : 120,
          collapsedEdits: ctx.setupKey === "edits",
          tools: ctx.setupKey === "edits" ? await editTools() : undefined,
          vcsDiff: ctx.setupKey === "review" ? reviewDiffs() : undefined,
        }),
      url: ({ prepared }) => prepared.path,
    }),
  },

  async setup({ setupKey, page }) {
    await page.waitFor(timeline, { timeout: 60_000 })
    await page.waitFor(composer)

    if (setupKey === "review") {
      await openReview(page)
      await page.idle()
      divider = await page.eval(measureDivider, {
        panel: '[data-slot="session-chat-panel"]',
        row: "[data-pane-row]",
        min: 400,
        rest: 328,
      })
    }

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

    // The divider beside the review (72 changed files) held for five seconds and dragged as a hand does, a pointer
    // move every display frame: a slow stretch toward the session, jiggles, a fast throw toward the review and a slow
    // pull back (fixtures/drag.ts). The timeline narrows and widens on every frame, so the rows in view rewrap; each
    // frame should keep up with the display.
    [drag]: {
      primary: "frames.dropped.pct",
      metrics: ["main.work", "main.layout", "main.style", "main.script", "frames.interval.p95"],
      run: ({ page }) => dragDivider(page, handle, divider!),
      reset: ({ page }) => page.idle(),
    },
  },
})
