import { describe, expect } from "bun:test"
import path from "path"
import { Cause, Effect, Exit, Fiber, Layer, Option } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
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

      const store = AppNodeBuilder.build(LayerNode.group([ToolOutputStore.node, FSUtil.node]), [
        [Global.node, global],
        [Config.node, configured],
      ])
      return Effect.gen(function* () {
        return yield* body({ root: tmp.path, store: yield* ToolOutputStore.Service, fs: yield* FSUtil.Service })
      }).pipe(Effect.provide(store))
    },
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  )

const it = testEffect(Layer.empty)

describe("ToolOutputStore", () => {
  it.live("bounds the provider-facing text channel with one managed file", () =>
    withStore(({ store, fs }) =>
      Effect.gen(function* () {
        const first = "HEAD-" + "x".repeat(30_000)
        const second = "y".repeat(30_000) + "-TAIL"
        const result = yield* store.bound({
          sessionID,
          callID: "call-aggregate",
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
        expect(yield* fs.readFileString(result.outputPaths[0])).toBe(first + second)
        if (result.output.content[0]?.type !== "text") throw new Error("expected text preview")
        expect(Buffer.byteLength(result.output.content[0].text)).toBeLessThanOrEqual(ToolOutputStore.MAX_BYTES)
      }),
    ),
  )

  it.live("uses bounded text for oversized structured-only output", () =>
    withStore(({ store, fs }) =>
      Effect.gen(function* () {
        const structured = { text: "x".repeat(ToolOutputStore.MAX_BYTES) }
        const result = yield* store.bound({ sessionID, callID: "call-json", output: { structured, content: [] } })
        expect(result.output.structured).toEqual({
          _truncated: true,
          _bytes: Buffer.byteLength(JSON.stringify(structured)),
          _outputPath: result.outputPaths[0],
        })
        expect(Buffer.byteLength(JSON.stringify(result.output.structured))).toBeLessThanOrEqual(
          ToolOutputStore.MAX_STRUCTURED_BYTES,
        )
        expect(result.outputPaths).toHaveLength(1)
        expect(JSON.parse(yield* fs.readFileString(result.outputPaths[0]))).toEqual(structured)
        expect(result.output.content).toHaveLength(1)
      }),
    ),
  )

  it.live("projects guarded structured-only output into the bounded content channel", () =>
    withStore(({ store, fs }) =>
      Effect.gen(function* () {
        const structured = { text: "x".repeat(ToolOutputStore.MAX_STRUCTURED_BYTES) }
        const result = yield* store.bound({
          sessionID,
          callID: "call-structured-content",
          output: { structured, content: [] },
        })
        expect(result.output.structured).toEqual({
          _truncated: true,
          _bytes: Buffer.byteLength(JSON.stringify(structured)),
          _outputPath: result.outputPaths[0],
        })
        expect(result.output.content).toEqual([{ type: "text", text: JSON.stringify(structured) }])
        expect(JSON.parse(yield* fs.readFileString(result.outputPaths[0]))).toEqual(structured)
      }),
    ),
  )

  it.live("measures the structured boundary in UTF-8 bytes", () =>
    withStore(({ store }) =>
      Effect.gen(function* () {
        const structured = { text: "é".repeat(ToolOutputStore.MAX_STRUCTURED_BYTES / 2) }
        const encoded = JSON.stringify(structured)
        expect(structured.text.length).toBeLessThan(ToolOutputStore.MAX_STRUCTURED_BYTES)
        expect(Buffer.byteLength(encoded)).toBeGreaterThan(ToolOutputStore.MAX_STRUCTURED_BYTES)

        const result = yield* store.bound({
          sessionID,
          callID: "call-structured-utf8",
          output: { structured, content: [] },
        })

        expect(result.output.structured).toMatchObject({
          _truncated: true,
          _bytes: Buffer.byteLength(encoded),
        })
      }),
    ),
  )

  it.live("retains independent structured and contextual overflow", () =>
    withStore(({ store, fs }) =>
      Effect.gen(function* () {
        const structured = { detail: "s".repeat(ToolOutputStore.MAX_STRUCTURED_BYTES) }
        const content = "c".repeat(ToolOutputStore.MAX_BYTES + 1)
        const result = yield* store.bound({
          sessionID,
          callID: "call-two-channel-overflow",
          output: { structured, content: [{ type: "text", text: content }] },
        })

        expect(result.outputPaths).toHaveLength(2)
        expect(JSON.parse(yield* fs.readFileString(result.outputPaths[0]))).toEqual(structured)
        expect(yield* fs.readFileString(result.outputPaths[1])).toBe(content)
      }),
    ),
  )

  it.live("keeps structured output at the receipt boundary inline", () =>
    withStore(({ store }) =>
      Effect.gen(function* () {
        const empty = JSON.stringify({ text: "" })
        const structured = { text: "x".repeat(ToolOutputStore.MAX_STRUCTURED_BYTES - Buffer.byteLength(empty)) }
        expect(Buffer.byteLength(JSON.stringify(structured))).toBe(ToolOutputStore.MAX_STRUCTURED_BYTES)

        const result = yield* store.bound({
          sessionID,
          callID: "call-structured-boundary",
          output: { structured, content: [] },
        })

        expect(result).toEqual({ output: { structured, content: [] }, outputPaths: [] })
      }),
    ),
  )

  it.live("normalizes structured values to their durable JSON record", () =>
    withStore(({ store }) =>
      Effect.gen(function* () {
        const primitive = yield* store.bound({
          sessionID,
          callID: "call-primitive",
          output: { structured: "value", content: [] },
        })
        const nonFinite = yield* store.bound({
          sessionID,
          callID: "call-non-finite",
          output: { structured: { value: Number.NaN }, content: [] },
        })
        const omitted = yield* store.bound({
          sessionID,
          callID: "call-omitted",
          output: { structured: undefined, content: [] },
        })

        expect(primitive.output.structured).toEqual({ value: "value" })
        expect(nonFinite.output.structured).toEqual({ value: null })
        expect(omitted.output.structured).toEqual({})
      }),
    ),
  )

  it.live("measures primitive overflow after durable record normalization", () =>
    withStore(({ store, fs }) =>
      Effect.gen(function* () {
        const value = "x".repeat(ToolOutputStore.MAX_STRUCTURED_BYTES)
        const encoded = JSON.stringify({ value })
        const result = yield* store.bound({
          sessionID,
          callID: "call-primitive-overflow",
          output: { structured: value, content: [] },
        })

        expect(result.output.structured).toEqual({
          _truncated: true,
          _bytes: Buffer.byteLength(encoded),
          _outputPath: result.outputPaths[0],
        })
        expect(yield* fs.readFileString(result.outputPaths[0])).toBe(encoded)
      }),
    ),
  )

  it.live("preserves native media and structured metadata without applying a settlement media limit", () =>
    withStore(({ store }) =>
      Effect.gen(function* () {
        const data = "a".repeat(6 * 1024 * 1024)
        const result = yield* store.bound({
          sessionID,
          callID: "call-file",
          output: {
            structured: { caption: "pixel" },
            content: [{ type: "file", uri: `data:image/png;base64,${data}`, mime: "image/png", name: "pixel.png" }],
          },
        })
        expect(result.outputPaths).toEqual([])
        expect(result.output.structured).toEqual({ caption: "pixel" })
        expect(result.output.content).toHaveLength(1)
        expect(result.output.content[0]).toEqual({
          type: "file",
          uri: `data:image/png;base64,${data}`,
          mime: "image/png",
          name: "pixel.png",
        })
      }),
    ),
  )

  it.live("preserves structured metadata and native media when bounding text", () =>
    withStore(({ store, fs }) =>
      Effect.gen(function* () {
        const text = "x".repeat(ToolOutputStore.MAX_BYTES + 1)
        const media = {
          type: "file" as const,
          uri: "data:image/png;base64,aGVsbG8=",
          mime: "image/png",
          name: "pixel.png",
        }
        const result = yield* store.bound({
          sessionID,
          callID: "call-text-and-media",
          output: { structured: { caption: "pixel" }, content: [{ type: "text", text }, media] },
        })

        expect(result.output.structured).toEqual({ caption: "pixel" })
        expect(result.output.content[1]).toEqual(media)
        expect(yield* fs.readFileString(result.outputPaths[0])).toBe(text)
      }),
    ),
  )

  it.live("marks projected receipt metadata truncated when bounding its contextual output", () =>
    withStore(({ store }) =>
      Effect.gen(function* () {
        const result = yield* store.bound({
          sessionID,
          callID: "call-receipt",
          propagateTruncation: true,
          output: {
            structured: { bytes: ToolOutputStore.MAX_BYTES + 1, truncated: false },
            content: [{ type: "text", text: "x".repeat(ToolOutputStore.MAX_BYTES + 1) }],
          },
        })
        expect(result.output.structured).toEqual({ bytes: ToolOutputStore.MAX_BYTES + 1, truncated: true })
      }),
    ),
  )

  it.live("preserves ordinary truncated metadata when bounding contextual output", () =>
    withStore(({ store }) =>
      Effect.gen(function* () {
        const result = yield* store.bound({
          sessionID,
          callID: "call-ordinary-truncated",
          output: {
            structured: { truncated: false },
            content: [{ type: "text", text: "x".repeat(ToolOutputStore.MAX_BYTES + 1) }],
          },
        })
        expect(result.output.structured).toEqual({ truncated: false })
      }),
    ),
  )

  it.live("bounds structured data duplicated in projected text independently", () =>
    withStore(({ store, fs }) =>
      Effect.gen(function* () {
        const text = "x".repeat(30_000)
        const output = { structured: { output: text }, content: [{ type: "text" as const, text }] }
        const result = yield* store.bound({ sessionID, callID: "call-duplicated", output })
        expect(result.output.content).toEqual(output.content)
        expect(result.output.structured).toEqual({
          _truncated: true,
          _bytes: Buffer.byteLength(JSON.stringify(output.structured)),
          _outputPath: result.outputPaths[0],
        })
        expect(JSON.parse(yield* fs.readFileString(result.outputPaths[0]))).toEqual(output.structured)
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
            callID: "call-lossy",
            output: { structured: {}, content: [{ type: "text", text: "x".repeat(ToolOutputStore.MAX_BYTES + 1) }] },
          })
          .pipe(Effect.exit)
        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit))
          expect(Option.getOrUndefined(Cause.findErrorOption(exit.cause))?._tag).toBe("ToolOutputStore.StorageError")
      }),
    ),
  )

  it.live("rejects unencodable structured metadata even when projected content exists", () =>
    withStore(({ store }) =>
      Effect.gen(function* () {
        const output = { structured: { value: 1n }, content: [{ type: "text" as const, text: "readable text" }] }
        const exit = yield* store.bound({ sessionID, callID: "call-unencodable", output }).pipe(Effect.exit)
        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit))
          expect(Option.getOrUndefined(Cause.findErrorOption(exit.cause))).toMatchObject({
            _tag: "ToolOutputStore.StorageError",
            operation: "encode",
          })
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
      ).pipe(Layer.provide(LayerNode.compile(FSUtil.node)))
      const store = AppNodeBuilder.build(ToolOutputStore.nodeWithoutConfig, [
        [Global.node, Global.layerWith({ data: root.path })],
        [FSUtil.node, blockedFilesystem],
      ])
      const exit = yield* Effect.gen(function* () {
        const service = yield* ToolOutputStore.Service
        const fiber = yield* service
          .bound({
            sessionID,
            callID: "call-interrupted",
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
            callID: "call-config",
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
