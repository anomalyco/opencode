import { defineScript } from "opencode-drive"
import * as Effect from "effect/Effect"

export default defineScript({
  tui: { recording: true, viewport: { cols: 90, rows: 30 } },
  run: ({ artifacts, tui, tuis }) =>
    Effect.gen(function* () {
      const secondary = yield* tuis.launch()
      yield* Effect.tryPromise(() =>
        Bun.write(
          `${artifacts}/tui-options.json`,
          `${JSON.stringify({
            primaryRecording: tui.recording !== undefined,
            secondaryRecording: secondary.recording !== undefined,
          })}\n`,
        ),
      )
    }),
})
