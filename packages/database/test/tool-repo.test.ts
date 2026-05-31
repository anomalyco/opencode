import { describe, expect, it } from "bun:test"
import { migrate } from "@opencode-ai/effect-drizzle-sqlite/effect-sqlite/migrator"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { Database } from "../src/db"
import { ToolRepo } from "../src/tool/repo"

const layer = Layer.mergeAll(ToolRepo.layer, Database.layerMemory)

const run = <A, E>(effect: Effect.Effect<A, E, ToolRepo | Database>): Promise<A> =>
  Effect.runPromise(
    Effect.scoped(
      Effect.provide(
        Effect.gen(function* () {
          const svc = yield* Database
          yield* migrate(svc.db, { migrationsFolder: `${import.meta.dirname}/../migration` })
          return yield* effect
        }),
        layer,
      ),
    ),
  )

const toolCode = (name: string) =>
  [
    `export const tool = { name: "${name}", description: "", schema: { input: {}, output: {} } }`,
    `export default function fn() { return {} }`,
  ].join("\n")

describe("ToolRepo", () => {
  it("creates a tool and registers it in runtime", async () => {
    const result = await run(
      Effect.gen(function* () {
        const repo = yield* ToolRepo
        return yield* repo.create({
          name: "adder",
          description: "Adds two nums",
          input_schema: { a: "number", b: "number" },
          output_schema: { result: "number" },
          code: [
            "export const tool = {",
            '  name: "adder",',
            '  description: "Adds two nums",',
            "  schema: { input: { a: 'number', b: 'number' }, output: { result: 'number' } },",
            "}",
            "export default function adder({ a, b }: { a: number; b: number }) {",
            "  return { result: a + b }",
            "}",
          ].join("\n"),
        })
      }),
    )
    expect(result.name).toBe("adder")
    expect(result.input).toEqual({ a: "number", b: "number" })
  })

  it("runs a created tool", async () => {
    const result = await run(
      Effect.gen(function* () {
        const repo = yield* ToolRepo
        yield* repo.create({
          name: "multiplier",
          description: "Multiplies two nums",
          input_schema: { a: "number", b: "number" },
          output_schema: { result: "number" },
          code: [
            "export const tool = {",
            '  name: "multiplier",',
            '  description: "Multiplies two nums",',
            "  schema: { input: { a: 'number', b: 'number' }, output: { result: 'number' } },",
            "}",
            "export default function mult({ a, b }: { a: number; b: number }) {",
            "  return { result: a * b }",
            "}",
          ].join("\n"),
        })
        return yield* repo.run("multiplier", { a: 3, b: 4 })
      }),
    )
    expect(result).toEqual({ result: 12 })
  })

  it("lists all tools", async () => {
    const result = await run(
      Effect.gen(function* () {
        const repo = yield* ToolRepo
        yield* repo.create({
          name: "tool-a",
          description: "A",
          input_schema: {},
          output_schema: {},
          code: toolCode("tool-a"),
        })
        yield* repo.create({
          name: "tool-b",
          description: "B",
          input_schema: {},
          output_schema: {},
          code: toolCode("tool-b"),
        })
        return yield* repo.list()
      }),
    )
    expect(result).toHaveLength(2)
    expect(result.map((t) => t.name).sort()).toEqual(["tool-a", "tool-b"])
  })

  it("updates a tool description and reloads", async () => {
    const result = await run(
      Effect.gen(function* () {
        const repo = yield* ToolRepo
        yield* repo.create({
          name: "updatable",
          description: "v1",
          input_schema: {},
          output_schema: {},
          code: [
            "export const tool = { name: 'updatable', description: 'v1', schema: { input: {}, output: {} } }",
            "export default function v1() { return { version: 1 } }",
          ].join("\n"),
        })
        const updated = yield* repo.update("updatable", {
          description: "v2",
          code: [
            "export const tool = { name: 'updatable', description: 'v2', schema: { input: {}, output: {} } }",
            "export default function v2() { return { version: 2 } }",
          ].join("\n"),
        })
        return { signature: updated, result: yield* repo.run("updatable", {}) }
      }),
    )
    expect(result.signature.description).toBe("v2")
    expect(result.result).toEqual({ version: 2 })
  })

  it("deletes a tool", async () => {
    const result = await run(
      Effect.gen(function* () {
        const repo = yield* ToolRepo
        yield* repo.create({
          name: "deletable",
          description: "",
          input_schema: {},
          output_schema: {},
          code: toolCode("d"),
        })
        yield* repo.delete("deletable")
        return yield* repo.list()
      }),
    )
    expect(result).toHaveLength(0)
  })
})
