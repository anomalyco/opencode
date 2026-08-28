// Subprocess test for custom tool registration with non-Zod args (#45532).
// Arg values that are neither Zod schemas nor JSON Schema definitions used to
// be filtered into an empty parameter schema with no diagnostic — the tool
// registers, but the model sees no parameters and the author has no idea why.
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import path from "node:path"
import { cliIt } from "../../lib/cli-process"

const SHORTHAND_TOOL = `export default {
  description: "shorthand args tool",
  args: { foo: "string" },
  execute: async () => "ok",
}
`

describe("opencode run custom tool args", () => {
  cliIt.concurrent(
    "warns when custom tool args values are neither Zod nor JSON Schema",
    ({ llm, home, opencode }) =>
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          Bun.write(path.join(home, ".config", "opencode", "tool", "plain-shorthand.ts"), SHORTHAND_TOOL),
        )
        yield* llm.text("ok")

        const result = yield* opencode.run("hi", { printLogs: true })

        opencode.expectExit(result, 0)
        expect(result.stderr).toContain("plain-shorthand")
        expect(result.stderr).toContain("foo")

        const hits = yield* llm.hits
        const chat = hits.find((hit) => hit.url.pathname === "/v1/chat/completions")
        const tools = (chat?.body as { tools?: Array<{ function?: { name?: string } }> })?.tools ?? []
        expect(tools.some((entry) => entry.function?.name === "plain-shorthand")).toBe(true)
      }),
    60_000,
  )
})
