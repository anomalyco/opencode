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
const otherSessionID = SessionV2.ID.make("ses_tool_output_store_other")

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
  it.live("returns under-limit text unchanged without writing a resource", () =>
    withStore(({ store }) =>
      Effect.gen(function* () {
        expect(yield* store.truncate({ sessionID, toolCallID: "call-short", content: "line one\nline two" })).toEqual({
          content: "line one\nline two",
          truncated: false,
        })
      }),
    ),
  )

  it.live("stores byte-truncated output and returns an opaque head-tail preview", () =>
    withStore(({ store }) =>
      Effect.gen(function* () {
        const content = "HEAD-" + "x".repeat(100) + "-TAIL"
        const result = yield* store.truncate({ sessionID, toolCallID: "call-bytes", content, maxBytes: 20 })

        expect(result.truncated).toBe(true)
        if (!result.truncated) throw new Error("expected truncation")
        expect(result.content).toContain("HEAD-")
        expect(result.content).toContain("-TAIL")
        expect(result.content).toContain("output truncated")
        expect(result.resource.uri).toMatch(/^tool-output:\/\/[0-9A-Za-z]+$/)
        expect(result.resource.uri.slice("tool-output://".length)).not.toContain("/")
        expect(result.resource.uri).not.toContain("\\")
        expect(result.resource).toMatchObject({ mime: "text/plain", size: Buffer.byteLength(content) })
        expect((yield* store.read({ sessionID, uri: result.resource.uri })).content).toBe(content)
      }),
    ),
  )

  it.live("stores line-truncated output and keeps both ends in the preview", () =>
    withStore(({ store }) =>
      Effect.gen(function* () {
        const content = Array.from({ length: 10 }, (_, index) => `line-${index}`).join("\n")
        const result = yield* store.truncate({ sessionID, toolCallID: "call-lines", content, maxLines: 4 })

        expect(result.truncated).toBe(true)
        if (!result.truncated) throw new Error("expected truncation")
        expect(result.content).toContain("line-0\nline-1")
        expect(result.content).toContain("line-8\nline-9")
        expect(result.content).not.toContain("line-4")
      }),
    ),
  )

  it.live("keeps one-line previews bounded", () =>
    withStore(({ store }) =>
      Effect.gen(function* () {
        const result = yield* store.truncate({
          sessionID,
          toolCallID: "call-one-line",
          content: "one\ntwo\nthree",
          maxLines: 1,
        })

        expect(result.truncated).toBe(true)
        if (!result.truncated) throw new Error("expected truncation")
        const preview = result.content.split("\n\n... output truncated")[0]
        expect(preview).toBe("one")
      }),
    ),
  )

  it.live("pages reads within the bounded managed-resource limit", () =>
    withStore(({ root, store, fs }) =>
      Effect.gen(function* () {
        const resource = yield* store.write({
          sessionID,
          toolCallID: "call-page",
          content: "0123456789",
          name: "out.txt",
        })
        const first = yield* store.read({ sessionID, uri: resource.uri, limit: 4 })
        const second = yield* store.read({ sessionID, uri: resource.uri, offset: first.next, limit: 4 })
        const last = yield* store.read({ sessionID, uri: resource.uri, offset: second.next, limit: 4 })

        expect(first).toMatchObject({ content: "0123", offset: 0, truncated: true, next: 4 })
        expect(second).toMatchObject({ content: "4567", offset: 4, truncated: true, next: 8 })
        expect(last).toMatchObject({ content: "89", offset: 8, truncated: false })
        expect(last.resource).toEqual({ uri: resource.uri, mime: "text/plain", name: "out.txt", size: 10 })
        expect(
          JSON.parse(
            yield* fs.readFileString(
              path.join(root, "tool-output", "managed", `${resource.uri.slice("tool-output://".length)}.json`),
            ),
          ),
        ).toMatchObject({
          sessionID,
          toolCallID: "call-page",
        })

        const bounded = yield* store.read({
          sessionID,
          uri: (yield* store.write({
            sessionID,
            toolCallID: "call-bounded",
            content: "x".repeat(ToolOutputStore.MAX_READ_BYTES + 10),
          })).uri,
          limit: ToolOutputStore.MAX_READ_BYTES + 10,
        })
        expect(Buffer.byteLength(bounded.content)).toBe(ToolOutputStore.MAX_READ_BYTES)
        expect(bounded).toMatchObject({ truncated: true, next: ToolOutputStore.MAX_READ_BYTES })
      }),
    ),
  )

  it.live("allows the owning session and denies cross-session reads", () =>
    withStore(({ store }) =>
      Effect.gen(function* () {
        const resource = yield* store.write({ sessionID, toolCallID: "call-owned", content: "owned" })
        expect((yield* store.read({ sessionID, uri: resource.uri })).content).toBe("owned")
        expect(yield* Effect.flip(store.read({ sessionID: otherSessionID, uri: resource.uri }))).toBeInstanceOf(
          ToolOutputStore.AccessDeniedError,
        )
      }),
    ),
  )

  it.live("rejects resources whose payload size no longer matches metadata", () =>
    withStore(({ root, store, fs }) =>
      Effect.gen(function* () {
        const resource = yield* store.write({ sessionID, toolCallID: "call-modified", content: "original" })
        const id = resource.uri.slice("tool-output://".length)
        yield* fs.writeFileString(path.join(root, "tool-output", "managed", `${id}.txt`), "changed payload")

        expect(yield* Effect.flip(store.read({ sessionID, uri: resource.uri }))).toBeInstanceOf(
          ToolOutputStore.ResourceNotFoundError,
        )
      }),
    ),
  )

  it.live("honors configured truncation limits", () =>
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

  it.live("cleans old managed resources while preserving recent and unrelated files", () =>
    withStore(({ root, store, fs }) =>
      Effect.gen(function* () {
        const old = yield* store.write({ sessionID, toolCallID: "call-old", content: "old" })
        const recent = yield* store.write({ sessionID, toolCallID: "call-recent", content: "recent" })
        const directory = path.join(root, "tool-output", "managed")
        const oldID = old.uri.slice("tool-output://".length)
        const recentID = recent.uri.slice("tool-output://".length)
        const oldMetadata = path.join(directory, `${oldID}.json`)
        const unrelated = path.join(root, "tool-output", "unrelated.txt")
        const unrelatedManaged = path.join(directory, "unrelated.txt")
        const record = JSON.parse(yield* fs.readFileString(oldMetadata))

        yield* fs.writeFileString(
          oldMetadata,
          JSON.stringify({ ...record, created: Date.now() - 8 * 24 * 60 * 60 * 1_000 }),
        )
        yield* fs.writeFileString(unrelated, "keep")
        yield* fs.writeFileString(unrelatedManaged, "keep")
        yield* store.cleanup()

        expect(yield* fs.exists(path.join(directory, `${oldID}.txt`))).toBe(false)
        expect(yield* fs.exists(oldMetadata)).toBe(false)
        expect(yield* fs.exists(path.join(directory, `${recentID}.txt`))).toBe(true)
        expect(yield* fs.exists(unrelated)).toBe(true)
        expect(yield* fs.exists(unrelatedManaged)).toBe(true)
      }),
    ),
  )

  it.live("cleans stale generated orphan payloads and malformed pairs", () =>
    withStore(({ root, store, fs }) =>
      Effect.gen(function* () {
        const directory = path.join(root, "tool-output", "managed")
        yield* fs.ensureDir(directory)
        const orphanID = "00000000000000000000000000"
        const malformedID = "00000000000000000000000001"
        const orphan = path.join(directory, `${orphanID}.txt`)
        const malformedPayload = path.join(directory, `${malformedID}.txt`)
        const malformedMetadata = path.join(directory, `${malformedID}.json`)
        yield* fs.writeFileString(orphan, "orphan")
        yield* fs.writeFileString(malformedPayload, "malformed")
        yield* fs.writeFileString(malformedMetadata, "not json")
        const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1_000)
        yield* Effect.all([fs.utimes(orphan, old, old), fs.utimes(malformedPayload, old, old)])

        yield* store.cleanup()

        expect(yield* fs.exists(orphan)).toBe(false)
        expect(yield* fs.exists(malformedPayload)).toBe(false)
        expect(yield* fs.exists(malformedMetadata)).toBe(false)
      }),
    ),
  )

  it.live("cleans managed resources whose payload size no longer matches metadata", () =>
    withStore(({ root, store, fs }) =>
      Effect.gen(function* () {
        const resource = yield* store.write({ sessionID, toolCallID: "call-modified", content: "original" })
        const directory = path.join(root, "tool-output", "managed")
        const id = resource.uri.slice("tool-output://".length)
        const payload = path.join(directory, `${id}.txt`)
        const metadata = path.join(directory, `${id}.json`)
        yield* fs.writeFileString(payload, "changed payload")

        yield* store.cleanup()

        expect(yield* fs.exists(payload)).toBe(false)
        expect(yield* fs.exists(metadata)).toBe(false)
      }),
    ),
  )
})
