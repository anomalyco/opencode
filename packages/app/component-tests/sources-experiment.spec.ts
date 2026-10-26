import type { SessionMessageInfo } from "@opencode/client/promise"
import type { MotionKnob } from "@opencode/ui/motion-tuning"
import { expect, sourceURL, story } from "../../stories/playwright/story"

const source = (path: string) => sourceURL(new URL(path, import.meta.url))

const modules = {
  fixture: source("./extension-host.fixture.tsx"),
  definition: source("../../gui-extensions/src/sources/index.ts"),
  renderer: source("../../gui-extensions/src/sources/renderer.tsx"),
  tuning: source("../../ui/src/motion-tuning.ts"),
}

// One turn: the user message the panel's tab is keyed by, and a reply that searched the web.
const messages: SessionMessageInfo[] = [
  { id: "main", type: "user", text: "Who made One Million Checkboxes?", time: { created: 1 } },
  {
    id: "msg_reply",
    type: "assistant",
    agent: "build",
    model: { id: "claude-sonnet-4", providerID: "anthropic" },
    time: { created: 2, completed: 3 },
    content: [
      {
        type: "tool",
        id: "call_search",
        name: "websearch",
        state: {
          status: "completed",
          input: { query: "one million checkboxes" },
          content: [
            { type: "text", text: "## [One Million Checkboxes](https://eieio.games/blog/one-million-checkboxes)" },
          ],
        },
        time: { created: 2, ran: 2, completed: 3 },
      },
    ],
  },
]

story.beforeEach(async ({ mount }) => {
  // Any story loads the app; the fixture mounts the real host beside it.
  await mount("ui-line-comment--editor")
})

story("turning the Sources experiment off closes its open panel and loads no more site icons", async ({ page }) => {
  // Site icons stay off the network, and load, so each stays an image until the experiment turns off.
  await page.route("**/favicon.ico", (route) =>
    route.fulfill({
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
        "base64",
      ),
    }),
  )

  const result = await page.evaluate(
    async (input) => {
      const [{ mountSessionRegion, until }, { default: definition }, { default: renderer }, { motionTuning }] =
        await Promise.all([
          import(input.modules.fixture),
          import(input.modules.definition),
          import(input.modules.renderer),
          import(input.modules.tuning),
        ])

      const knob = (id: string) => motionTuning.list().find((item: MotionKnob) => item.id === id)
      motionTuning.set(knob("sources.enabled"), true)
      motionTuning.set(knob("sources.icons"), "site")

      const host: { container: HTMLElement; unmount: () => void } = mountSessionRegion({
        active: "sources:main",
        messages: JSON.parse(input.messages),
        definitions: [{ ...definition, renderer: async () => ({ default: renderer }) }],
      })

      const panel = () => host.container.querySelector('[data-slot="session-sources-panel"]')
      const icons = () => host.container.querySelectorAll('[data-slot="site-icon-image"]').length

      await until(() => !!panel()?.querySelector('[data-slot="sources-step-row"]'))
      panel()?.querySelector<HTMLButtonElement>('[data-slot="sources-step-row"]')?.click()
      await until(() => icons() > 0)
      const open = { panel: !!panel(), icons: icons() }

      motionTuning.set(knob("sources.enabled"), false)
      await until(() => !panel())
      const off = { panel: !!panel(), icons: icons() }
      host.unmount()

      return { open, off }
    },
    // As JSON: the messages' type is too deep for `evaluate`'s serializable argument check.
    { modules, messages: JSON.stringify(messages) },
  )

  expect(result).toEqual({ open: { panel: true, icons: 1 }, off: { panel: false, icons: 0 } })
})
