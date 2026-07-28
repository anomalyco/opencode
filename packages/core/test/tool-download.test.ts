import fs from "node:fs/promises"
import path from "node:path"
import { createHash } from "node:crypto"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { LayerNodePlatform } from "@opencode-ai/core/effect/app-node-platform"
import { Location } from "@opencode-ai/core/location"
import { LocationMutation } from "@opencode-ai/core/location-mutation"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { DownloadTool } from "@opencode-ai/core/tool/download"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { ToolOutputStore } from "@opencode-ai/core/tool-output-store"
import { location } from "./fixture/location"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"
import { settleTool, toolDefinitions, toolIdentity } from "./lib/tool"

const sessionID = SessionV2.ID.make("ses_download_tool_test")
const payload = new TextEncoder().encode("large-file-chunk".repeat(16_384))
const checksum = createHash("sha256").update(payload).digest("hex")
const assertions: PermissionV2.AssertInput[] = []

const downloadPhase = (update: Record<string, unknown>) => {
  const download = update.download
  if (!download || typeof download !== "object" || Array.isArray(download)) return
  const phase: unknown = Reflect.get(download, "phase")
  return typeof phase === "string" ? phase : undefined
}

const permission = Layer.succeed(
  PermissionV2.Service,
  PermissionV2.Service.of({
    assert: (input) => Effect.sync(() => assertions.push(input)),
    ask: () => Effect.die("unused"),
    reply: () => Effect.die("unused"),
    get: () => Effect.die("unused"),
    forSession: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
  }),
)

const http = Layer.succeed(
  HttpClient.HttpClient,
  HttpClient.make((request) =>
    Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        new Response(payload, {
          headers: { "content-length": String(payload.byteLength), "content-type": "application/octet-stream" },
        }),
      ),
    ),
  ),
)

const withTool = <A, E, R>(directory: string, body: (registry: ToolRegistry.Interface) => Effect.Effect<A, E, R>) => {
  const activeLocation = Layer.succeed(
    Location.Service,
    Location.Service.of(location({ directory: AbsolutePath.make(directory) })),
  )
  return Effect.gen(function* () {
    return yield* body(yield* ToolRegistry.Service)
  }).pipe(
    Effect.provide(
      AppNodeBuilder.build(
        LayerNode.group([ToolRegistry.node, ToolRegistry.toolsNode, LocationMutation.node, DownloadTool.node]),
        [
          [Location.node, activeLocation],
          [PermissionV2.node, permission],
          [ToolOutputStore.node, ToolOutputStore.nodeWithoutConfig],
          [LayerNodePlatform.httpClient, http],
        ],
      ),
    ),
  )
}

const call = (
  input: typeof DownloadTool.Input.Type,
  progress: NonNullable<ToolRegistry.ExecuteInput["progress"]>,
  id = "call-download",
) => ({
  sessionID,
  ...toolIdentity,
  call: { type: "tool-call" as const, id, name: "download", input },
  progress,
})

const it = testEffect(Layer.empty)

describe("DownloadTool", () => {
  it.live("streams to disk, publishes progress, verifies SHA-256, and settles only after completion", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => {
        assertions.length = 0
        const updates: Record<string, unknown>[] = []
        return withTool(tmp.path, (registry) =>
          Effect.gen(function* () {
            expect((yield* toolDefinitions(registry)).map((tool) => tool.name)).toEqual(["download"])
            const settled = yield* settleTool(
              registry,
              call(
                { url: "https://example.com/archive.bin", filePath: "artifacts/archive.bin", sha256: checksum },
                (update) => Effect.sync(() => updates.push(update.structured)),
              ),
            )
            const target = path.join(tmp.path, "artifacts", "archive.bin")
            expect(new Uint8Array(yield* Effect.promise(() => fs.readFile(target)))).toEqual(payload)
            expect(settled.result).toMatchObject({ type: "text", value: expect.stringContaining(checksum) })
            expect(settled.output?.structured).toMatchObject({
              sha256: checksum,
              download: { phase: "completed", receivedBytes: payload.byteLength, totalBytes: payload.byteLength },
            })
            expect(updates.map(downloadPhase)).toEqual(["starting", "downloading", "verifying", "completed"])
            expect(assertions.map((input) => input.action)).toEqual(["download", "edit"])
            expect(
              (yield* Effect.promise(() => fs.readdir(path.dirname(target)))).some((name) =>
                name.includes(".opencode-part-"),
              ),
            ).toBe(false)
          }),
        )
      },
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("reports checksum failures and removes the partial file", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        withTool(tmp.path, (registry) =>
          Effect.gen(function* () {
            const target = path.join(tmp.path, "bad.bin")
            const settled = yield* settleTool(
              registry,
              call(
                { url: "https://example.com/bad.bin", filePath: "bad.bin", sha256: "0".repeat(64) },
                () => Effect.void,
                "call-bad-checksum",
              ),
            )
            expect(settled.result).toMatchObject({ type: "error", value: expect.stringContaining("SHA-256 mismatch") })
            expect(
              yield* Effect.promise(() =>
                fs.stat(target).then(
                  () => true,
                  () => false,
                ),
              ),
            ).toBe(false)
            expect(
              (yield* Effect.promise(() => fs.readdir(tmp.path))).some((name) => name.includes(".opencode-part-")),
            ).toBe(false)
          }),
        ),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )
})
