import { expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import { CodeMode, Extension, Tool } from "../src/index.js"

test("Lua calls only declared capabilities; denied calls can be recovered without crossing a host error object", async () => {
  const calls: string[] = []
  const extensions = [
    Extension.lua({
      name: "example",
      globals: {
        lookup: (id) =>
          Effect.sync(() => {
            if (typeof id !== "string") throw new TypeError("expected an id")
            calls.push(id)
            return { id }
          }),
      },
    }),
  ]
  const run = CodeMode.make({
    language: "lua",
    extensions,
    hooks: {
      "extension.before": (call) =>
        call.args[0] === "denied" ? Effect.fail(new Error("permission denied")) : Effect.void,
    },
  })
  expect(
    await Effect.runPromise(
      run.execute(`
    local ok, message = pcall(lookup, "denied")
    return { ok = ok, message = message, id = lookup("allowed").id }
  `),
    ),
  ).toMatchObject({ ok: true, value: { ok: false, message: "permission denied", id: "allowed" } })
  expect(calls).toEqual(["allowed"])
  expect(() => CodeMode.make({ extensions })).toThrow("requires language")
  expect(() =>
    CodeMode.make({ language: "lua", extensions: [Extension.make({ name: "js", globals: { fs: {} } })] }),
  ).toThrow("Extension.lua")
})

test("Lua table shapes survive a validated tool round trip, including empty containers and nested nulls", async () => {
  const shape = Schema.Struct({
    list: Schema.Array(Schema.NullOr(Schema.String)),
    record: Schema.Record(Schema.String, Schema.Json),
  })
  const runtime = CodeMode.make({
    language: "lua",
    tools: { echo: Tool.make({ description: "Echo", input: shape, output: shape, execute: Effect.succeed }) },
  })
  expect(
    await Effect.runPromise(
      runtime.execute(`
    local a = tools.echo({ list = {json.null}, record = { omitted = nil, kept = json.null } })
    a.list[1] = nil
    return { tools.echo(a), tools.echo({ list = json.array(), record = {} }) }
  `),
    ),
  ).toMatchObject({
    ok: true,
    value: [
      { list: [], record: { kept: null } },
      { list: [], record: {} },
    ],
  })
  expect(await Effect.runPromise(runtime.execute("return tools.echo({list = {}, record = {}})"))).toMatchObject({
    ok: false,
    error: { kind: "InvalidToolInput" },
    toolCalls: [],
  })
})
