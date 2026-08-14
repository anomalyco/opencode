import { defineScript, Llm } from "opencode-drive"
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"

export default defineScript({
  run: ({ artifacts, llm, ui }) =>
    Effect.gen(function* () {
      yield* llm.serve(() => Stream.fromEffect(Effect.sleep(500).pipe(Effect.as(Llm.text("late response")))))
      const file = `${artifacts}/script-runs.txt`
      const screenshotFile = `${artifacts}/script-screenshots.txt`
      const previous = yield* Effect.promise(() =>
        Bun.file(file)
          .text()
          .catch(() => ""),
      )
      const screenshots = yield* Effect.promise(() =>
        Bun.file(screenshotFile)
          .text()
          .catch(() => ""),
      )
      const screenshot = yield* ui.screenshot("restart-shared")
      yield* Effect.tryPromise(() => Bun.write(screenshotFile, `${screenshots}${screenshot}\n`))
      yield* Effect.tryPromise(() => Bun.write(file, `${previous}run\n`))
      yield* Effect.never
    }),
})
