import { describe, expect, spyOn } from "bun:test"
import path from "path"
import { Effect, Layer } from "effect"
import { LSP } from "@/lsp/lsp"
import * as LSPServer from "@/lsp/server"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Flag } from "@opencode-ai/core/flag/flag"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(LSP.defaultLayer, CrossSpawnSpawner.defaultLayer))

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

  it.live("does not spawn pyrefly when experimental flag is disabled", () =>
    provideTmpdirInstance(
      (dir) =>
        LSP.Service.use((lsp) =>
          Effect.gen(function* () {
            const originalPyrefly = Flag.OPENCODE_EXPERIMENTAL_LSP_PYREFLY
            const spy = spyOn(LSPServer.Pyrefly, "spawn").mockResolvedValue(undefined)

            try {
              Flag.OPENCODE_EXPERIMENTAL_LSP_PYREFLY = false
              yield* lsp.hover({
                file: path.join(dir, "src", "inside.py"),
                line: 0,
                character: 0,
              })
              expect(spy).toHaveBeenCalledTimes(0)
            } finally {
              Flag.OPENCODE_EXPERIMENTAL_LSP_PYREFLY = originalPyrefly
              spy.mockRestore()
            }
          }),
        ),
      { config: { lsp: true } },
    ),
  )

  it.live("spawns pyrefly for python files when experimental flag is enabled", () =>
    provideTmpdirInstance(
      (dir) =>
        LSP.Service.use((lsp) =>
          Effect.gen(function* () {
            const originalPyrefly = Flag.OPENCODE_EXPERIMENTAL_LSP_PYREFLY
            const spy = spyOn(LSPServer.Pyrefly, "spawn").mockResolvedValue(undefined)

            try {
              Flag.OPENCODE_EXPERIMENTAL_LSP_PYREFLY = true
              yield* lsp.hover({
                file: path.join(dir, "src", "inside.py"),
                line: 0,
                character: 0,
              })
              expect(spy).toHaveBeenCalledTimes(1)
            } finally {
              Flag.OPENCODE_EXPERIMENTAL_LSP_PYREFLY = originalPyrefly
              spy.mockRestore()
            }
          }),
        ),
      { config: { lsp: true } },
    ),
  )

  it.live("does not spawn competing python LSPs when pyrefly is enabled", () =>
    provideTmpdirInstance(
      (dir) =>
        LSP.Service.use((lsp) =>
          Effect.gen(function* () {
            const originalPyrefly = Flag.OPENCODE_EXPERIMENTAL_LSP_PYREFLY
            const originalTy = Flag.OPENCODE_EXPERIMENTAL_LSP_TY
            const pyreflySpy = spyOn(LSPServer.Pyrefly, "spawn").mockResolvedValue(undefined)
            const pyrightSpy = spyOn(LSPServer.Pyright, "spawn").mockResolvedValue(undefined)
            const tySpy = spyOn(LSPServer.Ty, "spawn").mockResolvedValue(undefined)

            try {
              Flag.OPENCODE_EXPERIMENTAL_LSP_PYREFLY = true
              Flag.OPENCODE_EXPERIMENTAL_LSP_TY = true
              yield* lsp.hover({
                file: path.join(dir, "src", "inside.py"),
                line: 0,
                character: 0,
              })
              expect(pyreflySpy).toHaveBeenCalledTimes(1)
              expect(pyrightSpy).toHaveBeenCalledTimes(0)
              expect(tySpy).toHaveBeenCalledTimes(0)
            } finally {
              Flag.OPENCODE_EXPERIMENTAL_LSP_PYREFLY = originalPyrefly
              Flag.OPENCODE_EXPERIMENTAL_LSP_TY = originalTy
              pyreflySpy.mockRestore()
              pyrightSpy.mockRestore()
              tySpy.mockRestore()
            }
          }),
        ),
      { config: { lsp: true } },
    ),
  )
})
