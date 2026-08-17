import { describe, expect } from "bun:test"
import path from "path"
import { Effect } from "effect"
import { Config } from "@opencode-ai/core/config"
import { Document, Info } from "@opencode-ai/schema/config"
import { ConfigToolOutput } from "@opencode-ai/schema/config/tool-output"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { ToolOutput } from "@opencode-ai/core/tool-output"
import { FSUtil } from "@opencode-ai/util/fs-util"
import { Global } from "@opencode-ai/util/global"
import { Identifier } from "@opencode-ai/core/id/id"
import { tmpdir } from "./fixture/tmpdir"
import { it } from "./lib/effect"

const withStore = <A, E, R>(
  body: (output: ToolOutput.Interface, fs: FSUtil.Interface, root: string) => Effect.Effect<A, E, R>,
  info = new Info(),
) =>
  Effect.acquireUseRelease(
    Effect.promise(() => tmpdir()),
    (tmp) => {
      const config = Config.testLayer([new Document({ type: "document", info })])
      const layer = AppNodeBuilder.build(LayerNode.group([ToolOutput.node, FSUtil.node]), [
        [Config.node, config],
        [Global.node, Global.layerWith({ data: tmp.path })],
      ])
      return Effect.gen(function* () {
        return yield* body(yield* ToolOutput.Service, yield* FSUtil.Service, tmp.path)
      }).pipe(Effect.provide(layer))
    },
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  )

describe("ToolOutput", () => {
  it.live("writes oversized text and returns a bounded preview", () =>
    withStore(
      (service, fs) =>
        Effect.gen(function* () {
          const output = { items: [1, 2, 3] }
          const result = yield* service.truncate({ output, content: "one\ntwo\nthree" })
          expect(result.output).toBe(output)
          expect(result.metadata).toMatchObject({ truncated: true })
          const outputPath = result.metadata?.outputPath
          expect(typeof outputPath).toBe("string")
          if (typeof outputPath !== "string") return
          expect(yield* fs.readFileString(outputPath)).toBe("one\ntwo\nthree")
          expect(result.content).toEqual([
            { type: "text", text: "one\ntwo" },
            { type: "text", text: `... 1 line truncated; full content saved to ${outputPath} ...` },
          ])
        }),
      new Info({ tool_output: new ConfigToolOutput.Info({ max_lines: 2, max_bytes: 1_000 }) }),
    ),
  )

  it.live("reports bytes omitted by the byte limit", () =>
    withStore(
      (output) =>
        Effect.gen(function* () {
          const result = yield* output.truncate({ content: "one\ntwo" })
          expect(result.content).toEqual([
            { type: "text", text: "one" },
            {
              type: "text",
              text: expect.stringMatching(/^\.\.\. 4 bytes truncated; full content saved to .+ \.\.\.$/),
            },
          ])
        }),
      new Info({ tool_output: new ConfigToolOutput.Info({ max_lines: 100, max_bytes: 5 }) }),
    ),
  )

  it.live("preserves mixed content ordering", () =>
    withStore(
      (output) =>
        Effect.gen(function* () {
          const file = { type: "file" as const, uri: "file:///image.png", mime: "image/png" }
          const result = yield* output.truncate({
            content: [{ type: "text", text: "before" }, file, { type: "text", text: "after\nomitted" }],
          })
          expect(result.content).toEqual([
            { type: "text", text: "before" },
            file,
            { type: "text", text: "after" },
            { type: "text", text: expect.stringMatching(/^\.\.\. 1 line truncated; full content saved to /) },
          ])
        }),
      new Info({ tool_output: new ConfigToolOutput.Info({ max_lines: 2, max_bytes: 1_000 }) }),
    ),
  )

  it.live("skips results that report a truncation state", () =>
    withStore((output) =>
      Effect.gen(function* () {
        const truncated = { content: "one\ntwo", metadata: { truncated: true, source: "tool" } }
        const retained = { content: "one\ntwo", metadata: { truncated: false, source: "tool" } }
        expect(yield* output.truncate(truncated)).toBe(truncated)
        expect(yield* output.truncate(retained)).toBe(retained)
      }),
    ),
  )

  it.live("marks results that fit without changing their content", () =>
    withStore((output) =>
      Effect.gen(function* () {
        const content = [{ type: "text" as const, text: "small" }]
        expect(yield* output.truncate({ content })).toEqual({ content, metadata: { truncated: false } })
      }),
    ),
  )

  it.live("does not count a trailing newline as another line", () =>
    withStore(
      (output) =>
        Effect.gen(function* () {
          expect(yield* output.truncate({ content: "one\ntwo\n" })).toEqual({
            content: "one\ntwo\n",
            metadata: { truncated: false },
          })
        }),
      new Info({ tool_output: new ConfigToolOutput.Info({ max_lines: 2, max_bytes: 1_000 }) }),
    ),
  )

  it.live("reports a trailing newline omitted by the byte limit", () =>
    withStore(
      (output) =>
        Effect.gen(function* () {
          const result = yield* output.truncate({ content: "one\n" })
          expect(result.content).toEqual([
            { type: "text", text: "one" },
            { type: "text", text: expect.stringMatching(/^\.\.\. 1 byte truncated; full content saved to /) },
          ])
        }),
      new Info({ tool_output: new ConfigToolOutput.Info({ max_lines: 2, max_bytes: 3 }) }),
    ),
  )

  it.live("uses file modification time when IDs wrap", () =>
    withStore((output, fs, root) =>
      Effect.gen(function* () {
        const directory = path.join(root, ToolOutput.DIRECTORY)
        const old = path.join(directory, Identifier.create("tool", "ascending", 2 ** 36 - 1))
        const recent = path.join(directory, Identifier.create("tool", "ascending", 2 ** 36 + 1))
        yield* fs.ensureDir(directory)
        yield* fs.writeFileString(old, "old")
        yield* fs.writeFileString(recent, "recent")
        yield* fs.utimes(old, new Date(), new Date(Date.now() - 8 * 24 * 60 * 60 * 1_000))
        yield* output.cleanup()
        expect(yield* fs.exists(old)).toBe(false)
        expect(yield* fs.exists(recent)).toBe(true)
      }),
    ),
  )
})
