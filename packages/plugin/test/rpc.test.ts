import { expect, test } from "bun:test"
import { Rpc } from "@opencode-ai/plugin/rpc"
import { fileURLToPath } from "node:url"
import { Acme } from "./rpc.fixture.js"

test("definitions preserve their schemas and ID without registering anything", () => {
  expect(Rpc.define(Acme)).toBe(Acme)
  expect(Acme.id).toBe("acme")
  expect(Object.keys(Acme.events)).toEqual(["updated", "progress", "counted"])
})

test("defining an RPC contract does not invoke its schema parser", () => {
  const schema = {
    "~standard": {
      version: 1 as const,
      vendor: "test",
      validate: () => {
        throw new Error("Definition must not parse values")
      },
    },
  }
  const definition = Rpc.define({
    id: "portable",
    methods: { echo: { input: schema, output: schema, errors: { rejected: schema } } },
    events: { updated: { schema } },
  })

  expect(definition.methods.echo.input).toBe(schema)
  expect(definition.methods.echo.output).toBe(schema)
  expect(definition.methods.echo.errors.rejected).toBe(schema)
  expect(definition.events.updated.schema).toBe(schema)
})

test("framework RPC error names are reserved", () => {
  const schema = { type: "null" }
  const errors = Object.fromEntries([["rpc.internal", schema]])
  expect(() =>
    Rpc.define({ id: "reserved", methods: { call: { input: schema, output: schema, errors } }, events: {} }),
  ).toThrow('RPC error names starting with "rpc." are reserved: rpc.internal')
})

test("the shared definition entrypoint bundles without Effect or host runtime dependencies", async () => {
  const inputs = new Set<string>()
  const result = await Bun.build({
    entrypoints: [fileURLToPath(import.meta.resolve("@opencode-ai/plugin/rpc"))],
    target: "browser",
    plugins: [
      {
        name: "rpc-import-boundary",
        setup(build) {
          build.onLoad({ filter: /.*/ }, (args) => {
            inputs.add(args.path)
            return undefined
          })
        },
      },
    ],
  })

  expect(result.success).toBe(true)
  expect([...inputs].sort((a, b) => a.localeCompare(b))).toEqual(
    [import.meta.resolve("@opencode-ai/plugin/rpc"), import.meta.resolve("@opencode-ai/schema/rpc")]
      .map((url) => fileURLToPath(url))
      .sort((a, b) => a.localeCompare(b)),
  )
})
