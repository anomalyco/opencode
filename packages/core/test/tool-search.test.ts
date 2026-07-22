import { describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { FileSystem } from "@opencode-ai/core/filesystem"
import { FSUtil } from "@opencode-ai/util/fs-util"
import { Location } from "@opencode-ai/core/location"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { GlobTool } from "@opencode-ai/core/tool/glob"
import { GrepTool } from "@opencode-ai/core/tool/grep"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { ToolOutputStore } from "@opencode-ai/core/tool-output-store"
import { location } from "./fixture/location"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"
import { executeTool, registerToolPlugin, settleTool, toolIdentity } from "./lib/tool"

const globToolNode = makeLocationNode({
  name: "test/glob-tool-plugin",
  layer: Layer.effectDiscard(registerToolPlugin(GlobTool.Plugin)),
  deps: [ToolRegistry.toolsNode, FSUtil.node, Ripgrep.node, Location.node, PermissionV2.node],
})
const grepToolNode = makeLocationNode({
  name: "test/grep-tool-plugin",
  layer: Layer.effectDiscard(registerToolPlugin(GrepTool.Plugin)),
  deps: [ToolRegistry.toolsNode, FSUtil.node, Ripgrep.node, Location.node, PermissionV2.node],
})
const permission = Layer.succeed(
  PermissionV2.Service,
  PermissionV2.Service.of({
    assert: () => Effect.void,
    ask: () => Effect.die("unused"),
    reply: () => Effect.die("unused"),
    get: () => Effect.die("unused"),
    forSession: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
  }),
)
const sessionID = SessionV2.ID.make("ses_search_tool_test")

const withTools = <A, E, R>(directory: string, body: (registry: ToolRegistry.Interface) => Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    return yield* body(yield* ToolRegistry.Service)
  }).pipe(
    Effect.provide(
      AppNodeBuilder.build(LayerNode.group([ToolRegistry.node, ToolRegistry.toolsNode, globToolNode, grepToolNode]), [
        [
          Location.node,
          Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(directory) }))),
        ],
        [PermissionV2.node, permission],
        [ToolOutputStore.node, ToolOutputStore.nodeWithoutConfig],
      ]),
    ),
  )

const call = (name: "glob" | "grep", input: unknown) => ({
  sessionID,
  ...toolIdentity,
  call: { type: "tool-call" as const, id: `call-${name}`, name, input },
})

const it = testEffect(Layer.empty)

describe("search tools", () => {
  it.live("bounds omitted glob and grep limits", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            Promise.all(
              Array.from({ length: FileSystem.DEFAULT_SEARCH_LIMIT + 1 }, (_, index) =>
                fs.writeFile(path.join(tmp.path, `${index}.txt`), "needle\n"),
              ),
            ),
          )
          yield* withTools(tmp.path, (registry) =>
            Effect.gen(function* () {
              const glob = yield* settleTool(registry, call("glob", { pattern: "*" }))
              const grep = yield* settleTool(registry, call("grep", { pattern: "needle" }))

              expect(glob.output?.structured).toEqual({ count: FileSystem.DEFAULT_SEARCH_LIMIT })
              expect(grep.output?.structured).toEqual({ matches: FileSystem.DEFAULT_SEARCH_LIMIT })
              expect(glob.output?.content).toEqual([{ type: "text", text: glob.result.value }])
              expect(grep.output?.content).toEqual([{ type: "text", text: grep.result.value }])
              expect(String(glob.result.value).split("\n")).toHaveLength(FileSystem.DEFAULT_SEARCH_LIMIT)
              expect(grep.result.value).toStartWith(`Found ${FileSystem.DEFAULT_SEARCH_LIMIT} matches\n`)
            }),
          )
        }),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  for (const name of ["glob", "grep"] as const) {
    it.live(`${name} reports a missing search path`, () =>
      Effect.acquireUseRelease(
        Effect.promise(() => tmpdir()),
        (tmp) =>
          withTools(tmp.path, (registry) =>
            Effect.gen(function* () {
              const result = yield* executeTool(
                registry,
                call(name, { path: "missing", pattern: name === "glob" ? "*" : "needle" }),
              )
              expect(result).toEqual({ type: "error", value: "Search path does not exist: missing" })
            }),
          ),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      ),
    )
  }

  it.effect("records deterministic size reductions for representative search and web payloads", () =>
    Effect.sync(() => {
      const entries = Array.from({ length: 100 }, (_, index) => ({
        path: `src/generated/feature-${String(index).padStart(3, "0")}.typescript`,
        type: "file",
      }))
      const matches = entries.map((entry, index) => ({
        entry,
        line: index + 1,
        offset: index * 80,
        text: `export const generatedFeature${index} = "representative search payload"`,
        submatches: [{ text: "representative", start: 42, end: 56 }],
      }))
      const webfetch = {
        url: "https://example.com/reference",
        contentType: "text/markdown; charset=utf-8",
        format: "markdown",
        output: "representative web content\n".repeat(2_000),
      }
      const websearch = { provider: "exa", text: "representative search context\n".repeat(2_000) }
      const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value))

      expect({
        glob: { complete: bytes(entries), compact: bytes({ count: entries.length }) },
        grep: { complete: bytes(matches), compact: bytes({ matches: matches.length }) },
        webfetch: { complete: bytes(webfetch), compact: bytes({ contentType: webfetch.contentType }) },
        websearch: { complete: bytes(websearch), compact: bytes({ provider: websearch.provider }) },
      }).toEqual({
        glob: { complete: 6_201, compact: 13 },
        grep: { complete: 23_367, compact: 15 },
        webfetch: { complete: 56_116, compact: 46 },
        websearch: { complete: 62_028, compact: 18 },
      })
    }),
  )
})
