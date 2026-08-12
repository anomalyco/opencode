import { Effect } from "effect"
import { defineScript, Llm } from "opencode-drive"

export default defineScript({
  setup: ({ fs }) => fs.writeFile(
    "src/message.ts",
    'export const message = "Hello from OpenCode Drive"\n',
  ),

  run: ({ llm, ui }) =>
    Effect.gen(function* () {
      yield* ui.waitFor((state) => state.focused.editor)
      const editor = yield* ui.getElement({ editor: true, focused: true })
      yield* ui.focus(editor)

      yield* ui.submit("What does src/message.ts export?")
      yield* llm.send(
        Llm.reasoning("I should inspect the small source file first.", {
          delay: 5,
          chunkSize: 10,
        }),
        Llm.pause(100),
        Llm.text(
          'src/message.ts exports `message` with the value "Hello from OpenCode Drive".',
          {
            delay: 10,
            chunkSize: 12,
          },
        ),
      )
      yield* llm.send(Llm.text("Message export"))

      yield* ui.waitFor("Hello from OpenCode Drive")
      if (!(yield* ui.matches("OpenCode Drive")))
        throw new Error("the expected response was not visible")

      yield* ui.screenshot("simple-response")
    }),
})
