import { Effect, Stream } from "effect"
import { defineScript, Llm } from "opencode-drive"

export default defineScript({
  setup: ({ fs }) => fs.writeFile(
    "src/greeting.ts",
    [
      "export function greeting(name: string) {",
      '  return `Welcome, ${name}!`',
      "}",
      "",
    ].join("\n"),
  ),

  run: ({ llm, ui }) =>
    Effect.gen(function* () {
      let turn = 0

      yield* llm.title(() => Effect.succeed("Understanding the greeting"))
      yield* llm.serve(() => {
        if (turn++ === 0)
          return Stream.make(
            Llm.reasoning(
              "I should read the implementation before explaining it.",
            ),
            Llm.toolCall({
              index: 0,
              id: "call_read_greeting",
              name: "read",
              input: { filePath: "src/greeting.ts" },
            }),
            Llm.finish("tool-calls"),
          )

        return Stream.make(
          Llm.text("The function accepts a name, "),
          Llm.pause(150),
          Llm.text("places it into a welcome message, "),
          Llm.pause(150),
          Llm.text("and adds an exclamation mark."),
          Llm.pause(150),
          Llm.finish("stop"),
        )
      })

      yield* ui.submit("Read src/greeting.ts and explain what it does.")
      yield* ui.waitFor("adds an exclamation mark")
    }),
})
