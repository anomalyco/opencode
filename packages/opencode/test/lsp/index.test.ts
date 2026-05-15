import { describe, expect, spyOn } from "bun:test"
import path from "path"
import { Effect, Layer } from "effect"
import { Config } from "@/config/config"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { LSP } from "@/lsp/lsp"
import * as LSPServer from "@/lsp/server"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(LSP.defaultLayer, CrossSpawnSpawner.defaultLayer))
const experimentalTyIt = testEffect(
  Layer.mergeAll(
    LSP.layer.pipe(Layer.provide(Config.defaultLayer), Layer.provide(RuntimeFlags.layer({ experimentalLspTy: true }))),
    CrossSpawnSpawner.defaultLayer,
  ),
)
const disabledDownloadIt = testEffect(
  Layer.mergeAll(
    LSP.layer.pipe(Layer.provide(Config.defaultLayer), Layer.provide(RuntimeFlags.layer({ disableLspDownload: true }))),
    CrossSpawnSpawner.defaultLayer,
  ),
)

describe("lsp.spawn", () => {
  it.live("does not spawn builtin LSP for files outside instance", () =>
    provideTmpdirInstance(
      (dir) =>
        LSP.Service.use((lsp) =>
          Effect.gen(function* () {
            const spy = spyOn(LSPServer.Typescript, "spawn").mockResolvedValue(undefined)

            try {
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
      { config: { lsp: true } },
    ),
  )

  it.live("does not spawn builtin LSP for files inside instance when LSP is unset", () =>
    provideTmpdirInstance((dir) =>
      LSP.Service.use((lsp) =>
        Effect.gen(function* () {
          const spy = spyOn(LSPServer.Typescript, "spawn").mockResolvedValue(undefined)

          try {
            yield* lsp.hover({
              file: path.join(dir, "src", "inside.ts"),
              line: 0,
              character: 0,
            })
            expect(spy).toHaveBeenCalledTimes(0)
          } finally {
            spy.mockRestore()
          }
        }),
      ),
    ),
  )

  it.live("would spawn builtin LSP for files inside instance when lsp is true", () =>
    provideTmpdirInstance(
      (dir) =>
        LSP.Service.use((lsp) =>
          Effect.gen(function* () {
            const spy = spyOn(LSPServer.Typescript, "spawn").mockResolvedValue(undefined)

            try {
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
      { config: { lsp: true } },
    ),
  )

  it.live("would spawn builtin LSP for files inside instance when config object is provided", () =>
    provideTmpdirInstance(
      (dir) =>
        LSP.Service.use((lsp) =>
          Effect.gen(function* () {
            const spy = spyOn(LSPServer.Typescript, "spawn").mockResolvedValue(undefined)

            try {
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
      {
        config: {
          lsp: {
            eslint: { disabled: true },
          },
        },
      },
    ),
  )

  it.live("uses pyright instead of ty by default", () =>
    provideTmpdirInstance(
      (dir) =>
        LSP.Service.use((lsp) =>
          Effect.gen(function* () {
            const ty = spyOn(LSPServer.Ty, "spawn").mockResolvedValue(undefined)
            const pyright = spyOn(LSPServer.Pyright, "spawn").mockResolvedValue(undefined)

            try {
              yield* lsp.hover({
                file: path.join(dir, "src", "inside.py"),
                line: 0,
                character: 0,
              })
              expect(ty).toHaveBeenCalledTimes(0)
              expect(pyright).toHaveBeenCalledTimes(1)
            } finally {
              ty.mockRestore()
              pyright.mockRestore()
            }
          }),
        ),
      { config: { lsp: true } },
    ),
  )

  experimentalTyIt.live("uses ty instead of pyright when experimentalLspTy is enabled", () =>
    provideTmpdirInstance(
      (dir) =>
        LSP.Service.use((lsp) =>
          Effect.gen(function* () {
            const ty = spyOn(LSPServer.Ty, "spawn").mockResolvedValue(undefined)
            const pyright = spyOn(LSPServer.Pyright, "spawn").mockResolvedValue(undefined)

            try {
              yield* lsp.hover({
                file: path.join(dir, "src", "inside.py"),
                line: 0,
                character: 0,
              })
              expect(ty).toHaveBeenCalledTimes(1)
              expect(pyright).toHaveBeenCalledTimes(0)
            } finally {
              ty.mockRestore()
              pyright.mockRestore()
            }
          }),
        ),
      { config: { lsp: true } },
    ),
  )

  disabledDownloadIt.live("passes disableLspDownload to builtin LSP spawn", () =>
    provideTmpdirInstance(
      (dir) =>
        LSP.Service.use((lsp) =>
          Effect.gen(function* () {
            const pyright = spyOn(LSPServer.Pyright, "spawn").mockResolvedValue(undefined)

            try {
              yield* lsp.hover({
                file: path.join(dir, "src", "inside.py"),
                line: 0,
                character: 0,
              })
              expect(pyright).toHaveBeenCalledTimes(1)
              expect(pyright.mock.calls[0]?.[2]).toMatchObject({ disableLspDownload: true })
            } finally {
              pyright.mockRestore()
            }
          }),
        ),
      { config: { lsp: true } },
    ),
  )
})
