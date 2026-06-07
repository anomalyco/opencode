import { describe, expect } from "bun:test"
import path from "path"
import { Cause, Effect, Exit, Fiber, Layer, Option } from "effect"
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
  it.live("bounds aggregate text and structured output with one managed file", () =>
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
        expect(result.output.structured).toEqual({})
        expect(result.outputPaths).toHaveLength(1)
        expect(JSON.parse(yield* fs.readFileString(result.outputPaths[0]))).toEqual({
          structured: { kind: "report" },
          content: [
            { type: "text", text: first },
            { type: "text", text: second },
          ],
        })
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
        expect(result.output.structured).toEqual({})
        expect(result.outputPaths).toHaveLength(1)
        expect(JSON.parse(yield* fs.readFileString(result.outputPaths[0]))).toEqual({ structured, content: [] })
        expect(result.output.content).toHaveLength(1)
      }),
    ),
  )

  it.live("preserves oversized inline media without duplicating its data", () =>
    withStore(({ store }) =>
      Effect.gen(function* () {
        const data = "a".repeat(ToolOutputStore.MAX_BYTES)
        const result = yield* store.bound({
          sessionID,
          toolCallID: "call-file",
          output: {
            structured: { caption: "pixel" },
            content: [{ type: "file", source: { type: "data", data }, mime: "image/png", name: "pixel.png" }],
          },
        })
        expect(result.outputPaths).toEqual([])
        expect(result.output.structured).toEqual({})
        expect(result.output.content).toHaveLength(1)
        expect(result.output.content[0]).toEqual({
          type: "file",
          source: { type: "data", data },
          mime: "image/png",
          name: "pixel.png",
        })
      }),
    ),
  )

  it.live("rejects inline media beyond the settlement media limit", () =>
    withStore(({ store }) =>
      Effect.gen(function* () {
        const exit = yield* store
          .bound({
            sessionID,
            toolCallID: "call-file-too-large",
            output: {
              structured: {},
              content: [
                {
                  type: "file",
                  source: { type: "data", data: "a".repeat(ToolOutputStore.MAX_INLINE_MEDIA_BYTES + 1) },
                  mime: "image/png",
                },
              ],
            },
          })
          .pipe(Effect.exit)
        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit))
          expect(Option.getOrUndefined(Cause.findErrorOption(exit.cause))?._tag).toBe("ToolOutputStore.MediaLimitError")
      }),
    ),
  )

  it.live("rejects inline media whose aggregate size exceeds the settlement limit", () =>
    withStore(({ store }) =>
      Effect.gen(function* () {
        const exit = yield* store
          .bound({
            sessionID,
            toolCallID: "call-files-too-large",
            output: {
              structured: {},
              content: [
                { type: "file", source: { type: "data", data: "a".repeat(3 * 1024 * 1024) }, mime: "image/png" },
                { type: "file", source: { type: "data", data: "b".repeat(3 * 1024 * 1024) }, mime: "image/png" },
              ],
            },
          })
          .pipe(Effect.exit)
        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit))
          expect(Option.getOrUndefined(Cause.findErrorOption(exit.cause))?._tag).toBe("ToolOutputStore.MediaLimitError")
      }),
    ),
  )

  it.live("fails oversized settlement when complete retention cannot be written", () =>
    withStore(({ root, store, fs }) =>
      Effect.gen(function* () {
        yield* fs.writeFileString(path.join(root, "tool-output"), "not a directory")
        const exit = yield* store
          .bound({
            sessionID,
            toolCallID: "call-lossy",
            output: { structured: {}, content: [{ type: "text", text: "x".repeat(ToolOutputStore.MAX_BYTES + 1) }] },
          })
          .pipe(Effect.exit)
        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit))
          expect(Option.getOrUndefined(Cause.findErrorOption(exit.cause))?._tag).toBe("ToolOutputStore.StorageError")
      }),
    ),
  )

  it.live("fails operationally when output cannot be encoded for bounding", () =>
    withStore(({ store }) =>
      Effect.gen(function* () {
        const exit = yield* store
          .bound({
            sessionID,
            toolCallID: "call-unencodable",
            output: {
              structured: { value: 1n },
              content: [{ type: "text", text: "readable text" }],
            },
          })
          .pipe(Effect.exit)
        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit))
          expect(Option.getOrUndefined(Cause.findErrorOption(exit.cause))?._tag).toBe("ToolOutputStore.StorageError")
      }),
    ),
  )

  it.live("preserves interruption while retaining complete output", () =>
    Effect.gen(function* () {
      const root = yield* Effect.promise(() => tmpdir())
      const blockedFilesystem = Layer.effect(
        FSUtil.Service,
        Effect.gen(function* () {
          const fs = yield* FSUtil.Service
          return FSUtil.Service.of({
            ...fs,
            ensureDir: () => Effect.void,
            writeFileString: () => Effect.never,
          })
        }),
      ).pipe(Layer.provide(FSUtil.defaultLayer))
      const store = ToolOutputStore.layer.pipe(
        Layer.provide(blockedFilesystem),
        Layer.provide(Global.layerWith({ data: root.path })),
      )
      const exit = yield* Effect.gen(function* () {
        const service = yield* ToolOutputStore.Service
        const fiber = yield* service
          .bound({
            sessionID,
            toolCallID: "call-interrupted",
            output: { structured: {}, content: [{ type: "text", text: "x".repeat(ToolOutputStore.MAX_BYTES + 1) }] },
          })
          .pipe(Effect.forkChild)
        yield* Fiber.interrupt(fiber)
        return yield* Fiber.await(fiber)
      }).pipe(Effect.provide(store))
      expect(Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)).toBe(true)
      yield* Effect.promise(() => root[Symbol.asyncDispose]())
    }),
  )

  it.live("honors configured limits", () =>
    withStore(
      ({ store }) =>
        Effect.gen(function* () {
          expect(yield* store.limits()).toEqual({ maxLines: 2, maxBytes: 1_000 })
          const result = yield* store.bound({
            sessionID,
            toolCallID: "call-config",
            output: { structured: {}, content: [{ type: "text", text: "one\ntwo\nthree" }] },
          })
          expect(result.outputPaths).toHaveLength(1)
        }),
      new Config.Info({ tool_output: new ConfigToolOutput.Info({ max_lines: 2, max_bytes: 1_000 }) }),
    ),
  )

  it.live("cleans expired managed files and preserves unrelated files", () =>
    withStore(({ root, store, fs }) =>
      Effect.gen(function* () {
        const old = path.join(root, "tool-output", "tool_old")
        const recent = path.join(root, "tool-output", "tool_recent")
        const unrelated = path.join(root, "tool-output", "keep.txt")
        yield* fs.ensureDir(path.join(root, "tool-output"))
        yield* fs.writeFileString(old, "old")
        yield* fs.writeFileString(recent, "recent")
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
