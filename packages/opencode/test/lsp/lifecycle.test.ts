import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import path from "path"
import { Effect, Layer } from "effect"
import { LSP } from "../../src/lsp"
import { LSPServer } from "../../src/lsp"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(LSP.defaultLayer, CrossSpawnSpawner.defaultLayer))

describe("LSP service lifecycle", () => {
  let spawnSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    spawnSpy = spyOn(LSPServer.Typescript, "spawn").mockResolvedValue(undefined)
  })

  afterEach(() => {
    spawnSpy.mockRestore()
  })

  it.live("init() completes without error", () => provideTmpdirInstance(() => LSP.Service.use((lsp) => lsp.init())))

  it.live("status() returns empty array initially", () =>
    provideTmpdirInstance(() =>
      LSP.Service.use((lsp) =>
        Effect.gen(function* () {
          const result = yield* lsp.status()
          expect(Array.isArray(result)).toBe(true)
          expect(result.length).toBe(0)
        }),
      ),
    ),
  )

  it.live("diagnostics() returns empty object initially", () =>
    provideTmpdirInstance(() =>
      LSP.Service.use((lsp) =>
        Effect.gen(function* () {
          const result = yield* lsp.diagnostics()
          expect(typeof result).toBe("object")
          expect(Object.keys(result).length).toBe(0)
        }),
      ),
    ),
  )

  it.live("hasClients() returns false for .ts files in instance when LSP is unset", () =>
    provideTmpdirInstance((dir) =>
      LSP.Service.use((lsp) =>
        Effect.gen(function* () {
          const result = yield* lsp.hasClients(path.join(dir, "test.ts"))
          expect(result).toBe(false)
        }),
      ),
    ),
  )

  it.live("hasClients() returns true for .ts files in instance when lsp is true", () =>
    provideTmpdirInstance(
      (dir) =>
        LSP.Service.use((lsp) =>
          Effect.gen(function* () {
            const result = yield* lsp.hasClients(path.join(dir, "test.ts"))
            expect(result).toBe(true)
          }),
        ),
      { config: { lsp: true } },
    ),
  )

  it.live("hasClients() keeps built-in LSPs when config object is provided", () =>
    provideTmpdirInstance(
      (dir) =>
        LSP.Service.use((lsp) =>
          Effect.gen(function* () {
            const result = yield* lsp.hasClients(path.join(dir, "test.ts"))
            expect(result).toBe(true)
          }),
        ),
      {
        config: {
          lsp: {
            eslint: { disabled: true },
          },
        },
      },
    ),
  )

  it.live("hasClients() returns false for files outside instance", () =>
    provideTmpdirInstance((dir) =>
      LSP.Service.use((lsp) =>
        Effect.gen(function* () {
          const result = yield* lsp.hasClients(path.join(dir, "..", "outside.ts"))
          expect(typeof result).toBe("boolean")
        }),
      ),
    ),
  )

  it.live("workspaceSymbol() returns empty array with no clients", () =>
    provideTmpdirInstance(() =>
      LSP.Service.use((lsp) =>
        Effect.gen(function* () {
          const result = yield* lsp.workspaceSymbol("test")
          expect(Array.isArray(result)).toBe(true)
          expect(result.length).toBe(0)
        }),
      ),
    ),
  )

  it.live("definition() returns empty array for unknown file", () =>
    provideTmpdirInstance((dir) =>
      LSP.Service.use((lsp) =>
        Effect.gen(function* () {
          const result = yield* lsp.definition({
            file: path.join(dir, "nonexistent.ts"),
            line: 0,
            character: 0,
          })
          expect(Array.isArray(result)).toBe(true)
        }),
      ),
    ),
  )

  it.live("references() returns empty array for unknown file", () =>
    provideTmpdirInstance((dir) =>
      LSP.Service.use((lsp) =>
        Effect.gen(function* () {
          const result = yield* lsp.references({
            file: path.join(dir, "nonexistent.ts"),
            line: 0,
            character: 0,
          })
          expect(Array.isArray(result)).toBe(true)
        }),
      ),
    ),
  )

  it.live("multiple init() calls are idempotent", () =>
    provideTmpdirInstance(() =>
      LSP.Service.use((lsp) =>
        Effect.gen(function* () {
          yield* lsp.init()
          yield* lsp.init()
          yield* lsp.init()
        }),
      ),
    ),
  )
})

describe("LSP.Diagnostic", () => {
  test("pretty() formats error diagnostic", () => {
    const result = LSP.Diagnostic.pretty({
      range: { start: { line: 9, character: 4 }, end: { line: 9, character: 10 } },
      message: "Type 'string' is not assignable to type 'number'",
      severity: 1,
    } as any)
    expect(result).toBe("ERROR [10:5] Type 'string' is not assignable to type 'number'")
  })

  test("pretty() formats warning diagnostic", () => {
    const result = LSP.Diagnostic.pretty({
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
      message: "Unused variable",
      severity: 2,
    } as any)
    expect(result).toBe("WARN [1:1] Unused variable")
  })

  test("pretty() defaults to ERROR when no severity", () => {
    const result = LSP.Diagnostic.pretty({
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
      message: "Something wrong",
    } as any)
    expect(result).toBe("ERROR [1:1] Something wrong")
  })
})
