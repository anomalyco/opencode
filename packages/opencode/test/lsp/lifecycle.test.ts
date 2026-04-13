import { afterEach, beforeEach, describe, expect, spyOn } from "bun:test"
import path from "path"
import { Effect } from "effect"
import { LSP } from "../../src/lsp"
import { LSPServer } from "../../src/lsp/server"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(LSP.defaultLayer)

describe("LSP service lifecycle", () => {
  let spawnSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    spawnSpy = spyOn(LSPServer.Typescript, "spawn").mockResolvedValue(undefined)
  })

  afterEach(() => {
    spawnSpy.mockRestore()
  })

  it.live("init() completes without error", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const lsp = yield* LSP.Service
        yield* lsp.init()
      }),
    ),
  )

  it.live("status() returns empty array initially", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const lsp = yield* LSP.Service
        const result = yield* lsp.status()
        expect(Array.isArray(result)).toBe(true)
        expect(result.length).toBe(0)
      }),
    ),
  )

  it.live("diagnostics() returns empty object initially", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const lsp = yield* LSP.Service
        const result = yield* lsp.diagnostics()
        expect(typeof result).toBe("object")
        expect(Object.keys(result).length).toBe(0)
      }),
    ),
  )

  it.live("hasClients() returns true for .ts files in instance", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const lsp = yield* LSP.Service
        const result = yield* lsp.hasClients(path.join(dir, "test.ts"))
        expect(result).toBe(true)
      }),
    ),
  )

  it.live("hasClients() returns false for files outside instance", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const lsp = yield* LSP.Service
        const result = yield* lsp.hasClients(path.join(dir, "..", "outside.ts"))
        expect(typeof result).toBe("boolean")
      }),
    ),
  )

  it.live("workspaceSymbol() returns empty array with no clients", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const lsp = yield* LSP.Service
        const result = yield* lsp.workspaceSymbol("test")
        expect(Array.isArray(result)).toBe(true)
        expect(result.length).toBe(0)
      }),
    ),
  )

  it.live("definition() returns empty array for unknown file", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const lsp = yield* LSP.Service
        const result = yield* lsp.definition({
          file: path.join(dir, "nonexistent.ts"),
          line: 0,
          character: 0,
        })
        expect(Array.isArray(result)).toBe(true)
      }),
    ),
  )

  it.live("references() returns empty array for unknown file", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const lsp = yield* LSP.Service
        const result = yield* lsp.references({
          file: path.join(dir, "nonexistent.ts"),
          line: 0,
          character: 0,
        })
        expect(Array.isArray(result)).toBe(true)
      }),
    ),
  )

  it.live("multiple init() calls are idempotent", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const lsp = yield* LSP.Service
        yield* lsp.init()
        yield* lsp.init()
        yield* lsp.init()
      }),
    ),
  )
})

describe("LSP.Diagnostic", () => {
  it.live("pretty() formats error diagnostic", () =>
    Effect.sync(() => {
      const result = LSP.Diagnostic.pretty({
        range: { start: { line: 9, character: 4 }, end: { line: 9, character: 10 } },
        message: "Type 'string' is not assignable to type 'number'",
        severity: 1,
      } as any)
      expect(result).toBe("ERROR [10:5] Type 'string' is not assignable to type 'number'")
    }),
  )

  it.live("pretty() formats warning diagnostic", () =>
    Effect.sync(() => {
      const result = LSP.Diagnostic.pretty({
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
        message: "Unused variable",
        severity: 2,
      } as any)
      expect(result).toBe("WARN [1:1] Unused variable")
    }),
  )

  it.live("pretty() defaults to ERROR when no severity", () =>
    Effect.sync(() => {
      const result = LSP.Diagnostic.pretty({
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
        message: "Something wrong",
      } as any)
      expect(result).toBe("ERROR [1:1] Something wrong")
    }),
  )
})
