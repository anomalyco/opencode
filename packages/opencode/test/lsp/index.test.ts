import { describe, expect, spyOn } from "bun:test"
import path from "path"
import { Effect } from "effect"
import { LSP } from "../../src/lsp"
import { LSPServer } from "../../src/lsp/server"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(LSP.defaultLayer)

describe("lsp.spawn", () => {
  it.live("does not spawn builtin LSP for files outside instance", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const spy = spyOn(LSPServer.Typescript, "spawn").mockResolvedValue(undefined)

        try {
          const lsp = yield* LSP.Service
          yield* lsp.touchFile(path.join(dir, "..", "outside.ts"))
          yield* lsp.hover({
            file: path.join(dir, "..", "hover.ts"),
            line: 0,
            character: 0,
          })
          expect(spy).toHaveBeenCalledTimes(0)
        } finally {
          spy.mockRestore()
        }
      }),
    ),
  )

  it.live("would spawn builtin LSP for files inside instance", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const spy = spyOn(LSPServer.Typescript, "spawn").mockResolvedValue(undefined)

        try {
          const lsp = yield* LSP.Service
          yield* lsp.hover({
            file: path.join(dir, "src", "inside.ts"),
            line: 0,
            character: 0,
          })
          expect(spy).toHaveBeenCalledTimes(1)
        } finally {
          spy.mockRestore()
        }
      }),
    ),
  )
})
