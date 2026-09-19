import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { describe, expect } from "bun:test"
import path from "path"
import os from "os"
import { symlink } from "fs/promises"
import { Effect } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import type { Tool } from "@/tool/tool"
import { assertExternalDirectoryEffect } from "../../src/tool/external-directory"
import { Filesystem } from "@/util/filesystem"
import { TestInstance, tmpdirScoped } from "../fixture/fixture"
import type { Permission } from "../../src/permission"
import { evaluate, fromConfig } from "../../src/permission"
import { SessionID, MessageID } from "../../src/session/schema"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(CrossSpawnSpawner.node))

const baseCtx: Omit<Tool.Context, "ask"> = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make("msg_test"),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
}

const glob = (p: string) =>
  process.platform === "win32" ? Filesystem.normalizePathPattern(p) : p.replaceAll("\\", "/")

function makeCtx() {
  const requests: Array<Omit<PermissionV1.Request, "id" | "sessionID" | "tool">> = []
  const ctx: Tool.Context = {
    ...baseCtx,
    ask: (req) =>
      Effect.sync(() => {
        requests.push(req)
      }),
  }
  return { requests, ctx }
}

describe("tool.assertExternalDirectory", () => {
  it.live("no-ops for empty target", () =>
    Effect.gen(function* () {
      const { requests, ctx } = makeCtx()

      yield* assertExternalDirectoryEffect(ctx)

      expect(requests.length).toBe(0)
    }),
  )

  it.instance("no-ops for paths inside the instance directory", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const { requests, ctx } = makeCtx()

      yield* assertExternalDirectoryEffect(ctx, path.join(test.directory, "file.txt"))

      expect(requests.length).toBe(0)
    }),
  )

  it.instance("asks with a single canonical glob", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const { requests, ctx } = makeCtx()

      const target = path.join(path.dirname(test.directory), "outside", "file.txt")
      const expected = glob(path.join(path.dirname(target), "*"))

      yield* assertExternalDirectoryEffect(ctx, target)

      const req = requests.find((r) => r.permission === "external_directory")
      expect(req).toBeDefined()
      expect(req!.patterns).toEqual([expected])
      expect(req!.always).toEqual([expected])
    }),
  )

  it.instance("uses target directory when kind=directory", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const { requests, ctx } = makeCtx()

      const target = path.join(path.dirname(test.directory), "outside")
      const expected = glob(path.join(target, "*"))

      yield* assertExternalDirectoryEffect(ctx, target, { kind: "directory" })

      const req = requests.find((r) => r.permission === "external_directory")
      expect(req).toBeDefined()
      expect(req!.patterns).toEqual([expected])
      expect(req!.always).toEqual([expected])
    }),
  )

  it.instance("requests the lexical pattern and persists the resolved always grant", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const outside = yield* tmpdirScoped()
      yield* Effect.promise(() => Bun.write(path.join(outside, "file.txt"), "x"))
      const alias = path.join(test.directory, "alias")
      yield* Effect.promise(() => symlink(outside, alias, "dir"))
      const { requests, ctx } = makeCtx()

      yield* assertExternalDirectoryEffect(ctx, path.join(alias, "file.txt"))

      const req = requests.find((r) => r.permission === "external_directory")
      expect(req).toBeDefined()
      expect(req!.patterns).toEqual([glob(path.join(alias, "*"))])
      expect(req!.always).toEqual([glob(path.join(outside, "*"))])
    }),
  )

  it.instance("does not ask when an allow rule matches the lexical alias path", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const outside = yield* tmpdirScoped()
      yield* Effect.promise(() => Bun.write(path.join(outside, "file.txt"), "x"))
      const alias = path.join(test.directory, "alias")
      yield* Effect.promise(() => symlink(outside, alias, "dir"))
      const ruleset = fromConfig({ external_directory: { [path.join(alias, "*")]: "allow" } })
      const { requests, ctx } = makeCtx()
      const next: Tool.Context = {
        ...ctx,
        ask: (req) =>
          Effect.sync(() => {
            const needsAsk = req.patterns.some(
              (pattern) => evaluate(req.permission, pattern, ruleset).action !== "allow",
            )
            if (needsAsk) requests.push(req)
          }),
      }

      yield* assertExternalDirectoryEffect(next, path.join(alias, "file.txt"))

      expect(requests.find((r) => r.permission === "external_directory")).toBeUndefined()
    }),
  )

  it.instance("asks when a symlink inside the directory escapes it", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const { requests, ctx } = makeCtx()
      const link = path.join(test.directory, "vendor")
      yield* Effect.promise(() => symlink(os.tmpdir(), link))

      yield* assertExternalDirectoryEffect(ctx, path.join(link, "escape.txt"))

      expect(requests.some((r) => r.permission === "external_directory")).toBe(true)
    }),
  )

  it.instance("asks for a non-existent target under an escaping symlinked parent", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const { requests, ctx } = makeCtx()
      const link = path.join(test.directory, "vendor")
      yield* Effect.promise(() => symlink(os.tmpdir(), link))

      yield* assertExternalDirectoryEffect(ctx, path.join(link, "created", "new-file.txt"))

      expect(requests.some((r) => r.permission === "external_directory")).toBe(true)
    }),
  )

  it.live("skips prompting when bypass=true", () =>
    Effect.gen(function* () {
      const { requests, ctx } = makeCtx()

      yield* assertExternalDirectoryEffect(ctx, "/tmp/outside/file.txt", { bypass: true })

      expect(requests.length).toBe(0)
    }),
  )

  if (process.platform === "win32") {
    it.instance(
      "normalizes Windows path variants to one glob",
      () =>
        Effect.gen(function* () {
          const { requests, ctx } = makeCtx()

          const outerTmp = yield* tmpdirScoped()
          yield* Effect.promise(() => Bun.write(path.join(outerTmp, "outside.txt"), "x"))

          const target = path.join(outerTmp, "outside.txt")
          const alt = target
            .replace(/^[A-Za-z]:/, "")
            .replaceAll("\\", "/")
            .toLowerCase()

          yield* assertExternalDirectoryEffect(ctx, alt)

          const req = requests.find((r) => r.permission === "external_directory")
          const expected = glob(path.join(outerTmp, "*"))
          expect(req).toBeDefined()
          expect(req!.patterns).toEqual([expected])
          expect(req!.always).toEqual([expected])
        }),
      { git: true },
    )

    it.instance(
      "uses drive root glob for root files",
      () =>
        Effect.gen(function* () {
          const { requests, ctx } = makeCtx()

          const tmp = yield* TestInstance
          const root = path.parse(tmp.directory).root
          const target = path.join(root, "boot.ini")

          yield* assertExternalDirectoryEffect(ctx, target)

          const req = requests.find((r) => r.permission === "external_directory")
          const expected = path.join(root, "*")
          expect(req).toBeDefined()
          expect(req!.patterns).toEqual([expected])
          expect(req!.always).toEqual([expected])
        }),
      { git: true },
    )
  }
})
