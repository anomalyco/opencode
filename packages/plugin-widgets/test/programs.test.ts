import { expect, test } from "bun:test"
import { Effect } from "effect"
import { WidgetTemplates } from "../src/index.js"
import { make } from "./fake.js"

const source = `function view(state, data) { return ui.text(data.title) }`
const prelude = (name: string) => ({ program: (text: string) => `// prelude ${name}\n${text}` })

test("a saved version keeps serving the program it was saved with after the prelude changes", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const fake = yield* make
      const save = (widgetTemplates: WidgetTemplates.Interface, text: string) =>
        widgetTemplates.save({
          name: "card",
          description: "A card",
          data: { type: "object" },
          source: text,
          example: {},
        })
      const saved = yield* save(WidgetTemplates.make(fake.context.storage, prelude("A")), source)

      // A release ships prelude B: the stored version is still prelude A's program, exactly.
      const after = WidgetTemplates.make(fake.context.storage, prelude("B"))
      expect((yield* after.get("card", saved.version)).program).toBe(`// prelude A\n${source}`)
      expect((yield* after.latest("card")).program).toBe(`// prelude A\n${source}`)
      // New content is built with prelude B; the old version stays prelude A's.
      yield* save(after, source.replace("ui.text", "ui.markdown"))
      expect((yield* after.latest("card")).program).toStartWith("// prelude B\n")
      expect((yield* after.get("card", saved.version)).program).toStartWith("// prelude A\n")
    }),
  ))
