import { describe, expect } from "bun:test"
import { Effect } from "effect"
import path from "node:path"
import { cliIt } from "../../lib/cli-process"
import { reply } from "../../lib/llm-server"

const schema = JSON.stringify({
  type: "object",
  properties: { ok: { type: "boolean" } },
  required: ["ok"],
  additionalProperties: false,
})

describe("opencode run --output-schema", () => {
  for (const file of [false, true]) {
    cliIt.concurrent(
      `writes structured output from ${file ? "a schema file" : "inline JSON"}`,
      ({ llm, opencode, home }) =>
        Effect.gen(function* () {
          const input = file ? path.join(home, "schema.json") : schema
          if (file) yield* Effect.promise(() => Bun.write(input, schema))
          yield* llm.push(
            reply().reason("Preparing JSON").text("Result follows").tool("StructuredOutput", { ok: true }),
          )

          const result = yield* opencode.run("Return success", { extraArgs: ["--output-schema", input, "--thinking"] })

          opencode.expectExit(result, 0)
          expect(JSON.parse(result.stdout)).toEqual({ ok: true })
          expect(result.stderr).toContain("Preparing JSON")
        }),
      60_000,
    )
  }

  cliIt.concurrent(
    "includes the structured result in JSON events",
    ({ llm, opencode }) =>
      Effect.gen(function* () {
        yield* llm.tool("StructuredOutput", { ok: false })
        const result = yield* opencode.run("Return failure", {
          format: "json",
          extraArgs: ["--output-schema", schema],
        })

        opencode.expectExit(result, 0)
        expect(opencode.parseJsonEvents(result.stdout)).toContainEqual(
          expect.objectContaining({ type: "structured_output", output: { ok: false } }),
        )
      }),
    60_000,
  )

  cliIt.live(
    "reads the schema locally when attached to a server",
    ({ home, llm, opencode }) =>
      Effect.gen(function* () {
        const file = path.join(home, "schema.json")
        yield* Effect.promise(() => Bun.write(file, schema))
        yield* llm.tool("StructuredOutput", { ok: true })
        const server = yield* opencode.serve()
        const result = yield* opencode.run("Return success", {
          extraArgs: ["--attach", server.url, "--output-schema", file],
        })

        opencode.expectExit(result, 0)
        expect(JSON.parse(result.stdout)).toEqual({ ok: true })
      }),
    60_000,
  )

  cliIt.concurrent(
    "fails when the model does not provide structured output",
    ({ llm, opencode }) =>
      Effect.gen(function* () {
        yield* llm.text("No structured result")
        const result = yield* opencode.run("Return success", { extraArgs: ["--output-schema", schema] })

        expect(result.exitCode).not.toBe(0)
        expect(result.stdout).toBe("")
        expect(result.stderr).toContain("Model did not produce structured output")
      }),
    60_000,
  )

  for (const input of ["{invalid", "/missing/schema.json", ""]) {
    cliIt.concurrent(
      `rejects an unreadable schema: ${input}`,
      ({ opencode }) =>
        Effect.gen(function* () {
          const result = yield* opencode.run("Return success", { extraArgs: ["--output-schema", input] })
          expect(result.exitCode).not.toBe(0)
          expect(result.stdout).toBe("")
        }),
      60_000,
    )
  }
})
