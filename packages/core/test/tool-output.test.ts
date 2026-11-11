import { describe, expect } from "bun:test"
import path from "path"
import { Effect } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { ToolOutput } from "@opencode/core/tool-output"
import type { Tool } from "@opencode/core/tool"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { withTempDir } from "./fixture/tmpdir"
import { it } from "./lib/effect"

const withStore = <A, E, R>(
  body: (output: ToolOutput.Interface, fs: FSUtil.Interface, root: string) => Effect.Effect<A, E, R>,
  limits?: { maxLines?: number; maxBytes?: number },
) =>
  withTempDir((tmp) => {
    const layer = AppNodeBuilder.build(LayerNode.group([ToolOutput.node, FSUtil.node]), [
      Global.node.replace(Global.layerWith({ data: tmp.path })),
    ])
    return Effect.gen(function* () {
      const output = yield* ToolOutput.Service
      const fs = yield* FSUtil.Service
      if (limits) yield* output.transform((editor) => editor.configure(limits))
      return yield* body(output, fs, tmp.path)
    }).pipe(Effect.provide(layer))
  })

describe("ToolOutput", () => {
  it.live("writes oversized text and returns a bounded head+tail preview", () =>
    withStore(
      (service, fs) =>
        Effect.gen(function* () {
          const output = { items: [1, 2, 3] }
          const result = yield* service.truncate({ output, content: [{ type: "text", text: "one\ntwo\nthree" }] })
          expect(result.output).toBe(output)
          expect(result.metadata).toMatchObject({ truncated: true })
          const outputPath = result.metadata?.outputPath
          expect(typeof outputPath).toBe("string")
          if (typeof outputPath !== "string") return
          expect(yield* fs.readFileString(outputPath)).toBe("one\ntwo\nthree")
          expect(result.content).toEqual([
            {
              type: "text",
              text: `one\n[showing lines 1-1 and 3-3 of 3; full output saved to ${outputPath}]\nthree`,
            },
          ])
        }),
      { maxLines: 2, maxBytes: 1_000 },
    ),
  )

  it.live("keeps the tail when only the tail fits the byte limit", () =>
    withStore(
      (output) =>
        Effect.gen(function* () {
          const result = yield* output.truncate({ content: [{ type: "text", text: "one\ntwo" }] })
          expect(result.content).toEqual([
            { type: "text", text: expect.stringMatching(/^\[showing lines 2-2 of 2; full output saved to .+\]\ntwo$/) },
          ])
        }),
      { maxLines: 100, maxBytes: 5 },
    ),
  )

  it.live("keeps the head and tail within the line limit", () =>
    withStore(
      (output) =>
        Effect.gen(function* () {
          const lines = Array.from({ length: 100 }, (_, index) => `l${index + 1}`)
          const result = yield* output.truncate({ content: [{ type: "text", text: lines.join("\n") }] })
          const outputPath = result.metadata?.outputPath
          expect(result.content).toEqual([
            {
              type: "text",
              text: `${lines.slice(0, 5).join("\n")}\n[showing lines 1-5 and 96-100 of 100; full output saved to ${outputPath}]\n${lines.slice(-5).join("\n")}`,
            },
          ])
          const text = result.content[0]?.type === "text" ? result.content[0].text : ""
          expect(text.split("\n").filter((line) => !line.startsWith("[showing "))).toHaveLength(10)
        }),
      { maxLines: 10, maxBytes: 1_000_000 },
    ),
  )

  it.live("reports only the head when the line budget has no tail room", () =>
    withStore(
      (output) =>
        Effect.gen(function* () {
          const result = yield* output.truncate({ content: [{ type: "text", text: "short\nomitted" }] })
          expect(result.content).toEqual([
            {
              type: "text",
              text: expect.stringMatching(/^short\n\[showing lines 1-1 of 2; full output saved to .+\]$/),
            },
          ])
        }),
      { maxLines: 1, maxBytes: 1_000 },
    ),
  )

  it.live("keeps multibyte tails intact", () =>
    withStore(
      (output) =>
        Effect.gen(function* () {
          const result = yield* output.truncate({ content: [{ type: "text", text: "开头\n中间\n结尾🚀" }] })
          const text = result.content[0]?.type === "text" ? result.content[0].text : ""
          expect(text).toMatch(/^开头\n\[showing lines 1-1 and 3-3 of 3; full output saved to .+\]\n结尾🚀$/)
          expect(text).not.toContain("\uFFFD")
        }),
      { maxLines: 2, maxBytes: 1_000 },
    ),
  )

  it.live("keeps attachments where they were in the content", () =>
    withStore(
      (output) =>
        Effect.gen(function* () {
          const file = { type: "file" as const, uri: "file:///image.png", mime: "image/png" }
          const result = yield* output.truncate({
            content: [{ type: "text", text: "before" }, file, { type: "text", text: "after\nomitted" }],
          })
          const outputPath = result.metadata?.outputPath
          expect(result.content).toEqual([
            { type: "text", text: `before\n[showing lines 1-1 and 3-3 of 3; full output saved to ${outputPath}]` },
            file,
            { type: "text", text: "omitted" },
          ])
        }),
      { maxLines: 2, maxBytes: 1_000 },
    ),
  )

  it.live("gives unused tail budget back to the head", () =>
    withStore(
      (output) =>
        Effect.gen(function* () {
          const text = `${Array.from({ length: 30 }, (_, index) => `s${index + 1}`).join("\n")}\n${"x".repeat(2_000)}`
          const result = yield* output.truncate({ content: [{ type: "text", text }] })
          const preview = result.content[0]?.type === "text" ? result.content[0].text : ""
          expect(preview).toMatch(/\[showing lines 1-10 of 31; full output saved to .+\]$/)
          expect(preview.split("\n").filter((line) => line.startsWith("s"))).toHaveLength(10)
        }),
      { maxLines: 10, maxBytes: 1_000 },
    ),
  )

  it.live("keeps content when the marker alone exceeds the byte limit", () =>
    withStore(
      (output) =>
        Effect.gen(function* () {
          const text = Array.from({ length: 20 }, () => "x".repeat(20)).join("\n")
          const result = yield* output.truncate({ content: [{ type: "text", text }] })
          const preview = result.content[0]?.type === "text" ? result.content[0].text : ""
          expect(preview.startsWith("x")).toBe(true)
          expect(preview).toContain("[showing lines ")
        }),
      { maxLines: 10, maxBytes: 100 },
    ),
  )

  it.live("keeps text lines on the same side of an attachment", () =>
    withStore(
      (output) =>
        Effect.gen(function* () {
          const file = { type: "file" as const, uri: "file:///image.png", mime: "image/png" }
          const result = yield* output.truncate({
            content: [{ type: "text", text: "a1\na2\na3\na4\na5\na6" }, file, { type: "text", text: "b1" }],
          })
          const outputPath = result.metadata?.outputPath
          expect(result.content).toEqual([
            {
              type: "text",
              text: `a1\na2\n[showing lines 1-2 and 6-7 of 7; full output saved to ${outputPath}]\na6`,
            },
            file,
            { type: "text", text: "b1" },
          ])
        }),
      { maxLines: 4, maxBytes: 1_000 },
    ),
  )

  it.live("keeps the preview within the byte limit", () =>
    withStore(
      (output) =>
        Effect.gen(function* () {
          const lines = Array.from({ length: 20 }, () => "x".repeat(100))
          const result = yield* output.truncate({ content: [{ type: "text", text: lines.join("\n") }] })
          const text = result.content[0]?.type === "text" ? result.content[0].text : ""
          expect(text).toContain("x")
          expect(text).toContain("[showing lines ")
          expect(Buffer.byteLength(text, "utf-8")).toBeLessThanOrEqual(400)
        }),
      { maxLines: 1_000, maxBytes: 400 },
    ),
  )

  it.live("keeps a leading attachment ahead of the preview", () =>
    withStore(
      (output) =>
        Effect.gen(function* () {
          const file = { type: "file" as const, uri: "file:///image.png", mime: "image/png" }
          const result = yield* output.truncate({
            content: [file, { type: "text", text: "line1\nline2" }],
          })
          expect(result.content[0]).toBe(file)
          expect(result.content[1]).toEqual({
            type: "text",
            text: expect.stringMatching(/^line1\n\[showing lines 1-1 of 2; full output saved to .+\]$/),
          })
        }),
      { maxLines: 1, maxBytes: 1_000 },
    ),
  )

  it.live("skips results that report a truncation state", () =>
    withStore((output) =>
      Effect.gen(function* () {
        const content: Tool.NormalizedResult["content"] = [{ type: "text", text: "one\ntwo" }]
        const truncated = { content, metadata: { truncated: true, source: "tool" } }
        const retained = { content, metadata: { truncated: false, source: "tool" } }
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
          expect(yield* output.truncate({ content: [{ type: "text", text: "one\ntwo\n" }] })).toEqual({
            content: [{ type: "text", text: "one\ntwo\n" }],
            metadata: { truncated: false },
          })
        }),
      { maxLines: 2, maxBytes: 1_000 },
    ),
  )

  it.live("reports a trailing newline omitted by the byte limit", () =>
    withStore(
      (output) =>
        Effect.gen(function* () {
          const result = yield* output.truncate({ content: [{ type: "text", text: "one\n" }] })
          expect(result.content).toEqual([
            { type: "text", text: expect.stringMatching(/^\[showing lines 1-1 of 1; full output saved to .+\]\none$/) },
          ])
        }),
      { maxLines: 2, maxBytes: 3 },
    ),
  )

  it.live("uses file modification time when IDs wrap", () =>
    withStore((output, fs, root) =>
      Effect.gen(function* () {
        const directory = path.join(root, ToolOutput.DIRECTORY)
        const old = path.join(directory, ToolOutput.fileName(2 ** 36 - 1))
        const recent = path.join(directory, ToolOutput.fileName(2 ** 36 + 1))
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
