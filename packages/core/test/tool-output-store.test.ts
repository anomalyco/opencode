import { describe, expect } from "bun:test"
import path from "path"
import { Effect, Layer, Stream } from "effect"
import { Config } from "@opencode-ai/core/config"
import { Document, Info } from "@opencode-ai/schema/config"
import { ConfigToolOutput } from "@opencode-ai/schema/config/tool-output"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { ToolOutputStore } from "@opencode-ai/core/tool-output-store"
import { FSUtil } from "@opencode-ai/util/fs-util"
import { Global } from "@opencode-ai/util/global"
import { tmpdir } from "./fixture/tmpdir"
import { it } from "./lib/effect"

const withStore = <A, E, R>(
  body: (store: ToolOutputStore.Interface, fs: FSUtil.Interface, root: string) => Effect.Effect<A, E, R>,
  info = new Info(),
) =>
  Effect.acquireUseRelease(
    Effect.promise(() => tmpdir()),
    (tmp) => {
      const config = Layer.succeed(
        Config.Service,
        Config.Service.of({
          entries: () => Effect.succeed([new Document({ type: "document", info })]),
          changes: () => Stream.empty,
        }),
      )
      const layer = AppNodeBuilder.build(LayerNode.group([ToolOutputStore.node, FSUtil.node]), [
        [Config.node, config],
        [Global.node, Global.layerWith({ data: tmp.path })],
      ])
      return Effect.gen(function* () {
        return yield* body(yield* ToolOutputStore.Service, yield* FSUtil.Service, tmp.path)
      }).pipe(Effect.provide(layer))
    },
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  )

describe("ToolOutputStore", () => {
  it.live("writes oversized text and returns a bounded preview", () =>
    withStore(
      (store, fs) =>
        Effect.gen(function* () {
          const output = { items: [1, 2, 3] }
          const result = yield* store.bound({ output, content: "one\ntwo\nthree" })
          expect(result.output).toBe(output)
          expect(result.metadata).toMatchObject({ truncated: true })
          const outputPath = result.metadata?.outputPath
          expect(typeof outputPath).toBe("string")
          if (typeof outputPath !== "string") return
          expect(yield* fs.readFileString(outputPath)).toBe("one\ntwo\nthree")
          expect(result.content).toEqual([
            { type: "text", text: `one\ntwo\n\n... output truncated; full content saved to ${outputPath} ...` },
          ])
        }),
      new Info({ tool_output: new ConfigToolOutput.Info({ max_lines: 2, max_bytes: 1_000 }) }),
    ),
  )

  it.live("skips results already marked truncated", () =>
    withStore((store) =>
      Effect.gen(function* () {
        const result = { content: "one\ntwo", metadata: { truncated: true, source: "tool" } }
        expect(yield* store.bound(result)).toBe(result)
      }),
    ),
  )

  it.live("marks results that fit without changing their content", () =>
    withStore((store) =>
      Effect.gen(function* () {
        const content = [{ type: "text" as const, text: "small" }]
        expect(yield* store.bound({ content })).toEqual({ content, metadata: { truncated: false } })
      }),
    ),
  )

  it.live("removes expired managed files", () =>
    withStore((store, fs, root) =>
      Effect.gen(function* () {
        const directory = path.join(root, ToolOutputStore.DIRECTORY)
        const old = path.join(directory, "tool_old")
        const recent = path.join(directory, "tool_recent")
        yield* fs.ensureDir(directory)
        yield* fs.writeFileString(old, "old")
        yield* fs.writeFileString(recent, "recent")
        const expired = new Date(Date.now() - 8 * 24 * 60 * 60 * 1_000)
        yield* fs.utimes(old, expired, expired)
        yield* store.cleanup()
        expect(yield* fs.exists(old)).toBe(false)
        expect(yield* fs.exists(recent)).toBe(true)
      }),
    ),
  )
})
