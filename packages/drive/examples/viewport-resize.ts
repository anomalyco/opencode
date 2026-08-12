import { Effect } from "effect"
import { defineScript, Llm } from "opencode-drive"

export default defineScript({
  tui: { viewport: { cols: 120, rows: 36 } },

  setup: ({ fs }) => fs.writeFile(
    "src/viewport.ts",
    `export const viewportSequence = ["120x36", "80x24", "50x18"]\n`,
  ),

  run: ({ ui, llm }) =>
    Effect.gen(function* () {
      yield* ui.submit(
        "Show a compact status report for the viewport resize demo.",
      )
      yield* llm.send(
        Llm.text(
          "Viewport demo: starting wide at 120 columns by 36 rows. The file src/viewport.ts lists the planned sequence. This first response should have plenty of horizontal room before the terminal narrows.",
        ),
      )
      yield* Effect.sleep(900)

      yield* ui.resize({ cols: 80, rows: 24 })
      yield* Effect.sleep(900)

      yield* ui.submit("Now describe the medium viewport.")
      yield* llm.send(
        Llm.text(
          "Medium viewport: resized to 80 columns by 24 rows. Lines should wrap sooner, the composer has less vertical breathing room, and the conversation should reflow without losing focus.",
        ),
      )
      yield* ui.waitFor("resized to 80 columns")
      yield* Effect.sleep(900)

      yield* ui.resize({ cols: 50, rows: 18 })
      yield* Effect.sleep(900)

      yield* ui.submit("Finish with the narrow viewport summary.")
      yield* llm.send(
        Llm.text(
          "Narrow viewport: now 50 columns by 18 rows. This final state is intentionally cramped so modal, wrapping, and footer behavior are easy to inspect in the recording.",
        ),
      )
      yield* ui.waitFor("now 50 columns")
      yield* Effect.sleep(1200)
    }),
})
