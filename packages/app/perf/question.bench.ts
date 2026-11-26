// The new question dock with its motion on: five questions, switched with the arrow keys while each switch is still
// moving, so the frame loop steps the switch, the dock's heights and the footer every frame. At 1440×900.
import { bench, web } from "@hona/strobe"
import { sessionHref } from "../e2e/utils/app"
import { mockOpenCodeServer } from "../e2e/utils/mock-server"
import { fixture } from "../e2e/utils/session-fixture"
import { cached } from "./fixtures/mock"

const sessionID = "ses_perf_question"

const question = '[data-component="dock-prompt"][data-kind="question"]'

const title = `${question} [data-slot="question-header-title"]`

export default bench({
  targets: {
    web: web({
      expect: { title: "OpenCode" },
      viewport: { width: 1440, height: 900 },
      async prepare(ctx) {
        const { url } = ctx
        const server = new URL(url).origin
        const page = cached(ctx)

        await mockOpenCodeServer(page, {
          server,
          directory: fixture.directory,
          project: fixture.project,
          provider: fixture.provider,
          sessions: [{ ...fixture.sessions[0], id: sessionID, title: "Question workload" }],
          pageMessages: () => ({ items: [] }),
          forms: [
            {
              id: "frm_perf_question",
              sessionID,
              title: "Questions",
              metadata: { kind: "question" },
              fields: Array.from({ length: 5 }, (_, index) => ({
                key: `q${index}`,
                type: index % 2 ? "multiselect" : "string",
                title: `Question ${index + 1}`,
                description: `Question ${index + 1}: ${"Which of these should the change keep as it is? ".repeat(index + 1)}`,
                options: Array.from({ length: 3 + index }, (_, option) => ({
                  value: `option-${option}`,
                  label: `Option ${option + 1}`,
                  description: "Keeps the current behavior and adds coverage for it.",
                })),
                custom: true,
              })),
            },
          ],
        })
        await page.addInitScript(() => {
          localStorage.setItem("settings.v3", JSON.stringify({ general: { newQuestionUI: true } }))
          localStorage.setItem("opencode.motion.v2", JSON.stringify({ "question.motion": 1 }))
        })

        return { path: sessionHref(sessionID, server) }
      },
      url: ({ prepared }) => prepared.path,
    }),
  },

  async setup({ page }) {
    await page.waitFor(`${question} [data-slot="question-option"]:focus`, { timeout: 60_000 })
    await page.idle()
  },

  cases: {
    // Four switches on and four back, each key a frame into the last switch.
    "switch questions": {
      primary: "main.work",
      metrics: ["frames.dropped.pct"],
      async run({ page }) {
        for (const key of ["ArrowRight", "ArrowRight", "ArrowRight", "ArrowRight"])
          await page.press(key, { until: "frame" })
        await page.waitFor(title, { text: "5 of 5 questions" })

        for (const key of ["ArrowLeft", "ArrowLeft", "ArrowLeft", "ArrowLeft"]) await page.press(key, { until: "frame" })
        await page.waitFor(title, { text: "1 of 5 questions" })
        await page.idle()
      },
    },
  },
})
