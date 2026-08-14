import { join } from "node:path"
import { defineScript, Llm } from "opencode-drive"
import * as Effect from "effect/Effect"

export default defineScript({
  config: {
    test: { declared: true },
  },
  tuiConfig: {
    test: { declared: true },
  },
  project: {
    git: true,
    files: {
      "src/seeded.ts": "export const seeded = true\n",
    },
  },
  setup: ({ fs, config, tuiConfig }) =>
    Effect.gen(function* () {
      config.autoupdate = false
      config.test = { ...(config.test as Record<string, boolean>), setup: true }
      tuiConfig.test = { ...(tuiConfig.test as Record<string, boolean>), setup: true }
      yield* fs.writeFile("setup-seeded.txt", "included in baseline\n")
    }),

  run: ({ artifacts, fs, llm, ui }) =>
    Effect.gen(function* () {
      const gitWriteError = yield* Effect.matchEffect(fs.writeFile(".GIT/config", "no"), {
        onFailure: (error) => Effect.succeed(String(error)),
        onSuccess: () => Effect.succeed(undefined),
      })
      yield* ui.waitFor((state) => Effect.succeed(state.focused.editor))
      const editor = yield* ui.getElement(1)
      yield* ui.focus(editor)
      yield* ui.click(editor)
      yield* ui.submit("script-text")
      yield* llm.send(Llm.text("script response", { delay: 0, chunkSize: 3 }))
      const matches = yield* ui.matches("script-text")
      yield* ui.waitFor("script-text")
      yield* ui.screenshot("script-shot")
      const state = yield* ui.state()
      const frame = yield* ui.capture()
      yield* Effect.tryPromise(() =>
        Bun.write(
          join(artifacts, "script-result.json"),
          `${JSON.stringify({ focused: state.focused, frame: { cols: frame.cols, rows: frame.rows }, gitWriteError, matches }, undefined, 2)}\n`,
        ),
      )
    }),
})
