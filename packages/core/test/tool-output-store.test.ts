import { describe, expect } from "bun:test"
import path from "path"
import { Effect, Layer } from "effect"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Global } from "@opencode-ai/core/global"
import { Config } from "@opencode-ai/core/config"
import { ConfigToolOutput } from "@opencode-ai/core/config/tool-output"
import { SessionV2 } from "@opencode-ai/core/session"
import { ToolOutputStore } from "@opencode-ai/core/tool-output-store"
import { testEffect } from "./lib/effect"
import { tmpdir } from "./fixture/tmpdir"

const sessionID = SessionV2.ID.make("ses_tool_output_store")

const withStore = <A, E, R>(
  body: (input: { root: string; store: ToolOutputStore.Interface; fs: FSUtil.Interface }) => Effect.Effect<A, E, R>,
  config?: Config.Info,
) =>
  Effect.acquireUseRelease(
    Effect.promise(() => tmpdir()),
    (tmp) => {
      const global = Global.layerWith({ data: tmp.path })
      const configured = config
        ? Layer.succeed(
            Config.Service,
            Config.Service.of({
              entries: () => Effect.succeed([new Config.Document({ type: "document", info: config })]),
            }),
          )
        : Layer.empty
      const store = ToolOutputStore.layer.pipe(
        Layer.provide(FSUtil.defaultLayer),
        Layer.provide(global),
        Layer.provide(configured),
      )
      return Effect.gen(function* () {
        return yield* body({ root: tmp.path, store: yield* ToolOutputStore.Service, fs: yield* FSUtil.Service })
      }).pipe(Effect.provide(Layer.mergeAll(store, FSUtil.defaultLayer)))
    },
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  )

const it = testEffect(Layer.empty)

describe("ToolOutputStore", () => {
  it.live("returns under-limit text unchanged without writing a file", () =>
    withStore(({ store }) =>
      Effect.gen(function* () {
        expect(yield* store.truncate({ sessionID, toolCallID: "call-short", content: "one\ntwo" })).toEqual({
          content: "one\ntwo",
          truncated: false,
        })
      }),
    ),
  )

  it.live("stores full output at an absolute managed path", () =>
    withStore(({ root, store, fs }) =>
      Effect.gen(function* () {
        const content = "HEAD-" + "x".repeat(500) + "-TAIL"
        const result = yield* store.truncate({ sessionID, toolCallID: "call-large", content, maxBytes: 300 })
        expect(result.truncated).toBe(true)
        if (!result.truncated) throw new Error("expected truncation")
        expect(path.isAbsolute(result.outputPath)).toBe(true)
        expect(result.outputPath).toStartWith(path.join(root, "tool-output", "tool_"))
        expect(result.content).toContain(result.outputPath)
        expect(result.content).toContain("HEAD-")
        expect(result.content).toContain("-TAIL")
        expect(yield* fs.readFileString(result.outputPath)).toBe(content)
      }),
    ),
  )

  it.live("bounds aggregate text blocks with one managed file", () =>
    withStore(({ store, fs }) =>
      Effect.gen(function* () {
        const first = "HEAD-" + "x".repeat(30_000)
        const second = "y".repeat(30_000) + "-TAIL"
        const result = yield* store.bound({
          sessionID,
          toolCallID: "call-aggregate",
          output: {
            structured: { kind: "report" },
            content: [
              { type: "text", text: first },
              { type: "text", text: second },
            ],
          },
        })
        expect(result.output.structured).toEqual({ kind: "report" })
        expect(result.outputPaths).toHaveLength(1)
        expect(yield* fs.readFileString(result.outputPaths[0]!)).toBe(`${first}\n\n${second}`)
        if (result.output.content[0]?.type !== "text") throw new Error("expected text preview")
        expect(Buffer.byteLength(result.output.content[0].text)).toBeLessThanOrEqual(ToolOutputStore.MAX_BYTES)
      }),
    ),
  )

  it.live("uses bounded text for oversized structured-only output", () =>
    withStore(({ store, fs }) =>
      Effect.gen(function* () {
        const structured = { text: "x".repeat(ToolOutputStore.MAX_BYTES) }
        const result = yield* store.bound({ sessionID, toolCallID: "call-json", output: { structured, content: [] } })
        expect(result.output.structured).toBe(structured)
        expect(result.outputPaths).toHaveLength(1)
        expect(yield* fs.readFileString(result.outputPaths[0]!)).toBe(JSON.stringify(structured))
      }),
    ),
  )

  it.live("degrades to lossy bounded output when writing fails", () =>
    withStore(({ root, store, fs }) =>
      Effect.gen(function* () {
        yield* fs.writeFileString(path.join(root, "tool-output"), "not a directory")
        const result = yield* store.bound({
          sessionID,
          toolCallID: "call-lossy",
          output: { structured: {}, content: [{ type: "text", text: "x".repeat(ToolOutputStore.MAX_BYTES + 1) }] },
        })
        expect(result.outputPaths).toEqual([])
        if (result.output.content[0]?.type !== "text") throw new Error("expected text preview")
        expect(result.output.content[0].text).toContain("could not be retained")
      }),
    ),
  )

  it.live("honors configured limits", () =>
    withStore(
      ({ store }) =>
        Effect.gen(function* () {
          expect(yield* store.limits()).toEqual({ maxLines: 2, maxBytes: 1_000 })
          expect(
            (yield* store.truncate({ sessionID, toolCallID: "call-config", content: "one\ntwo\nthree" })).truncated,
          ).toBe(true)
        }),
      new Config.Info({ tool_output: new ConfigToolOutput.Info({ max_lines: 2, max_bytes: 1_000 }) }),
    ),
  )

  it.live("cleans expired managed files and preserves unrelated files", () =>
    withStore(({ root, store, fs }) =>
      Effect.gen(function* () {
        const old = yield* store.write({ sessionID, toolCallID: "old", content: "old" })
        const recent = yield* store.write({ sessionID, toolCallID: "recent", content: "recent" })
        const unrelated = path.join(root, "tool-output", "keep.txt")
        yield* fs.writeFileString(unrelated, "keep")
        const expired = new Date(Date.now() - 8 * 24 * 60 * 60 * 1_000)
        yield* fs.utimes(old, expired, expired)
        yield* store.cleanup()
        expect(yield* fs.exists(old)).toBe(false)
        expect(yield* fs.exists(recent)).toBe(true)
        expect(yield* fs.exists(unrelated)).toBe(true)
      }),
    ),
  )
})
